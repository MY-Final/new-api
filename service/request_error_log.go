package service

import (
	"io"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

const (
	requestErrorLogMessageLimit = 8192
	requestErrorCleanupInterval = 3600
)

var (
	requestErrorSensitiveField = regexp.MustCompile(`(?i)"(api_?key|authorization|access_?token|secret)"\s*:\s*"[^"]*"`)
	lastRequestErrorCleanup    atomic.Int64
)

// CaptureRequestErrorLog stores the failed relay request selected by
// request_error_log_setting. It never blocks the response: the row is written
// on a pooled goroutine after the body has been copied and truncated.
func CaptureRequestErrorLog(c *gin.Context, apiErr *types.NewAPIError) {
	if c == nil || c.Request == nil || apiErr == nil {
		return
	}
	settings := operation_setting.GetRequestErrorLogSetting()
	if !settings.ShouldCapture(apiErr.StatusCode) || !types.IsRecordErrorLog(apiErr) {
		return
	}
	if c.Request.Header.Get("Upgrade") != "" {
		return
	}

	entry := &model.RequestErrorLog{
		RequestId:    c.GetString(common.RequestIdKey),
		UserId:       c.GetInt("id"),
		Username:     c.GetString("username"),
		TokenId:      c.GetInt("token_id"),
		TokenName:    c.GetString("token_name"),
		ModelName:    c.GetString("original_model"),
		ChannelId:    common.GetContextKeyInt(c, constant.ContextKeyChannelId),
		Group:        c.GetString("group"),
		Ip:           c.ClientIP(),
		StatusCode:   apiErr.StatusCode,
		ErrorCode:    string(apiErr.GetErrorCode()),
		ErrorType:    string(apiErr.GetErrorType()),
		ErrorMessage: truncateUTF8(apiErr.MaskSensitiveErrorWithStatusCode(common.UpstreamAddresses(c)...), requestErrorLogMessageLimit),
		RequestPath:  c.Request.URL.Path,
		IsStream:     common.GetContextKeyBool(c, constant.ContextKeyIsStream),
		CreatedAt:    common.GetTimestamp(),
	}
	if startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime); !startTime.IsZero() {
		entry.UseTime = int(time.Since(startTime).Seconds())
	}

	if body, size, truncated, ok := readRequestErrorBody(c, settings.MaxBodyBytes()); ok {
		entry.Body = model.LongText(redactRequestErrorBody(body))
		entry.BodyBytes = size
		entry.BodyTruncated = truncated
	}

	gopool.Go(func() {
		if err := model.CreateRequestErrorLog(entry); err != nil {
			common.SysLog(common.LogText("failed to record request error log: %s", err.Error()))
		}
		cleanupExpiredRequestErrorLogs()
	})
}

// readRequestErrorBody copies at most limit bytes from the cached body storage.
// Binary payloads are not stored: their text form would be useless and could
// grow the row without bound.
func readRequestErrorBody(c *gin.Context, limit int) (string, int, bool, bool) {
	contentType := strings.ToLower(c.Request.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "json") && !strings.HasPrefix(contentType, "text/") {
		return "", 0, false, false
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return "", 0, false, false
	}
	reader, err := storage.NewReader()
	if err != nil {
		return "", 0, false, false
	}
	defer reader.Close()

	data, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		return "", 0, false, false
	}
	size := int(storage.Size())
	if size <= 0 {
		size = len(data)
	}
	if len(data) > limit {
		return string(data[:limit]), size, true, true
	}
	return string(data), size, false, true
}

func redactRequestErrorBody(body string) string {
	return requestErrorSensitiveField.ReplaceAllString(body, `"$1":"***"`)
}

// truncateUTF8 cuts text to at most maxBytes without splitting a rune.
func truncateUTF8(text string, maxBytes int) string {
	if len(text) <= maxBytes {
		return text
	}
	cut := maxBytes
	for cut > 0 && !utf8RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
}

func utf8RuneStart(b byte) bool {
	return b&0xC0 != 0x80
}

func cleanupExpiredRequestErrorLogs() {
	days := operation_setting.GetRequestErrorLogSetting().Retention()
	if days <= 0 {
		return
	}
	now := common.GetTimestamp()
	last := lastRequestErrorCleanup.Load()
	if now-last < requestErrorCleanupInterval {
		return
	}
	if !lastRequestErrorCleanup.CompareAndSwap(last, now) {
		return
	}
	if _, err := model.CleanupRequestErrorLogs(now - int64(days)*24*60*60); err != nil {
		common.SysLog(common.LogText("failed to clean up request error logs: %s", err.Error()))
	}
}
