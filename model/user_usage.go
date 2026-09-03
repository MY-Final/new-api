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
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const userUsageAggregateSelect = "" +
	"COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS request_count, " +
	"COALESCE(SUM(CASE WHEN type = ? THEN prompt_tokens ELSE 0 END), 0) AS prompt_tokens, " +
	"COALESCE(SUM(CASE WHEN type = ? THEN completion_tokens ELSE 0 END), 0) AS completion_tokens, " +
	"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) AS consumed_quota, " +
	"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) AS refunded_quota, " +
	"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) - " +
	"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) AS net_quota"

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
	TotalTokens      int64 `json:"total_tokens"`
	ConsumedQuota    int64 `json:"consumed_quota"`
	RefundedQuota    int64 `json:"refunded_quota"`
	NetQuota         int64 `json:"net_quota"`
}

type UserUsageDaily struct {
	Day              string `json:"day"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	ConsumedQuota    int64  `json:"consumed_quota"`
	RefundedQuota    int64  `json:"refunded_quota"`
	NetQuota         int64  `json:"net_quota"`
}

type UserUsageModel struct {
	ModelName        string `json:"model_name"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	ConsumedQuota    int64  `json:"consumed_quota"`
	RefundedQuota    int64  `json:"refunded_quota"`
	NetQuota         int64  `json:"net_quota"`
}

type UserUsage struct {
	User    UserUsageUser      `json:"user"`
	Summary UserUsageAggregate `json:"summary"`
	Daily   []UserUsageDaily   `json:"daily"`
	Models  []UserUsageModel   `json:"models"`
}

func userUsageDayExpression() string {
	switch common.LogDatabaseType() {
	case common.DatabaseTypeClickHouse:
		return "formatDateTime(toDateTime(created_at), '%Y-%m-%d')"
	case common.DatabaseTypeMySQL:
		return "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d')"
	case common.DatabaseTypePostgreSQL:
		return "TO_CHAR(TO_TIMESTAMP(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
	default:
		return "strftime('%Y-%m-%d', created_at, 'unixepoch')"
	}
}

func userUsageAggregateArgs() []any {
	return []any{
		LogTypeConsume,
		LogTypeConsume,
		LogTypeConsume,
		LogTypeConsume,
		LogTypeRefund,
		LogTypeConsume,
		LogTypeRefund,
	}
}

func addUserUsageRange(query *gorm.DB, userID int, startTimestamp int64, endTimestamp int64) *gorm.DB {
	return query.
		Where("user_id = ?", userID).
		Where("created_at >= ?", startTimestamp).
		Where("created_at <= ?", endTimestamp)
}

func addUserUsageBillingTypes(query *gorm.DB) *gorm.DB {
	return query.Where("type IN ?", []int{LogTypeConsume, LogTypeRefund})
}

func finalizeUserUsageAggregate(aggregate *UserUsageAggregate) {
	aggregate.TotalTokens = aggregate.PromptTokens + aggregate.CompletionTokens
	aggregate.NetQuota = aggregate.ConsumedQuota - aggregate.RefundedQuota
}

func finalizeUserUsageDaily(rows []UserUsageDaily) {
	for index := range rows {
		rows[index].TotalTokens = rows[index].PromptTokens + rows[index].CompletionTokens
		rows[index].NetQuota = rows[index].ConsumedQuota - rows[index].RefundedQuota
	}
}

func finalizeUserUsageModels(rows []UserUsageModel) {
	for index := range rows {
		rows[index].TotalTokens = rows[index].PromptTokens + rows[index].CompletionTokens
		rows[index].NetQuota = rows[index].ConsumedQuota - rows[index].RefundedQuota
	}
}

func GetUserUsage(userID int, startTimestamp int64, endTimestamp int64) (*UserUsage, error) {
	var usage UserUsage
	if err := DB.Table("users").
		Select("id, username, display_name, quota, used_quota, request_count").
		Where("id = ? AND deleted_at IS NULL", userID).
		First(&usage.User).Error; err != nil {
		return nil, err
	}

	baseQuery := addUserUsageRange(LOG_DB.Table("logs"), userID, startTimestamp, endTimestamp)
	if err := baseQuery.Select(userUsageAggregateSelect, userUsageAggregateArgs()...).Scan(&usage.Summary).Error; err != nil {
		return nil, errors.New("查询用量统计失败")
	}
	finalizeUserUsageAggregate(&usage.Summary)

	dayExpression := userUsageDayExpression()
	var daily []UserUsageDaily
	dailySelect := fmt.Sprintf("%s AS day, %s", dayExpression, userUsageAggregateSelect)
	if err := addUserUsageBillingTypes(addUserUsageRange(LOG_DB.Table("logs"), userID, startTimestamp, endTimestamp)).
		Select(dailySelect, userUsageAggregateArgs()...).
		Group(dayExpression).
		Order("day ASC").
		Scan(&daily).Error; err != nil {
		return nil, errors.New("查询每日用量失败")
	}
	finalizeUserUsageDaily(daily)
	usage.Daily = daily
	if usage.Daily == nil {
		usage.Daily = make([]UserUsageDaily, 0)
	}

	var models []UserUsageModel
	modelSelect := fmt.Sprintf("model_name, %s", userUsageAggregateSelect)
	if err := addUserUsageBillingTypes(addUserUsageRange(LOG_DB.Table("logs"), userID, startTimestamp, endTimestamp)).
		Select(modelSelect, userUsageAggregateArgs()...).
		Group("model_name").
		Order("net_quota DESC, model_name ASC").
		Scan(&models).Error; err != nil {
		return nil, errors.New("查询模型用量失败")
	}
	finalizeUserUsageModels(models)
	usage.Models = models
	if usage.Models == nil {
		usage.Models = make([]UserUsageModel, 0)
	}

	return &usage, nil
}
