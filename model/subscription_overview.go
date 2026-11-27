package model

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

type SubscriptionOverview struct {
	StartTimestamp         int64                      `json:"start_timestamp"`
	EndTimestamp           int64                      `json:"end_timestamp"`
	QuotaPerUnit           float64                    `json:"quota_per_unit"`
	HasUnsupportedCurrency bool                       `json:"has_unsupported_currency"`
	Summary                SubscriptionOverviewTotals `json:"summary"`
	Plans                  []SubscriptionOverviewPlan `json:"plans"`
}

type SubscriptionOverviewTotals struct {
	OrderCount             int64   `json:"order_count"`
	RevenueUSD             float64 `json:"revenue_usd"`
	CashRevenueUSD         float64 `json:"cash_revenue_usd"`
	BalanceRevenueUSD      float64 `json:"balance_revenue_usd"`
	ConsumedQuota          int64   `json:"consumed_quota"`
	ConsumedCostUSD        float64 `json:"consumed_cost_usd"`
	UnattributedQuota      int64   `json:"unattributed_quota"`
	GrossProfitUSD         float64 `json:"gross_profit_usd"`
	GrossMargin            float64 `json:"gross_margin"`
	ActiveSubscriptions    int64   `json:"active_subscriptions"`
	UnlimitedSubscriptions int64   `json:"unlimited_subscriptions"`
	CapacityQuota          int64   `json:"capacity_quota"`
	UsedQuota              int64   `json:"used_quota"`
	ReservedQuota          int64   `json:"reserved_quota"`
	RemainingQuota         int64   `json:"remaining_quota"`
	RemainingCostUSD       float64 `json:"remaining_cost_usd"`
}

type SubscriptionOverviewPlan struct {
	PlanId                 int     `json:"plan_id"`
	Title                  string  `json:"title"`
	PriceAmount            float64 `json:"price_amount"`
	PriceAmountUSD         float64 `json:"price_amount_usd"`
	Currency               string  `json:"currency"`
	CurrencySupported      bool    `json:"currency_supported"`
	Enabled                bool    `json:"enabled"`
	ConfiguredQuotaUSD     float64 `json:"configured_quota_usd"`
	QuotaBelowPrice        bool    `json:"quota_below_price"`
	OrderCount             int64   `json:"order_count"`
	RevenueUSD             float64 `json:"revenue_usd"`
	CashRevenueUSD         float64 `json:"cash_revenue_usd"`
	BalanceRevenueUSD      float64 `json:"balance_revenue_usd"`
	ConsumedQuota          int64   `json:"consumed_quota"`
	ConsumedCostUSD        float64 `json:"consumed_cost_usd"`
	UnattributedQuota      int64   `json:"unattributed_quota"`
	GrossProfitUSD         float64 `json:"gross_profit_usd"`
	GrossMargin            float64 `json:"gross_margin"`
	ActiveSubscriptions    int64   `json:"active_subscriptions"`
	UnlimitedSubscriptions int64   `json:"unlimited_subscriptions"`
	CapacityQuota          int64   `json:"capacity_quota"`
	UsedQuota              int64   `json:"used_quota"`
	ReservedQuota          int64   `json:"reserved_quota"`
	RemainingQuota         int64   `json:"remaining_quota"`
	RemainingCostUSD       float64 `json:"remaining_cost_usd"`
	RemainingCostRatio     float64 `json:"remaining_cost_ratio"`
	// RemainingCostRatioSource is "consumption", "configured", "partial", or
	// "unconfigured". Partial means some route groups still lack a cost ratio.
	RemainingCostRatioSource    string                      `json:"remaining_cost_ratio_source"`
	UnconfiguredCostRatioGroups []string                    `json:"unconfigured_cost_ratio_groups"`
	Groups                      []SubscriptionOverviewGroup `json:"groups"`
}

type SubscriptionOverviewGroup struct {
	GroupName          string  `json:"group_name"`
	ConsumedQuota      int64   `json:"consumed_quota"`
	ConsumedCostUSD    float64 `json:"consumed_cost_usd"`
	UnattributedQuota  int64   `json:"unattributed_quota"`
	EffectiveCostRatio float64 `json:"effective_cost_ratio"`
	CostShare          float64 `json:"cost_share"`
	// CostRatioSource is "snapshot", "partial", or "unattributed".
	CostRatioSource string `json:"cost_ratio_source"`
}

type subscriptionOverviewGroupUsage struct {
	PlanId        int     `gorm:"column:plan_id"`
	GroupName     string  `gorm:"column:group_name"`
	CostRatio     float64 `gorm:"column:cost_ratio"`
	ConsumedQuota int64   `gorm:"column:consumed_quota"`
}

type subscriptionOverviewGroupTotals struct {
	quota             int64
	snapshotQuota     int64
	snapshotCost      float64
	unattributedQuota int64
}

func subscriptionOverviewCurrencyToUSD(amount float64, currency string, usdToCNY float64) (float64, bool) {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "USD":
		return amount, true
	case "CNY":
		if usdToCNY <= 0 {
			return 0, false
		}
		return amount / usdToCNY, true
	default:
		return 0, false
	}
}

// GetSubscriptionOverview aggregates subscription order revenue, consumed
// quota cost, and the remaining capacity of active subscriptions. Revenue is
// cash collected from successful orders inside the range. Consumed quota and
// cost come from settled RequestBilling rows, so each charge keeps the route
// group and cost ratio that were effective when the request settled.
func GetSubscriptionOverview(start, end int64) (*SubscriptionOverview, error) {
	if start <= 0 || end <= 0 {
		return nil, errors.New("start and end timestamps are required")
	}
	if end < start {
		return nil, errors.New("end timestamp must not be before start timestamp")
	}
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 {
		quotaPerUnit = 500000
	}

	usdToCNY := operation_setting.USDExchangeRate
	if usdToCNY <= 0 {
		usdToCNY = 1
	}
	hasUnsupportedCurrency := false

	plans := make([]SubscriptionPlan, 0)
	if err := DB.
		Select("id", "title", "price_amount", "currency", "enabled", "sort_order", "total_amount").
		Order("sort_order asc, id asc").
		Find(&plans).Error; err != nil {
		return nil, err
	}
	planWindows := make([]SubscriptionPlanQuotaWindow, 0)
	if err := DB.
		Select("plan_id", "quota_limit").
		Find(&planWindows).Error; err != nil {
		return nil, err
	}
	planWindowCapacity := make(map[int]int64, len(planWindows))
	for _, window := range planWindows {
		planWindowCapacity[window.PlanId] = max(planWindowCapacity[window.PlanId], window.QuotaLimit)
	}

	orderRows := make([]struct {
		PlanId        int     `gorm:"column:plan_id"`
		PaymentMethod string  `gorm:"column:payment_method"`
		OrderCount    int64   `gorm:"column:order_count"`
		Revenue       float64 `gorm:"column:revenue"`
	}, 0)
	if err := DB.Model(&SubscriptionOrder{}).
		Select("plan_id, payment_method, COUNT(*) AS order_count, COALESCE(SUM(money), 0) AS revenue").
		Where("status = ? AND complete_time >= ? AND complete_time <= ?", common.TopUpStatusSuccess, start, end).
		Group("plan_id").
		Group("payment_method").
		Scan(&orderRows).Error; err != nil {
		return nil, err
	}

	if commonGroupCol == "" {
		initCol()
	}
	netQuotaExpr := "CASE WHEN request_billings.quota > COALESCE(request_billings.refunded_quota, 0) THEN request_billings.quota - COALESCE(request_billings.refunded_quota, 0) ELSE 0 END"
	planIdExpr := "COALESCE(NULLIF(request_billings.plan_id, 0), user_subscriptions.plan_id)"
	groupUsageRows := make([]subscriptionOverviewGroupUsage, 0)
	if err := DB.Model(&RequestBilling{}).
		Select(fmt.Sprintf(
			"%s AS plan_id, request_billings.%s AS group_name, request_billings.cost_ratio AS cost_ratio, COALESCE(SUM(%s), 0) AS consumed_quota",
			planIdExpr, commonGroupCol, netQuotaExpr,
		)).
		Joins("LEFT JOIN user_subscriptions ON user_subscriptions.id = request_billings.subscription_id").
		Where("request_billings.funding_source = ? AND request_billings.created_at >= ? AND request_billings.created_at <= ? AND (request_billings.settled = ? OR request_billings.usage_recorded = ?)",
			"subscription", start, end, true, true).
		Group(fmt.Sprintf("%s, request_billings.%s, request_billings.cost_ratio", planIdExpr, commonGroupCol)).
		Scan(&groupUsageRows).Error; err != nil {
		return nil, err
	}
	configuredCostRatios := make([]SubscriptionPlanRouteGroup, 0)
	if err := DB.Select("plan_id", "group_name", "cost_ratio").Find(&configuredCostRatios).Error; err != nil {
		return nil, err
	}
	maxConfiguredCostRatio := make(map[int]float64, len(plans))
	unconfiguredCostRatioGroups := make(map[int][]string, len(plans))
	for _, row := range configuredCostRatios {
		if math.IsNaN(row.CostRatio) || math.IsInf(row.CostRatio, 0) || row.CostRatio <= 0 {
			unconfiguredCostRatioGroups[row.PlanId] = append(unconfiguredCostRatioGroups[row.PlanId], row.GroupName)
			continue
		}
		if row.CostRatio > maxConfiguredCostRatio[row.PlanId] {
			maxConfiguredCostRatio[row.PlanId] = row.CostRatio
		}
	}
	groupTotalsByPlan := make(map[int]map[string]*subscriptionOverviewGroupTotals)
	for _, row := range groupUsageRows {
		if row.PlanId <= 0 || row.ConsumedQuota <= 0 {
			continue
		}
		if groupTotalsByPlan[row.PlanId] == nil {
			groupTotalsByPlan[row.PlanId] = make(map[string]*subscriptionOverviewGroupTotals)
		}
		totals := groupTotalsByPlan[row.PlanId][row.GroupName]
		if totals == nil {
			totals = &subscriptionOverviewGroupTotals{}
			groupTotalsByPlan[row.PlanId][row.GroupName] = totals
		}
		totals.quota += row.ConsumedQuota
		ratio := row.CostRatio
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
			ratio = 0
		}
		if ratio > 0 {
			totals.snapshotQuota += row.ConsumedQuota
			totals.snapshotCost += float64(row.ConsumedQuota) / quotaPerUnit * ratio
			continue
		}
		totals.unattributedQuota += row.ConsumedQuota
	}

	now := common.GetTimestamp()
	subscriptions := make([]UserSubscription, 0)
	if err := DB.
		Select("id", "plan_id", "amount_total", "amount_used", "status", "end_time").
		Where("status = ? AND end_time > ?", "active", now).
		Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	activeIDs := make([]int, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		activeIDs = append(activeIDs, subscription.Id)
	}

	windowsBySubscription := make(map[int][]UserSubscriptionQuotaWindow, len(activeIDs))
	if len(activeIDs) > 0 {
		windows := make([]UserSubscriptionQuotaWindow, 0)
		if err := DB.
			Select("user_subscription_id", "window_seconds", "quota_limit").
			Where("user_subscription_id IN ?", activeIDs).
			Order("user_subscription_id asc, sort_order asc, window_seconds asc, id asc").
			Find(&windows).Error; err != nil {
			return nil, err
		}
		for _, window := range windows {
			windowsBySubscription[window.UserSubscriptionId] = append(windowsBySubscription[window.UserSubscriptionId], window)
		}
	}

	type subscriptionWindowUsage struct {
		UserSubscriptionId int   `gorm:"column:user_subscription_id"`
		UsedQuota          int64 `gorm:"column:used_quota"`
		ReservedQuota      int64 `gorm:"column:reserved_quota"`
	}
	windowUsageByDuration := make(map[int64]map[int]subscriptionWindowUsage)
	windowDurations := make(map[int64]struct{})
	for _, windows := range windowsBySubscription {
		for _, window := range windows {
			windowDurations[window.WindowSeconds] = struct{}{}
		}
	}
	for windowSeconds := range windowDurations {
		windowUsageByDuration[windowSeconds] = make(map[int]subscriptionWindowUsage)
		if len(activeIDs) == 0 {
			continue
		}
		rows := make([]subscriptionWindowUsage, 0)
		if err := DB.Model(&SubscriptionPreConsumeRecord{}).
			Select("user_subscription_id, COALESCE(SUM(usage_quota), 0) AS used_quota, COALESCE(SUM(CASE WHEN finalized_at = 0 THEN usage_quota ELSE 0 END), 0) AS reserved_quota").
			Where("user_subscription_id IN ? AND created_at > ? AND status <> ?",
				activeIDs, now-windowSeconds, SubscriptionUsageStatusRefunded).
			Group("user_subscription_id").
			Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			windowUsageByDuration[windowSeconds][row.UserSubscriptionId] = row
		}
	}

	reservedRows := make([]struct {
		UserSubscriptionId int   `gorm:"column:user_subscription_id"`
		ReservedQuota      int64 `gorm:"column:reserved_quota"`
	}, 0)
	if len(activeIDs) > 0 {
		if err := DB.Model(&SubscriptionPreConsumeRecord{}).
			Select("user_subscription_id, COALESCE(SUM(usage_quota), 0) AS reserved_quota").
			Where("user_subscription_id IN ? AND status <> ? AND finalized_at = 0", activeIDs, SubscriptionUsageStatusRefunded).
			Group("user_subscription_id").
			Scan(&reservedRows).Error; err != nil {
			return nil, err
		}
	}
	reservedBySubscription := make(map[int]int64, len(reservedRows))
	for _, row := range reservedRows {
		reservedBySubscription[row.UserSubscriptionId] = max(row.ReservedQuota, 0)
	}

	rows := make(map[int]*SubscriptionOverviewPlan, len(plans))
	orderedPlanIds := make([]int, 0, len(plans))
	for _, plan := range plans {
		priceAmountUSD, currencySupported := subscriptionOverviewCurrencyToUSD(plan.PriceAmount, plan.Currency, usdToCNY)
		configuredQuota := plan.TotalAmount
		if configuredQuota <= 0 {
			configuredQuota = planWindowCapacity[plan.Id]
		}
		configuredQuotaUSD := float64(configuredQuota) / quotaPerUnit
		quotaBelowPrice := configuredQuota > 0 && priceAmountUSD > 0 && configuredQuotaUSD+1e-9 < priceAmountUSD
		rows[plan.Id] = &SubscriptionOverviewPlan{
			PlanId:             plan.Id,
			Title:              plan.Title,
			PriceAmount:        plan.PriceAmount,
			PriceAmountUSD:     priceAmountUSD,
			Currency:           plan.Currency,
			CurrencySupported:  currencySupported,
			Enabled:            plan.Enabled,
			ConfiguredQuotaUSD: configuredQuotaUSD,
			QuotaBelowPrice:    quotaBelowPrice,
		}
		orderedPlanIds = append(orderedPlanIds, plan.Id)
	}
	planRow := func(planId int) *SubscriptionOverviewPlan {
		row, ok := rows[planId]
		if ok {
			return row
		}
		row = &SubscriptionOverviewPlan{
			PlanId:            planId,
			Title:             fmt.Sprintf("Plan #%d", planId),
			CurrencySupported: false,
		}
		hasUnsupportedCurrency = true
		rows[planId] = row
		orderedPlanIds = append(orderedPlanIds, planId)
		return row
	}

	for _, row := range orderRows {
		target := planRow(row.PlanId)
		target.OrderCount += row.OrderCount
		revenueUSD, ok := subscriptionOverviewCurrencyToUSD(row.Revenue, target.Currency, usdToCNY)
		if !ok {
			hasUnsupportedCurrency = true
			target.CurrencySupported = false
			continue
		}
		target.RevenueUSD += revenueUSD
		if row.PaymentMethod == PaymentMethodBalance {
			target.BalanceRevenueUSD += revenueUSD
		} else {
			target.CashRevenueUSD += revenueUSD
		}
	}
	for _, subscription := range subscriptions {
		row := planRow(subscription.PlanId)
		row.ActiveSubscriptions++
		windows := windowsBySubscription[subscription.Id]
		if len(windows) > 0 {
			hasSelected := false
			var selectedLimit int64
			var selectedUsed int64
			var selectedReserved int64
			var selectedAvailable int64
			for _, window := range windows {
				usage := windowUsageByDuration[window.WindowSeconds][subscription.Id]
				available := max(window.QuotaLimit-usage.UsedQuota, 0)
				if hasSelected &&
					(available > selectedAvailable ||
						available == selectedAvailable && window.QuotaLimit <= selectedLimit) {
					continue
				}
				hasSelected = true
				selectedLimit = window.QuotaLimit
				selectedUsed = max(usage.UsedQuota-usage.ReservedQuota, 0)
				selectedReserved = max(usage.ReservedQuota, 0)
				selectedAvailable = available
			}
			if hasSelected {
				row.CapacityQuota += selectedLimit
				row.UsedQuota += selectedUsed
				row.ReservedQuota += selectedReserved
				row.RemainingQuota += selectedAvailable
			}
			continue
		}
		if subscription.AmountTotal > 0 {
			reserved := reservedBySubscription[subscription.Id]
			row.CapacityQuota += subscription.AmountTotal
			row.UsedQuota += max(subscription.AmountUsed-reserved, 0)
			row.ReservedQuota += reserved
			row.RemainingQuota += max(subscription.AmountTotal-subscription.AmountUsed, 0)
			continue
		}
		row.UnlimitedSubscriptions++
	}

	for planId := range groupTotalsByPlan {
		planRow(planId)
	}
	overview := &SubscriptionOverview{
		StartTimestamp:         start,
		EndTimestamp:           end,
		QuotaPerUnit:           quotaPerUnit,
		HasUnsupportedCurrency: hasUnsupportedCurrency,
		Plans:                  make([]SubscriptionOverviewPlan, 0, len(orderedPlanIds)),
	}
	for _, planId := range orderedPlanIds {
		row := *rows[planId]
		groups := make([]SubscriptionOverviewGroup, 0, len(groupTotalsByPlan[planId]))
		for groupName, totals := range groupTotalsByPlan[planId] {
			cost := totals.snapshotCost
			effectiveRatio := 0.0
			if totals.snapshotQuota > 0 {
				effectiveRatio = cost * quotaPerUnit / float64(totals.snapshotQuota)
			}
			source := "unattributed"
			switch {
			case totals.snapshotQuota > 0 && totals.unattributedQuota > 0:
				source = "partial"
			case totals.snapshotQuota > 0:
				source = "snapshot"
			}
			groups = append(groups, SubscriptionOverviewGroup{
				GroupName:          groupName,
				ConsumedQuota:      totals.quota,
				ConsumedCostUSD:    cost,
				UnattributedQuota:  totals.unattributedQuota,
				EffectiveCostRatio: effectiveRatio,
				CostRatioSource:    source,
			})
			row.ConsumedQuota += totals.quota
			row.ConsumedCostUSD += cost
			row.UnattributedQuota += totals.unattributedQuota
		}
		slices.SortFunc(groups, func(a, b SubscriptionOverviewGroup) int {
			switch {
			case a.ConsumedCostUSD > b.ConsumedCostUSD:
				return -1
			case a.ConsumedCostUSD < b.ConsumedCostUSD:
				return 1
			default:
				return strings.Compare(a.GroupName, b.GroupName)
			}
		})
		for index := range groups {
			if row.ConsumedCostUSD > 0 {
				groups[index].CostShare = groups[index].ConsumedCostUSD / row.ConsumedCostUSD
			}
		}
		row.Groups = groups
		row.GrossProfitUSD = row.RevenueUSD - row.ConsumedCostUSD
		if row.RevenueUSD > 0 {
			row.GrossMargin = row.GrossProfitUSD / row.RevenueUSD
		}
		row.UnconfiguredCostRatioGroups = make([]string, len(unconfiguredCostRatioGroups[planId]))
		copy(row.UnconfiguredCostRatioGroups, unconfiguredCostRatioGroups[planId])
		slices.Sort(row.UnconfiguredCostRatioGroups)
		attributedQuota := row.ConsumedQuota - row.UnattributedQuota
		switch {
		case attributedQuota > 0:
			row.RemainingCostRatio = row.ConsumedCostUSD * quotaPerUnit / float64(attributedQuota)
			row.RemainingCostRatioSource = "consumption"
		case maxConfiguredCostRatio[planId] > 0:
			row.RemainingCostRatio = maxConfiguredCostRatio[planId]
			row.RemainingCostRatioSource = "configured"
			if len(row.UnconfiguredCostRatioGroups) > 0 {
				row.RemainingCostRatioSource = "partial"
			}
		default:
			row.RemainingCostRatioSource = "unconfigured"
		}
		row.RemainingCostUSD = float64(row.RemainingQuota) / quotaPerUnit * row.RemainingCostRatio

		overview.Summary.OrderCount += row.OrderCount
		overview.Summary.RevenueUSD += row.RevenueUSD
		overview.Summary.CashRevenueUSD += row.CashRevenueUSD
		overview.Summary.BalanceRevenueUSD += row.BalanceRevenueUSD
		overview.Summary.ConsumedQuota += row.ConsumedQuota
		overview.Summary.ConsumedCostUSD += row.ConsumedCostUSD
		overview.Summary.UnattributedQuota += row.UnattributedQuota
		overview.Summary.GrossProfitUSD += row.GrossProfitUSD
		overview.Summary.ActiveSubscriptions += row.ActiveSubscriptions
		overview.Summary.UnlimitedSubscriptions += row.UnlimitedSubscriptions
		overview.Summary.CapacityQuota += row.CapacityQuota
		overview.Summary.UsedQuota += row.UsedQuota
		overview.Summary.ReservedQuota += row.ReservedQuota
		overview.Summary.RemainingQuota += row.RemainingQuota
		overview.Summary.RemainingCostUSD += row.RemainingCostUSD
		overview.Plans = append(overview.Plans, row)
	}
	if overview.Summary.RevenueUSD > 0 {
		overview.Summary.GrossMargin = overview.Summary.GrossProfitUSD / overview.Summary.RevenueUSD
	}
	return overview, nil
}
