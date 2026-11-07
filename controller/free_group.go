package controller

import (
	"strings"
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

const freeGroupScheduleMaxDays = 93

func GetFreeGroupUserUsage(c *gin.Context) {
	zone := time.FixedZone("UTC+8", 8*60*60)
	today := time.Now().In(zone).Format("2006-01-02")
	day := strings.TrimSpace(c.Query("day"))
	if day == "" {
		day = today
	}
	date, err := time.ParseInLocation("2006-01-02", day, zone)
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.PageSize < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting = model.ResolveFreeGroupSetting(setting, date)
	used, err := model.FreeGroupDailyCount(date)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items, total, err := model.ListFreeGroupUserUsage(day, strings.TrimSpace(c.Query("username")), page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"day": day, "today": today, "enabled": setting.Enabled, "group": setting.Group,
		"daily_limit": setting.DailyLimit, "user_limit": setting.UserLimit,
		"used": used, "items": items, "total": total,
	})
}

func GetFreeGroupUsage(c *gin.Context) {
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting = model.ResolveFreeGroupSetting(setting, time.Now())
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

func GetFreeGroupSchedule(c *gin.Context) {
	zone := time.FixedZone("UTC+8", 8*60*60)
	now := time.Now().In(zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
	from, to := today, today.AddDate(0, 0, 30)
	if raw := strings.TrimSpace(c.Query("from")); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, zone)
		if err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		from = parsed
	}
	if raw := strings.TrimSpace(c.Query("to")); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, zone)
		if err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		to = parsed
	}
	if to.Before(from) || int(to.Sub(from).Hours()/24)+1 > freeGroupScheduleMaxDays {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	setting, err := model.LoadFreeGroupSetting()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	todaySetting := model.ResolveFreeGroupSetting(setting, now)
	tomorrowSetting := model.ResolveFreeGroupSetting(setting, now.AddDate(0, 0, 1))
	common.ApiSuccess(c, gin.H{
		"today":          today.Format("2006-01-02"),
		"tomorrow":       today.AddDate(0, 0, 1).Format("2006-01-02"),
		"enabled":        setting.Enabled,
		"default_group":  setting.Group,
		"today_group":    todaySetting.Group,
		"tomorrow_group": tomorrowSetting.Group,
		"days":           model.FreeGroupSchedule(setting, from, to),
	})
}
