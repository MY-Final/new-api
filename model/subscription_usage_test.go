package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionCycleTokenUsageDatabases(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres", "clickhouse"} {
		t.Run(dialect, func(t *testing.T) {
			mainDialect := dialect
			if dialect == "clickhouse" {
				if os.Getenv("TEST_CLICKHOUSE_LOG_DSN") == "" {
					t.Skip("TEST_CLICKHOUSE_LOG_DSN is not configured")
				}
				mainDialect = "sqlite"
			}
			db := setupLogAnalysisTestDB(t, mainDialect)
			require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}, &UserSubscription{}, &SubscriptionOrder{}))
			t.Cleanup(func() {
				_ = db.Migrator().DropTable(&SubscriptionOrder{}, &UserSubscription{}, &SubscriptionPlan{})
			})
			if dialect == "clickhouse" {
				logDB, logType, err := chooseDB("TEST_CLICKHOUSE_LOG_DSN", true)
				require.NoError(t, err)
				sqlDB, err := logDB.DB()
				require.NoError(t, err)
				t.Cleanup(func() {
					_ = logDB.Migrator().DropTable(&Log{})
					_ = sqlDB.Close()
				})
				LOG_DB = logDB
				common.SetLogDatabaseType(logType)
				initCol()
				require.NoError(t, logDB.Exec(clickHouseLogCreateTableSQL(0)).Error)
			}
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, LOG_DB.Raw(versionQuery).Scan(&version).Error)
			t.Logf("log database: %s %s; main database: %s", dialect, version, mainDialect)

			empty, err := GetUserSubscriptionTokenUsage(999)
			require.NoError(t, err)
			assert.Empty(t, empty)
			_, err = GetUserSubscriptionTokenUsage(0)
			require.Error(t, err)

			require.NoError(t, db.Create(&[]SubscriptionPlan{
				{Id: 7, Title: "Monthly"}, {Id: 8, Title: "Granted"}, {Id: 9, Title: "Unused"},
			}).Error)
			require.NoError(t, db.Create(&[]UserSubscription{
				{Id: 501, UserId: 1, PlanId: 7, StartTime: 1000, EndTime: 3000, Source: "order", LastResetTime: 2400},
				{Id: 502, UserId: 1, PlanId: 7, StartTime: 100, EndTime: 900, Source: "balance"},
				{Id: 503, UserId: 1, PlanId: 8, StartTime: 1200, EndTime: 3500, Source: "admin"},
				{Id: 504, UserId: 2, PlanId: 7, StartTime: 1000, EndTime: 3000, Source: "order"},
				{Id: 505, UserId: 1, PlanId: 9, StartTime: 4000, EndTime: 5000, Source: "order"},
			}).Error)
			require.NoError(t, db.Create(&[]SubscriptionOrder{
				{Id: 1, UserId: 1, PlanId: 7, CompleteTime: 100, Status: "success", TradeNo: "old"},
				{Id: 2, UserId: 1, PlanId: 7, CompleteTime: 1001, Status: "success", TradeNo: "initial"},
				{Id: 3, UserId: 1, PlanId: 7, CompleteTime: 2000, Status: "success", TradeNo: "renewal"},
				{Id: 4, UserId: 1, PlanId: 7, CompleteTime: 1500, Status: "pending", TradeNo: "pending"},
				{Id: 5, UserId: 1, PlanId: 7, CompleteTime: 1700, Status: "expired", TradeNo: "failed"},
				{Id: 6, UserId: 2, PlanId: 7, CompleteTime: 1600, Status: "success", TradeNo: "other-user"},
				{Id: 7, UserId: 1, PlanId: 8, CompleteTime: 2500, Status: "success", TradeNo: "grant-renewal"},
			}).Error)
			logs := []Log{
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 500, PromptTokens: 40, CompletionTokens: 10, Other: `{"billing_source":"subscription","subscription_id":502}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 1000, PromptTokens: 10, CompletionTokens: 5, Other: `{"billing_source":"subscription","subscription_id":501,"cache_tokens":2}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 1999, PromptTokens: 20, CompletionTokens: 10, Other: `{"billing_source":"subscription","subscription_id":501,"usage_semantic":"anthropic","cache_tokens":7,"cache_creation_tokens":3}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2000, PromptTokens: 30, CompletionTokens: 12, Other: `{"billing_source":"subscription","subscription_id":501,"cache_tokens":9}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2999, PromptTokens: 10, CompletionTokens: 20, Other: `{"billing_source":"subscription","subscription_id":501,"input_tokens_total":80,"cache_tokens":50,"cache_write_tokens":5}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 3001, PromptTokens: 1, CompletionTokens: 2, Other: `{"billing_source":"subscription","subscription_id":501}`},
				{UserId: 1, Type: LogTypeRefund, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"subscription","subscription_id":501}`},
				{UserId: 1, Type: LogTypeError, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"subscription","subscription_id":501}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"wallet","subscription_id":501}`},
				{UserId: 2, Type: LogTypeConsume, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"subscription","subscription_id":501}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"subscription","subscription_id":504}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 999, PromptTokens: 999, CompletionTokens: 999, Other: `{"billing_source":"subscription","subscription_id":501}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2500, PromptTokens: 999, CompletionTokens: 999, Other: `{invalid`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2000, PromptTokens: 6, CompletionTokens: 4, Other: `{"billing_source":"subscription","subscription_id":503}`},
				{UserId: 1, Type: LogTypeConsume, CreatedAt: 2500, PromptTokens: 8, CompletionTokens: 3, Other: `{"billing_source":"subscription","subscription_id":503}`},
			}
			for index := range logs {
				logs[index].RequestId = common.NewRequestId()
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)

			periods, err := GetUserSubscriptionTokenUsage(1)
			require.NoError(t, err)
			require.Len(t, periods, 6)
			assert.Equal(t, 505, periods[0].SubscriptionId)
			assert.Zero(t, periods[0].TotalTokens)
			assert.Equal(t, 503, periods[1].SubscriptionId)
			assert.Equal(t, 7, periods[1].OrderId)
			assert.EqualValues(t, 11, periods[1].TotalTokens)
			assert.Equal(t, SubscriptionCycleTokenUsage{
				SubscriptionId: 501, PlanId: 7, PlanTitle: "Monthly", OrderId: 3, Cycle: 2,
				StartTime: 2000, EndTime: 3000, RequestCount: 3, InputTokens: 111, OutputTokens: 34,
				CacheReadTokens: 59, CacheWriteTokens: 5, TotalTokens: 145,
			}, periods[2])
			assert.Equal(t, 503, periods[3].SubscriptionId)
			assert.EqualValues(t, 10, periods[3].TotalTokens)
			assert.Equal(t, SubscriptionCycleTokenUsage{
				SubscriptionId: 501, PlanId: 7, PlanTitle: "Monthly", OrderId: 2, Cycle: 1,
				StartTime: 1000, EndTime: 2000, RequestCount: 2, InputTokens: 40, OutputTokens: 15,
				CacheReadTokens: 9, CacheWriteTokens: 3, TotalTokens: 55,
			}, periods[4])
			assert.Equal(t, 502, periods[5].SubscriptionId)
			assert.EqualValues(t, 50, periods[5].TotalTokens)
		})
	}
}
