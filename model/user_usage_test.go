package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestGetUserUsageAggregatesTargetBillingLogs(t *testing.T) {
	truncateTables(t)
	user := User{
		Username:     "usage-user",
		DisplayName:  "Usage User",
		Password:     "password123",
		Quota:        900,
		UsedQuota:    700,
		RequestCount: 12,
		AffCode:      "usage-user-aff",
	}
	otherUser := User{Username: "other-usage-user", Password: "password123", AffCode: "other-usage-aff"}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, DB.Create(&otherUser).Error)

	dayOne := time.Date(2025, time.January, 10, 12, 0, 0, 0, time.UTC).Unix()
	dayTwo := time.Date(2025, time.January, 11, 12, 0, 0, 0, time.UTC).Unix()
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: user.Id, CreatedAt: dayOne, Type: LogTypeConsume, ModelName: "model-a",
		PromptTokens: 100, CompletionTokens: 50, Quota: 100,
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: user.Id, CreatedAt: dayTwo, Type: LogTypeConsume, ModelName: "model-b",
		PromptTokens: 200, CompletionTokens: 100, Quota: 300,
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: user.Id, CreatedAt: dayTwo, Type: LogTypeRefund, ModelName: "model-a", Quota: 50,
	}).Error)
	// Other log types must not add requests, tokens, or model rows.
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: user.Id, CreatedAt: dayTwo, Type: LogTypeManage, ModelName: "ignored",
		PromptTokens: 999, CompletionTokens: 999, Quota: 999,
	}).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: otherUser.Id, CreatedAt: dayOne, Type: LogTypeConsume, ModelName: "other",
		PromptTokens: 999, CompletionTokens: 999, Quota: 999,
	}).Error)

	usage, err := GetUserUsage(user.Id, dayOne, dayTwo)
	require.NoError(t, err)
	require.Equal(t, UserUsageUser{
		Id: user.Id, Username: "usage-user", DisplayName: "Usage User", Quota: 900,
		UsedQuota: 700, RequestCount: 12,
	}, usage.User)
	require.Equal(t, UserUsageAggregate{
		RequestCount: 2, PromptTokens: 300, CompletionTokens: 150, TotalTokens: 450,
		ConsumedQuota: 400, RefundedQuota: 50, NetQuota: 350,
	}, usage.Summary)
	require.Equal(t, []UserUsageDaily{
		{Day: "2025-01-10", RequestCount: 1, PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150, ConsumedQuota: 100, NetQuota: 100},
		{Day: "2025-01-11", RequestCount: 1, PromptTokens: 200, CompletionTokens: 100, TotalTokens: 300, ConsumedQuota: 300, RefundedQuota: 50, NetQuota: 250},
	}, usage.Daily)
	require.Equal(t, []UserUsageModel{
		{ModelName: "model-b", RequestCount: 1, PromptTokens: 200, CompletionTokens: 100, TotalTokens: 300, ConsumedQuota: 300, NetQuota: 300},
		{ModelName: "model-a", RequestCount: 1, PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150, ConsumedQuota: 100, RefundedQuota: 50, NetQuota: 50},
	}, usage.Models)
}

func TestGetUserUsageReturnsZeroAggregatesForEmptyRange(t *testing.T) {
	truncateTables(t)
	user := User{Username: "empty-usage-user", Password: "password123", AffCode: "empty-usage-aff"}
	require.NoError(t, DB.Create(&user).Error)

	usage, err := GetUserUsage(user.Id, 100, 200)
	require.NoError(t, err)
	require.Equal(t, UserUsageAggregate{}, usage.Summary)
	require.Empty(t, usage.Daily)
	require.Empty(t, usage.Models)
}

func TestUserUsageDayExpressionCoversSupportedDatabases(t *testing.T) {
	original := common.LogDatabaseType()
	t.Cleanup(func() { common.SetLogDatabaseType(original) })

	for _, testCase := range []struct {
		databaseType common.DatabaseType
		expected     string
	}{
		{common.DatabaseTypeSQLite, "strftime('%Y-%m-%d'"},
		{common.DatabaseTypeMySQL, "DATE_FORMAT(FROM_UNIXTIME(created_at)"},
		{common.DatabaseTypePostgreSQL, "TO_CHAR(TO_TIMESTAMP(created_at)"},
		{common.DatabaseTypeClickHouse, "formatDateTime(toDateTime(created_at)"},
	} {
		common.SetLogDatabaseType(testCase.databaseType)
		require.Contains(t, userUsageDayExpression(), testCase.expected)
	}
}
