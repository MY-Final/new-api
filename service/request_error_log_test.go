package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestErrorLogShouldCapture(t *testing.T) {
	settings := operation_setting.GetRequestErrorLogSetting()
	original := *settings
	t.Cleanup(func() { *settings = original })

	settings.Enabled = false
	assert.False(t, settings.ShouldCapture(403), "a disabled capture stores nothing")

	settings.Enabled = true
	settings.StatusCodes = "400,403"
	assert.True(t, settings.ShouldCapture(403), "a listed status code is captured")
	assert.False(t, settings.ShouldCapture(502), "an unlisted status code is skipped")
	assert.False(t, settings.ShouldCapture(200), "successful responses are never captured")

	settings.StatusCodes = "*"
	assert.True(t, settings.ShouldCapture(502), "* captures every failed response")
	assert.False(t, settings.ShouldCapture(302), "redirects are not failures")
}

func TestTruncateUTF8KeepsRuneBoundary(t *testing.T) {
	text := "错误请求"
	assert.Equal(t, "错", truncateUTF8(text, 4), "truncation backs off to the previous rune")
	assert.Equal(t, text, truncateUTF8(text, len(text)), "text within the limit is unchanged")
	assert.Empty(t, truncateUTF8(text, 0))
}

func TestRedactRequestErrorBody(t *testing.T) {
	body := `{"model":"m","api_key":"sk-secret","nested":{"authorization":"Bearer token"},"content":"keep"}`
	redacted := redactRequestErrorBody(body)
	assert.NotContains(t, redacted, "sk-secret")
	assert.NotContains(t, redacted, "Bearer token")
	assert.Contains(t, redacted, `"content":"keep"`)
}

func TestReadRequestErrorBodyTruncatesAndSkipsBinary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	c.Request.Header.Set("Content-Type", "application/json")

	storage, err := common.CreateBodyStorage([]byte(`{"messages":[]}`))
	require.NoError(t, err)
	c.Set(common.KeyBodyStorage, storage)

	body, size, truncated, ok := readRequestErrorBody(c, 4)
	require.True(t, ok)
	assert.Equal(t, `{"me`, body)
	assert.Equal(t, len(`{"messages":[]}`), size)
	assert.True(t, truncated)

	c.Request.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	_, _, _, ok = readRequestErrorBody(c, 4)
	assert.False(t, ok, "binary payloads are not stored")
}
