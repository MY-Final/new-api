package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type userUsageResponse struct {
	Success bool             `json:"success"`
	Message string           `json:"message"`
	Data    *model.UserUsage `json:"data"`
}

func performUserUsageRequest(t *testing.T, operatorRole int, targetID int, query string) userUsageResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "id", Value: fmt.Sprintf("%d", targetID)}}
	context.Set("role", operatorRole)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/user/usage?"+query, nil)

	GetUserUsage(context)
	var response userUsageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestGetUserUsageAllowsAdminToQueryCommonUser(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{Username: "usage-controller-user", Password: "password123", Role: common.RoleCommonUser}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.Log{
		UserId: user.Id, CreatedAt: 1500, Type: model.LogTypeConsume, PromptTokens: 8,
		CompletionTokens: 2, Quota: 30, ModelName: "controller-model",
	}).Error)

	response := performUserUsageRequest(t, common.RoleAdminUser, user.Id, "start_timestamp=1000&end_timestamp=2000")
	require.True(t, response.Success, response.Message)
	require.NotNil(t, response.Data)
	require.Equal(t, int64(1), response.Data.Summary.RequestCount)
	require.Equal(t, int64(10), response.Data.Summary.TotalTokens)
	require.Equal(t, int64(30), response.Data.Summary.NetQuota)
}

func TestGetUserUsageRejectsSameOrHigherRole(t *testing.T) {
	db := setupManageUserTestDB(t)
	admin := model.User{Username: "usage-controller-admin", Password: "password123", Role: common.RoleAdminUser}
	require.NoError(t, db.Create(&admin).Error)

	response := performUserUsageRequest(t, common.RoleAdminUser, admin.Id, "start_timestamp=1000&end_timestamp=2000")
	require.False(t, response.Success)
	require.Nil(t, response.Data)

	response = performUserUsageRequest(t, common.RoleAdminUser, admin.Id, "start_timestamp=bad&end_timestamp=2000")
	require.False(t, response.Success)
}

func TestGetUserUsageRejectsRangesOverThirtyOneDays(t *testing.T) {
	db := setupManageUserTestDB(t)
	user := model.User{Username: "usage-controller-range", Password: "password123", Role: common.RoleCommonUser}
	require.NoError(t, db.Create(&user).Error)

	response := performUserUsageRequest(t, common.RoleAdminUser, user.Id, "start_timestamp=1000&end_timestamp=2679401")
	require.False(t, response.Success)
}
