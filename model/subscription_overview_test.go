package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetSubscriptionOverviewAggregatesOrdersUsageAndActiveCapacity(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now

	user := &User{
		Username: "overview-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)

	plans := []SubscriptionPlan{
		{Id: 301, Title: "Lite", PriceAmount: 30, Currency: "CNY", Enabled: true, SortOrder: 1},
		{Id: 302, Title: "Pro", PriceAmount: 68, Currency: "CNY", Enabled: false, SortOrder: 2},
	}
	require.NoError(t, DB.Create(&plans).Error)
	require.NoError(t, DB.Model(&SubscriptionPlan{}).
		Where("id = ?", 302).
		UpdateColumn("enabled", false).Error)

	subscriptions := []UserSubscription{
		{Id: 401, UserId: user.Id, PlanId: 301, AmountTotal: 0, AmountUsed: 5060000, Status: "active", EndTime: now + 86400},
		{Id: 402, UserId: user.Id, PlanId: 301, AmountTotal: 0, AmountUsed: 0, Status: "active", EndTime: now + 86400},
		{Id: 403, UserId: user.Id, PlanId: 302, AmountTotal: 170000000, AmountUsed: 500000, Status: "expired", EndTime: now - 86400},
	}
	require.NoError(t, DB.Create(&subscriptions).Error)
	require.NoError(t, DB.Create(&UserSubscriptionQuotaWindow{
		UserSubscriptionId: 401,
		WindowSeconds:      2678400,
		QuotaLimit:         75000000,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscriptionQuotaWindow{
		UserSubscriptionId: 402,
		WindowSeconds:      2678400,
		QuotaLimit:         75000000,
	}).Error)

	orders := []SubscriptionOrder{
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-in-1", Status: "success", CompleteTime: now - 60},
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-in-2", Status: "success", CompleteTime: now - 120},
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-old", Status: "success", CompleteTime: start - 86400},
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-pending", Status: "pending", CompleteTime: now - 60},
	}
	require.NoError(t, DB.Create(&orders).Error)

	usage := []SubscriptionPreConsumeRecord{
		{RequestId: "usage-1", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 10000, FinalizedAt: now - 50},
		{RequestId: "usage-2", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 20000, FinalizedAt: now - 50},
		{RequestId: "usage-3", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 30000, FinalizedAt: now - 50},
		{RequestId: "usage-refunded", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 99999, Status: SubscriptionUsageStatusRefunded, FinalizedAt: now - 50},
		{RequestId: "usage-old", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 40000, FinalizedAt: now - 50},
		{RequestId: "usage-pending", UserId: user.Id, UserSubscriptionId: 401, UsageQuota: 5000000},
	}
	require.NoError(t, DB.Create(&usage).Error)
	for i := range usage {
		createdAt := now - int64(i+1)
		if usage[i].RequestId == "usage-old" {
			createdAt = start - 86400
		}
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).
			Where("request_id = ?", usage[i].RequestId).
			UpdateColumn("created_at", createdAt).Error)
	}

	overview, err := GetSubscriptionOverview(start, end, 0.15)
	require.NoError(t, err)

	assert.Equal(t, int64(2), overview.Summary.OrderCount)
	assert.InDelta(t, 60, overview.Summary.Revenue, 0.000001)
	assert.Equal(t, int64(60000), overview.Summary.ConsumedQuota)
	assert.InDelta(t, 0.018, overview.Summary.ConsumedCost, 0.000001)
	assert.InDelta(t, 59.982, overview.Summary.GrossProfit, 0.000001)
	assert.Equal(t, int64(2), overview.Summary.ActiveSubscriptions)
	assert.Equal(t, int64(150000000), overview.Summary.CapacityQuota)
	assert.Equal(t, int64(60000), overview.Summary.UsedQuota)
	assert.Equal(t, int64(5000000), overview.Summary.ReservedQuota)
	assert.Equal(t, int64(144940000), overview.Summary.RemainingQuota)
	assert.InDelta(t, 43.482, overview.Summary.RemainingCost, 0.000001)

	require.Len(t, overview.Plans, 2)
	lite := overview.Plans[0]
	assert.Equal(t, 301, lite.PlanId)
	assert.Equal(t, int64(2), lite.OrderCount)
	assert.InDelta(t, 60, lite.Revenue, 0.000001)
	assert.Equal(t, int64(60000), lite.ConsumedQuota)
	assert.Equal(t, int64(2), lite.ActiveSubscriptions)
	assert.Equal(t, int64(150000000), lite.CapacityQuota)
	assert.InDelta(t, 0.9997, lite.GrossMargin, 0.000001)

	pro := overview.Plans[1]
	assert.Equal(t, 302, pro.PlanId)
	assert.False(t, pro.Enabled)
	assert.Equal(t, int64(0), pro.ActiveSubscriptions)
	assert.Equal(t, int64(0), pro.CapacityQuota)
}
