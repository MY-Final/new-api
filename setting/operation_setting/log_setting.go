package operation_setting

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	LogMaxRangeDaysOptionKey        = "log_setting.max_range_days"
	LogUserRefreshSecondsOptionKey  = "log_setting.user_refresh_seconds"
	LogAdminRefreshSecondsOptionKey = "log_setting.admin_refresh_seconds"
)

// LogSetting limits how far regular users can reach into usage logs.
type LogSetting struct {
	// UserExportEnabled lets regular users export their own usage logs.
	// Administrators can always export.
	UserExportEnabled bool `json:"user_export_enabled"`
	// MaxRangeDays is the longest time range a user can search in their logs
	// and dashboard, and the longest range any export can cover.
	MaxRangeDays        int `json:"max_range_days"`
	UserRefreshSeconds  int `json:"user_refresh_seconds"`
	AdminRefreshSeconds int `json:"admin_refresh_seconds"`
}

var logSetting = LogSetting{
	UserExportEnabled: true,
	MaxRangeDays:      365,
}

func init() {
	config.GlobalConfig.Register("log_setting", &logSetting)
}

func GetLogSetting() *LogSetting {
	return &logSetting
}

func (s *LogSetting) MaxRangeSeconds() int64 {
	return int64(max(s.MaxRangeDays, 1)) * 24 * 60 * 60
}

func ValidateLogMaxRangeDays(value string) error {
	days, err := strconv.Atoi(value)
	if err != nil || days < 1 {
		return common.NewMessage("The longest log time range must be at least 1 day")
	}
	return nil
}

func ValidateLogRefreshSeconds(value string) error {
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < 0 || seconds > 60 {
		return common.NewMessage("The log refresh interval must be an integer between 0 and 60 seconds")
	}
	return nil
}

func GetLogRefreshInterval(all bool) time.Duration {
	common.OptionMapRWMutex.RLock()
	seconds := logSetting.UserRefreshSeconds
	if all {
		seconds = logSetting.AdminRefreshSeconds
	}
	common.OptionMapRWMutex.RUnlock()
	if seconds == 0 {
		if all {
			seconds = common.GetEnvOrDefault("LOG_SSE_ADMIN_REFRESH_SECONDS", 5)
		} else {
			seconds = common.GetEnvOrDefault("LOG_SSE_USER_REFRESH_SECONDS", 3)
		}
	}
	return time.Duration(max(1, min(seconds, 60))) * time.Second
}
