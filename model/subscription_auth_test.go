package model

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSubscriptionGroupTransitionsPreserveAuthVersionAndSessions(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	user := User{
		Username:    "subscription-auth-user",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, CreateUserSession(&UserSession{
		SID:             "subscription-auth-session",
		UserID:          user.Id,
		Version:         1,
		UserAuthVersion: 1,
		Status:          UserSessionStatusActive,
		RefreshHash:     "refresh-hash",
		LoginMethod:     "password",
		LastActiveAt:    now,
		ExpiresAt:       now + 3600,
	}))
	require.NoError(t, populateUserCache(user))
	plan := &SubscriptionPlan{
		Title:         "Upgraded",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   100,
		UpgradeGroup:  "pro",
		RouteGroups:   []string{"pro"},
		Enabled:       true,
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, plan.Id, plan.RouteGroups))

	subscription, err := CreateUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.NoError(t, err)
	require.Equal(t, "default", subscription.PrevUserGroup)
	require.NoError(t, RefreshUserGroupCache(user.Id))

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "pro", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	var session UserSession
	require.NoError(t, DB.First(&session, "sid = ?", "subscription-auth-session").Error)
	assert.Equal(t, UserSessionStatusActive, session.Status)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "pro", cached.Group)
	assert.EqualValues(t, 1, cached.AuthVersion)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		target, err := downgradeUserGroupForSubscriptionTx(tx, subscription, now+1)
		assert.Equal(t, "default", target)
		return err
	}))
	require.NoError(t, RefreshUserGroupCache(user.Id))
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "default", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	require.NoError(t, DB.First(&session, "sid = ?", "subscription-auth-session").Error)
	assert.Equal(t, UserSessionStatusActive, session.Status)
	cached, err = GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "default", cached.Group)
}

func TestSubscriptionGroupCacheRefreshFailureDoesNotChangeCommittedResult(t *testing.T) {
	previousDB, previousLogDB := DB, LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(
		&User{},
		&SubscriptionPlan{},
		&UserSubscription{},
		&SubscriptionPlanQuotaWindow{},
		&UserSubscriptionQuotaWindow{},
		&SubscriptionPlanRouteGroup{},
		&UserSubscriptionRouteGroup{},
		&SubscriptionPreConsumeRecord{},
	))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		_ = sqlDB.Close()
	})

	user := User{
		Username:    "subscription-cache-failure",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	plan := &SubscriptionPlan{
		Title:         "Cache failure plan",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   100,
		UpgradeGroup:  "pro",
		RouteGroups:   []string{"pro"},
		Enabled:       true,
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, plan.Id, plan.RouteGroups))
	InvalidateSubscriptionPlanCache(plan.Id)

	oldRedisEnabled, oldRDB := common.RedisEnabled, common.RDB
	common.RedisEnabled = true
	common.RDB = redis.NewClient(&redis.Options{
		Dialer: func(context.Context, string, string) (net.Conn, error) {
			return nil, errors.New("forced redis failure")
		},
		MaxRetries: -1,
	})
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RedisEnabled, common.RDB = oldRedisEnabled, oldRDB
	})

	message, err := AdminBindSubscription(user.Id, plan.Id, "test")
	require.NoError(t, err)
	require.NotNil(t, message)
	assert.Equal(t, "pro", message.Params["group"])

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "pro", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	var subscription UserSubscription
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&subscription).Error)
	assert.Equal(t, "active", subscription.Status)
}

func TestExpiredSubscriptionRepurchasePreservesOriginalGroup(t *testing.T) {
	for _, source := range []string{"admin", "balance", "order"} {
		t.Run(source, func(t *testing.T) {
			truncateTables(t)
			user := User{Username: "expired-repurchase-user", Password: "unused-password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "paid-user"}
			require.NoError(t, DB.Create(&user).Error)
			plan := SubscriptionPlan{Title: "Subscription", Currency: "CNY", DurationUnit: SubscriptionDurationDay, DurationValue: 1, UpgradeGroup: "subscription-user", RouteGroups: []string{"subscription-route"}, Enabled: true}
			require.NoError(t, DB.Create(&plan).Error)
			require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, plan.Id, plan.RouteGroups))
			InvalidateSubscriptionPlanCache(plan.Id)
			_, err := AdminBindSubscription(user.Id, plan.Id, "test")
			require.NoError(t, err)
			var first UserSubscription
			require.NoError(t, DB.Where("user_id = ?", user.Id).First(&first).Error)
			now := time.Now().Unix()
			require.NoError(t, DB.Model(&first).Update("end_time", now-10).Error)

			switch source {
			case "admin":
				_, err = AdminBindSubscription(user.Id, plan.Id, "test")
			case "balance":
				_, err = PurchaseSubscriptionWithBalance(user.Id, plan.Id)
			case "order":
				order := SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: "expired-repurchase-order", PaymentProvider: "test", PaymentMethod: "test", Status: common.TopUpStatusPending}
				require.NoError(t, DB.Create(&order).Error)
				err = CompleteSubscriptionOrder(order.TradeNo, "", "test", "")
			}
			require.NoError(t, err)
			var renewed UserSubscription
			require.NoError(t, DB.Where("user_id = ?", user.Id).Order("id desc").First(&renewed).Error)
			assert.NotEqual(t, first.Id, renewed.Id)
			assert.Equal(t, "paid-user", renewed.PrevUserGroup)
			require.NoError(t, DB.First(&first, first.Id).Error)
			assert.Equal(t, "expired", first.Status)
			require.NoError(t, DB.Model(&renewed).Update("end_time", now-1).Error)
			if source == "admin" {
				_, err = ExpireDueSubscriptions(200)
			} else {
				_, err = ExpireDueSubscriptionsForUser(user.Id)
			}
			require.NoError(t, err)
			var updated User
			require.NoError(t, DB.First(&updated, user.Id).Error)
			assert.Equal(t, "paid-user", updated.Group)
		})
	}
}

func TestSubscriptionRepurchaseFailureRollsBackExpiredGroupTransition(t *testing.T) {
	truncateTables(t)
	user := User{Username: "failed-repurchase-user", Password: "unused-password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "paid-user"}
	require.NoError(t, DB.Create(&user).Error)
	plan := SubscriptionPlan{Title: "Subscription", Currency: "CNY", DurationUnit: SubscriptionDurationDay, DurationValue: 1, UpgradeGroup: "subscription-user", RouteGroups: []string{"subscription-route"}, Enabled: true}
	require.NoError(t, DB.Create(&plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, plan.Id, plan.RouteGroups))
	InvalidateSubscriptionPlanCache(plan.Id)
	_, err := AdminBindSubscription(user.Id, plan.Id, "test")
	require.NoError(t, err)
	var first UserSubscription
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&first).Error)
	require.NoError(t, DB.Model(&first).Update("end_time", time.Now().Unix()-10).Error)
	const callbackName = "test:fail-subscription-repurchase"
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "user_subscriptions" {
			tx.AddError(errors.New("forced subscription insert failure"))
		}
	}))
	t.Cleanup(func() { DB.Callback().Create().Remove(callbackName) })

	_, err = AdminBindSubscription(user.Id, plan.Id, "test")
	require.ErrorContains(t, err, "forced subscription insert failure")
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "subscription-user", updated.Group)
	require.NoError(t, DB.First(&first, first.Id).Error)
	assert.Equal(t, "active", first.Status)
	assert.Equal(t, "paid-user", first.PrevUserGroup)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestExpiredSubscriptionReplacementWithoutUpgradeRefreshesGroupCache(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)
	user := User{Username: "replacement-cache-user", Password: "unused-password-hash", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "paid-user", AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	firstPlan := SubscriptionPlan{Title: "First subscription", Currency: "CNY", DurationUnit: SubscriptionDurationDay, DurationValue: 1, UpgradeGroup: "subscription-user", RouteGroups: []string{"subscription-route"}, Enabled: true}
	require.NoError(t, DB.Create(&firstPlan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, firstPlan.Id, firstPlan.RouteGroups))
	InvalidateSubscriptionPlanCache(firstPlan.Id)
	_, err := AdminBindSubscription(user.Id, firstPlan.Id, "test")
	require.NoError(t, err)
	var first UserSubscription
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&first).Error)
	require.NoError(t, DB.Model(&first).Update("end_time", time.Now().Unix()-10).Error)
	secondPlan := SubscriptionPlan{Title: "Replacement subscription", Currency: "CNY", DurationUnit: SubscriptionDurationDay, DurationValue: 1, RouteGroups: []string{"regular-route"}, Enabled: true}
	require.NoError(t, DB.Create(&secondPlan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, secondPlan.Id, secondPlan.RouteGroups))
	InvalidateSubscriptionPlanCache(secondPlan.Id)

	_, err = AdminBindSubscription(user.Id, secondPlan.Id, "test")
	require.NoError(t, err)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "paid-user", cached.Group)
}

func TestSubscriptionExpirationDoesNotStallForDeletedOwner(t *testing.T) {
	for _, hardDelete := range []bool{false, true} {
		t.Run(fmt.Sprintf("hard_delete=%t", hardDelete), func(t *testing.T) {
			truncateTables(t)
			user := User{Username: "deleted-subscription-owner", Password: "unused-password-hash", Group: "subscription-user"}
			require.NoError(t, DB.Create(&user).Error)
			subscription := UserSubscription{UserId: user.Id, Status: "active", StartTime: time.Now().Unix() - 100, EndTime: time.Now().Unix() - 1, UpgradeGroup: "subscription-user", PrevUserGroup: "paid-user"}
			require.NoError(t, DB.Create(&subscription).Error)
			deleteQuery := DB
			if hardDelete {
				deleteQuery = deleteQuery.Unscoped()
			}
			require.NoError(t, deleteQuery.Delete(&user).Error)

			count, err := ExpireDueSubscriptions(200)
			require.NoError(t, err)
			assert.Equal(t, 1, count)
			require.NoError(t, DB.First(&subscription, subscription.Id).Error)
			assert.Equal(t, "expired", subscription.Status)
		})
	}
}
