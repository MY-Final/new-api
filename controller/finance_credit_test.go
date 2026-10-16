package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestManualFinanceCreditSeparatesPaidAndBonusAndRejectsConflictingRetries(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
	operator := model.User{Username: "credit-operator", AffCode: "credit-operator", Role: common.RoleRootUser}
	target := model.User{Username: "credit-target", AffCode: "credit-target", Role: common.RoleCommonUser, Quota: 100, PaidQuota: 60, BonusQuota: 40}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&target).Error)

	operation, already, err := model.CreditUserByAdmin(target.Id, 50, 10, "offline payment and promotion", "receipt-001", "wechat", "credit-001", operator.Id, operator.Role)
	require.NoError(t, err)
	assert.False(t, already)
	assert.Equal(t, 100, operation.TargetMainBefore)
	assert.Equal(t, 160, operation.TargetMainAfter)
	assert.Equal(t, 50, operation.TargetPaidDelta)
	assert.Equal(t, 10, operation.TargetBonusDelta)
	assert.Equal(t, "wechat", operation.PaymentChannel)
	retry, already, err := model.CreditUserByAdmin(target.Id, 50, 10, "offline payment and promotion", "receipt-001", "wechat", "credit-001", operator.Id, operator.Role)
	require.NoError(t, err)
	assert.True(t, already)
	assert.Equal(t, operation.Id, retry.Id)
	_, _, err = model.CreditUserByAdmin(target.Id, 51, 10, "offline payment and promotion", "receipt-001", "wechat", "credit-001", operator.Id, operator.Role)
	assert.ErrorIs(t, err, model.ErrFinancialOperationConflict)
	_, _, err = model.CreditUserByAdmin(target.Id, 50, 10, "offline payment and promotion", "receipt-001", "alipay", "credit-001", operator.Id, operator.Role)
	assert.ErrorIs(t, err, model.ErrFinancialOperationConflict)
	for _, channel := range []string{"", "unknown"} {
		_, _, err = model.CreditUserByAdmin(target.Id, 50, 10, "offline payment", "receipt-002", channel, "invalid-channel", operator.Id, operator.Role)
		require.ErrorContains(t, err, "Select a valid payment channel")
	}
	var got model.User
	require.NoError(t, db.First(&got, target.Id).Error)
	assert.Equal(t, 160, got.Quota)
	assert.Equal(t, 110, got.PaidQuota)
	assert.Equal(t, 50, got.BonusQuota)
	var count int64
	require.NoError(t, db.Model(&model.FinancialOperation{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestManualFinanceCreditValidationAndAtomicity(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		quota, paid, bonus       int
		reference, reason        string
		operatorRole, targetRole int
	}{
		{"zero amount", 100, 0, 0, "receipt", "credit", common.RoleRootUser, common.RoleCommonUser},
		{"negative bonus", 100, 50, -1, "receipt", "credit", common.RoleRootUser, common.RoleCommonUser},
		{"missing receipt", 100, 50, 0, "", "credit", common.RoleRootUser, common.RoleCommonUser},
		{"missing reason", 100, 50, 0, "receipt", " ", common.RoleRootUser, common.RoleCommonUser},
		{"wallet overflow", common.MaxWalletQuota, 1, 0, "receipt", "credit", common.RoleRootUser, common.RoleCommonUser},
		{"combined overflow", 0, common.MaxWalletQuota, 1, "receipt", "credit", common.RoleRootUser, common.RoleCommonUser},
		{"same role", 100, 50, 0, "receipt", "credit", common.RoleAdminUser, common.RoleAdminUser},
		{"ordinary user", 100, 50, 0, "receipt", "credit", common.RoleCommonUser, common.RoleCommonUser},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
			operator := model.User{Username: "validation-operator", AffCode: "validation-operator", Role: tc.operatorRole}
			target := model.User{Username: "validation-target", AffCode: "validation-target", Role: tc.targetRole, Quota: tc.quota, PaidQuota: tc.quota}
			require.NoError(t, db.Create(&operator).Error)
			require.NoError(t, db.Create(&target).Error)
			_, _, err := model.CreditUserByAdmin(target.Id, tc.paid, tc.bonus, tc.reason, tc.reference, "wechat", "validation", operator.Id, operator.Role)
			require.Error(t, err)
			var got model.User
			require.NoError(t, db.First(&got, target.Id).Error)
			assert.Equal(t, tc.quota, got.Quota)
			var count int64
			require.NoError(t, db.Model(&model.FinancialOperation{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestManualFinanceCreditNormalizesLegacyBalanceAndRollsBackOnLedgerFailure(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
	operator := model.User{Username: "legacy-credit-operator", AffCode: "legacy-credit-operator", Role: common.RoleRootUser}
	target := model.User{Username: "legacy-credit-target", AffCode: "legacy-credit-target", Role: common.RoleCommonUser, Quota: 100}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&target).Error)
	_, _, err := model.CreditUserByAdmin(target.Id, 0, 20, "trial", "", "other", "gift-001", operator.Id, operator.Role)
	require.NoError(t, err)
	var got model.User
	require.NoError(t, db.First(&got, target.Id).Error)
	assert.Equal(t, 120, got.Quota)
	assert.Equal(t, 100, got.PaidQuota)
	assert.Equal(t, 20, got.BonusQuota)
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:reject_credit_ledger", func(tx *gorm.DB) {
		if tx.Statement.Table == "financial_operations" {
			tx.AddError(fmt.Errorf("ledger unavailable"))
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Create().Remove("test:reject_credit_ledger") })
	_, _, err = model.CreditUserByAdmin(target.Id, 50, 10, "offline payment", "receipt-rollback", "alipay", "rollback-001", operator.Id, operator.Role)
	require.ErrorContains(t, err, "ledger unavailable")
	require.NoError(t, db.First(&got, target.Id).Error)
	assert.Equal(t, 120, got.Quota)
	assert.Equal(t, 100, got.PaidQuota)
	assert.Equal(t, 20, got.BonusQuota)
}

func TestManualFinanceCreditAPIRequiresReceiptConfirmationAndRecordsAudit(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
	operator := model.User{Username: "api-credit-operator", AffCode: "api-credit-operator", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	target := model.User{Username: "api-credit-target", AffCode: "api-credit-target", Role: common.RoleCommonUser}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&target).Error)
	require.NoError(t, model.PublishUserAuthCache(operator.Id))
	session, err := service.CreateLoginSession(operator.Id, "password", "127.0.0.1", "credit-test")
	require.NoError(t, err)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.AdminAuth())
	router.POST("/api/finance/credits", CreateFinanceCredit)
	for _, confirmed := range []bool{false, true, true} {
		body := fmt.Sprintf(`{"user_id":%d,"paid_quota":50,"bonus_quota":10,"reference":"api-receipt","payment_channel":"usdt","reason":"offline payment","client_id":"api-001","payment_received":%t}`, target.Id, confirmed)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/finance/credits", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+session.AccessToken)
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.Contains(t, recorder.Body.String(), fmt.Sprintf(`"success":%t`, confirmed))
	}
	var got model.User
	require.NoError(t, db.First(&got, target.Id).Error)
	assert.Equal(t, 60, got.Quota)
	assert.Equal(t, 50, got.PaidQuota)
	assert.Equal(t, 10, got.BonusQuota)
	entries, total, err := model.GetAuditLogs(model.AuditLogFilter{Action: "finance.manual_credit"}, 0, 10, common.RoleRootUser)
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	var success, failure int
	for _, entry := range entries {
		if entry.Success {
			encoded, err := common.Marshal(entry.Other.Op.Params)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"payment_channel":"usdt"`)
			success++
		} else {
			failure++
		}
	}
	assert.Equal(t, 2, success)
	assert.Equal(t, 1, failure)
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND type = ?", target.Id, model.LogTypeTopup).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Contains(t, logs[0].Other, `"action":"finance.manual_credit"`)
	assert.Contains(t, logs[0].Other, `"paid_delta":50`)
	assert.Contains(t, logs[0].Other, `"bonus_delta":10`)
}

func TestManualFinanceCreditPreservesCachedReservationsAndDoesNotCreditRetriesTwice(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
	operator := model.User{Username: "cached-credit-operator", AffCode: "cached-credit-operator", Role: common.RoleRootUser}
	target := model.User{Username: "cached-credit-target", AffCode: "cached-credit-target", Quota: 100, PaidQuota: 60, BonusQuota: 40, Role: common.RoleCommonUser}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&target).Error)
	server := miniredis.RunT(t)
	previousRDB := common.RDB
	common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	common.RedisEnabled = true
	t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = previousRDB })
	_, err := model.GetUserCache(target.Id)
	require.NoError(t, err)
	var key string
	for _, candidate := range server.Keys() {
		if server.HGet(candidate, "Id") == strconv.Itoa(target.Id) && server.HGet(candidate, "Quota") != "" {
			key = candidate
			break
		}
	}
	require.NotEmpty(t, key)
	server.HSet(key, "Quota", "80")
	server.HSet(key, "BonusQuota", "20")
	for _, retry := range []bool{false, true} {
		_, already, err := model.CreditUserByAdmin(target.Id, 50, 10, "offline and gift", "cached-receipt", "bank_transfer", "cached-001", operator.Id, operator.Role)
		require.NoError(t, err)
		assert.Equal(t, retry, already)
		assert.Equal(t, "140", server.HGet(key, "Quota"))
		assert.Equal(t, "110", server.HGet(key, "PaidQuota"))
		assert.Equal(t, "30", server.HGet(key, "BonusQuota"))
	}
}

func TestManualFinanceCreditMigrationPreservesExistingLedger(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(fmt.Sprintf("upgrade=%v", upgrade), func(t *testing.T) {
			db := setupManageUserTestDB(t)
			if upgrade {
				// v1.0.0-cicd-test.29 has the same persisted ledger fields except payment_channel.
				current := reflect.TypeFor[model.FinancialOperation]()
				fields := make([]reflect.StructField, 0, current.NumField()-1)
				for i := range current.NumField() {
					field := current.Field(i)
					if field.Name != "PaymentChannel" {
						fields = append(fields, field)
					}
				}
				require.NoError(t, db.Table("financial_operations").AutoMigrate(reflect.New(reflect.StructOf(fields)).Interface()))
				require.False(t, db.Migrator().HasColumn("financial_operations", "payment_channel"))
				require.NoError(t, db.Omit("payment_channel").Create(&model.FinancialOperation{OperationKey: "legacy-credit", OperationType: model.FinancialOperationManualCredit, SourceId: "legacy-receipt", Reason: "Legacy credit", TargetPaidDelta: 50, TargetBonusDelta: 10}).Error)
			}
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.FinancialOperation{}))
				require.True(t, db.Migrator().HasColumn(&model.FinancialOperation{}, "payment_channel"))
				require.True(t, db.Migrator().HasIndex(&model.FinancialOperation{}, "idx_financial_operations_operation_key"))
			}
			if upgrade {
				var old model.FinancialOperation
				require.NoError(t, db.Where("operation_key = ?", "legacy-credit").First(&old).Error)
				assert.Equal(t, "legacy-receipt", old.SourceId)
				assert.Equal(t, "Legacy credit", old.Reason)
				assert.Equal(t, 50, old.TargetPaidDelta)
				assert.Equal(t, 10, old.TargetBonusDelta)
				assert.Empty(t, old.PaymentChannel)
				require.Error(t, db.Create(&model.FinancialOperation{OperationKey: "legacy-credit"}).Error)
			}
			fresh := model.FinancialOperation{OperationKey: "new-credit", PaymentChannel: "wechat"}
			require.NoError(t, db.Create(&fresh).Error)
			var saved model.FinancialOperation
			require.NoError(t, db.First(&saved, fresh.Id).Error)
			assert.Equal(t, "wechat", saved.PaymentChannel)
		})
	}
}
