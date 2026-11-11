package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
)

// DefaultSubscriptionUpstreamRatio is the fallback upstream multiplier used by
// the subscription business overview when the caller does not specify one.
const DefaultSubscriptionUpstreamRatio = 0.15

type SubscriptionOverview struct {
	StartTimestamp int64                      `json:"start_timestamp"`
	EndTimestamp   int64                      `json:"end_timestamp"`
	UpstreamRatio  float64                    `json:"upstream_ratio"`
	QuotaPerUnit   float64                    `json:"quota_per_unit"`
	Summary        SubscriptionOverviewTotals `json:"summary"`
	Plans          []SubscriptionOverviewPlan `json:"plans"`
}

type SubscriptionOverviewTotals struct {
	OrderCount          int64   `json:"order_count"`
	Revenue             float64 `json:"revenue"`
	ConsumedQuota       int64   `json:"consumed_quota"`
	ConsumedCost        float64 `json:"consumed_cost"`
	GrossProfit         float64 `json:"gross_profit"`
	GrossMargin         float64 `json:"gross_margin"`
	ActiveSubscriptions int64   `json:"active_subscriptions"`
	CapacityQuota       int64   `json:"capacity_quota"`
	UsedQuota           int64   `json:"used_quota"`
	ReservedQuota       int64   `json:"reserved_quota"`
	RemainingQuota      int64   `json:"remaining_quota"`
	RemainingCost       float64 `json:"remaining_cost"`
}

type SubscriptionOverviewPlan struct {
	PlanId              int     `json:"plan_id"`
	Title               string  `json:"title"`
	PriceAmount         float64 `json:"price_amount"`
	Currency            string  `json:"currency"`
	Enabled             bool    `json:"enabled"`
	OrderCount          int64   `json:"order_count"`
	Revenue             float64 `json:"revenue"`
	ConsumedQuota       int64   `json:"consumed_quota"`
	ConsumedCost        float64 `json:"consumed_cost"`
	GrossProfit         float64 `json:"gross_profit"`
	GrossMargin         float64 `json:"gross_margin"`
	ActiveSubscriptions int64   `json:"active_subscriptions"`
	CapacityQuota       int64   `json:"capacity_quota"`
	UsedQuota           int64   `json:"used_quota"`
	ReservedQuota       int64   `json:"reserved_quota"`
	RemainingQuota      int64   `json:"remaining_quota"`
	RemainingCost       float64 `json:"remaining_cost"`
}

// GetSubscriptionOverview aggregates subscription order revenue, consumed
// quota cost, and the remaining capacity of active subscriptions. Revenue is
// cash collected from successful orders inside the range; cost only covers
// quota actually consumed inside the same range.
func GetSubscriptionOverview(start, end int64, upstreamRatio float64) (*SubscriptionOverview, error) {
	if start <= 0 || end <= 0 {
		return nil, errors.New("start and end timestamps are required")
	}
	if end < start {
		return nil, errors.New("end timestamp must not be before start timestamp")
	}
	if upstreamRatio < 0 {
		return nil, errors.New("upstream ratio must not be negative")
	}
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 {
		quotaPerUnit = 500000
	}

	plans := make([]SubscriptionPlan, 0)
	if err := DB.
		Select("id", "title", "price_amount", "currency", "enabled", "sort_order").
		Order("sort_order asc, id asc").
		Find(&plans).Error; err != nil {
		return nil, err
	}

	orderRows := make([]struct {
		PlanId     int     `gorm:"column:plan_id"`
		OrderCount int64   `gorm:"column:order_count"`
		Revenue    float64 `gorm:"column:revenue"`
	}, 0)
	if err := DB.Model(&SubscriptionOrder{}).
		Select("plan_id, COUNT(*) AS order_count, COALESCE(SUM(money), 0) AS revenue").
		Where("status = ? AND complete_time >= ? AND complete_time <= ?", common.TopUpStatusSuccess, start, end).
		Group("plan_id").
		Scan(&orderRows).Error; err != nil {
		return nil, err
	}

	usageRows := make([]struct {
		PlanId        int   `gorm:"column:plan_id"`
		ConsumedQuota int64 `gorm:"column:consumed_quota"`
	}, 0)
	if err := DB.Model(&SubscriptionPreConsumeRecord{}).
		Select("user_subscriptions.plan_id AS plan_id, COALESCE(SUM(subscription_pre_consume_records.usage_quota), 0) AS consumed_quota").
		Joins("JOIN user_subscriptions ON user_subscriptions.id = subscription_pre_consume_records.user_subscription_id").
		Where("subscription_pre_consume_records.created_at >= ? AND subscription_pre_consume_records.created_at <= ? AND subscription_pre_consume_records.status <> ? AND subscription_pre_consume_records.finalized_at > 0",
			start, end, SubscriptionUsageStatusRefunded).
		Group("user_subscriptions.plan_id").
		Scan(&usageRows).Error; err != nil {
		return nil, err
	}

	now := common.GetTimestamp()
	subscriptions := make([]UserSubscription, 0)
	if err := DB.
		Select("id", "plan_id", "amount_total", "amount_used", "status", "end_time").
		Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	windows := make([]UserSubscriptionQuotaWindow, 0)
	if err := DB.
		Select("user_subscription_id", "quota_limit").
		Find(&windows).Error; err != nil {
		return nil, err
	}
	windowCapacity := make(map[int]int64, len(windows))
	for _, window := range windows {
		windowCapacity[window.UserSubscriptionId] = max(windowCapacity[window.UserSubscriptionId], window.QuotaLimit)
	}
	reservedRows := make([]struct {
		UserSubscriptionId int   `gorm:"column:user_subscription_id"`
		ReservedQuota      int64 `gorm:"column:reserved_quota"`
	}, 0)
	if err := DB.Model(&SubscriptionPreConsumeRecord{}).
		Select("user_subscription_id, COALESCE(SUM(usage_quota), 0) AS reserved_quota").
		Where("status <> ? AND finalized_at = 0", SubscriptionUsageStatusRefunded).
		Group("user_subscription_id").
		Scan(&reservedRows).Error; err != nil {
		return nil, err
	}
	reservedBySubscription := make(map[int]int64, len(reservedRows))
	for _, row := range reservedRows {
		reservedBySubscription[row.UserSubscriptionId] = max(row.ReservedQuota, 0)
	}

	rows := make(map[int]*SubscriptionOverviewPlan, len(plans))
	orderedPlanIds := make([]int, 0, len(plans))
	for _, plan := range plans {
		rows[plan.Id] = &SubscriptionOverviewPlan{
			PlanId:      plan.Id,
			Title:       plan.Title,
			PriceAmount: plan.PriceAmount,
			Currency:    plan.Currency,
			Enabled:     plan.Enabled,
		}
		orderedPlanIds = append(orderedPlanIds, plan.Id)
	}
	planRow := func(planId int) *SubscriptionOverviewPlan {
		row, ok := rows[planId]
		if ok {
			return row
		}
		row = &SubscriptionOverviewPlan{
			PlanId: planId,
			Title:  fmt.Sprintf("Plan #%d", planId),
		}
		rows[planId] = row
		orderedPlanIds = append(orderedPlanIds, planId)
		return row
	}

	for _, row := range orderRows {
		planRow(row.PlanId).OrderCount = row.OrderCount
		planRow(row.PlanId).Revenue = row.Revenue
	}
	for _, row := range usageRows {
		planRow(row.PlanId).ConsumedQuota = row.ConsumedQuota
	}

	for _, subscription := range subscriptions {
		if subscription.Status != "active" || subscription.EndTime <= now {
			continue
		}
		capacity := subscription.AmountTotal
		if capacity <= 0 {
			capacity = windowCapacity[subscription.Id]
		}
		reserved := reservedBySubscription[subscription.Id]
		used := max(subscription.AmountUsed-reserved, 0)
		remaining := max(capacity-subscription.AmountUsed, 0)
		row := planRow(subscription.PlanId)
		row.ActiveSubscriptions++
		row.CapacityQuota += capacity
		row.UsedQuota += used
		row.ReservedQuota += reserved
		row.RemainingQuota += remaining
	}

	overview := &SubscriptionOverview{
		StartTimestamp: start,
		EndTimestamp:   end,
		UpstreamRatio:  upstreamRatio,
		QuotaPerUnit:   quotaPerUnit,
		Plans:          make([]SubscriptionOverviewPlan, 0, len(orderedPlanIds)),
	}
	for _, planId := range orderedPlanIds {
		row := *rows[planId]
		row.ConsumedCost = float64(row.ConsumedQuota) / quotaPerUnit * upstreamRatio
		row.GrossProfit = row.Revenue - row.ConsumedCost
		if row.Revenue > 0 {
			row.GrossMargin = row.GrossProfit / row.Revenue
		}
		row.RemainingCost = float64(row.RemainingQuota) / quotaPerUnit * upstreamRatio

		overview.Summary.OrderCount += row.OrderCount
		overview.Summary.Revenue += row.Revenue
		overview.Summary.ConsumedQuota += row.ConsumedQuota
		overview.Summary.ConsumedCost += row.ConsumedCost
		overview.Summary.GrossProfit += row.GrossProfit
		overview.Summary.ActiveSubscriptions += row.ActiveSubscriptions
		overview.Summary.CapacityQuota += row.CapacityQuota
		overview.Summary.UsedQuota += row.UsedQuota
		overview.Summary.ReservedQuota += row.ReservedQuota
		overview.Summary.RemainingQuota += row.RemainingQuota
		overview.Summary.RemainingCost += row.RemainingCost
		overview.Plans = append(overview.Plans, row)
	}
	if overview.Summary.Revenue > 0 {
		overview.Summary.GrossMargin = overview.Summary.GrossProfit / overview.Summary.Revenue
	}
	return overview, nil
}
