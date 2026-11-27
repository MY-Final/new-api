package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetSubscriptionOverviewAggregatesOrdersUsageAndActiveCapacity(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now
	previousRate := operation_setting.USDExchangeRate
	operation_setting.USDExchangeRate = 1
	t.Cleanup(func() {
		operation_setting.USDExchangeRate = previousRate
	})

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
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-in-1", PaymentMethod: "stripe", Status: "success", CompleteTime: now - 60},
		{UserId: user.Id, PlanId: 301, Money: 30, TradeNo: "order-in-2", PaymentMethod: PaymentMethodBalance, Status: "success", CompleteTime: now - 120},
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
			createdAt = now - 32*24*60*60
		}
		require.NoError(t, DB.Model(&SubscriptionPreConsumeRecord{}).
			Where("request_id = ?", usage[i].RequestId).
			UpdateColumn("created_at", createdAt).Error)
	}
	billings := []RequestBilling{
		{Id: "billing-vip", RequestId: "billing-vip", UserId: user.Id, SubscriptionId: 401, Group: "vip", CostRatio: 0.1, FundingSource: "subscription", Quota: 10000, Settled: true, CreatedAt: now - 40},
		{Id: "billing-default", RequestId: "billing-default", UserId: user.Id, SubscriptionId: 401, Group: "default", CostRatio: 0.2, FundingSource: "subscription", Quota: 50000, Settled: true, CreatedAt: now - 30},
		{Id: "billing-refunded", RequestId: "billing-refunded", UserId: user.Id, SubscriptionId: 401, Group: "vip", CostRatio: 0.1, FundingSource: "subscription", Quota: 99999, RefundedQuota: 99999, RefundedAt: now - 20, Settled: true, CreatedAt: now - 20},
		{Id: "billing-wallet", RequestId: "billing-wallet", UserId: user.Id, Group: "vip", CostRatio: 9, FundingSource: "wallet", Quota: 77777, Settled: true, CreatedAt: now - 20},
		{Id: "billing-old", RequestId: "billing-old", UserId: user.Id, SubscriptionId: 401, Group: "vip", CostRatio: 0.1, FundingSource: "subscription", Quota: 40000, Settled: true, CreatedAt: start - 86400},
		{Id: "billing-unsettled", RequestId: "billing-unsettled", UserId: user.Id, SubscriptionId: 401, Group: "vip", CostRatio: 0.1, FundingSource: "subscription", Quota: 12345, CreatedAt: now - 10},
	}
	require.NoError(t, DB.Create(&billings).Error)

	overview, err := GetSubscriptionOverview(start, end)
	require.NoError(t, err)

	assert.Equal(t, int64(2), overview.Summary.OrderCount)
	assert.InDelta(t, 60, overview.Summary.RevenueUSD, 0.000001)
	assert.InDelta(t, 30, overview.Summary.CashRevenueUSD, 0.000001)
	assert.InDelta(t, 30, overview.Summary.BalanceRevenueUSD, 0.000001)
	assert.Equal(t, int64(60000), overview.Summary.ConsumedQuota)
	assert.InDelta(t, 0.022, overview.Summary.ConsumedCostUSD, 0.000001)
	assert.Zero(t, overview.Summary.UnattributedQuota)
	assert.InDelta(t, 59.978, overview.Summary.GrossProfitUSD, 0.000001)
	assert.Equal(t, int64(2), overview.Summary.ActiveSubscriptions)
	assert.Equal(t, int64(0), overview.Summary.UnlimitedSubscriptions)
	assert.Equal(t, int64(150000000), overview.Summary.CapacityQuota)
	assert.Equal(t, int64(60000), overview.Summary.UsedQuota)
	assert.Equal(t, int64(5000000), overview.Summary.ReservedQuota)
	assert.Equal(t, int64(144940000), overview.Summary.RemainingQuota)
	assert.InDelta(t, 53.144666, overview.Summary.RemainingCostUSD, 0.000001)

	require.Len(t, overview.Plans, 2)
	lite := overview.Plans[0]
	assert.Equal(t, 301, lite.PlanId)
	assert.Equal(t, int64(2), lite.OrderCount)
	assert.InDelta(t, 60, lite.RevenueUSD, 0.000001)
	assert.InDelta(t, 30, lite.CashRevenueUSD, 0.000001)
	assert.InDelta(t, 30, lite.BalanceRevenueUSD, 0.000001)
	assert.Equal(t, int64(60000), lite.ConsumedQuota)
	assert.InDelta(t, 0.022, lite.ConsumedCostUSD, 0.000001)
	assert.InDelta(t, 0.1833333, lite.RemainingCostRatio, 0.000001)
	assert.Equal(t, "consumption", lite.RemainingCostRatioSource)
	assert.Equal(t, int64(2), lite.ActiveSubscriptions)
	assert.Equal(t, int64(150000000), lite.CapacityQuota)
	assert.InDelta(t, 0.99963333, lite.GrossMargin, 0.000001)
	require.Len(t, lite.Groups, 2)
	assert.Equal(t, "default", lite.Groups[0].GroupName)
	assert.Equal(t, int64(50000), lite.Groups[0].ConsumedQuota)
	assert.InDelta(t, 0.02, lite.Groups[0].ConsumedCostUSD, 0.000001)
	assert.InDelta(t, 0.2, lite.Groups[0].EffectiveCostRatio, 0.000001)
	assert.InDelta(t, 0.9090909, lite.Groups[0].CostShare, 0.000001)
	assert.Equal(t, "snapshot", lite.Groups[0].CostRatioSource)
	assert.Equal(t, "vip", lite.Groups[1].GroupName)
	assert.Equal(t, int64(10000), lite.Groups[1].ConsumedQuota)
	assert.InDelta(t, 0.002, lite.Groups[1].ConsumedCostUSD, 0.000001)
	assert.InDelta(t, 0.1, lite.Groups[1].EffectiveCostRatio, 0.000001)
	assert.InDelta(t, 0.09090909, lite.Groups[1].CostShare, 0.000001)
	assert.Equal(t, "snapshot", lite.Groups[1].CostRatioSource)

	pro := overview.Plans[1]
	assert.Equal(t, 302, pro.PlanId)
	assert.False(t, pro.Enabled)
	assert.Equal(t, int64(0), pro.ActiveSubscriptions)
	assert.Equal(t, int64(0), pro.CapacityQuota)
}

func TestGetSubscriptionOverviewUsesCurrentRollingWindowAndUnlimitedCapacity(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now

	user := &User{
		Username: "overview-window-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	plan := SubscriptionPlan{Id: 501, Title: "Windowed", PriceAmount: 10, Currency: "USD", Enabled: true}
	require.NoError(t, DB.Create(&plan).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsWithCostRatiosTx(
		DB, plan.Id, []string{"default"}, nil, map[string]float64{"default": 0.15},
	))
	subscriptions := []UserSubscription{
		{Id: 601, UserId: user.Id, PlanId: plan.Id, AmountTotal: 0, AmountUsed: 5000000, Status: "active", EndTime: now + 86400},
		{Id: 602, UserId: user.Id, PlanId: plan.Id, AmountTotal: 0, AmountUsed: 12345, Status: "active", EndTime: now + 86400},
	}
	require.NoError(t, DB.Create(&subscriptions).Error)
	require.NoError(t, DB.Create(&[]UserSubscriptionQuotaWindow{
		{UserSubscriptionId: 601, WindowSeconds: 3600, QuotaLimit: 100},
		{UserSubscriptionId: 601, WindowSeconds: 86400, QuotaLimit: 1000},
	}).Error)
	require.NoError(t, DB.Create(&SubscriptionPreConsumeRecord{
		RequestId: "window-settled", UserId: user.Id, UserSubscriptionId: 601,
		UsageQuota: 80, Status: "consumed", FinalizedAt: now - 10,
	}).Error)
	require.NoError(t, DB.Create(&SubscriptionPreConsumeRecord{
		RequestId: "window-reserved", UserId: user.Id, UserSubscriptionId: 601,
		UsageQuota: 5, Status: "consumed",
	}).Error)

	overview, err := GetSubscriptionOverview(start, end)
	require.NoError(t, err)

	assert.Equal(t, int64(2), overview.Summary.ActiveSubscriptions)
	assert.Equal(t, int64(1), overview.Summary.UnlimitedSubscriptions)
	assert.Equal(t, int64(100), overview.Summary.CapacityQuota)
	assert.Equal(t, int64(80), overview.Summary.UsedQuota)
	assert.Equal(t, int64(5), overview.Summary.ReservedQuota)
	assert.Equal(t, int64(15), overview.Summary.RemainingQuota)
	assert.InDelta(t, 0.0000045, overview.Summary.RemainingCostUSD, 0.000000001)
	assert.Equal(t, "configured", overview.Plans[0].RemainingCostRatioSource)
}

func TestGetSubscriptionOverviewConvertsCustomCurrencyAndFlagsQuotaBelowPrice(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now
	previousRate := operation_setting.USDExchangeRate
	t.Cleanup(func() {
		operation_setting.USDExchangeRate = previousRate
	})

	user := &User{
		Username: "overview-currency-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	plan := SubscriptionPlan{
		Id: 701, Title: "Currency", PriceAmount: 30, Currency: "CNY",
		Enabled: true, TotalAmount: 2054795,
	}
	require.NoError(t, DB.Create(&plan).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId: user.Id, PlanId: plan.Id, Money: 30, TradeNo: "currency-order",
		PaymentMethod: PaymentMethodBalance, Status: common.TopUpStatusSuccess, CompleteTime: now - 10,
	}).Error)
	unsupportedPlan := SubscriptionPlan{
		Id: 702, Title: "Unsupported", PriceAmount: 10, Currency: "EUR", Enabled: true,
	}
	require.NoError(t, DB.Create(&unsupportedPlan).Error)
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId: user.Id, PlanId: unsupportedPlan.Id, Money: 10, TradeNo: "unsupported-order",
		PaymentMethod: "stripe", Status: common.TopUpStatusSuccess, CompleteTime: now - 10,
	}).Error)

	operation_setting.USDExchangeRate = 7.3
	overview, err := GetSubscriptionOverview(start, end)
	require.NoError(t, err)
	assert.InDelta(t, 30.0/7.3, overview.Summary.RevenueUSD, 0.000001)
	assert.InDelta(t, 30.0/7.3, overview.Summary.BalanceRevenueUSD, 0.000001)
	assert.InDelta(t, 30.0/7.3, overview.Plans[0].PriceAmountUSD, 0.000001)
	assert.False(t, overview.Plans[0].QuotaBelowPrice)
	assert.True(t, overview.HasUnsupportedCurrency)
	assert.False(t, overview.Plans[1].CurrencySupported)
	assert.Equal(t, int64(1), overview.Plans[1].OrderCount)
	assert.Zero(t, overview.Plans[1].RevenueUSD)

	operation_setting.USDExchangeRate = 1
	overview, err = GetSubscriptionOverview(start, end)
	require.NoError(t, err)
	assert.InDelta(t, 30, overview.Summary.RevenueUSD, 0.000001)
	assert.InDelta(t, 30, overview.Summary.BalanceRevenueUSD, 0.000001)
	assert.InDelta(t, 30, overview.Plans[0].PriceAmountUSD, 0.000001)
	assert.InDelta(t, 2054795.0/500000.0, overview.Plans[0].ConfiguredQuotaUSD, 0.000001)
	assert.True(t, overview.Plans[0].QuotaBelowPrice)
}

func TestGetSubscriptionOverviewAttributesOnlySnapshottedCostRatios(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now

	user := &User{
		Username: "overview-cost-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	consumedPlan := SubscriptionPlan{Id: 801, Title: "Consumed", Currency: "USD", Enabled: true, TotalAmount: 1000000}
	unusedPlan := SubscriptionPlan{Id: 802, Title: "Unused", Currency: "USD", Enabled: true, TotalAmount: 300000}
	require.NoError(t, DB.Create(&[]SubscriptionPlan{consumedPlan, unusedPlan}).Error)
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsWithCostRatiosTx(DB, consumedPlan.Id, []string{"vip"}, nil, map[string]float64{"vip": 0.09}))
	require.NoError(t, ReplaceSubscriptionPlanRouteGroupsWithCostRatiosTx(DB, unusedPlan.Id, []string{"cheap", "premium"}, nil, map[string]float64{"cheap": 0.13}))
	require.NoError(t, DB.Create(&[]UserSubscription{
		{Id: 901, UserId: user.Id, PlanId: consumedPlan.Id, AmountTotal: 1000000, AmountUsed: 100000, Status: "active", EndTime: now + 86400},
		{Id: 902, UserId: user.Id, PlanId: unusedPlan.Id, AmountTotal: 300000, AmountUsed: 0, Status: "active", EndTime: now + 86400},
	}).Error)
	require.NoError(t, DB.Create(&[]RequestBilling{{
		Id: "billing-known", RequestId: "billing-known", UserId: user.Id,
		SubscriptionId: 901, Group: "vip", CostRatio: 0.09, FundingSource: "subscription",
		Quota: 60000, Settled: true, CreatedAt: now - 10,
	}, {
		Id: "billing-unattributed", RequestId: "billing-unattributed", UserId: user.Id,
		SubscriptionId: 901, Group: "vip", CostRatio: 0, FundingSource: "subscription",
		Quota: 40000, Settled: true, CreatedAt: now - 10,
	}}).Error)

	overview, err := GetSubscriptionOverview(start, end)
	require.NoError(t, err)

	consumed := overview.Plans[0]
	assert.Equal(t, int64(100000), consumed.ConsumedQuota)
	assert.Equal(t, int64(40000), consumed.UnattributedQuota)
	assert.InDelta(t, 0.0108, consumed.ConsumedCostUSD, 0.000001)
	require.Len(t, consumed.Groups, 1)
	assert.Equal(t, "vip", consumed.Groups[0].GroupName)
	assert.Equal(t, int64(40000), consumed.Groups[0].UnattributedQuota)
	assert.InDelta(t, 0.09, consumed.Groups[0].EffectiveCostRatio, 0.000001)
	assert.Equal(t, "partial", consumed.Groups[0].CostRatioSource)
	assert.InDelta(t, 0.09, consumed.RemainingCostRatio, 0.000001)
	assert.Equal(t, "consumption", consumed.RemainingCostRatioSource)
	assert.InDelta(t, 0.162, consumed.RemainingCostUSD, 0.000001)
	assert.Equal(t, int64(40000), overview.Summary.UnattributedQuota)

	unused := overview.Plans[1]
	assert.Zero(t, unused.ConsumedQuota)
	assert.InDelta(t, 0.13, unused.RemainingCostRatio, 0.000001)
	assert.Equal(t, "partial", unused.RemainingCostRatioSource)
	assert.Equal(t, []string{"premium"}, unused.UnconfiguredCostRatioGroups)
	assert.InDelta(t, 0.078, unused.RemainingCostUSD, 0.000001)
}

func TestGetSubscriptionOverviewKeepsDeletedSubscriptionUsageByPlanSnapshot(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start := now - 7*24*60*60
	end := now

	user := &User{
		Username: "overview-deleted-subscription-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)
	plan := SubscriptionPlan{Id: 1001, Title: "Deleted subscription", Currency: "USD", Enabled: true, TotalAmount: 1000000}
	require.NoError(t, DB.Create(&plan).Error)
	subscription := UserSubscription{
		Id: 1101, UserId: user.Id, PlanId: plan.Id, AmountTotal: 1000000,
		Status: "active", EndTime: now + 86400,
	}
	require.NoError(t, DB.Create(&subscription).Error)
	require.NoError(t, DB.Create(&RequestBilling{
		Id: "billing-deleted-subscription", RequestId: "billing-deleted-subscription",
		UserId: user.Id, SubscriptionId: subscription.Id, PlanId: plan.Id,
		Group: "vip", CostRatio: 0.2, FundingSource: "subscription",
		Quota: 10000, Settled: true, CreatedAt: now - 10,
	}).Error)
	require.NoError(t, DB.Where("id = ?", subscription.Id).Delete(&UserSubscription{}).Error)

	overview, err := GetSubscriptionOverview(start, end)
	require.NoError(t, err)

	planOverview := overview.Plans[0]
	assert.Equal(t, plan.Id, planOverview.PlanId)
	assert.Equal(t, int64(10000), planOverview.ConsumedQuota)
	assert.InDelta(t, 0.004, planOverview.ConsumedCostUSD, 0.000001)
	assert.Zero(t, planOverview.UnattributedQuota)
	require.Len(t, planOverview.Groups, 1)
	assert.Equal(t, "vip", planOverview.Groups[0].GroupName)
	assert.Equal(t, "snapshot", planOverview.Groups[0].CostRatioSource)
}
