package controller

import (
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
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

	upstreamRatio := model.DefaultSubscriptionUpstreamRatio
	if raw := c.Query("upstream_ratio"); raw != "" {
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 100 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		upstreamRatio = value
	}

	overview, err := model.GetSubscriptionOverview(start, end, upstreamRatio)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, overview)
}
