package service

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const freeGroupSettingContextKey = "free_group_setting"
const freeGroupReservedContextKey = "free_group_reserved"
const FreeGroupDailyLimitError types.ErrorCode = "free_group_daily_limit_reached"

// LoadFreeGroupSetting snapshots the authoritative settings for one request.
func LoadFreeGroupSetting(c *gin.Context) *types.NewAPIError {
	if _, exists := c.Get(freeGroupSettingContextKey); exists {
		return nil
	}
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeQueryDataError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	c.Set(freeGroupSettingContextKey, model.ResolveFreeGroupSetting(setting, time.Now()))
	return nil
}

func IsFreeGroup(c *gin.Context, group string) bool {
	value, exists := c.Get(freeGroupSettingContextKey)
	if !exists {
		return false
	}
	setting, ok := value.(model.FreeGroupSetting)
	return ok && setting.Enabled && setting.Group == group
}

// ReserveFreeGroupCall reserves once per client request, even across retries.
func ReserveFreeGroupCall(c *gin.Context, group string, userID int) *types.NewAPIError {
	if !IsFreeGroup(c, group) || c.GetBool(freeGroupReservedContextKey) {
		return nil
	}
	value, _ := c.Get(freeGroupSettingContextKey)
	setting := value.(model.FreeGroupSetting)
	now := time.Now()
	allowed, err := model.ReserveFreeGroupDailyCall(now, userID, setting.DailyLimit, setting.UserLimit)
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeQueryDataError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	if !allowed {
		if err := model.RecordFreeGroupRejection(now, userID); err != nil {
			common.SysError("failed to record free group rejection: " + err.Error())
		}
		local := now.In(time.FixedZone("UTC+8", 8*60*60))
		reset := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, local.Location())
		seconds := int64((reset.Sub(now) + time.Second - 1) / time.Second)
		c.Header("Retry-After", strconv.FormatInt(seconds, 10))
		message := i18n.T(c, i18n.MsgFreeGroupLimitReached, map[string]any{"Reset": reset.Format(time.RFC3339)})
		return types.NewErrorWithStatusCode(errors.New(message), FreeGroupDailyLimitError, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	c.Set(freeGroupReservedContextKey, true)
	return nil
}
