package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configureRequestAutoGroupsTest(t *testing.T) {
	t.Helper()
	originalMax := setting.GetMaxTokenAutoGroups()
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("2"))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["vip","default","svip"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP","svip":"SVIP"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"svip":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprintf("%d", originalMax)))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})
}

func newRequestAutoGroupsContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	return ctx
}

func TestGetRequestAutoGroupsInheritedListIsNotLimited(t *testing.T) {
	configureRequestAutoGroupsTest(t)
	ctx := newRequestAutoGroupsContext()

	groups := GetRequestAutoGroups(ctx, "default")

	assert.Equal(t, []string{"vip", "default", "svip"}, groups)
}

func TestGetRequestAutoGroupsFiltersBeforeApplyingCurrentLimit(t *testing.T) {
	configureRequestAutoGroupsTest(t)
	ctx := newRequestAutoGroupsContext()
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"revoked", "vip", "default", "svip"})
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`[]`))

	groups := GetRequestAutoGroups(ctx, "default")

	assert.Equal(t, []string{"vip", "default"}, groups)
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("1"))
	assert.Equal(t, []string{"vip"}, GetRequestAutoGroups(ctx, "default"))
}

func TestGetRequestAutoGroupsDoesNotFallBackAfterPermissionChange(t *testing.T) {
	configureRequestAutoGroupsTest(t)
	ctx := newRequestAutoGroupsContext()
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip"})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))

	groups := GetRequestAutoGroups(ctx, "default")

	assert.Empty(t, groups)
}

func TestActiveSubscriptionAddsRouteGroupsToUserPermissions(t *testing.T) {
	configureRequestAutoGroupsTest(t)
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["deepseek-a","default","deepseek-b"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"deepseek-a":1,"deepseek-b":1}`))
	truncate(t)
	user := model.User{
		Username: "subscription-route-groups",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	now := common.GetTimestamp()
	subscription := model.UserSubscription{
		UserId:       user.Id,
		Status:       "active",
		StartTime:    now,
		EndTime:      now + 3600,
		UpgradeGroup: "deepseek-day",
	}
	require.NoError(t, model.DB.Create(&subscription).Error)
	require.NoError(t, model.SnapshotPlanRouteGroupsTx(
		model.DB,
		subscription.Id,
		[]string{"deepseek-a", "deepseek-b"},
	))

	groups := GetUserUsableGroupsForUser("default", user.Id)
	assert.Equal(t, subscriptionRouteGroupDescription, groups["deepseek-a"])
	assert.Equal(t, subscriptionRouteGroupDescription, groups["deepseek-b"])
	assert.Equal(t, []string{"deepseek-a", "default", "deepseek-b"}, GetUserAutoGroupForUser("default", user.Id))
	for _, path := range []string{"/v1/chat/completions", "/v1/messages", "/v1/responses", "/v1beta/models/gemini:generateContent"} {
		ctx := newRequestAutoGroupsContext()
		ctx.Request = httptest.NewRequest("POST", path, nil)
		ctx.Set("id", user.Id)
		assert.Nil(t, ValidateSubscriptionEndpoint(ctx, "deepseek-a"), path)
	}
	for _, path := range []string{"/v1/images/generations", "/v1/realtime", "/mj/submit/imagine"} {
		ctx := newRequestAutoGroupsContext()
		ctx.Request = httptest.NewRequest("POST", path, nil)
		ctx.Set("id", user.Id)
		err := ValidateSubscriptionEndpoint(ctx, "deepseek-a")
		require.NotNil(t, err, path)
		assert.Equal(t, 400, err.StatusCode, path)
		assert.Nil(t, ValidateSubscriptionEndpoint(ctx, "default"), "wallet routing remains available")
	}
	taskPluginContext := newRequestAutoGroupsContext()
	taskPluginContext.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	taskPluginContext.Set("id", user.Id)
	taskPluginContext.Set("channel_type", constant.ChannelTypeTaskPlugin)
	err := ValidateSubscriptionEndpoint(taskPluginContext, "deepseek-a")
	require.NotNil(t, err)
	assert.Equal(t, 400, err.StatusCode)

	require.NoError(t, model.DB.Model(&subscription).Update("end_time", now-1).Error)
	groups = GetUserUsableGroupsForUser("default", user.Id)
	assert.NotContains(t, groups, "deepseek-a")
	assert.NotContains(t, groups, "deepseek-b")
}
