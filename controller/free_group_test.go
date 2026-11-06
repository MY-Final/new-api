package controller

import (
	"net/http"
	"net/http/httptest"
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
