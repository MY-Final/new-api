package model

import (
	"cmp"
	"errors"
	"slices"
	"sort"

	"github.com/QuantumNous/new-api/common"
)

type SubscriptionCycleTokenUsage struct {
	SubscriptionId   int    `json:"subscription_id"`
	PlanId           int    `json:"plan_id"`
	PlanTitle        string `json:"plan_title"`
	OrderId          int    `json:"order_id"`
	Cycle            int    `json:"cycle"`
	StartTime        int64  `json:"start_time"`
	EndTime          int64  `json:"end_time"`
	RequestCount     int64  `json:"request_count"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

func GetUserSubscriptionTokenUsage(userId int) ([]SubscriptionCycleTokenUsage, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	result := make([]SubscriptionCycleTokenUsage, 0)
	var subscriptions []UserSubscription
	if err := DB.Where("user_id = ?", userId).
		Order("start_time ASC, id ASC").Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	if len(subscriptions) == 0 {
		return result, nil
	}

	byPlan := make(map[int][]UserSubscription)
	planIds := make([]int, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		if _, exists := byPlan[subscription.PlanId]; !exists {
			planIds = append(planIds, subscription.PlanId)
		}
		byPlan[subscription.PlanId] = append(byPlan[subscription.PlanId], subscription)
	}
	var plans []SubscriptionPlan
	if err := DB.Select("id", "title").Where("id IN ?", planIds).Find(&plans).Error; err != nil {
		return nil, err
	}
	titles := make(map[int]string, len(plans))
	for _, plan := range plans {
		titles[plan.Id] = plan.Title
	}

	var orders []SubscriptionOrder
	if err := DB.Select("id", "plan_id", "complete_time").
		Where("user_id = ? AND status = ?", userId, common.TopUpStatusSuccess).
		Order("complete_time ASC, id ASC").Find(&orders).Error; err != nil {
		return nil, err
	}
	ordersBySubscription := make(map[int][]SubscriptionOrder)
	for _, order := range orders {
		candidates := byPlan[order.PlanId]
		index := sort.Search(len(candidates), func(index int) bool {
			return candidates[index].StartTime > order.CompleteTime
		}) - 1
		if index < 0 {
			continue
		}
		subscription := candidates[index]
		if order.CompleteTime > subscription.EndTime {
			continue
		}
		ordersBySubscription[subscription.Id] = append(ordersBySubscription[subscription.Id], order)
	}

	indices := make(map[int][]int, len(subscriptions))
	for _, subscription := range subscriptions {
		period := SubscriptionCycleTokenUsage{
			SubscriptionId: subscription.Id,
			PlanId:         subscription.PlanId,
			PlanTitle:      titles[subscription.PlanId],
			Cycle:          1,
			StartTime:      subscription.StartTime,
			EndTime:        subscription.EndTime,
		}
		for orderIndex, order := range ordersBySubscription[subscription.Id] {
			if orderIndex == 0 && (subscription.Source != "admin" || order.CompleteTime == period.StartTime) {
				period.OrderId = order.Id
				continue
			}
			period.EndTime = order.CompleteTime
			indices[subscription.Id] = append(indices[subscription.Id], len(result))
			result = append(result, period)
			period.StartTime = order.CompleteTime
			period.EndTime = subscription.EndTime
			period.OrderId = order.Id
			period.Cycle++
		}
		indices[subscription.Id] = append(indices[subscription.Id], len(result))
		result = append(result, period)
	}

	rows, err := LOG_DB.Model(&Log{}).
		Select("created_at", "prompt_tokens", "completion_tokens", "other").
		Where("user_id = ? AND type = ? AND created_at >= ?", userId, LogTypeConsume, subscriptions[0].StartTime).
		Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var log Log
		if err := LOG_DB.ScanRows(rows, &log); err != nil {
			return nil, err
		}
		var metadata struct {
			BillingSource  string `json:"billing_source"`
			SubscriptionId int    `json:"subscription_id"`
		}
		if err := common.UnmarshalJsonStr(log.Other, &metadata); err != nil || metadata.BillingSource != "subscription" {
			continue
		}
		periodIndices := indices[metadata.SubscriptionId]
		index := sort.Search(len(periodIndices), func(index int) bool {
			return result[periodIndices[index]].StartTime > log.CreatedAt
		}) - 1
		if index < 0 {
			continue
		}
		period := &result[periodIndices[index]]
		log.Type = LogTypeConsume
		metrics := usageLogMetrics(&log)
		period.RequestCount += metrics.RequestCount
		period.InputTokens += metrics.InputTokens
		period.OutputTokens += metrics.OutputTokens
		period.CacheReadTokens += metrics.CacheReadTokens
		period.CacheWriteTokens += metrics.CacheWriteTokens
		period.TotalTokens += metrics.TotalTokens
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slices.SortFunc(result, func(left, right SubscriptionCycleTokenUsage) int {
		if order := cmp.Compare(right.StartTime, left.StartTime); order != 0 {
			return order
		}
		if order := cmp.Compare(right.SubscriptionId, left.SubscriptionId); order != 0 {
			return order
		}
		return cmp.Compare(right.Cycle, left.Cycle)
	})
	return result, nil
}
