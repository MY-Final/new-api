package controller

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const maxLogAnalysisRangeSeconds int64 = 366 * 24 * 60 * 60

func GetLogAnalysis(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if startTimestamp == 0 && endTimestamp == 0 {
		now := time.Now()
		startTimestamp = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
		endTimestamp = now.Unix()
	}
	if startTimestamp <= 0 || endTimestamp < startTimestamp || endTimestamp-startTimestamp > maxLogAnalysisRangeSeconds {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	channel, _ := strconv.Atoi(c.Query("channel"))
	if channel < 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	topLimit, _ := strconv.Atoi(c.Query("top_limit"))
	realtimeMinutes, _ := strconv.Atoi(c.Query("realtime_minutes"))
	result, err := model.GetLogAnalysis(model.LogAnalysisFilter{
		Start:           startTimestamp,
		End:             endTimestamp,
		ModelName:       c.Query("model_name"),
		Username:        c.Query("username"),
		Group:           c.Query("group"),
		ChannelID:       channel,
		BucketSize:      model.LogAnalysisBucketSizeForRange(startTimestamp, endTimestamp),
		TopLimit:        topLimit,
		RealtimeMinutes: realtimeMinutes,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
