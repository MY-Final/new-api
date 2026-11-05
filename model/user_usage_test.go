package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
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
		InputTokens: 300, OutputTokens: 150, UserCost: 350,
		ConsumedQuota: 400, RefundedQuota: 50, NetQuota: 350,
	}, usage.Summary)
	require.Equal(t, []UserUsageDaily{
		{Day: "2025-01-10", RequestCount: 1, PromptTokens: 100, CompletionTokens: 50, InputTokens: 100, OutputTokens: 50, TotalTokens: 150, ConsumedQuota: 100, NetQuota: 100, UserCost: 100},
		{Day: "2025-01-11", RequestCount: 1, PromptTokens: 200, CompletionTokens: 100, InputTokens: 200, OutputTokens: 100, TotalTokens: 300, ConsumedQuota: 300, RefundedQuota: 50, NetQuota: 250, UserCost: 250},
	}, usage.Daily)
	require.Equal(t, []UserUsageModel{
		{ModelName: "model-b", RequestCount: 1, PromptTokens: 200, CompletionTokens: 100, InputTokens: 200, OutputTokens: 100, TotalTokens: 300, ConsumedQuota: 300, NetQuota: 300, UserCost: 300},
		{ModelName: "model-a", RequestCount: 1, PromptTokens: 100, CompletionTokens: 50, InputTokens: 100, OutputTokens: 50, TotalTokens: 150, ConsumedQuota: 100, RefundedQuota: 50, NetQuota: 50, UserCost: 50},
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

func TestGetUserUsageSeparatesCacheAndReasoningTokens(t *testing.T) {
	truncateTables(t)
	user := User{Username: "usage-cache-user", Password: "password123", AffCode: "usage-cache-aff"}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: user.Id, CreatedAt: 1500, Type: LogTypeConsume,
		PromptTokens: 70, CompletionTokens: 23, Quota: 40,
		Other: common.MapToJsonStr(map[string]any{
			"usage_semantic":     "anthropic",
			"cache_tokens":       30,
			"cache_write_tokens": 20,
			"input_tokens_total": 120,
			"reasoning_tokens":   8,
		}),
	}).Error)

	usage, err := GetUserUsage(user.Id, 1000, 2000)
	require.NoError(t, err)
	require.Equal(t, int64(120), usage.Summary.InputTokens)
	require.Equal(t, int64(23), usage.Summary.OutputTokens)
	require.Equal(t, int64(30), usage.Summary.CacheReadTokens)
	require.Equal(t, int64(20), usage.Summary.CacheWriteTokens)
	require.Equal(t, int64(8), usage.Summary.ReasoningTokens)
	require.Equal(t, int64(143), usage.Summary.TotalTokens)

	requests, err := GetUserUsageRequests(UserUsageFilter{
		UserID: user.Id,
		Start:  1000,
		End:    2000,
	}, 1, 20)
	require.NoError(t, err)
	require.Len(t, requests.Items, 1)
	require.Equal(t, int64(120), requests.Items[0].InputTokens)
	require.Equal(t, int64(20), requests.Items[0].CacheWriteTokens)
	require.Equal(t, int64(8), requests.Items[0].ReasoningTokens)
	require.Equal(t, int64(40), requests.Items[0].UserCost)
}

func TestGetUserUsageBreakdownSeparatesWalletAndSubscriptionCharges(t *testing.T) {
	truncateTables(t)
	user := User{Username: "usage-breakdown-user", Password: "password123", AffCode: "usage-breakdown-aff", UsedQuota: 100, RequestCount: 4}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, DB.Create(&[]RequestBilling{
		{Id: "breakdown-wallet", RequestId: "breakdown-wallet-request", UserId: user.Id, FundingSource: "wallet", Quota: 30, Settled: true},
		{Id: "breakdown-subscription", RequestId: "breakdown-subscription-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: 1, Quota: 20, Settled: true},
		{Id: "breakdown-refunded", RequestId: "breakdown-refunded-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: 1, Quota: 30, RefundedQuota: 30, Settled: true},
		{Id: "breakdown-task", RequestId: "breakdown-task-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: 1, TaskId: "breakdown-task", Quota: 10, UsageRecorded: true},
		{Id: "breakdown-pending", RequestId: "breakdown-pending-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: 1, TaskId: "breakdown-pending", Quota: 99},
	}).Error)

	breakdown, err := GetUserUsageBreakdown(user.Id, user.UsedQuota, user.RequestCount)
	require.NoError(t, err)
	assert.Equal(t, UserUsageBreakdown{
		WalletUsedQuota:          70,
		SubscriptionUsedQuota:    30,
		WalletRequestCount:       1,
		SubscriptionRequestCount: 3,
	}, breakdown)
}

func TestListUserSubscriptionUsageReturnsNetChargedRecords(t *testing.T) {
	truncateTables(t)
	user := User{Username: "subscription-usage-user", Password: "password123", AffCode: "subscription-usage-aff"}
	require.NoError(t, DB.Create(&user).Error)
	plan := SubscriptionPlan{Title: "Daily Pass", Enabled: true}
	require.NoError(t, DB.Create(&plan).Error)
	subscription := UserSubscription{
		UserId: user.Id, PlanId: plan.Id, Status: "active",
		StartTime: 100, EndTime: 200, AmountTotal: 100, AmountUsed: 50,
	}
	require.NoError(t, DB.Create(&subscription).Error)
	require.NoError(t, DB.Create(&[]RequestBilling{
		{Id: "usage-record-one", RequestId: "usage-record-one-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: subscription.Id, ModelName: "model-one", Quota: 20, Settled: true, CreatedAt: 100},
		{Id: "usage-record-two", RequestId: "usage-record-two-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: subscription.Id, ModelName: "model-two", Quota: 30, RefundedQuota: 30, Settled: true, CreatedAt: 200},
		{Id: "usage-record-wallet", RequestId: "usage-record-wallet-request", UserId: user.Id, FundingSource: "wallet", ModelName: "wallet-model", Quota: 40, Settled: true, CreatedAt: 300},
		{Id: "usage-record-pending", RequestId: "usage-record-pending-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: subscription.Id, ModelName: "pending-model", TaskId: "usage-record-pending-task", Quota: 50, CreatedAt: 400},
	}).Error)

	records, total, err := ListUserSubscriptionUsage(user.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, records, 2)
	assert.Equal(t, "usage-record-two", records[0].BillingId)
	assert.Equal(t, "Daily Pass", records[0].PlanTitle)
	assert.Equal(t, plan.Id, records[0].PlanId)
	assert.Equal(t, 0, records[0].Quota)
	assert.Equal(t, 30, records[0].RefundedQuota)
	assert.Equal(t, "usage-record-one", records[1].BillingId)
	assert.Equal(t, 20, records[1].Quota)
}
