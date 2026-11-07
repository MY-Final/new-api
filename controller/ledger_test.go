package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDashboardPaidUsageAndActivityDatabaseMatrix(t *testing.T) {
	for _, tc := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(tc.kind, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if tc.env != "" && dsn == "" {
				t.Skip(tc.env + " not configured")
			}
			db := modelManagementDB(t, tc.kind, dsn)
			require.NoError(t, db.AutoMigrate(&model.QuotaUsageDaily{}, &model.Checkin{}, &model.Log{}, &model.FinancialOperation{}, &model.Redemption{}, &model.TopUp{}))
			users := []model.User{{Username: "alice", AffCode: "dashboard-alice"}, {Username: "bob", AffCode: "dashboard-bob"}, {Username: "refund", AffCode: "dashboard-refund"}}
			require.NoError(t, db.Create(&users).Error)
			require.NoError(t, db.Create(&[]model.QuotaUsageDaily{
				{UserId: users[0].Id, Date: "2025-01-10", PaidQuota: 10},
				{UserId: users[0].Id, Date: "2025-01-11", PaidQuota: -3},
				{UserId: users[1].Id, Date: "2025-01-11", PaidQuota: 9},
				{UserId: users[2].Id, Date: "2025-01-09", PaidQuota: 99},
			}).Error)
			day1 := time.Date(2025, 1, 10, 12, 0, 0, 0, time.Local).Unix()
			day2 := time.Date(2025, 1, 11, 12, 0, 0, 0, time.Local).Unix()
			nextDay := time.Date(2025, 1, 12, 0, 0, 0, 0, time.Local).Unix()
			require.NoError(t, db.Create(&[]model.FinancialOperation{
				{OperationKey: "manual-1", OperationType: model.FinancialOperationManualCredit, CreatedAt: day1, TargetPaidDelta: 100, TargetBonusDelta: 20},
				{OperationKey: "manual-2", OperationType: model.FinancialOperationManualCredit, CreatedAt: day2, TargetPaidDelta: 50, TargetBonusDelta: 10},
				{OperationKey: "manual-outside", OperationType: model.FinancialOperationManualCredit, CreatedAt: nextDay, TargetPaidDelta: 500},
				{OperationKey: "other-op", OperationType: model.FinancialOperationPenalty, CreatedAt: day1, TargetPaidDelta: 200},
			}).Error)
			require.NoError(t, db.Create(&[]model.Redemption{
				{Key: "dashboard-1", Type: model.RedemptionTypePaid, Quota: 80, PaidQuota: 70, BonusQuota: 10, Status: common.RedemptionCodeStatusUsed, UsedUserId: users[0].Id, RedeemedTime: day1},
				{Key: "dashboard-2", Type: model.RedemptionTypePaid, Quota: 30, PaidQuota: 30, Status: common.RedemptionCodeStatusRefunded, UsedUserId: users[1].Id, RedeemedTime: day2},
				{Key: "dashboard-3", Type: model.RedemptionTypeReward, Quota: 15, BonusQuota: 15, Status: common.RedemptionCodeStatusUsed, UsedUserId: users[2].Id, RedeemedTime: day2},
			}).Error)
			require.NoError(t, db.Where("used_user_id = ?", users[2].Id).Delete(&model.Redemption{}).Error)
			require.NoError(t, db.Create(&[]model.TopUp{
				{TradeNo: "online-1", Source: model.TopUpSourceTopup, Status: common.TopUpStatusSuccess, CreditedQuota: 40, CompleteTime: day1},
				{TradeNo: "online-2", Source: model.TopUpSourceTopup, Status: common.TopUpStatusRefunded, CreditedQuota: 60, CompleteTime: day2},
				{TradeNo: "old-online", Source: "", Status: common.TopUpStatusSuccess, CompleteTime: day1},
				{TradeNo: "subscription", Source: model.TopUpSourceSubscription, Status: common.TopUpStatusSuccess, CreditedQuota: 900, CompleteTime: day1},
				{TradeNo: "online-outside", Source: model.TopUpSourceTopup, Status: common.TopUpStatusSuccess, CreditedQuota: 500, CompleteTime: nextDay},
			}).Error)
			require.NoError(t, db.Create(&[]model.Log{
				{UserId: users[0].Id, CreatedAt: day1, Type: model.LogTypeConsume},
				{UserId: users[0].Id, CreatedAt: day1 + 1, Type: model.LogTypeConsume},
				{UserId: users[1].Id, CreatedAt: day1, Type: model.LogTypeConsume},
				{UserId: users[0].Id, CreatedAt: day2, Type: model.LogTypeConsume},
				{UserId: users[2].Id, CreatedAt: day2, Type: model.LogTypeRefund, Quota: 1},
			}).Error)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/ledger/summary?start_date=2025-01-10&end_date=2025-01-11&include_users=true", nil)
			GetQuotaLedgerSummary(ctx)
			var response struct {
				Success bool                     `json:"success"`
				Data    model.QuotaLedgerSummary `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success, recorder.Body.String())
			assert.EqualValues(t, 16, response.Data.RangePaidQuota)
			assert.Equal(t, []model.QuotaLedgerDailyPaidUsage{{Date: "2025-01-10", PaidQuota: 10}, {Date: "2025-01-11", PaidQuota: 6}}, response.Data.DailyPaidUsage)
			assert.Equal(t, []model.QuotaLedgerPaidUser{{UserId: users[1].Id, Username: "bob", PaidQuota: 9}, {UserId: users[0].Id, Username: "alice", PaidQuota: 7}}, response.Data.PaidUsers)
			require.NotNil(t, response.Data.Credits)
			assert.Equal(t, model.QuotaLedgerCredits{
				ManualPaid: 150, ManualBonus: 30, RedemptionPaid: 100, RedemptionBonus: 25, RedemptionDeleted: 1,
				OnlinePaid: 100, OnlineIncomplete: 1,
			}, *response.Data.Credits)
			require.NoError(t, db.Model(&model.Redemption{}).Where("used_user_id = ?", users[0].Id).Updates(map[string]any{"paid_quota": 0, "bonus_quota": 0}).Error)
			credits, err := model.GetQuotaLedgerCredits(time.Unix(day1, 0).Add(-12*time.Hour), time.Unix(nextDay, 0))
			require.NoError(t, err)
			assert.EqualValues(t, 1, credits.RedemptionIncomplete)
			ranking, err := model.GetUserUsageRanking(model.UserUsageFilter{Start: day1 - 10, End: day2 + 10}, 1, 10, "user_cost")
			require.NoError(t, err)
			assert.Equal(t, []model.UserUsageDailyActivity{{Day: "2025-01-10", Users: 2}, {Day: "2025-01-11", Users: 1}}, ranking.DailyActivity)
			assert.Equal(t, "2025-01-10", ranking.ServerStartDay)
			assert.Equal(t, "2025-01-11", ranking.ServerEndDay)
		})
	}
}
