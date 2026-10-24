package operation_setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// RequestErrorLogSettingName is the option prefix of the error request capture
// settings (request_error_log_setting.*).
const RequestErrorLogSettingName = "request_error_log_setting"

// RequestErrorLogSetting controls which failed relay requests keep their
// request body for later inspection.
type RequestErrorLogSetting struct {
	// Enabled turns capture on. It is independent of ERROR_LOG_ENABLED: that
	// switch writes error lines to the server log file, this one stores one
	// database row per captured request.
	Enabled bool `json:"enabled"`
	// StatusCodes is a comma separated list of HTTP status codes to capture.
	// Empty or "*" captures every 4xx/5xx response.
	StatusCodes string `json:"status_codes"`
	// MaxBodyKB caps the stored request body size, in KiB.
	MaxBodyKB int `json:"max_body_kb"`
	// RetentionDays removes captured rows older than this many days. Zero
	// keeps them until an administrator deletes them.
	RetentionDays int `json:"retention_days"`
}

var requestErrorLogSetting = RequestErrorLogSetting{
	Enabled:       false,
	StatusCodes:   "400,401,403,413,422,429,451,500,502,503,504",
	MaxBodyKB:     64,
	RetentionDays: 7,
}

func init() {
	config.GlobalConfig.Register(RequestErrorLogSettingName, &requestErrorLogSetting)
}

func GetRequestErrorLogSetting() *RequestErrorLogSetting {
	return &requestErrorLogSetting
}

const (
	requestErrorLogDefaultMaxBodyKB = 64
	requestErrorLogMaxBodyKB        = 1024
	requestErrorLogMaxRetentionDays = 3650
)

// MaxBodyBytes is the capture limit applied to one request body.
func (s *RequestErrorLogSetting) MaxBodyBytes() int {
	kb := s.MaxBodyKB
	if kb <= 0 {
		kb = requestErrorLogDefaultMaxBodyKB
	}
	return min(kb, requestErrorLogMaxBodyKB) << 10
}

// Retention returns the configured retention in days, clamped to a usable
// range. Zero means captured rows are kept until deleted manually.
func (s *RequestErrorLogSetting) Retention() int {
	return min(max(s.RetentionDays, 0), requestErrorLogMaxRetentionDays)
}

// ShouldCapture reports whether a failed request with statusCode is stored.
func (s *RequestErrorLogSetting) ShouldCapture(statusCode int) bool {
	if !s.Enabled || statusCode < 400 || statusCode > 599 {
		return false
	}
	codes := strings.TrimSpace(s.StatusCodes)
	if codes == "" || codes == "*" {
		return true
	}
	for code := range strings.SplitSeq(codes, ",") {
		parsed, err := strconv.Atoi(strings.TrimSpace(code))
		if err == nil && parsed == statusCode {
			return true
		}
	}
	return false
}
