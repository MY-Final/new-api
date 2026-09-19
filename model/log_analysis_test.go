package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupLogAnalysisTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()

	previousDB, previousLogDB := DB, LOG_DB
	previousMainType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousSQLitePath := common.SQLitePath
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainType, previousLogType)
		common.SQLitePath = previousSQLitePath
		initCol()
	})

	dsn := "local"
	switch dialect {
	case "sqlite":
		common.SQLitePath = filepath.Join(t.TempDir(), "log-analysis.db")
	case "mysql":
		dsn = os.Getenv("TEST_MYSQL_DSN")
	case "postgres":
		dsn = os.Getenv("TEST_POSTGRES_DSN")
	}
	if dsn == "" {
		t.Skip("test database DSN is not configured")
	}
	t.Setenv("LOG_ANALYSIS_TEST_DSN", dsn)

	db, dbType, err := chooseDB("LOG_ANALYSIS_TEST_DSN", true)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	require.NoError(t, db.Migrator().DropTable(&Log{}, &Channel{}, &ChannelStatusEvent{}))
	// Simulate the pre-change schema first, then run the new migration twice:
	// this covers both a fresh install and an upgrade of an existing database,
	// and proves the added table migration is idempotent.
	require.NoError(t, db.AutoMigrate(&Log{}, &Channel{}))
	require.NoError(t, db.AutoMigrate(&ChannelStatusEvent{}))
	require.NoError(t, db.AutoMigrate(&ChannelStatusEvent{}))
	t.Cleanup(func() {
		_ = db.Migrator().DropTable(&Log{}, &Channel{}, &ChannelStatusEvent{})
	})

	DB, LOG_DB = db, db
	common.SetDatabaseTypes(dbType, dbType)
	initCol()
	return db
}

func seedLogAnalysisRows(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	now := time.Now().Unix()
	require.NoError(t, db.Create(&[]Channel{
		{
			Id:        1,
			Name:      "alpha",
			Status:    common.ChannelStatusAutoDisabled,
			OtherInfo: `{"status_reason":"upstream 502","status_time":123}`,
		},
		{Id: 2, Name: "beta", Status: common.ChannelStatusEnabled},
	}).Error)

	logs := []Log{
		{Type: LogTypeConsume, UserId: 1, Username: "alice", TokenId: 1, TokenName: "key-a", ModelName: "gpt-4o", ChannelId: 1, CreatedAt: now - 100, Quota: 10, PromptTokens: 60, CompletionTokens: 40, UseTime: 1},
		{Type: LogTypeConsume, UserId: 1, Username: "alice", TokenId: 1, TokenName: "key-a", ModelName: "gpt-4o", ChannelId: 1, CreatedAt: now - 90, Quota: 10, PromptTokens: 60, CompletionTokens: 40, UseTime: 3},
		{Type: LogTypeConsume, UserId: 2, Username: "bob", TokenId: 2, TokenName: "key-b", ModelName: "gpt-4o-mini", ChannelId: 1, CreatedAt: now - 80, Quota: 10, PromptTokens: 60, CompletionTokens: 40, UseTime: 8},
		{Type: LogTypeError, UserId: 1, Username: "alice", TokenId: 1, TokenName: "key-a", ModelName: "gpt-4o", ChannelId: 1, CreatedAt: now - 70, UseTime: 2, Other: `{"error_code":"bad_response_status_code","error_type":"openai_error","status_code":502}`, Content: "status_code=502, upstream failed"},
		{Type: LogTypeConsume, UserId: 2, Username: "bob", TokenId: 2, TokenName: "key-b", ModelName: "claude-3", ChannelId: 2, CreatedAt: now - 60, Quota: 10, PromptTokens: 60, CompletionTokens: 40, UseTime: 60},
		{Type: LogTypeError, UserId: 2, Username: "bob", TokenId: 2, TokenName: "key-b", ModelName: "claude-3", ChannelId: 2, CreatedAt: now - 50, UseTime: 5, Other: `{"error_code":"do_request_failed","status_code":500}`, Content: "status_code=500, dial tcp timeout"},
		{Type: LogTypeError, UserId: 2, Username: "bob", TokenId: 2, TokenName: "key-b", ModelName: "claude-3", ChannelId: 2, CreatedAt: now - 40, UseTime: 5, Other: `{"error_code":"do_request_failed","status_code":500}`, Content: "status_code=500, dial tcp timeout"},
	}
	require.NoError(t, db.Create(&logs).Error)

	// Channel 1 was auto-disabled twice inside the analysis window; channel 2's
	// only event predates the window and must not be counted.
	require.NoError(t, db.Create(&[]ChannelStatusEvent{
		{ChannelId: 1, Status: common.ChannelStatusAutoDisabled, Reason: "upstream 502", CreatedAt: now - 200},
		{ChannelId: 1, Status: common.ChannelStatusAutoDisabled, Reason: "upstream 502", CreatedAt: now - 150},
		{ChannelId: 2, Status: common.ChannelStatusAutoDisabled, Reason: "old outage", CreatedAt: now - 7200},
	}).Error)
	return now
}

func TestLogAnalysisAggregationAcrossDialects(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := setupLogAnalysisTestDB(t, dialect)
			now := seedLogAnalysisRows(t, db)

			result, err := GetLogAnalysis(LogAnalysisFilter{
				Start:           now - 3600,
				End:             now,
				BucketSize:      86400,
				TopLimit:        10,
				RealtimeMinutes: 30,
			})
			require.NoError(t, err)

			assert.EqualValues(t, 4, result.Summary.ConsumeCount)
			assert.EqualValues(t, 3, result.Summary.ErrorCount)
			assert.EqualValues(t, 40, result.Summary.Quota)
			assert.EqualValues(t, 400, result.Summary.Tokens)
			assert.InDelta(t, 4.0/7.0, result.Summary.SuccessRate, 0.0001)

			assert.EqualValues(t, 4, result.Realtime.ConsumeCount)
			assert.EqualValues(t, 3, result.Realtime.ErrorCount)
			assert.EqualValues(t, 2, result.Realtime.ActiveUsers)
			assert.InDelta(t, 4.0/30.0, result.Realtime.Rpm, 0.0001)

			var trendConsume, trendError int64
			for _, point := range result.Trend {
				trendConsume += point.Consume
				trendError += point.Error
			}
			assert.EqualValues(t, 4, trendConsume)
			assert.EqualValues(t, 3, trendError)

			require.Len(t, result.ErrorCodes, 2)
			assert.Equal(t, "do_request_failed", result.ErrorCodes[0].ErrorCode)
			assert.EqualValues(t, 2, result.ErrorCodes[0].Count)
			assert.Equal(t, 500, result.ErrorCodes[0].StatusCode)
			assert.Equal(t, "bad_response_status_code", result.ErrorCodes[1].ErrorCode)
			assert.EqualValues(t, 1, result.ErrorCodes[1].Count)
			assert.Equal(t, 502, result.ErrorCodes[1].StatusCode)
			assert.Equal(t, "openai_error", result.ErrorCodes[1].ErrorType)
			assert.Equal(t, "upstream failed", result.ErrorCodes[1].Sample)
			assert.False(t, result.ErrorLogsTruncated)

			require.Len(t, result.ErrorModels, 2)
			assert.Equal(t, "claude-3", result.ErrorModels[0].ModelName)
			assert.EqualValues(t, 2, result.ErrorModels[0].Count)
			assert.Equal(t, "gpt-4o", result.ErrorModels[1].ModelName)
			assert.EqualValues(t, 1, result.ErrorModels[1].Count)

			require.Len(t, result.TopErrorUsers, 2)
			assert.Equal(t, "bob", result.TopErrorUsers[0].Username)
			assert.EqualValues(t, 2, result.TopErrorUsers[0].Count)
			assert.Equal(t, "alice", result.TopErrorUsers[1].Username)

			require.Len(t, result.TopErrorTokens, 2)
			assert.Equal(t, "key-b", result.TopErrorTokens[0].TokenName)
			assert.EqualValues(t, 2, result.TopErrorTokens[0].Count)

			require.Len(t, result.Channels, 2)
			alpha := result.Channels[0]
			assert.Equal(t, 1, alpha.ChannelID)
			assert.Equal(t, "alpha", alpha.ChannelName)
			assert.Equal(t, common.ChannelStatusAutoDisabled, alpha.Status)
			assert.Equal(t, "upstream 502", alpha.StatusReason)
			assert.EqualValues(t, 123, alpha.StatusTime)
			assert.EqualValues(t, 3, alpha.ConsumeCount)
			assert.EqualValues(t, 1, alpha.ErrorCount)
			assert.InDelta(t, 0.75, alpha.SuccessRate, 0.0001)
			assert.InDelta(t, 4.0, alpha.AvgLatencySeconds, 0.0001)
			assert.InDelta(t, 3.0, alpha.P50Seconds, 0.0001)
			assert.InDelta(t, 10.0, alpha.P95Seconds, 0.0001)
			assert.InDelta(t, 8.0, alpha.MaxLatencySeconds, 0.0001)
			assert.EqualValues(t, 2, alpha.AutoDisabledCount)

			beta := result.Channels[1]
			assert.Equal(t, 2, beta.ChannelID)
			assert.Equal(t, "beta", beta.ChannelName)
			assert.EqualValues(t, 1, beta.ConsumeCount)
			assert.EqualValues(t, 2, beta.ErrorCount)
			assert.InDelta(t, 60.0, beta.P50Seconds, 0.0001)
			assert.EqualValues(t, 0, beta.AutoDisabledCount)

			byModel, err := GetLogAnalysis(LogAnalysisFilter{
				Start:           now - 3600,
				End:             now,
				ModelName:       "gpt-4o",
				BucketSize:      86400,
				TopLimit:        10,
				RealtimeMinutes: 30,
			})
			require.NoError(t, err)
			assert.EqualValues(t, 2, byModel.Summary.ConsumeCount)
			assert.EqualValues(t, 1, byModel.Summary.ErrorCount)

			byChannel, err := GetLogAnalysis(LogAnalysisFilter{
				Start:           now - 3600,
				End:             now,
				ChannelID:       2,
				BucketSize:      86400,
				TopLimit:        10,
				RealtimeMinutes: 30,
			})
			require.NoError(t, err)
			assert.EqualValues(t, 1, byChannel.Summary.ConsumeCount)
			assert.EqualValues(t, 2, byChannel.Summary.ErrorCount)

			byUser, err := GetLogAnalysis(LogAnalysisFilter{
				Start:           now - 3600,
				End:             now,
				Username:        "bob",
				BucketSize:      86400,
				TopLimit:        10,
				RealtimeMinutes: 30,
			})
			require.NoError(t, err)
			assert.EqualValues(t, 2, byUser.Summary.ConsumeCount)
			assert.EqualValues(t, 2, byUser.Summary.ErrorCount)
		})
	}
}

func TestParseLogAnalysisErrorRow(t *testing.T) {
	code, errorType, statusCode, sample := parseLogAnalysisErrorRow(logAnalysisErrorScanRow{
		Other:   `{"error_code":"bad_response_status_code","error_type":"openai_error","status_code":502}`,
		Content: "status_code=502, upstream failed",
	})
	assert.Equal(t, "bad_response_status_code", code)
	assert.Equal(t, "openai_error", errorType)
	assert.Equal(t, 502, statusCode)
	assert.Equal(t, "upstream failed", sample)

	code, errorType, statusCode, sample = parseLogAnalysisErrorRow(logAnalysisErrorScanRow{
		Other:   "",
		Content: "status_code=429, rate limited",
	})
	assert.Empty(t, code)
	assert.Empty(t, errorType)
	assert.Equal(t, 429, statusCode)
	assert.Equal(t, "rate limited", sample)

	_, _, statusCode, sample = parseLogAnalysisErrorRow(logAnalysisErrorScanRow{
		Other:   "{invalid",
		Content: "plain failure",
	})
	assert.Equal(t, 0, statusCode)
	assert.Equal(t, "plain failure", sample)

	longContent := "status_code=500, " + strings.Repeat("x", 200)
	_, _, _, sample = parseLogAnalysisErrorRow(logAnalysisErrorScanRow{Content: longContent})
	assert.Len(t, sample, 160)
}

func TestLogAnalysisPercentile(t *testing.T) {
	buckets := []int64{1, 1, 2, 2, 3, 3, 3, 3, 3, 3}
	assert.InDelta(t, 3.0, logAnalysisPercentile(buckets, 3, 0.5, 8), 0.0001)
	assert.InDelta(t, 10.0, logAnalysisPercentile(buckets, 3, 0.95, 8), 0.0001)
	assert.InDelta(t, 0.0, logAnalysisPercentile(buckets, 0, 0.95, 8), 0.0001)
	assert.InDelta(t, 42.0, logAnalysisPercentile([]int64{}, 1, 0.99, 42), 0.0001)
}

func TestLogAnalysisBucketExprDialects(t *testing.T) {
	original := common.LogDatabaseType()
	t.Cleanup(func() { common.SetLogDatabaseType(original) })

	common.SetLogDatabaseType(common.DatabaseTypeClickHouse)
	assert.Equal(t, "intDiv(created_at, 300) * 300", logAnalysisBucketExpr(300))
	common.SetLogDatabaseType(common.DatabaseTypeMySQL)
	assert.Equal(t, "FLOOR(created_at / 300) * 300", logAnalysisBucketExpr(300))
	common.SetLogDatabaseType(common.DatabaseTypePostgreSQL)
	assert.Equal(t, "(created_at / 300) * 300", logAnalysisBucketExpr(300))
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)
	assert.Equal(t, "(created_at / 300) * 300", logAnalysisBucketExpr(300))
}

func TestLogAnalysisBucketSizeForRange(t *testing.T) {
	assert.EqualValues(t, 300, LogAnalysisBucketSizeForRange(0, 3600))
	assert.EqualValues(t, 3600, LogAnalysisBucketSizeForRange(0, 24*3600))
	assert.EqualValues(t, 86400, LogAnalysisBucketSizeForRange(0, 7*24*3600))
	assert.EqualValues(t, 7*24*3600, LogAnalysisBucketSizeForRange(0, 90*24*3600))
}
