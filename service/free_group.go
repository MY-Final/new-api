package service

import (
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const freeGroupSettingContextKey = "free_group_setting"
const freeGroupReservedContextKey = "free_group_reserved"

// LoadFreeGroupSetting snapshots the authoritative settings for one request.
func LoadFreeGroupSetting(c *gin.Context) *types.NewAPIError {
	if _, exists := c.Get(freeGroupSettingContextKey); exists {
		return nil
	}
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeQueryDataError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	c.Set(freeGroupSettingContextKey, setting)
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
	allowed, err := model.ReserveFreeGroupDailyCall(time.Now(), userID, setting.DailyLimit, setting.UserLimit)
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeQueryDataError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	if !allowed {
		return types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgFreeGroupLimitReached)), types.ErrorCodeAccessDenied, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
	}
	c.Set(freeGroupReservedContextKey, true)
	return nil
}
