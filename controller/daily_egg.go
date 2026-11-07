package controller

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetDailyEggRecords(c *gin.Context) {
	zone := time.FixedZone("UTC+8", 8*60*60)
	today := time.Now().In(zone).Format("2006-01-02")
	day := strings.TrimSpace(c.Query("day"))
	if day == "" {
		day = today
	}
	if _, err := time.ParseInLocation("2006-01-02", day, zone); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	page := common.GetPageQuery(c)
	if page.Page < 1 || page.PageSize < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	items, total, err := model.ListDailyEggDraws(day, strings.TrimSpace(c.Query("username")), strings.TrimSpace(c.Query("prize")), page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var prizes []model.DailyEggAdminPrize
	if day == today {
		prizes, err = model.DailyEggPrizeInventory(day)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}
	common.ApiSuccess(c, gin.H{"day": day, "today": today, "items": items, "total": total, "prizes": prizes})
}

func GetDailyEgg(c *gin.Context) {
	status, err := model.GetDailyEggStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
}

func OpenDailyEgg(c *gin.Context) {
	var request struct {
		Egg int `json:"egg" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid egg choice")
		return
	}
	draw, err := model.OpenDailyEgg(c.GetInt("id"), request.Egg)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, draw)
}
