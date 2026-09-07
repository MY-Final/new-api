/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package model

import (
	"errors"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

type UserUsageUser struct {
	Id           int    `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"display_name"`
	Quota        int    `json:"quota"`
	UsedQuota    int    `json:"used_quota"`
	RequestCount int    `json:"request_count"`
}

type UserUsageAggregate struct {
	RequestCount     int64 `json:"request_count"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
	ReasoningTokens  int64 `json:"reasoning_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
	ConsumedQuota    int64 `json:"consumed_quota"`
	RefundedQuota    int64 `json:"refunded_quota"`
	NetQuota         int64 `json:"net_quota"`
	UserCost         int64 `json:"user_cost"`
}

type UserUsageDaily struct {
	Day              string `json:"day"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	ConsumedQuota    int64  `json:"consumed_quota"`
	RefundedQuota    int64  `json:"refunded_quota"`
	NetQuota         int64  `json:"net_quota"`
	UserCost         int64  `json:"user_cost"`
}

type UserUsageModel struct {
	ModelName        string `json:"model_name"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	ConsumedQuota    int64  `json:"consumed_quota"`
	RefundedQuota    int64  `json:"refunded_quota"`
	NetQuota         int64  `json:"net_quota"`
	UserCost         int64  `json:"user_cost"`
}

type UserUsage struct {
	User    UserUsageUser      `json:"user"`
	Summary UserUsageAggregate `json:"summary"`
	Daily   []UserUsageDaily   `json:"daily"`
	Models  []UserUsageModel   `json:"models"`
}

// UserUsageRequest is a sanitized, paginated view of one successful API call.
// The usage log's Other field is intentionally not returned here because it
// contains provider and billing diagnostics with role-specific visibility.
type UserUsageRequest struct {
	CreatedAt        int64  `json:"created_at"`
	RequestID        string `json:"request_id"`
	ModelName        string `json:"model_name"`
	ChannelID        int    `json:"channel_id"`
	ChannelName      string `json:"channel_name,omitempty"`
	Success          bool   `json:"success"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	UserCost         int64  `json:"user_cost"`
}

type UserUsageRequests struct {
	Items    []UserUsageRequest `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

type UserUsageRank struct {
	UserID           int    `json:"user_id"`
	Username         string `json:"username"`
	RequestCount     int64  `json:"request_count"`
	InputTokens      int64  `json:"input_tokens"`
	OutputTokens     int64  `json:"output_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	ReasoningTokens  int64  `json:"reasoning_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	UserCost         int64  `json:"user_cost"`
	ConsumedQuota    int64  `json:"consumed_quota"`
	RefundedQuota    int64  `json:"refunded_quota"`
	NetQuota         int64  `json:"net_quota"`
}

type UserUsageActivity struct {
	DAU int64 `json:"dau"`
	WAU int64 `json:"wau"`
	MAU int64 `json:"mau"`
}

type UserUsageRanking struct {
	Summary  UserUsageAggregate `json:"summary"`
	Activity UserUsageActivity  `json:"activity"`
	Items    []UserUsageRank    `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

type UserUsageFilter struct {
	UserID    int
	Start     int64
	End       int64
	Username  string
	ModelName string
	ChannelID int
}

type usageLogOther struct {
	UsageSemantic string `json:"usage_semantic"`
	InputTokens   int64  `json:"input_tokens_total"`
	CacheRead     int64  `json:"cache_tokens"`
	CacheWrite    int64  `json:"cache_write_tokens"`
	CacheCreation int64  `json:"cache_creation_tokens"`
	Reasoning     int64  `json:"reasoning_tokens"`
}

type usageMetrics struct {
	RequestCount     int64
	PromptTokens     int64
	CompletionTokens int64
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
	TotalTokens      int64
	ConsumedQuota    int64
	RefundedQuota    int64
}

func usageLogMetrics(log *Log) usageMetrics {
	if log == nil {
		return usageMetrics{}
	}
	if log.Type == LogTypeRefund {
		if log.Quota <= 0 {
			return usageMetrics{}
		}
		return usageMetrics{RefundedQuota: int64(log.Quota)}
	}
	if log.Type != LogTypeConsume {
		return usageMetrics{}
	}
	var other usageLogOther
	if log.Other != "" {
		if err := common.Unmarshal([]byte(log.Other), &other); err != nil {
			common.SysError("failed to parse usage log metadata: " + err.Error())
		}
	}

	promptTokens := int64(log.PromptTokens)
	if promptTokens < 0 {
		promptTokens = 0
	}
	completionTokens := int64(log.CompletionTokens)
	if completionTokens < 0 {
		completionTokens = 0
	}
	cacheReadTokens := other.CacheRead
	if cacheReadTokens < 0 {
		cacheReadTokens = 0
	}
	cacheWriteTokens := other.CacheWrite
	if cacheWriteTokens == 0 {
		cacheWriteTokens = other.CacheCreation
	}
	if cacheWriteTokens < 0 {
		cacheWriteTokens = 0
	}
	reasoningTokens := other.Reasoning
	if reasoningTokens < 0 {
		reasoningTokens = 0
	}

	inputTokens := other.InputTokens
	if inputTokens <= 0 {
		if other.UsageSemantic == "anthropic" {
			inputTokens = promptTokens + cacheReadTokens + cacheWriteTokens
		} else {
			// OpenAI-compatible prompt_tokens already includes cache subcategories.
			inputTokens = promptTokens
		}
	}
	if inputTokens < 0 {
		inputTokens = 0
	}

	metrics := usageMetrics{
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		InputTokens:      inputTokens,
		OutputTokens:     completionTokens,
		CacheReadTokens:  cacheReadTokens,
		CacheWriteTokens: cacheWriteTokens,
		ReasoningTokens:  reasoningTokens,
		TotalTokens:      inputTokens + completionTokens,
	}
	metrics.RequestCount = 1
	if log.Quota > 0 {
		metrics.ConsumedQuota = int64(log.Quota)
	}
	return metrics
}

func addUsageMetrics(target *usageMetrics, source usageMetrics) {
	target.RequestCount += source.RequestCount
	target.PromptTokens += source.PromptTokens
	target.CompletionTokens += source.CompletionTokens
	target.InputTokens += source.InputTokens
	target.OutputTokens += source.OutputTokens
	target.CacheReadTokens += source.CacheReadTokens
	target.CacheWriteTokens += source.CacheWriteTokens
	target.ReasoningTokens += source.ReasoningTokens
	target.TotalTokens += source.TotalTokens
	target.ConsumedQuota += source.ConsumedQuota
	target.RefundedQuota += source.RefundedQuota
}

func usageAggregateFromMetrics(metrics usageMetrics) UserUsageAggregate {
	return UserUsageAggregate{
		RequestCount:     metrics.RequestCount,
		PromptTokens:     metrics.PromptTokens,
		CompletionTokens: metrics.CompletionTokens,
		InputTokens:      metrics.InputTokens,
		OutputTokens:     metrics.OutputTokens,
		CacheReadTokens:  metrics.CacheReadTokens,
		CacheWriteTokens: metrics.CacheWriteTokens,
		ReasoningTokens:  metrics.ReasoningTokens,
		TotalTokens:      metrics.TotalTokens,
		ConsumedQuota:    metrics.ConsumedQuota,
		RefundedQuota:    metrics.RefundedQuota,
		NetQuota:         metrics.ConsumedQuota - metrics.RefundedQuota,
		UserCost:         metrics.ConsumedQuota - metrics.RefundedQuota,
	}
}

func usageLogQuery(filter UserUsageFilter) *gorm.DB {
	query := LOG_DB.Table("logs").
		Select("id, user_id, created_at, type, username, model_name, quota, prompt_tokens, completion_tokens, channel_id, request_id, other").
		Where("type IN ?", []int{LogTypeConsume, LogTypeRefund})
	if filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.Start > 0 {
		query = query.Where("created_at >= ?", filter.Start)
	}
	if filter.End > 0 {
		query = query.Where("created_at <= ?", filter.End)
	}
	if filter.ChannelID > 0 {
		query = query.Where("channel_id = ?", filter.ChannelID)
	}
	if filter.Username != "" {
		filtered, err := applyExplicitLogTextFilter(query, "username", filter.Username)
		if err != nil {
			return query.Where("1 = 0")
		}
		query = filtered
	}
	if filter.ModelName != "" {
		filtered, err := applyExplicitLogTextFilter(query, "model_name", filter.ModelName)
		if err != nil {
			return query.Where("1 = 0")
		}
		query = filtered
	}
	return query
}

const usageLogBatchSize = 1000

func forEachUsageLog(filter UserUsageFilter, fn func(Log)) error {
	var logs []Log
	return usageLogQuery(filter).
		Order("created_at ASC, id ASC").
		FindInBatches(&logs, usageLogBatchSize, func(_ *gorm.DB, _ int) error {
			for _, log := range logs {
				fn(log)
			}
			return nil
		}).Error
}

func GetUserUsage(userID int, startTimestamp int64, endTimestamp int64) (*UserUsage, error) {
	return GetUserUsageWithFilter(UserUsageFilter{
		UserID: userID,
		Start:  startTimestamp,
		End:    endTimestamp,
	})
}

func GetUserUsageWithFilter(filter UserUsageFilter) (*UserUsage, error) {
	var usage UserUsage
	if err := DB.Table("users").
		Select("id, username, display_name, quota, used_quota, request_count").
		Where("id = ? AND deleted_at IS NULL", filter.UserID).
		First(&usage.User).Error; err != nil {
		return nil, err
	}

	var total usageMetrics
	daily := make(map[string]usageMetrics)
	models := make(map[string]usageMetrics)
	err := forEachUsageLog(filter, func(log Log) {
		metrics := usageLogMetrics(&log)
		addUsageMetrics(&total, metrics)
		day := time.Unix(log.CreatedAt, 0).UTC().Format("2006-01-02")
		dayMetrics := daily[day]
		addUsageMetrics(&dayMetrics, metrics)
		daily[day] = dayMetrics
		modelMetrics := models[log.ModelName]
		addUsageMetrics(&modelMetrics, metrics)
		models[log.ModelName] = modelMetrics
	})
	if err != nil {
		return nil, errors.New("查询用量统计失败")
	}

	usage.Summary = usageAggregateFromMetrics(total)
	for day, metrics := range daily {
		aggregate := usageAggregateFromMetrics(metrics)
		usage.Daily = append(usage.Daily, UserUsageDaily{
			Day:              day,
			RequestCount:     aggregate.RequestCount,
			PromptTokens:     aggregate.PromptTokens,
			CompletionTokens: aggregate.CompletionTokens,
			InputTokens:      aggregate.InputTokens,
			OutputTokens:     aggregate.OutputTokens,
			CacheReadTokens:  aggregate.CacheReadTokens,
			CacheWriteTokens: aggregate.CacheWriteTokens,
			ReasoningTokens:  aggregate.ReasoningTokens,
			TotalTokens:      aggregate.TotalTokens,
			ConsumedQuota:    aggregate.ConsumedQuota,
			RefundedQuota:    aggregate.RefundedQuota,
			NetQuota:         aggregate.NetQuota,
			UserCost:         aggregate.UserCost,
		})
	}
	sort.Slice(usage.Daily, func(i, j int) bool { return usage.Daily[i].Day < usage.Daily[j].Day })
	for modelName, metrics := range models {
		aggregate := usageAggregateFromMetrics(metrics)
		usage.Models = append(usage.Models, UserUsageModel{
			ModelName:        modelName,
			RequestCount:     aggregate.RequestCount,
			PromptTokens:     aggregate.PromptTokens,
			CompletionTokens: aggregate.CompletionTokens,
			InputTokens:      aggregate.InputTokens,
			OutputTokens:     aggregate.OutputTokens,
			CacheReadTokens:  aggregate.CacheReadTokens,
			CacheWriteTokens: aggregate.CacheWriteTokens,
			ReasoningTokens:  aggregate.ReasoningTokens,
			TotalTokens:      aggregate.TotalTokens,
			ConsumedQuota:    aggregate.ConsumedQuota,
			RefundedQuota:    aggregate.RefundedQuota,
			NetQuota:         aggregate.NetQuota,
			UserCost:         aggregate.UserCost,
		})
	}
	sort.Slice(usage.Models, func(i, j int) bool {
		if usage.Models[i].NetQuota == usage.Models[j].NetQuota {
			return usage.Models[i].ModelName < usage.Models[j].ModelName
		}
		return usage.Models[i].NetQuota > usage.Models[j].NetQuota
	})
	if usage.Daily == nil {
		usage.Daily = make([]UserUsageDaily, 0)
	}
	if usage.Models == nil {
		usage.Models = make([]UserUsageModel, 0)
	}

	return &usage, nil
}

func GetUserUsageRequests(filter UserUsageFilter, page, pageSize int) (*UserUsageRequests, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	query := usageLogQuery(filter).Where("type = ?", LogTypeConsume)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var logs []*Log
	if err := query.Order("created_at DESC, id DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&logs).Error; err != nil {
		return nil, err
	}

	result := &UserUsageRequests{
		Items:    make([]UserUsageRequest, 0, len(logs)),
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}
	channelNames, err := usageChannelNames(logs)
	if err != nil {
		return nil, err
	}
	for _, log := range logs {
		metrics := usageLogMetrics(log)
		result.Items = append(result.Items, UserUsageRequest{
			CreatedAt:        log.CreatedAt,
			RequestID:        log.RequestId,
			ModelName:        log.ModelName,
			ChannelID:        log.ChannelId,
			ChannelName:      channelNames[log.ChannelId],
			Success:          true,
			InputTokens:      metrics.InputTokens,
			OutputTokens:     metrics.OutputTokens,
			CacheReadTokens:  metrics.CacheReadTokens,
			CacheWriteTokens: metrics.CacheWriteTokens,
			ReasoningTokens:  metrics.ReasoningTokens,
			TotalTokens:      metrics.TotalTokens,
			UserCost:         metrics.ConsumedQuota,
		})
	}
	return result, nil
}

func usageChannelNames(logs []*Log) (map[int]string, error) {
	channelIDs := make([]int, 0)
	seen := make(map[int]struct{})
	for _, log := range logs {
		if log.ChannelId <= 0 {
			continue
		}
		if _, ok := seen[log.ChannelId]; ok {
			continue
		}
		seen[log.ChannelId] = struct{}{}
		channelIDs = append(channelIDs, log.ChannelId)
	}
	if len(channelIDs) == 0 {
		return map[int]string{}, nil
	}

	result := make(map[int]string, len(channelIDs))
	if common.MemoryCacheEnabled {
		for _, channelID := range channelIDs {
			if channel, err := CacheGetChannel(channelID); err == nil {
				result[channelID] = channel.Name
			}
		}
		return result, nil
	}
	var channels []struct {
		ID   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if err := DB.Table("channels").Select("id, name").Where("id IN ?", channelIDs).Find(&channels).Error; err != nil {
		return nil, err
	}
	for _, channel := range channels {
		result[channel.ID] = channel.Name
	}
	return result, nil
}

func activeUserCount(startTimestamp, endTimestamp int64) (int64, error) {
	var count int64
	err := LOG_DB.Table("logs").
		Where("type = ? AND user_id > ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, 0, startTimestamp, endTimestamp).
		Distinct("user_id").Count(&count).Error
	return count, err
}

func GetUserUsageActivity(now time.Time) (UserUsageActivity, error) {
	end := now.Unix()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	day, err := activeUserCount(dayStart, end)
	if err != nil {
		return UserUsageActivity{}, err
	}
	week, err := activeUserCount(end-7*24*60*60, end)
	if err != nil {
		return UserUsageActivity{}, err
	}
	month, err := activeUserCount(end-30*24*60*60, end)
	if err != nil {
		return UserUsageActivity{}, err
	}
	return UserUsageActivity{DAU: day, WAU: week, MAU: month}, nil
}

func GetUserUsageRanking(filter UserUsageFilter, page, pageSize int, sortBy string) (*UserUsageRanking, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	totalMetrics := usageMetrics{}
	byUser := make(map[int]usageMetrics)
	usernames := make(map[int]string)
	err := forEachUsageLog(filter, func(log Log) {
		metrics := usageLogMetrics(&log)
		addUsageMetrics(&totalMetrics, metrics)
		if log.UserId <= 0 {
			return
		}
		userMetrics := byUser[log.UserId]
		addUsageMetrics(&userMetrics, metrics)
		byUser[log.UserId] = userMetrics
		if usernames[log.UserId] == "" {
			usernames[log.UserId] = log.Username
		}
	})
	if err != nil {
		return nil, err
	}

	items := make([]UserUsageRank, 0, len(byUser))
	for userID, metrics := range byUser {
		aggregate := usageAggregateFromMetrics(metrics)
		items = append(items, UserUsageRank{
			UserID:           userID,
			Username:         usernames[userID],
			RequestCount:     aggregate.RequestCount,
			InputTokens:      aggregate.InputTokens,
			OutputTokens:     aggregate.OutputTokens,
			CacheReadTokens:  aggregate.CacheReadTokens,
			CacheWriteTokens: aggregate.CacheWriteTokens,
			ReasoningTokens:  aggregate.ReasoningTokens,
			TotalTokens:      aggregate.TotalTokens,
			UserCost:         aggregate.UserCost,
			ConsumedQuota:    aggregate.ConsumedQuota,
			RefundedQuota:    aggregate.RefundedQuota,
			NetQuota:         aggregate.NetQuota,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := items[i], items[j]
		var leftValue, rightValue int64
		switch sortBy {
		case "request_count":
			leftValue, rightValue = left.RequestCount, right.RequestCount
		case "total_tokens":
			leftValue, rightValue = left.TotalTokens, right.TotalTokens
		default:
			leftValue, rightValue = left.UserCost, right.UserCost
		}
		if leftValue == rightValue {
			return left.Username < right.Username
		}
		return leftValue > rightValue
	})
	total := int64(len(items))
	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	activity, err := GetUserUsageActivity(time.Now())
	if err != nil {
		return nil, err
	}
	return &UserUsageRanking{
		Summary:  usageAggregateFromMetrics(totalMetrics),
		Activity: activity,
		Items:    items[start:end],
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}
