package model

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	logAnalysisDefaultTopLimit    = 10
	logAnalysisMaxTopLimit        = 50
	logAnalysisDefaultRealtimeMin = 15
	logAnalysisMaxRealtimeMinutes = 1440
	logAnalysisErrorScanLimit     = 10000
	logAnalysisMaxChannelRows     = 200
)

// Latency histogram upper bounds in seconds. use_time is stored in whole
// seconds, so these buckets double as a coarse latency distribution that can
// be aggregated with portable SQL on every supported database.
var logAnalysisLatencyBounds = []int64{1, 2, 3, 5, 10, 20, 30, 60, 120, 300}

type LogAnalysisFilter struct {
	Start           int64
	End             int64
	ModelName       string
	Username        string
	Group           string
	ChannelID       int
	BucketSize      int64
	TopLimit        int
	RealtimeMinutes int
}

type LogAnalysisSummary struct {
	ConsumeCount int64   `json:"consume_count"`
	ErrorCount   int64   `json:"error_count"`
	Quota        int64   `json:"quota"`
	Tokens       int64   `json:"tokens"`
	SuccessRate  float64 `json:"success_rate"`
}

type LogAnalysisRealtime struct {
	Minutes      int     `json:"minutes"`
	ConsumeCount int64   `json:"consume_count"`
	ErrorCount   int64   `json:"error_count"`
	Quota        int64   `json:"quota"`
	Tokens       int64   `json:"tokens"`
	ActiveUsers  int64   `json:"active_users"`
	SuccessRate  float64 `json:"success_rate"`
	Rpm          float64 `json:"rpm"`
	Tpm          float64 `json:"tpm"`
}

type LogAnalysisTrendPoint struct {
	Ts      int64 `json:"ts"`
	Consume int64 `json:"consume"`
	Error   int64 `json:"error"`
}

type LogAnalysisErrorCode struct {
	ErrorCode  string `json:"error_code"`
	ErrorType  string `json:"error_type"`
	StatusCode int    `json:"status_code"`
	Count      int64  `json:"count"`
	Sample     string `json:"sample,omitempty"`
}

type LogAnalysisErrorModel struct {
	ModelName string `json:"model_name"`
	Count     int64  `json:"count"`
}

type LogAnalysisErrorChannel struct {
	ChannelID int   `json:"channel_id"`
	Count     int64 `json:"count"`
}

type LogAnalysisErrorUser struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Count    int64  `json:"count"`
}

type LogAnalysisErrorToken struct {
	TokenID   int    `json:"token_id"`
	TokenName string `json:"token_name"`
	Count     int64  `json:"count"`
}

type LogAnalysisChannelHealth struct {
	ChannelID         int     `json:"channel_id"`
	ChannelName       string  `json:"channel_name"`
	Status            int     `json:"status"`
	StatusReason      string  `json:"status_reason"`
	StatusTime        int64   `json:"status_time"`
	ConsumeCount      int64   `json:"consume_count"`
	ErrorCount        int64   `json:"error_count"`
	Quota             int64   `json:"quota"`
	SuccessRate       float64 `json:"success_rate"`
	AvgLatencySeconds float64 `json:"avg_latency_seconds"`
	P50Seconds        float64 `json:"p50_seconds"`
	P95Seconds        float64 `json:"p95_seconds"`
	P99Seconds        float64 `json:"p99_seconds"`
	MaxLatencySeconds float64 `json:"max_latency_seconds"`
	AutoDisabledCount int64   `json:"auto_disabled_count"`
}

type LogAnalysisResult struct {
	Summary            LogAnalysisSummary         `json:"summary"`
	Realtime           LogAnalysisRealtime        `json:"realtime"`
	BucketSeconds      int64                      `json:"bucket_seconds"`
	Trend              []LogAnalysisTrendPoint    `json:"trend"`
	ErrorCodes         []LogAnalysisErrorCode     `json:"error_codes"`
	ErrorModels        []LogAnalysisErrorModel    `json:"error_models"`
	ErrorChannels      []LogAnalysisErrorChannel  `json:"error_channels"`
	Channels           []LogAnalysisChannelHealth `json:"channels"`
	TopErrorUsers      []LogAnalysisErrorUser     `json:"top_error_users"`
	TopErrorTokens     []LogAnalysisErrorToken    `json:"top_error_tokens"`
	ErrorLogsTruncated bool                       `json:"error_logs_truncated"`
}

func LogAnalysisBucketSizeForRange(start, end int64) int64 {
	span := end - start
	switch {
	case span <= 3*3600:
		return 300
	case span <= 72*3600:
		return 3600
	case span <= 31*24*3600:
		return 86400
	default:
		return 7 * 24 * 3600
	}
}

func normalizeLogAnalysisFilter(filter LogAnalysisFilter) LogAnalysisFilter {
	if filter.BucketSize <= 0 {
		filter.BucketSize = LogAnalysisBucketSizeForRange(filter.Start, filter.End)
	}
	if filter.TopLimit <= 0 {
		filter.TopLimit = logAnalysisDefaultTopLimit
	}
	if filter.TopLimit > logAnalysisMaxTopLimit {
		filter.TopLimit = logAnalysisMaxTopLimit
	}
	if filter.RealtimeMinutes <= 0 {
		filter.RealtimeMinutes = logAnalysisDefaultRealtimeMin
	}
	if filter.RealtimeMinutes > logAnalysisMaxRealtimeMinutes {
		filter.RealtimeMinutes = logAnalysisMaxRealtimeMinutes
	}
	return filter
}

func logAnalysisSuccessRate(consumeCount, errorCount int64) float64 {
	total := consumeCount + errorCount
	if total <= 0 {
		return 0
	}
	return float64(consumeCount) / float64(total)
}

func applyLogAnalysisFilters(query *gorm.DB, filter LogAnalysisFilter) (*gorm.DB, error) {
	if filter.ChannelID > 0 {
		query = query.Where("channel_id = ?", filter.ChannelID)
	}
	var err error
	if filter.Username != "" {
		query, err = applyExplicitLogTextFilter(query, "username", filter.Username)
		if err != nil {
			return nil, err
		}
	}
	if filter.ModelName != "" {
		query, err = applyExplicitLogTextFilter(query, "model_name", filter.ModelName)
		if err != nil {
			return nil, err
		}
	}
	if filter.Group != "" {
		query = query.Where(logGroupCol+" = ?", filter.Group)
	}
	return query, nil
}

func logAnalysisBucketExpr(bucketSize int64) string {
	switch {
	case common.UsingLogDatabase(common.DatabaseTypeClickHouse):
		return fmt.Sprintf("intDiv(created_at, %d) * %d", bucketSize, bucketSize)
	case common.UsingLogDatabase(common.DatabaseTypeMySQL):
		return fmt.Sprintf("FLOOR(created_at / %d) * %d", bucketSize, bucketSize)
	default:
		return fmt.Sprintf("(created_at / %d) * %d", bucketSize, bucketSize)
	}
}

type logAnalysisWindowRow struct {
	ConsumeCount int64 `gorm:"column:consume_count"`
	ErrorCount   int64 `gorm:"column:error_count"`
	Quota        int64 `gorm:"column:quota"`
	Tokens       int64 `gorm:"column:tokens"`
	ActiveUsers  int64 `gorm:"column:active_users"`
}

func logAnalysisWindowSummary(filter LogAnalysisFilter, start, end int64, withActiveUsers bool) (logAnalysisWindowRow, error) {
	var row logAnalysisWindowRow
	selectClause := "COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS consume_count, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS error_count, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) AS quota, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN prompt_tokens + completion_tokens ELSE 0 END), 0) AS tokens"
	args := []any{LogTypeConsume, LogTypeError, LogTypeConsume, LogTypeConsume}
	if withActiveUsers {
		selectClause += ", COUNT(DISTINCT CASE WHEN type = ? THEN user_id END) AS active_users"
		args = append(args, LogTypeConsume)
	}
	query := LOG_DB.Table("logs").
		Select(selectClause, args...).
		Where("created_at >= ? AND created_at <= ?", start, end)
	query, err := applyLogAnalysisFilters(query, filter)
	if err != nil {
		return row, err
	}
	err = query.Take(&row).Error
	return row, err
}

func getLogAnalysisTrend(filter LogAnalysisFilter) ([]LogAnalysisTrendPoint, error) {
	bucketExpr := logAnalysisBucketExpr(filter.BucketSize)
	query := LOG_DB.Table("logs").
		Select(fmt.Sprintf(
			"%s AS ts, COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS consume, COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS error",
			bucketExpr,
		), LogTypeConsume, LogTypeError).
		Where("created_at >= ? AND created_at <= ?", filter.Start, filter.End).
		Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	query, err := applyLogAnalysisFilters(query, filter)
	if err != nil {
		return nil, err
	}
	var points []LogAnalysisTrendPoint
	if err := query.Group(bucketExpr).Order(bucketExpr + " ASC").Find(&points).Error; err != nil {
		return nil, err
	}
	if points == nil {
		points = []LogAnalysisTrendPoint{}
	}
	return points, nil
}

type logAnalysisChannelRow struct {
	ChannelID    int   `gorm:"column:channel_id"`
	ConsumeCount int64 `gorm:"column:consume_count"`
	ErrorCount   int64 `gorm:"column:error_count"`
	Quota        int64 `gorm:"column:quota"`
	UseTimeSum   int64 `gorm:"column:use_time_sum"`
	MaxUseTime   int64 `gorm:"column:max_use_time"`
	Bucket0      int64 `gorm:"column:bucket_0"`
	Bucket1      int64 `gorm:"column:bucket_1"`
	Bucket2      int64 `gorm:"column:bucket_2"`
	Bucket3      int64 `gorm:"column:bucket_3"`
	Bucket4      int64 `gorm:"column:bucket_4"`
	Bucket5      int64 `gorm:"column:bucket_5"`
	Bucket6      int64 `gorm:"column:bucket_6"`
	Bucket7      int64 `gorm:"column:bucket_7"`
	Bucket8      int64 `gorm:"column:bucket_8"`
	Bucket9      int64 `gorm:"column:bucket_9"`
}

func (row logAnalysisChannelRow) buckets() []int64 {
	return []int64{
		row.Bucket0, row.Bucket1, row.Bucket2, row.Bucket3, row.Bucket4,
		row.Bucket5, row.Bucket6, row.Bucket7, row.Bucket8, row.Bucket9,
	}
}

// Buckets arrive cumulative (count of samples with use_time <= bound), so the
// first bound whose count reaches the target rank is the percentile estimate.
func logAnalysisPercentile(buckets []int64, total int64, ratio float64, maxUseTime int64) float64 {
	if total <= 0 {
		return 0
	}
	threshold := int64(math.Ceil(float64(total) * ratio))
	for i, count := range buckets {
		if count >= threshold {
			return float64(logAnalysisLatencyBounds[i])
		}
	}
	return float64(maxUseTime)
}

func getLogAnalysisChannelRows(filter LogAnalysisFilter) ([]logAnalysisChannelRow, error) {
	selectClause := "channel_id, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS consume_count, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS error_count, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) AS quota, " +
		"COALESCE(SUM(CASE WHEN type = ? THEN use_time ELSE 0 END), 0) AS use_time_sum, " +
		"COALESCE(MAX(CASE WHEN type = ? THEN use_time ELSE 0 END), 0) AS max_use_time"
	args := []any{LogTypeConsume, LogTypeError, LogTypeConsume, LogTypeConsume, LogTypeConsume}
	for i, bound := range logAnalysisLatencyBounds {
		selectClause += fmt.Sprintf(
			", COALESCE(SUM(CASE WHEN type = ? AND use_time <= %d THEN 1 ELSE 0 END), 0) AS bucket_%d",
			bound, i,
		)
		args = append(args, LogTypeConsume)
	}
	query := LOG_DB.Table("logs").
		Select(selectClause, args...).
		Where("created_at >= ? AND created_at <= ?", filter.Start, filter.End).
		Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	query, err := applyLogAnalysisFilters(query, filter)
	if err != nil {
		return nil, err
	}
	var rows []logAnalysisChannelRow
	if err := query.Group("channel_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, j int) bool {
		left := rows[i].ConsumeCount + rows[i].ErrorCount
		right := rows[j].ConsumeCount + rows[j].ErrorCount
		if left == right {
			return rows[i].ChannelID < rows[j].ChannelID
		}
		return left > right
	})
	if len(rows) > logAnalysisMaxChannelRows {
		rows = rows[:logAnalysisMaxChannelRows]
	}
	return rows, nil
}

type logAnalysisErrorModelRow struct {
	ModelName string `gorm:"column:model_name"`
	Count     int64  `gorm:"column:error_count"`
}

type logAnalysisErrorChannelRow struct {
	ChannelID int   `gorm:"column:channel_id"`
	Count     int64 `gorm:"column:error_count"`
}

type logAnalysisErrorUserRow struct {
	UserID   int    `gorm:"column:user_id"`
	Username string `gorm:"column:username"`
	Count    int64  `gorm:"column:error_count"`
}

type logAnalysisErrorTokenRow struct {
	TokenID   int    `gorm:"column:token_id"`
	TokenName string `gorm:"column:token_name"`
	Count     int64  `gorm:"column:error_count"`
}

func logAnalysisErrorGroupQuery(filter LogAnalysisFilter, fields string, group string) (*gorm.DB, error) {
	query := LOG_DB.Table("logs").
		Select(fmt.Sprintf("%s, COUNT(*) AS error_count", fields)).
		Where("type = ?", LogTypeError).
		Where("created_at >= ? AND created_at <= ?", filter.Start, filter.End)
	query, err := applyLogAnalysisFilters(query, filter)
	if err != nil {
		return nil, err
	}
	return query.Group(group).Order("error_count DESC").Limit(filter.TopLimit), nil
}

type logAnalysisErrorScanRow struct {
	Other   string `gorm:"column:other"`
	Content string `gorm:"column:content"`
}

var logAnalysisStatusCodePattern = regexp.MustCompile(`^status_code=(\d+)`)

func parseLogAnalysisErrorRow(row logAnalysisErrorScanRow) (code string, errorType string, statusCode int, sample string) {
	var payload map[string]any
	if err := common.UnmarshalJsonStr(row.Other, &payload); err == nil {
		if value, ok := payload["error_code"].(string); ok {
			code = value
		}
		if value, ok := payload["error_type"].(string); ok {
			errorType = value
		}
		switch value := payload["status_code"].(type) {
		case float64:
			statusCode = int(value)
		case string:
			if parsed, err := strconv.Atoi(value); err == nil {
				statusCode = parsed
			}
		}
	}
	sample = row.Content
	if match := logAnalysisStatusCodePattern.FindStringSubmatch(sample); len(match) == 2 {
		if statusCode == 0 {
			statusCode, _ = strconv.Atoi(match[1])
		}
		sample = sample[len(match[0]):]
		sample = strings.TrimPrefix(strings.TrimSpace(sample), ",")
		sample = strings.TrimSpace(sample)
	}
	if len(sample) > 160 {
		sample = sample[:160]
	}
	return code, errorType, statusCode, sample
}

func getLogAnalysisErrorCodes(filter LogAnalysisFilter) ([]LogAnalysisErrorCode, bool, error) {
	query := LOG_DB.Table("logs").
		Select("other, content").
		Where("type = ?", LogTypeError).
		Where("created_at >= ? AND created_at <= ?", filter.Start, filter.End)
	query, err := applyLogAnalysisFilters(query, filter)
	if err != nil {
		return nil, false, err
	}
	var rows []logAnalysisErrorScanRow
	if err := query.Order("created_at DESC").Limit(logAnalysisErrorScanLimit + 1).Find(&rows).Error; err != nil {
		return nil, false, err
	}
	truncated := len(rows) > logAnalysisErrorScanLimit
	if truncated {
		rows = rows[:logAnalysisErrorScanLimit]
	}

	type accumulator struct {
		errorType  string
		statusCode int
		count      int64
		sample     string
	}
	accumulators := make(map[string]*accumulator)
	for _, row := range rows {
		code, errorType, statusCode, sample := parseLogAnalysisErrorRow(row)
		key := code + "|" + strconv.Itoa(statusCode)
		entry, ok := accumulators[key]
		if !ok {
			entry = &accumulator{errorType: errorType, statusCode: statusCode}
			accumulators[key] = entry
		}
		entry.count++
		if entry.sample == "" && sample != "" {
			entry.sample = sample
		}
		if entry.errorType == "" && errorType != "" {
			entry.errorType = errorType
		}
	}

	results := make([]LogAnalysisErrorCode, 0, len(accumulators))
	for key, entry := range accumulators {
		code, _, _ := strings.Cut(key, "|")
		results = append(results, LogAnalysisErrorCode{
			ErrorCode:  code,
			ErrorType:  entry.errorType,
			StatusCode: entry.statusCode,
			Count:      entry.count,
			Sample:     entry.sample,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].Count == results[j].Count {
			return results[i].ErrorCode < results[j].ErrorCode
		}
		return results[i].Count > results[j].Count
	})
	if len(results) > filter.TopLimit {
		results = results[:filter.TopLimit]
	}
	return results, truncated, nil
}

type logAnalysisChannelInfo struct {
	Name         string
	Status       int
	StatusReason string
	StatusTime   int64
}

func resolveLogAnalysisChannelInfo(ids []int) map[int]logAnalysisChannelInfo {
	result := make(map[int]logAnalysisChannelInfo, len(ids))
	if len(ids) == 0 || DB == nil {
		return result
	}
	var rows []struct {
		Id        int    `gorm:"column:id"`
		Name      string `gorm:"column:name"`
		Status    int    `gorm:"column:status"`
		OtherInfo string `gorm:"column:other_info"`
	}
	if err := DB.Table("channels").
		Select("id, name, status, other_info").
		Where("id IN ?", ids).
		Find(&rows).Error; err != nil {
		return result
	}
	for _, row := range rows {
		info := logAnalysisChannelInfo{Name: row.Name, Status: row.Status}
		var payload map[string]any
		if err := common.UnmarshalJsonStr(row.OtherInfo, &payload); err == nil {
			if reason, ok := payload["status_reason"].(string); ok {
				info.StatusReason = reason
			}
			if statusTime, ok := payload["status_time"].(float64); ok {
				info.StatusTime = int64(statusTime)
			}
		}
		result[row.Id] = info
	}
	return result
}

func GetLogAnalysis(filter LogAnalysisFilter) (*LogAnalysisResult, error) {
	filter = normalizeLogAnalysisFilter(filter)
	result := &LogAnalysisResult{
		BucketSeconds:  filter.BucketSize,
		Trend:          []LogAnalysisTrendPoint{},
		ErrorCodes:     []LogAnalysisErrorCode{},
		ErrorModels:    []LogAnalysisErrorModel{},
		ErrorChannels:  []LogAnalysisErrorChannel{},
		Channels:       []LogAnalysisChannelHealth{},
		TopErrorUsers:  []LogAnalysisErrorUser{},
		TopErrorTokens: []LogAnalysisErrorToken{},
	}

	summaryRow, err := logAnalysisWindowSummary(filter, filter.Start, filter.End, false)
	if err != nil {
		return nil, err
	}
	result.Summary = LogAnalysisSummary{
		ConsumeCount: summaryRow.ConsumeCount,
		ErrorCount:   summaryRow.ErrorCount,
		Quota:        summaryRow.Quota,
		Tokens:       summaryRow.Tokens,
		SuccessRate:  logAnalysisSuccessRate(summaryRow.ConsumeCount, summaryRow.ErrorCount),
	}

	now := time.Now().Unix()
	realtimeStart := now - int64(filter.RealtimeMinutes)*60
	realtimeRow, err := logAnalysisWindowSummary(filter, realtimeStart, now, true)
	if err != nil {
		return nil, err
	}
	minutes := float64(filter.RealtimeMinutes)
	result.Realtime = LogAnalysisRealtime{
		Minutes:      filter.RealtimeMinutes,
		ConsumeCount: realtimeRow.ConsumeCount,
		ErrorCount:   realtimeRow.ErrorCount,
		Quota:        realtimeRow.Quota,
		Tokens:       realtimeRow.Tokens,
		ActiveUsers:  realtimeRow.ActiveUsers,
		SuccessRate:  logAnalysisSuccessRate(realtimeRow.ConsumeCount, realtimeRow.ErrorCount),
		Rpm:          float64(realtimeRow.ConsumeCount) / minutes,
		Tpm:          float64(realtimeRow.Tokens) / minutes,
	}

	if result.Trend, err = getLogAnalysisTrend(filter); err != nil {
		return nil, err
	}

	channelRows, err := getLogAnalysisChannelRows(filter)
	if err != nil {
		return nil, err
	}
	channelIds := make([]int, 0, len(channelRows))
	for _, row := range channelRows {
		channelIds = append(channelIds, row.ChannelID)
	}
	channelInfo := resolveLogAnalysisChannelInfo(channelIds)
	autoDisabledCounts, err := CountChannelAutoDisabledEvents(filter.Start, filter.End)
	if err != nil {
		return nil, err
	}
	for _, row := range channelRows {
		health := LogAnalysisChannelHealth{
			ChannelID:         row.ChannelID,
			ConsumeCount:      row.ConsumeCount,
			ErrorCount:        row.ErrorCount,
			Quota:             row.Quota,
			SuccessRate:       logAnalysisSuccessRate(row.ConsumeCount, row.ErrorCount),
			AutoDisabledCount: autoDisabledCounts[row.ChannelID],
		}
		if info, ok := channelInfo[row.ChannelID]; ok {
			health.ChannelName = info.Name
			health.Status = info.Status
			health.StatusReason = info.StatusReason
			health.StatusTime = info.StatusTime
		}
		if row.ConsumeCount > 0 {
			health.AvgLatencySeconds = float64(row.UseTimeSum) / float64(row.ConsumeCount)
		}
		buckets := row.buckets()
		health.P50Seconds = logAnalysisPercentile(buckets, row.ConsumeCount, 0.5, row.MaxUseTime)
		health.P95Seconds = logAnalysisPercentile(buckets, row.ConsumeCount, 0.95, row.MaxUseTime)
		health.P99Seconds = logAnalysisPercentile(buckets, row.ConsumeCount, 0.99, row.MaxUseTime)
		health.MaxLatencySeconds = float64(row.MaxUseTime)
		result.Channels = append(result.Channels, health)
	}

	var modelRows []logAnalysisErrorModelRow
	if query, err := logAnalysisErrorGroupQuery(filter, "model_name", "model_name"); err != nil {
		return nil, err
	} else if err := query.Find(&modelRows).Error; err != nil {
		return nil, err
	}
	for _, row := range modelRows {
		result.ErrorModels = append(result.ErrorModels, LogAnalysisErrorModel{ModelName: row.ModelName, Count: row.Count})
	}

	var errorChannelRows []logAnalysisErrorChannelRow
	if query, err := logAnalysisErrorGroupQuery(filter, "channel_id", "channel_id"); err != nil {
		return nil, err
	} else if err := query.Find(&errorChannelRows).Error; err != nil {
		return nil, err
	}
	for _, row := range errorChannelRows {
		result.ErrorChannels = append(result.ErrorChannels, LogAnalysisErrorChannel{ChannelID: row.ChannelID, Count: row.Count})
	}

	var userRows []logAnalysisErrorUserRow
	if query, err := logAnalysisErrorGroupQuery(filter, "user_id, username", "user_id, username"); err != nil {
		return nil, err
	} else if err := query.Find(&userRows).Error; err != nil {
		return nil, err
	}
	for _, row := range userRows {
		result.TopErrorUsers = append(result.TopErrorUsers, LogAnalysisErrorUser{UserID: row.UserID, Username: row.Username, Count: row.Count})
	}

	var tokenRows []logAnalysisErrorTokenRow
	if query, err := logAnalysisErrorGroupQuery(filter, "token_id, token_name", "token_id, token_name"); err != nil {
		return nil, err
	} else if err := query.Find(&tokenRows).Error; err != nil {
		return nil, err
	}
	for _, row := range tokenRows {
		result.TopErrorTokens = append(result.TopErrorTokens, LogAnalysisErrorToken{TokenID: row.TokenID, TokenName: row.TokenName, Count: row.Count})
	}

	if result.ErrorCodes, result.ErrorLogsTruncated, err = getLogAnalysisErrorCodes(filter); err != nil {
		return nil, err
	}

	return result, nil
}
