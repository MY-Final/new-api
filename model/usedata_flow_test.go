package model

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func seedFlowQuotaData(t *testing.T, quotaData QuotaData) {
	t.Helper()
	require.NoError(t, DB.Create(&quotaData).Error)
}

func seedFlowLookupData(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Create(&Channel{Id: 1, Name: "east"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 2, Name: "west"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 11, UserId: 1, Key: "sk-primary", Name: "primary"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 22, UserId: 2, Key: "sk-backup", Name: "backup"}).Error)
	require.NoError(t, DB.Delete(&Token{Id: 11}).Error)
}

func TestGetFlowQuotaDataUsesQuotaDataRoleSpecificDimensions(t *testing.T) {
	truncateTables(t)
	seedFlowLookupData(t)

	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1000,
		Count:     2,
		Quota:     100,
		TokenUsed: 40,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1100,
		Count:     1,
		Quota:     50,
		TokenUsed: 20,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 2,
		CreatedAt: 1200,
		Count:     1,
		Quota:     25,
		TokenUsed: 10,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    2,
		Username:  "bob",
		NodeName:  "node-b",
		TokenID:   22,
		UseGroup:  "default",
		ModelName: "gpt-b",
		ChannelID: 1,
		CreatedAt: 1300,
		Count:     3,
		Quota:     70,
		TokenUsed: 30,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		ModelName: "legacy",
		CreatedAt: 1400,
		Count:     99,
		Quota:     999,
		TokenUsed: 999,
	})

	rootRows, err := GetFlowQuotaData(900, 2000, "", 0, common.RoleRootUser)
	require.NoError(t, err)
	require.Len(t, rootRows, 3)
	// Token 11 was soft-deleted, so its name is intentionally left empty for the
	// frontend to render a localized "deleted (id)" label instead.
	require.Equal(t, FlowQuotaData{
		UserID:      1,
		Username:    "alice",
		NodeName:    "node-a",
		TokenID:     11,
		TokenName:   "",
		UseGroup:    "vip",
		ChannelID:   1,
		ChannelName: "east",
		ModelName:   "gpt-a",
		TokenUsed:   60,
		Count:       3,
		Quota:       150,
	}, *rootRows[0])
	// A token that still exists resolves to its current name.
	require.Equal(t, 22, rootRows[1].TokenID)
	require.Equal(t, "backup", rootRows[1].TokenName)

	adminRows, err := GetFlowQuotaData(900, 2000, "alice", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Len(t, adminRows, 2)
	require.Equal(t, 0, adminRows[0].TokenID)
	require.Empty(t, adminRows[0].TokenName)
	require.Empty(t, adminRows[0].NodeName)
	require.Equal(t, "alice", adminRows[0].Username)
	require.Equal(t, "vip", adminRows[0].UseGroup)
	require.Equal(t, "east", adminRows[0].ChannelName)
	require.Equal(t, 150, adminRows[0].Quota)

	selfRows, err := GetFlowQuotaData(900, 2000, "", 1, common.RoleCommonUser)
	require.NoError(t, err)
	require.Len(t, selfRows, 1)
	require.Empty(t, selfRows[0].Username)
	require.Equal(t, 0, selfRows[0].ChannelID)
	require.Empty(t, selfRows[0].ChannelName)
	require.Empty(t, selfRows[0].TokenName)
	require.Equal(t, "vip", selfRows[0].UseGroup)
	require.Equal(t, 175, selfRows[0].Quota)
}

func TestLogQuotaDataSplitsRowsByUseGroupTokenChannelAndNode(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()

	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3661,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     100,
		TokenUsed: 40,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     50,
		TokenUsed: 20,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "default",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     25,
		TokenUsed: 10,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:        1,
		Username:      "alice",
		ModelName:     "gpt-a",
		CreatedAt:     3700,
		UseGroup:      "vip",
		TokenID:       11,
		ChannelID:     1,
		NodeName:      "node-a",
		BillingSource: "subscription",
		Quota:         40,
		TokenUsed:     10,
	})

	SaveQuotaDataCache()

	var rows []QuotaData
	require.NoError(t, DB.Order("quota DESC").Find(&rows).Error)
	require.Len(t, rows, 3)
	require.Equal(t, int64(3600), rows[0].CreatedAt)
	require.Equal(t, "vip", rows[0].UseGroup)
	require.Equal(t, 11, rows[0].TokenID)
	require.Equal(t, 1, rows[0].ChannelID)
	require.Equal(t, "node-a", rows[0].NodeName)
	require.Empty(t, rows[0].BillingSource)
	require.Equal(t, 2, rows[0].Count)
	require.Equal(t, 150, rows[0].Quota)
	require.Equal(t, 60, rows[0].TokenUsed)
	require.Equal(t, "subscription", rows[1].BillingSource)
	require.Equal(t, 40, rows[1].Quota)
	require.Equal(t, "default", rows[2].UseGroup)
	require.Equal(t, 25, rows[2].Quota)
}

func TestQuotaDataTimeRangeIncludesBucketContainingStart(t *testing.T) {
	truncateTables(t)

	// quota_data rows are bucketed at the start of the hour by LogQuotaData.
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		UseGroup:  "vip",
		ModelName: "gpt-a",
		CreatedAt: 3600,
		Count:     1,
		Quota:     10,
		TokenUsed: 5,
	})

	dashboardRows, err := GetAllQuotaDates(3661, 3900, "")
	require.NoError(t, err)
	require.Len(t, dashboardRows, 1)
	require.Equal(t, 5, dashboardRows[0].TokenUsed)

	flowRows, err := GetFlowQuotaData(3661, 3900, "", 0, common.RoleRootUser)
	require.NoError(t, err)
	require.Len(t, flowRows, 1)

	rankingTotals, err := GetRankingQuotaTotals(3661, 3900)
	require.NoError(t, err)
	require.Len(t, rankingTotals, 1)
	require.Equal(t, int64(5), rankingTotals[0].TotalTokens)

	outsideRows, err := GetAllQuotaDates(7201, 7300, "")
	require.NoError(t, err)
	require.Empty(t, outsideRows)
}

func TestSumUsedQuotaSplitsWalletAndSubscription(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			setupLogAnalysisTestDB(t, dialect)

			now := common.GetTimestamp()
			logs := []Log{
				{UserId: 1, CreatedAt: now, Type: LogTypeConsume, Quota: 30, Other: `{"billing_source":"wallet"}`},
				{UserId: 1, CreatedAt: now, Type: LogTypeConsume, Quota: 20, Other: `{"billing_source":"subscription"}`},
				{UserId: 1, CreatedAt: now, Type: LogTypeConsume, Quota: 5, Other: `{}`},
				{UserId: 1, CreatedAt: now, Type: LogTypeConsume, Quota: 7, Other: `{"nested":{"billing_source":"subscription"}}`},
				{UserId: 1, CreatedAt: now, Type: LogTypeConsume, Quota: 3, Other: `{"billing_source": "subscription"}`},
				{UserId: 1, CreatedAt: now, Type: LogTypeRefund, Quota: 99, Other: `{"billing_source":"subscription"}`},
			}
			for i := range logs {
				require.NoError(t, createLog(&logs[i]))
			}

			stat, err := SumUsedQuota(LogTypeConsume, now-60, now+60, "", "", "", 0, "")
			require.NoError(t, err)
			require.Equal(t, 65, stat.Quota)
			require.Equal(t, 30, stat.WalletQuota)
			require.Equal(t, 23, stat.SubscriptionQuota)
			require.Equal(t, 12, stat.UnknownQuota)
		})
	}
}

type quotaDataBeforeBillingSource struct {
	Id                  int    `json:"id"`
	UserID              int    `json:"user_id" gorm:"index"`
	Username            string `json:"username" gorm:"index:idx_qdt_model_user_name,priority:2;size:64;default:''"`
	ModelName           string `json:"model_name" gorm:"index:idx_qdt_model_user_name,priority:1;size:64;default:''"`
	CreatedAt           int64  `json:"created_at" gorm:"bigint;index:idx_qdt_created_at,priority:2"`
	UseGroup            string `json:"use_group" gorm:"index;size:64;default:''"`
	TokenID             int    `json:"token_id" gorm:"index;default:0"`
	ChannelID           int    `json:"channel_id" gorm:"index;default:0"`
	NodeName            string `json:"node_name" gorm:"index;size:64;default:''"`
	TokenUsed           int    `json:"token_used" gorm:"default:0"`
	Count               int    `json:"count" gorm:"default:0"`
	Quota               int    `json:"quota" gorm:"default:0"`
	CacheReadTokens     int64  `json:"cache_read_tokens" gorm:"default:0"`
	CacheCreationTokens int64  `json:"cache_creation_tokens" gorm:"default:0"`
}

func (quotaDataBeforeBillingSource) TableName() string {
	return "quota_data"
}

func TestQuotaDataBillingSourceMigrationAndSplit(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := setupLogAnalysisTestDB(t, dialect)
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			t.Cleanup(func() { _ = db.Migrator().DropTable("quota_data") })
			require.NoError(t, db.Migrator().DropTable(&quotaDataBeforeBillingSource{}))
			require.NoError(t, db.AutoMigrate(&quotaDataBeforeBillingSource{}))

			legacy := quotaDataBeforeBillingSource{
				UserID:    1,
				Username:  "alice",
				ModelName: "gpt-a",
				CreatedAt: 3600,
				Count:     1,
				Quota:     10,
				TokenUsed: 10,
			}
			require.NoError(t, db.Create(&legacy).Error)

			require.NoError(t, db.AutoMigrate(&QuotaData{}))
			require.NoError(t, db.AutoMigrate(&QuotaData{}))
			require.True(t, db.Migrator().HasColumn(&QuotaData{}, "billing_source"))
			require.True(t, db.Migrator().HasIndex(&QuotaData{}, "idx_qdt_model_user_name"))

			var legacyRows []QuotaData
			require.NoError(t, db.Where("model_name = ?", "gpt-a").Find(&legacyRows).Error)
			require.Len(t, legacyRows, 1)
			require.Equal(t, 10, legacyRows[0].Quota)
			require.Empty(t, legacyRows[0].BillingSource)

			require.NoError(t, db.Create(&QuotaData{
				UserID:        1,
				Username:      "alice",
				ModelName:     "gpt-a",
				CreatedAt:     3600,
				BillingSource: "subscription",
				Count:         1,
				Quota:         20,
				TokenUsed:     5,
			}).Error)

			rows, err := GetAllQuotaDates(3600, 3600, "alice")
			require.NoError(t, err)
			require.Len(t, rows, 2)
			unknown, subscription := 0, 0
			for _, row := range rows {
				if row.BillingSource == "subscription" {
					subscription += row.Quota
				} else {
					unknown += row.Quota
				}
			}
			require.Equal(t, 10, unknown)
			require.Equal(t, 20, subscription)

			require.NoError(t, db.Migrator().DropTable(&QuotaData{}))
			require.NoError(t, db.AutoMigrate(&QuotaData{}))
			require.NoError(t, db.AutoMigrate(&QuotaData{}))
			require.True(t, db.Migrator().HasColumn(&QuotaData{}, "billing_source"))
			require.True(t, db.Migrator().HasIndex(&QuotaData{}, "idx_qdt_model_user_name"))
		})
	}
}

func TestRecordConsumeLogDashboardTokensIncludeCacheInput(t *testing.T) {
	truncateTables(t)
	common.DataExportEnabled = true
	t.Cleanup(func() {
		common.DataExportEnabled = true
		CacheQuotaDataLock.Lock()
		CacheQuotaData = make(map[string]*QuotaData)
		CacheQuotaDataLock.Unlock()
	})

	record := func(t *testing.T, userId int, username string, params RecordConsumeLogParams) {
		t.Helper()
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("username", username)
		RecordConsumeLog(c, userId, params)
	}

	// Anthropic-style usage: prompt_tokens excludes cache reads/writes, so the
	// dashboard total is token_used plus the separate cache counters.
	cacheOther := NewLogOther()
	cacheOther.SetPublic("cache_tokens", 7500)
	cacheOther.SetPublic("cache_write_tokens", 500)
	cacheOther.SetPublic("billing_source", "subscription")
	record(t, 1, "alice", RecordConsumeLogParams{
		PromptTokens:     1000,
		InputTokens:      9000,
		CompletionTokens: 50,
		ModelName:        "claude-sonnet",
		Quota:            123,
		Other:            cacheOther,
	})
	// OpenAI-style usage: no cache counters, prompt + completion is kept.
	record(t, 2, "bob", RecordConsumeLogParams{
		PromptTokens:     700,
		CompletionTokens: 30,
		ModelName:        "gpt-a",
		Quota:            45,
	})
	SaveQuotaDataCache()

	var rows []QuotaData
	require.NoError(t, DB.Order("user_id ASC").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, 1050, rows[0].TokenUsed)
	require.Equal(t, "subscription", rows[0].BillingSource)
	require.EqualValues(t, 7500, rows[0].CacheReadTokens)
	require.EqualValues(t, 500, rows[0].CacheCreationTokens)
	require.Equal(t, 9050, rows[0].TokenUsed+int(rows[0].CacheReadTokens)+int(rows[0].CacheCreationTokens))
	require.Equal(t, 730, rows[1].TokenUsed)
	require.Empty(t, rows[1].BillingSource)
	require.Zero(t, rows[1].CacheReadTokens)

	var logs []Log
	require.NoError(t, DB.Order("user_id ASC").Find(&logs).Error)
	require.Len(t, logs, 2)
	require.Equal(t, 1000, logs[0].PromptTokens)
	require.Equal(t, 50, logs[0].CompletionTokens)
	require.Equal(t, 700, logs[1].PromptTokens)
}
