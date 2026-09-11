package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateOptionRejectsRetiredFrontendTheme(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"theme.frontend","value":"classic"}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":false,"message":"Classic 前端已移除，主题只能设置为 default"}`, response.Body.String())
}

func TestGetStatusAdvertisesDefaultDashboard(t *testing.T) {
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	var payload struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	assert.Equal(t, "default", payload.Data["theme"])
}

func TestAPIBaseURLsAreValidatedAndExposedByStatus(t *testing.T) {
	valid := "https://kuncode.120403.xyz\nhttps://wcnmb.fun"
	require.NoError(t, system_setting.ValidateAPIBaseURLs(valid))
	for _, invalid := range []string{
		"javascript:alert(1)",
		"https://user:password@example.com",
		"https://example.com?token=secret",
		"https://example.com#fragment",
	} {
		assert.Error(t, system_setting.ValidateAPIBaseURLs(invalid), invalid)
	}
	invalidResponse := httptest.NewRecorder()
	invalidContext, _ := gin.CreateTestContext(invalidResponse)
	invalidContext.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"ApiBaseURLs","value":"javascript:alert(1)"}`),
	)
	UpdateOption(invalidContext)
	var invalidPayload struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(invalidResponse.Body.Bytes(), &invalidPayload))
	assert.False(t, invalidPayload.Success)

	previousMap := common.OptionMap
	common.OptionMap = map[string]string{system_setting.APIBaseURLsOptionKey: valid}
	t.Cleanup(func() { common.OptionMap = previousMap })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			APIBaseURLs []string `json:"api_base_urls"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	assert.Equal(t, []string{"https://kuncode.120403.xyz", "https://wcnmb.fun"}, payload.Data.APIBaseURLs)
}
