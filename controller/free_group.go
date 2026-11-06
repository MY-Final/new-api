package controller

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type freeGroupUsageResponse struct {
	Enabled    bool   `json:"enabled"`
	Group      string `json:"group"`
	DailyLimit int64  `json:"daily_limit"`
	Used       int64  `json:"used"`
	Remaining  int64  `json:"remaining"`
}

func GetFreeGroupUsage(c *gin.Context) {
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	used, err := model.FreeGroupDailyCount(time.Now())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, freeGroupUsageResponse{
		Enabled:    setting.Enabled,
		Group:      setting.Group,
		DailyLimit: setting.DailyLimit,
		Used:       used,
		Remaining:  max(setting.DailyLimit-used, 0),
	})
}
