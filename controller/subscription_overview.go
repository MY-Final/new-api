package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxSubscriptionOverviewRangeSeconds = 366 * 24 * 60 * 60

func AdminGetSubscriptionOverview(c *gin.Context) {
	now := common.GetTimestamp()
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if end <= 0 {
		end = now
	}
	if start <= 0 {
		start = end - 30*24*60*60
	}
	if start > end {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if end-start > maxSubscriptionOverviewRangeSeconds {
		common.ApiErrorT(c, "Date range cannot exceed {{days}} days", map[string]any{"days": 366})
		return
	}

	overview, err := model.GetSubscriptionOverview(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}

func AdminGetSubscriptionPlanSubscribers(c *gin.Context) {
	planId, _ := strconv.Atoi(c.Param("id"))
	if planId <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	statusFilter := c.Query("status")
	keyword := c.Query("keyword")

	result, err := model.GetSubscriptionPlanSubscribers(planId, page, pageSize, statusFilter, keyword)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Subscription plan not found"))
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
