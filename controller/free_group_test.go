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
	assert.NotContains(t, recorder.Body.String(), `"user":`)
}

func TestGetFreeGroupUsageIncludesPersonalDailyUsage(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.FreeGroupDailyUsage{}))
	require.NoError(t, db.Create(&model.Option{
		Key:   model.FreeGroupSettingOption,
		Value: `{"enabled":true,"group":"free-eggs","daily_limit":10,"user_limit":2}`,
	}).Error)
	user := model.User{Username: "free-user", AffCode: "free-user-code"}
	require.NoError(t, db.Create(&user).Error)
	day := time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
	require.NoError(t, db.Create(&[]model.FreeGroupDailyUsage{
		{Day: day, UserID: 0, Count: 7},
		{Day: day, UserID: user.Id, Count: 1},
	}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set("id", user.Id)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/free_group/usage", nil)

	GetFreeGroupUsage(context)

	var response struct {
		Success bool                   `json:"success"`
		Data    freeGroupUsageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, response.Success)
	require.NotNil(t, response.Data.User)
	assert.Equal(t, freeGroupUserUsageResponse{
		Limit: 2, Used: 1, Remaining: 1,
	}, *response.Data.User)
}

func TestGetFreeGroupScheduleResolvesDateOverridesOverWeeklySlots(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.FreeGroupDailyUsage{}))
	require.NoError(t, db.Create(&model.Option{
		Key: model.FreeGroupSettingOption,
		Value: `{"enabled":true,"group":"default","daily_limit":10,"user_limit":2,` +
			`"weekly":[{"weekday":1,"group":"monday"}],` +
			`"schedule":[{"date":"2026-11-03","group":"special"}]}`,
	}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/free_group/schedule?from=2026-11-02&to=2026-11-04", nil)

	GetFreeGroupSchedule(context)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Today string                       `json:"today"`
			Days  []model.FreeGroupScheduleDay `json:"days"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, response.Success)
	require.Len(t, response.Data.Days, 3)
	assert.Equal(t, model.FreeGroupScheduleDay{
		Date: "2026-11-02", Group: "monday", Source: "weekly",
		Enabled: true, DailyLimit: 10, UserLimit: 2,
	}, response.Data.Days[0])
	assert.Equal(t, model.FreeGroupScheduleDay{
		Date: "2026-11-03", Group: "special", Source: "date",
		Enabled: true, DailyLimit: 10, UserLimit: 2,
	}, response.Data.Days[1])
	assert.Equal(t, model.FreeGroupScheduleDay{
		Date: "2026-11-04", Group: "default", Source: "default",
		Enabled: true, DailyLimit: 10, UserLimit: 2,
	}, response.Data.Days[2])
}

func TestGetFreeGroupUsageUsesTodaysScheduledGroup(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.FreeGroupDailyUsage{}))
	day := time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
	require.NoError(t, db.Create(&model.Option{
		Key:   model.FreeGroupSettingOption,
		Value: `{"enabled":true,"group":"default","daily_limit":10,"schedule":[{"date":"` + day + `","group":"today-only"}]}`,
	}).Error)
	require.NoError(t, db.Create(&model.FreeGroupDailyUsage{Day: day, UserID: 0, Count: 1}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/free_group/usage", nil)

	GetFreeGroupUsage(context)

	var response struct {
		Success bool                   `json:"success"`
		Data    freeGroupUsageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, "today-only", response.Data.Group)
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
				{Day: "2026-11-06", UserID: users[0].Id, Count: 3, RejectedCount: 4, LastRejectedAt: 1793980740},
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
			assert.EqualValues(t, 4, filtered.Data.Items[0].RejectedCount)
			assert.EqualValues(t, 1793980740, filtered.Data.Items[0].LastRejectedAt)
			assert.False(t, request("day=invalid").Success)
		})
	}
}

func TestDailyEggRecordsDatabaseMatrix(t *testing.T) {
	for _, tc := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(tc.kind, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if tc.env != "" && dsn == "" {
				t.Skip(tc.env + " not configured")
			}
			db := modelManagementDB(t, tc.kind, dsn)
			require.NoError(t, db.AutoMigrate(&model.DailyEggDraw{}, &model.DailyEggInventory{}))
			require.NoError(t, db.Create(&model.Option{
				Key: model.DailyEggSettingOption, Value: `{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"first","name":"First","quota":100,"quantity":3,"probability":10000}]}`,
			}).Error)
			users := []model.User{{Username: "alice", AffCode: "egg-alice"}, {Username: "bob", AffCode: "egg-bob"}}
			require.NoError(t, db.Create(&users).Error)
			today := time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
			require.NoError(t, db.Create(&[]model.DailyEggDraw{
				{UserID: users[0].Id, Day: today, Egg: 2, PrizeID: "first", PrizeName: "First", Quota: 100, CreatedAt: 100},
				{UserID: users[1].Id, Day: today, Egg: 1, CreatedAt: 200},
				{UserID: users[0].Id, Day: "2026-01-01", Egg: 3, PrizeID: "first", PrizeName: "First", Quota: 100, CreatedAt: 50},
			}).Error)
			require.NoError(t, db.Create(&model.DailyEggInventory{Day: today, PrizeID: "first", Count: 1}).Error)
			request := func(query string) struct {
				Success bool `json:"success"`
				Data    struct {
					Day    string                     `json:"day"`
					Total  int64                      `json:"total"`
					Items  []model.DailyEggAdminDraw  `json:"items"`
					Prizes []model.DailyEggAdminPrize `json:"prizes"`
				} `json:"data"`
			} {
				recorder := httptest.NewRecorder()
				context, _ := gin.CreateTestContext(recorder)
				context.Request = httptest.NewRequest(http.MethodGet, "/api/daily_egg/records?"+query, nil)
				GetDailyEggRecords(context)
				var response struct {
					Success bool `json:"success"`
					Data    struct {
						Day    string                     `json:"day"`
						Total  int64                      `json:"total"`
						Items  []model.DailyEggAdminDraw  `json:"items"`
						Prizes []model.DailyEggAdminPrize `json:"prizes"`
					} `json:"data"`
				}
				require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				return response
			}
			first := request("p=1&page_size=1")
			assert.True(t, first.Success)
			assert.EqualValues(t, 2, first.Data.Total)
			require.Len(t, first.Data.Items, 1)
			assert.Equal(t, "bob", first.Data.Items[0].Username)
			require.Len(t, first.Data.Prizes, 1)
			assert.EqualValues(t, 1, first.Data.Prizes[0].Issued)
			assert.EqualValues(t, 2, first.Data.Prizes[0].Remaining)
			filtered := request("username=alice&prize=First")
			require.Len(t, filtered.Data.Items, 1)
			assert.EqualValues(t, 2, filtered.Data.Items[0].Egg)
			assert.EqualValues(t, 100, filtered.Data.Items[0].Quota)
			history := request("day=2026-01-01&prize=First")
			require.Len(t, history.Data.Items, 1)
			assert.EqualValues(t, 3, history.Data.Items[0].Egg)
			assert.Empty(t, history.Data.Prizes)
			assert.False(t, request("day=invalid").Success)
			assert.False(t, request("page_size=-1").Success)
		})
	}
}
