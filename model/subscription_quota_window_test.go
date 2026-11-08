package model

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedQuotaWindowSubscription(t *testing.T, plan *SubscriptionPlan) (*User, *UserSubscription) {
	t.Helper()
	truncateTables(t)
	user := &User{
		Username: fmt.Sprintf("window-user-%d", plan.Id),
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanQuotaWindowsTx(DB, plan.Id, plan.QuotaWindows))
	if len(plan.RouteGroups) == 0 {
		routeGroup := plan.UpgradeGroup
		if routeGroup == "" {
			routeGroup = "default"
		}
		plan.RouteGroups = []string{routeGroup}
	}
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsWithRatiosTx(DB, plan.Id, plan.RouteGroups, plan.RouteGroupRatios))
	InvalidateSubscriptionPlanCache(plan.Id)

	mutation, err := UpsertUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.NoError(t, err)
	require.NotNil(t, mutation.Subscription)
	return user, mutation.Subscription
}

func quotaWindowUsed(t *testing.T, subscriptionID int) map[int64]int64 {
	t.Helper()
	var subscription UserSubscription
	subscription.Id = subscriptionID
	require.NoError(t, PopulateSubscriptionQuotaWindowUsage(&subscription, GetDBTimestamp()))
	result := make(map[int64]int64, len(subscription.QuotaWindows))
	for _, window := range subscription.QuotaWindows {
		result[window.WindowSeconds] = window.Used
	}
	return result
}

func TestSubscriptionQuotaWindowsShareUsageAndSettlement(t *testing.T) {
	plan := &SubscriptionPlan{
		Id:             11001,
		Title:          "Rolling",
		Currency:       "CNY",
		DurationUnit:   SubscriptionDurationDay,
		DurationValue:  1,
		UpgradeGroup:   "vip",
		MaxConcurrency: 3,
		Enabled:        true,
		RouteGroups:    []string{"vip"},
		RouteGroupRatios: map[string]float64{
			"vip": 1.5,
		},
		QuotaWindows: []SubscriptionQuotaWindow{
			{WindowSeconds: 5 * 60 * 60, QuotaLimit: 300},
			{WindowSeconds: 7 * 24 * 60 * 60, QuotaLimit: 500},
			{WindowSeconds: 30 * 24 * 60 * 60, QuotaLimit: 700},
		},
	}
	_, subscription := seedQuotaWindowSubscription(t, plan)
	assert.Equal(t, 3, subscription.MaxConcurrency)
	assert.Equal(t, map[string]float64{"vip": 1.5}, subscription.RouteGroupRatios)

	snapshot, err := LoadUserSubscriptionQuotaWindowsTx(DB, subscription.Id)
	require.NoError(t, err)
	require.Len(t, snapshot, 3)
	assert.EqualValues(t, 300, snapshot[0].QuotaLimit)

	preConsume, err := PreConsumeUserSubscription("rolling-request-1", subscription.UserId, "deepseek-chat", 0, "vip", 100)
	require.NoError(t, err)
	assert.EqualValues(t, 100, preConsume.AmountUsedAfter)
	assert.Equal(t, map[int64]int64{
		5 * 60 * 60:       100,
		7 * 24 * 60 * 60:  100,
		30 * 24 * 60 * 60: 100,
	}, quotaWindowUsed(t, subscription.Id))

	require.NoError(t, AdjustSubscriptionUsage("rolling-request-1", 25))
	assert.Equal(t, map[int64]int64{
		5 * 60 * 60:       125,
		7 * 24 * 60 * 60:  125,
		30 * 24 * 60 * 60: 125,
	}, quotaWindowUsed(t, subscription.Id))

	require.NoError(t, RefundSubscriptionPreConsume("rolling-request-1"))
	assert.Equal(t, map[int64]int64{
		5 * 60 * 60:       0,
		7 * 24 * 60 * 60:  0,
		30 * 24 * 60 * 60: 0,
	}, quotaWindowUsed(t, subscription.Id))

	_, err = PreConsumeUserSubscription("rolling-request-2", subscription.UserId, "deepseek-chat", 0, "vip", 80)
	require.NoError(t, err)
	require.NoError(t, AdjustSubscriptionUsage("rolling-request-2", -20))
	require.NoError(t, FinalizeSubscriptionUsage("rolling-request-2"))

	var record SubscriptionPreConsumeRecord
	require.NoError(t, DB.Where("request_id = ?", "rolling-request-2").First(&record).Error)
	assert.EqualValues(t, 60, record.UsageQuota)
	assert.NotZero(t, record.FinalizedAt)
	assert.Equal(t, map[int64]int64{
		5 * 60 * 60:       60,
		7 * 24 * 60 * 60:  60,
		30 * 24 * 60 * 60: 60,
	}, quotaWindowUsed(t, subscription.Id))

	// Editing a plan must not rewrite an already purchased snapshot.
	require.NoError(t, ReplaceSubscriptionPlanQuotaWindowsTx(DB, plan.Id, []SubscriptionQuotaWindow{
		{WindowSeconds: 60, QuotaLimit: 1},
	}))
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsWithRatiosTx(DB, plan.Id, []string{"other-route"}, map[string]float64{
		"other-route": 3,
	}))
	snapshot, err = LoadUserSubscriptionQuotaWindowsTx(DB, subscription.Id)
	require.NoError(t, err)
	assert.Len(t, snapshot, 3)
	routeGroups, err := LoadUserSubscriptionRouteGroupsTx(DB, subscription.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{"vip"}, routeGroups)
	routeGroupRatios, err := LoadUserSubscriptionRouteGroupRatiosTx(DB, subscription.Id)
	require.NoError(t, err)
	assert.Equal(t, map[string]float64{"vip": 1.5}, routeGroupRatios)
}

func TestSubscriptionConsumesOnlyThroughSnapshottedRouteGroups(t *testing.T) {
	plan := &SubscriptionPlan{
		Id:             11011,
		Title:          "DeepSeek day pass",
		Currency:       "CNY",
		DurationUnit:   SubscriptionDurationDay,
		DurationValue:  1,
		UpgradeGroup:   "deepseek-day",
		RouteGroups:    []string{"deepseek-a", "deepseek-b"},
		MaxConcurrency: 2,
		Enabled:        true,
	}
	_, subscription := seedQuotaWindowSubscription(t, plan)

	_, err := PreConsumeUserSubscription("qualification-only", subscription.UserId, "deepseek-chat", 0, "deepseek-day", 1)
	require.Error(t, err)

	for index, group := range []string{"deepseek-a", "deepseek-b"} {
		requestId := fmt.Sprintf("allowed-route-%d", index)
		result, err := PreConsumeUserSubscription(requestId, subscription.UserId, "deepseek-chat", 0, group, 1)
		require.NoError(t, err)
		assert.Equal(t, subscription.Id, result.UserSubscriptionId)
	}

	_, err = PreConsumeUserSubscription("unlisted-route", subscription.UserId, "deepseek-chat", 0, "default", 1)
	require.Error(t, err)
}

func TestNormalizeSubscriptionRouteGroupsTrimsDeduplicatesAndRejectsAuto(t *testing.T) {
	groups, err := NormalizeSubscriptionRouteGroups([]string{" deepseek-a ", "deepseek-b", "deepseek-a"})
	require.NoError(t, err)
	assert.Equal(t, []string{"deepseek-a", "deepseek-b"}, groups)

	_, err = NormalizeSubscriptionRouteGroups([]string{"auto"})
	require.Error(t, err)

	ratios, err := NormalizeSubscriptionRouteGroupRatios(
		[]string{"deepseek-a", "deepseek-b"},
		map[string]float64{"deepseek-a": 1.5},
	)
	require.NoError(t, err)
	assert.Equal(t, map[string]float64{"deepseek-a": 1.5, "deepseek-b": 0}, ratios)

	_, err = NormalizeSubscriptionRouteGroupRatios(
		[]string{"deepseek-a"},
		map[string]float64{"deepseek-a": -0.1},
	)
	require.Error(t, err)
}

func TestSubscriptionPurchaseRejectsPlanWithoutRouteGroups(t *testing.T) {
	truncateTables(t)
	user := User{
		Username: "missing-route-group-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	plan := &SubscriptionPlan{
		Title:         "Missing route groups",
		Currency:      "CNY",
		DurationUnit:  SubscriptionDurationDay,
		DurationValue: 1,
		Enabled:       true,
	}
	require.NoError(t, DB.Create(plan).Error)

	_, err := UpsertUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "At least one subscription route group is required")

	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.Zero(t, count)
}

func TestSubscriptionQuotaWindowRejectsAndExpiresOldUsage(t *testing.T) {
	now := GetDBTimestamp()
	plan := &SubscriptionPlan{
		Id:            11002,
		Title:         "Window rejection",
		DurationUnit:  SubscriptionDurationDay,
		DurationValue: 1,
		UpgradeGroup:  "vip",
		Enabled:       true,
		QuotaWindows: []SubscriptionQuotaWindow{
			{WindowSeconds: 5 * 60 * 60, QuotaLimit: 200},
			{WindowSeconds: 7 * 24 * 60 * 60, QuotaLimit: 2000},
			{WindowSeconds: 30 * 24 * 60 * 60, QuotaLimit: 4000},
		},
	}
	_, subscription := seedQuotaWindowSubscription(t, plan)

	oldRecord := SubscriptionPreConsumeRecord{
		RequestId:          "old-window-request",
		UserId:             subscription.UserId,
		UserSubscriptionId: subscription.Id,
		PreConsumed:        900,
		UsageQuota:         900,
		Status:             "consumed",
		FinalizedAt:        now - 6*60*60,
	}
	require.NoError(t, DB.Create(&oldRecord).Error)
	require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id = ?", oldRecord.Id).
		Updates(map[string]any{"created_at": now - 6*60*60}).Error)
	_, err := PreConsumeUserSubscription("current-window-request", subscription.UserId, "deepseek-chat", 0, "vip", 100)
	require.NoError(t, err)

	assert.Equal(t, map[int64]int64{
		5 * 60 * 60:       100,
		7 * 24 * 60 * 60:  1000,
		30 * 24 * 60 * 60: 1000,
	}, quotaWindowUsed(t, subscription.Id))

	_, err = PreConsumeUserSubscription("blocked-window-request", subscription.UserId, "deepseek-chat", 0, "vip", 101)
	require.Error(t, err)
	var windowErr *SubscriptionWindowLimitError
	require.ErrorAs(t, err, &windowErr)
	assert.EqualValues(t, 5*60*60, windowErr.WindowSeconds)
	assert.GreaterOrEqual(t, windowErr.RetryAfter, int64(1))

	var blockedCount int64
	require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).
		Where("request_id = ?", "blocked-window-request").Count(&blockedCount).Error)
	assert.Zero(t, blockedCount)
}

func TestSubscriptionWindowRetryUsesSlowestRecoverableWindow(t *testing.T) {
	t.Run("returns the last window recovery", func(t *testing.T) {
		now := GetDBTimestamp()
		plan := &SubscriptionPlan{
			Id:            11009,
			Title:         "Fastest recovery",
			DurationUnit:  SubscriptionDurationDay,
			DurationValue: 1,
			Enabled:       true,
			QuotaWindows: []SubscriptionQuotaWindow{
				{WindowSeconds: 5 * 60 * 60, QuotaLimit: 100, SortOrder: 0},
				{WindowSeconds: 7 * 24 * 60 * 60, QuotaLimit: 1000, SortOrder: 1},
			},
		}
		_, subscription := seedQuotaWindowSubscription(t, plan)
		rows := []SubscriptionPreConsumeRecord{
			{
				RequestId:          "short-window-used",
				UserId:             subscription.UserId,
				UserSubscriptionId: subscription.Id,
				PreConsumed:        100,
				UsageQuota:         100,
				Status:             "consumed",
			},
			{
				RequestId:          "long-window-used",
				UserId:             subscription.UserId,
				UserSubscriptionId: subscription.Id,
				PreConsumed:        1000,
				UsageQuota:         1000,
				Status:             "consumed",
			},
		}
		require.NoError(t, DB.Create(&rows).Error)
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id = ?", rows[0].Id).
			Update("created_at", now-60*60).Error)
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id = ?", rows[1].Id).
			Update("created_at", now-(7*24*60*60)+60*60).Error)

		_, err := PreConsumeUserSubscription("fastest-window-request", subscription.UserId, "deepseek-chat", 0, "default", 1)
		require.Error(t, err)
		var windowErr *SubscriptionWindowLimitError
		require.ErrorAs(t, err, &windowErr)
		assert.EqualValues(t, 5*60*60, windowErr.WindowSeconds)
		assert.InDelta(t, 4*60*60, windowErr.RetryAfter, 2)
	})

	t.Run("waits for enough usage to leave the window", func(t *testing.T) {
		now := GetDBTimestamp()
		plan := &SubscriptionPlan{
			Id:            11010,
			Title:         "Partial release",
			DurationUnit:  SubscriptionDurationDay,
			DurationValue: 1,
			Enabled:       true,
			QuotaWindows: []SubscriptionQuotaWindow{
				{WindowSeconds: 60 * 60, QuotaLimit: 100},
			},
		}
		_, subscription := seedQuotaWindowSubscription(t, plan)
		rows := []SubscriptionPreConsumeRecord{
			{
				RequestId:          "partial-release-first",
				UserId:             subscription.UserId,
				UserSubscriptionId: subscription.Id,
				PreConsumed:        30,
				UsageQuota:         30,
				Status:             "consumed",
			},
			{
				RequestId:          "partial-release-second",
				UserId:             subscription.UserId,
				UserSubscriptionId: subscription.Id,
				PreConsumed:        90,
				UsageQuota:         90,
				Status:             "consumed",
			},
		}
		require.NoError(t, DB.Create(&rows).Error)
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id = ?", rows[0].Id).
			Update("created_at", now-3000).Error)
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id = ?", rows[1].Id).
			Update("created_at", now-1000).Error)

		_, err := PreConsumeUserSubscription("partial-release-request", subscription.UserId, "deepseek-chat", 0, "default", 20)
		require.Error(t, err)
		var windowErr *SubscriptionWindowLimitError
		require.ErrorAs(t, err, &windowErr)
		assert.InDelta(t, 2600, windowErr.RetryAfter, 2)
	})
}

func TestLegacySubscriptionResetUsesPostResetUsage(t *testing.T) {
	now := time.Now()
	plan := &SubscriptionPlan{
		Id:               11003,
		Title:            "Legacy reset",
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		TotalAmount:      100,
		QuotaResetPeriod: SubscriptionResetDaily,
		Enabled:          true,
	}
	user, subscription := seedQuotaWindowSubscription(t, plan)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", subscription.Id).Updates(map[string]any{
		"amount_used":     90,
		"start_time":      now.Add(-48 * time.Hour).Unix(),
		"last_reset_time": now.Add(-48 * time.Hour).Unix(),
		"next_reset_time": now.Add(-time.Hour).Unix(),
	}).Error)

	result, err := PreConsumeUserSubscription("legacy-reset-request", user.Id, "deepseek-chat", 0, "default", 60)
	require.NoError(t, err)
	assert.Zero(t, result.AmountUsedBefore)
	assert.EqualValues(t, 60, result.AmountUsedAfter)
}

func TestPaidUnlimitedSubscriptionAllowsUseAndRenewal(t *testing.T) {
	plan := &SubscriptionPlan{
		Id:             11106,
		Title:          "Unlimited day pass",
		PriceAmount:    6,
		Currency:       "CNY",
		DurationUnit:   SubscriptionDurationDay,
		DurationValue:  1,
		UpgradeGroup:   "vip",
		MaxConcurrency: 2,
		Enabled:        true,
	}
	user, subscription := seedQuotaWindowSubscription(t, plan)
	require.Zero(t, subscription.AmountTotal)

	for index, amount := range []int64{100, 1_000_000} {
		result, err := PreConsumeUserSubscription(
			fmt.Sprintf("unlimited-day-pass-%d", index),
			user.Id,
			"deepseek-chat",
			0,
			"vip",
			amount,
		)
		require.NoError(t, err)
		assert.Zero(t, result.AmountTotal)
	}

	renewed, err := UpsertUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.NoError(t, err)
	assert.True(t, renewed.Renewed)
	assert.Equal(t, subscription.Id, renewed.Subscription.Id)
	assert.Zero(t, renewed.Subscription.AmountTotal)
}

func TestSubscriptionRenewalAndDifferentPlanConflict(t *testing.T) {
	plan := &SubscriptionPlan{
		Id:             11004,
		Title:          "Hourly",
		DurationUnit:   SubscriptionDurationHour,
		DurationValue:  2,
		UpgradeGroup:   "vip",
		MaxConcurrency: 2,
		Enabled:        true,
		RouteGroupRatios: map[string]float64{
			"vip": 1.5,
		},
		QuotaWindows: []SubscriptionQuotaWindow{{WindowSeconds: 3600, QuotaLimit: 100}},
	}
	user, first := seedQuotaWindowSubscription(t, plan)
	firstEnd := first.EndTime

	changedPlan := *plan
	changedPlan.MaxConcurrency = 9
	changedPlan.RouteGroups = []string{"replacement-route"}
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).
		Update("max_concurrency", changedPlan.MaxConcurrency).Error)
	InvalidateSubscriptionPlanCache(plan.Id)

	renewed, err := UpsertUserSubscriptionFromPlanTx(DB, user.Id, &changedPlan, "test")
	require.NoError(t, err)
	assert.True(t, renewed.Renewed)
	assert.EqualValues(t, firstEnd+2*60*60, renewed.Subscription.EndTime)
	assert.Equal(t, 2, renewed.Subscription.MaxConcurrency)
	assert.Equal(t, []string{"vip"}, renewed.Subscription.RouteGroups)
	assert.Equal(t, map[string]float64{"vip": 1.5}, renewed.Subscription.RouteGroupRatios)

	otherPlan := &SubscriptionPlan{
		Id:            11005,
		Title:         "Other",
		DurationUnit:  SubscriptionDurationDay,
		DurationValue: 1,
		Enabled:       true,
	}
	require.NoError(t, DB.Create(otherPlan).Error)
	_, err = UpsertUserSubscriptionFromPlanTx(DB, user.Id, otherPlan, "test")
	require.ErrorIs(t, err, ErrActiveSubscriptionConflict)
}

func TestSubscriptionRenewalResetsRollingWindowUsage(t *testing.T) {
	plan := &SubscriptionPlan{
		Id:            11107,
		Title:         "Monthly renewal",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		UpgradeGroup:  "vip",
		Enabled:       true,
		QuotaWindows: []SubscriptionQuotaWindow{
			{WindowSeconds: 5 * 60 * 60, QuotaLimit: 300},
		},
	}
	user, subscription := seedQuotaWindowSubscription(t, plan)

	_, err := PreConsumeUserSubscription("renew-window-1", user.Id, "deepseek-chat", 0, "vip", 200)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{5 * 60 * 60: 200}, quotaWindowUsed(t, subscription.Id))

	renewed, err := UpsertUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.NoError(t, err)
	require.True(t, renewed.Renewed)
	assert.Zero(t, renewed.Subscription.AmountUsed)
	assert.Equal(t, map[int64]int64{5 * 60 * 60: 0}, quotaWindowUsed(t, subscription.Id))

	var previous SubscriptionPreConsumeRecord
	require.NoError(t, DB.Where("request_id = ?", "renew-window-1").First(&previous).Error)
	assert.Equal(t, SubscriptionUsageStatusRefunded, previous.Status)

	_, err = PreConsumeUserSubscription("renew-window-2", user.Id, "deepseek-chat", 0, "vip", 300)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{5 * 60 * 60: 300}, quotaWindowUsed(t, subscription.Id))
}

func TestSubscriptionConcurrencyRequiresAnAllowedRouteGroup(t *testing.T) {
	truncateTables(t)
	user := User{
		Username: "group-scoped-concurrency-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "vip",
	}
	require.NoError(t, DB.Create(&user).Error)

	subscription := UserSubscription{
		UserId:         user.Id,
		PlanId:         11101,
		Status:         "active",
		StartTime:      time.Now().Unix(),
		EndTime:        time.Now().Add(time.Hour).Unix(),
		UpgradeGroup:   "vip",
		MaxConcurrency: 2,
	}
	require.NoError(t, DB.Create(&subscription).Error)
	require.NoError(t, SnapshotPlanRouteGroupsTx(DB, subscription.Id, []string{"vip", "deepseek-a"}))

	subscriptionID, limit, err := GetActiveSubscriptionConcurrency(user.Id, "vip")
	require.NoError(t, err)
	assert.Equal(t, subscription.Id, subscriptionID)
	assert.Equal(t, 2, limit)

	subscriptionID, limit, err = GetActiveSubscriptionConcurrency(user.Id, "default")
	require.NoError(t, err)
	assert.Zero(t, subscriptionID)
	assert.Zero(t, limit)

	subscriptionID, limit, err = GetActiveSubscriptionConcurrency(user.Id, "deepseek-a")
	require.NoError(t, err)
	assert.Equal(t, subscription.Id, subscriptionID)
	assert.Equal(t, 2, limit)
}

func TestConcurrentDifferentPlanPurchaseHasOneWinner(t *testing.T) {
	truncateTables(t)
	user := User{
		Username: "concurrent-window-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	plans := []*SubscriptionPlan{
		{Id: 11006, Title: "A", DurationUnit: SubscriptionDurationDay, DurationValue: 1, RouteGroups: []string{"default"}, Enabled: true},
		{Id: 11007, Title: "B", DurationUnit: SubscriptionDurationDay, DurationValue: 1, RouteGroups: []string{"default"}, Enabled: true},
	}
	require.NoError(t, DB.Create(&plans).Error)
	for _, plan := range plans {
		require.NoError(t, ReplaceSubscriptionPlanRouteGroupsTx(DB, plan.Id, plan.RouteGroups))
	}

	errs := make([]error, len(plans))
	var wait sync.WaitGroup
	for index := range plans {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, errs[index] = PurchaseSubscriptionWithBalance(user.Id, plans[index].Id)
		}()
	}
	wait.Wait()

	successCount := 0
	conflictCount := 0
	for _, err := range errs {
		switch {
		case err == nil:
			successCount++
		case errors.Is(err, ErrActiveSubscriptionConflict):
			conflictCount++
		default:
			require.NoError(t, err)
		}
	}
	assert.Equal(t, 1, successCount)
	assert.Equal(t, 1, conflictCount)
	var subscriptions int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&subscriptions).Error)
	assert.EqualValues(t, 1, subscriptions)
}

func TestCalcSubscriptionBalanceQuotaConvertsCNYPriceToUSD(t *testing.T) {
	originalType := operation_setting.GetGeneralSetting().QuotaDisplayType
	originalRate := operation_setting.USDExchangeRate
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalType
		operation_setting.USDExchangeRate = originalRate
		common.QuotaPerUnit = originalQuotaPerUnit
	})
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeCNY
	operation_setting.USDExchangeRate = 7.3
	common.QuotaPerUnit = 500000

	quota, err := calcSubscriptionBalanceQuota(30)
	require.NoError(t, err)
	// ¥30 / 7.3 * 500000 = 2054794.52..., rounded up. Charging USD 30 (15,000,000)
	// would overcharge a CNY plan by the exchange rate.
	assert.EqualValues(t, 2054795, quota)
}

func TestBalancePurchaseRejectsNonCNYPlan(t *testing.T) {
	truncateTables(t)
	user := User{
		Username:   "non-cny-plan-user",
		Password:   "unused-password-hash",
		Role:       common.RoleCommonUser,
		Status:     common.UserStatusEnabled,
		Group:      "default",
		Quota:      1000,
		PaidQuota:  1000,
		BonusQuota: 0,
	}
	require.NoError(t, DB.Create(&user).Error)
	plan := SubscriptionPlan{
		Id:              11102,
		Title:           "USD plan",
		PriceAmount:     6,
		Currency:        "USD",
		DurationUnit:    SubscriptionDurationDay,
		DurationValue:   1,
		Enabled:         true,
		AllowBalancePay: common.GetPointer(true),
	}
	require.NoError(t, DB.Create(&plan).Error)

	_, err := PurchaseSubscriptionWithBalance(user.Id, plan.Id)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "only for CNY")

	var subscriptions int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&subscriptions).Error)
	assert.Zero(t, subscriptions)
	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, 1000, updated.Quota)
}

func TestSubscriptionCleanupKeepsUnfinalizedUsage(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	rows := []SubscriptionPreConsumeRecord{
		{RequestId: "settled-old", UserSubscriptionId: 1, PreConsumed: 1, UsageQuota: 1, Status: "consumed", FinalizedAt: now - 100},
		{RequestId: "unsettled-old", UserSubscriptionId: 1, PreConsumed: 1, UsageQuota: 1, Status: "consumed"},
	}
	require.NoError(t, DB.Create(&rows).Error)
	require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).Where("id IN ?", []int{rows[0].Id, rows[1].Id}).
		Update("updated_at", now-100).Error)

	deleted, err := CleanupSubscriptionPreConsumeRecords(1)
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)

	var remaining []SubscriptionPreConsumeRecord
	require.NoError(t, DB.Find(&remaining).Error)
	require.Len(t, remaining, 1)
	assert.Equal(t, "unsettled-old", remaining[0].RequestId)
}

func TestSubscriptionExpirationDowngradesImmediately(t *testing.T) {
	truncateTables(t)
	user := User{
		Username: "expired-window-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "vip",
	}
	require.NoError(t, DB.Create(&user).Error)
	subscription := UserSubscription{
		UserId:        user.Id,
		PlanId:        11008,
		StartTime:     GetDBTimestamp() - 7200,
		EndTime:       GetDBTimestamp() - 1,
		Status:        "active",
		UpgradeGroup:  "vip",
		PrevUserGroup: "default",
	}
	require.NoError(t, DB.Create(&subscription).Error)

	expired, err := ExpireDueSubscriptionsForUser(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1, expired)

	var updatedUser User
	require.NoError(t, DB.First(&updatedUser, user.Id).Error)
	assert.Equal(t, "default", updatedUser.Group)
	var updatedSubscription UserSubscription
	require.NoError(t, DB.First(&updatedSubscription, subscription.Id).Error)
	assert.Equal(t, "expired", updatedSubscription.Status)
}

func TestNormalizeSubscriptionQuotaWindowsRejectsInvalidRules(t *testing.T) {
	_, err := NormalizeSubscriptionQuotaWindows([]SubscriptionQuotaWindow{
		{WindowSeconds: 3600, QuotaLimit: 1},
		{WindowSeconds: 3600, QuotaLimit: 2},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unique")

	_, err = NormalizeSubscriptionQuotaWindows([]SubscriptionQuotaWindow{
		{WindowSeconds: 3600, QuotaLimit: 0},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "positive")
}

func TestDeleteSubscriptionPlanRemovesUnusedPlanAndWindows(t *testing.T) {
	truncateTables(t)
	plan := &SubscriptionPlan{
		Id:            11103,
		Title:         "Unused plan",
		DurationUnit:  SubscriptionDurationDay,
		DurationValue: 1,
		Enabled:       true,
		QuotaWindows: []SubscriptionQuotaWindow{
			{WindowSeconds: 3600, QuotaLimit: 100},
		},
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanQuotaWindowsTx(DB, plan.Id, plan.QuotaWindows))
	_, err := GetSubscriptionPlanById(plan.Id)
	require.NoError(t, err)

	require.NoError(t, DeleteSubscriptionPlan(plan.Id))

	var storedPlan SubscriptionPlan
	require.ErrorIs(t, DB.First(&storedPlan, plan.Id).Error, gorm.ErrRecordNotFound)
	var windowCount int64
	require.NoError(t, DB.Model(&SubscriptionPlanQuotaWindow{}).
		Where("plan_id = ?", plan.Id).
		Count(&windowCount).Error)
	assert.Zero(t, windowCount)
	_, err = GetSubscriptionPlanById(plan.Id)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

func TestDeleteSubscriptionPlanRejectsReferencedPlan(t *testing.T) {
	t.Run("user subscription", func(t *testing.T) {
		truncateTables(t)
		plan := &SubscriptionPlan{
			Id:            11104,
			Title:         "Subscribed plan",
			DurationUnit:  SubscriptionDurationDay,
			DurationValue: 1,
			Enabled:       true,
			QuotaWindows: []SubscriptionQuotaWindow{
				{WindowSeconds: 3600, QuotaLimit: 100},
			},
		}
		require.NoError(t, DB.Create(plan).Error)
		require.NoError(t, ReplaceSubscriptionPlanQuotaWindowsTx(DB, plan.Id, plan.QuotaWindows))
		require.NoError(t, DB.Create(&UserSubscription{
			UserId:    1,
			PlanId:    plan.Id,
			Status:    "active",
			StartTime: GetDBTimestamp(),
			EndTime:   GetDBTimestamp() + 3600,
		}).Error)

		err := DeleteSubscriptionPlan(plan.Id)
		require.ErrorIs(t, err, ErrSubscriptionPlanInUse)

		var storedPlan SubscriptionPlan
		require.NoError(t, DB.First(&storedPlan, plan.Id).Error)
		var windowCount int64
		require.NoError(t, DB.Model(&SubscriptionPlanQuotaWindow{}).
			Where("plan_id = ?", plan.Id).
			Count(&windowCount).Error)
		assert.EqualValues(t, 1, windowCount)
	})

	t.Run("subscription order", func(t *testing.T) {
		truncateTables(t)
		plan := &SubscriptionPlan{
			Id:            11105,
			Title:         "Ordered plan",
			DurationUnit:  SubscriptionDurationDay,
			DurationValue: 1,
			Enabled:       true,
			QuotaWindows: []SubscriptionQuotaWindow{
				{WindowSeconds: 3600, QuotaLimit: 100},
			},
		}
		require.NoError(t, DB.Create(plan).Error)
		require.NoError(t, ReplaceSubscriptionPlanQuotaWindowsTx(DB, plan.Id, plan.QuotaWindows))
		require.NoError(t, DB.Create(&SubscriptionOrder{
			UserId:     1,
			PlanId:     plan.Id,
			TradeNo:    "delete-plan-order",
			Status:     common.TopUpStatusPending,
			CreateTime: GetDBTimestamp(),
		}).Error)

		err := DeleteSubscriptionPlan(plan.Id)
		require.ErrorIs(t, err, ErrSubscriptionPlanInUse)

		var storedPlan SubscriptionPlan
		require.NoError(t, DB.First(&storedPlan, plan.Id).Error)
		var windowCount int64
		require.NoError(t, DB.Model(&SubscriptionPlanQuotaWindow{}).
			Where("plan_id = ?", plan.Id).
			Count(&windowCount).Error)
		assert.EqualValues(t, 1, windowCount)
	})
}
