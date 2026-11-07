package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetFreeGroupUsageReturnsPublicDailyTotals(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.FreeGroupDailyUsage{}))
	require.NoError(t, db.Create(&model.Option{
		Key:   model.FreeGroupSettingOption,
		Value: `{"enabled":true,"group":"free-eggs","daily_limit":10,"user_limit":2}`,
	}).Error)
	day := time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
	require.NoError(t, db.Create(&model.FreeGroupDailyUsage{
		Day:    day,
		UserID: 0,
		Count:  7,
	}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/free_group/usage", nil)

	GetFreeGroupUsage(context)

	var response struct {
		Success bool                   `json:"success"`
		Data    freeGroupUsageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, response.Success)
	assert.Equal(t, freeGroupUsageResponse{
		Enabled:    true,
		Group:      "free-eggs",
		DailyLimit: 10,
		Used:       7,
		Remaining:  3,
	}, response.Data)
	assert.NotContains(t, recorder.Body.String(), "user_limit")
}

func TestFreeGroupUserUsageDatabaseMatrix(t *testing.T) {
	for _, tc := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(tc.kind, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if tc.env != "" && dsn == "" {
				t.Skip(tc.env + " not configured")
			}
			db := modelManagementDB(t, tc.kind, dsn)
			require.NoError(t, db.AutoMigrate(&model.FreeGroupDailyUsage{}))
			require.NoError(t, db.Create(&model.Option{Key: model.FreeGroupSettingOption, Value: `{"enabled":true,"group":"free","daily_limit":20,"user_limit":5}`}).Error)
			users := []model.User{{Username: "alice", AffCode: "alice-code"}, {Username: "bob", AffCode: "bob-code"}}
			require.NoError(t, db.Create(&users).Error)
			for _, entry := range []model.FreeGroupDailyUsage{
				{Day: "2026-11-06", UserID: 0, Count: 8},
				{Day: "2026-11-06", UserID: users[0].Id, Count: 3},
				{Day: "2026-11-06", UserID: users[1].Id, Count: 5},
				{Day: "2026-11-07", UserID: users[0].Id, Count: 1},
			} {
				require.NoError(t, db.Create(&entry).Error)
			}
			request := func(query string) struct {
				Success bool `json:"success"`
				Data    struct {
					Day   string                     `json:"day"`
					Used  int64                      `json:"used"`
					Total int64                      `json:"total"`
					Items []model.FreeGroupUserUsage `json:"items"`
				} `json:"data"`
			} {
				recorder := httptest.NewRecorder()
				context, _ := gin.CreateTestContext(recorder)
				context.Request = httptest.NewRequest(http.MethodGet, "/api/free_group/users?"+query, nil)
				GetFreeGroupUserUsage(context)
				var response struct {
					Success bool `json:"success"`
					Data    struct {
						Day   string                     `json:"day"`
						Used  int64                      `json:"used"`
						Total int64                      `json:"total"`
						Items []model.FreeGroupUserUsage `json:"items"`
					} `json:"data"`
				}
				require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				return response
			}
			first := request("day=2026-11-06&p=1&page_size=1")
			assert.True(t, first.Success)
			assert.EqualValues(t, 8, first.Data.Used)
			assert.EqualValues(t, 2, first.Data.Total)
			require.Len(t, first.Data.Items, 1)
			assert.Equal(t, "bob", first.Data.Items[0].Username)
			second := request("day=2026-11-06&p=2&page_size=1")
			require.Len(t, second.Data.Items, 1)
			assert.Equal(t, "alice", second.Data.Items[0].Username)
			filtered := request("day=2026-11-06&username=alice")
			assert.EqualValues(t, 8, filtered.Data.Used)
			assert.EqualValues(t, 1, filtered.Data.Total)
			require.Len(t, filtered.Data.Items, 1)
			assert.EqualValues(t, 3, filtered.Data.Items[0].Count)
			assert.False(t, request("day=invalid").Success)
		})
	}
}
