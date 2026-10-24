package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func requestErrorLogFilterFromQuery(c *gin.Context) model.RequestErrorLogFilter {
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	statusCode, _ := strconv.Atoi(c.Query("status_code"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return model.RequestErrorLogFilter{
		RequestId:      strings.TrimSpace(c.Query("request_id")),
		Username:       strings.TrimSpace(c.Query("username")),
		ModelName:      strings.TrimSpace(c.Query("model_name")),
		ChannelId:      channelId,
		StatusCode:     statusCode,
		Keyword:        strings.TrimSpace(c.Query("keyword")),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
	}
}

// GetRequestErrorLogs lists captured failed requests without their bodies.
func GetRequestErrorLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	entries, total, err := model.GetRequestErrorLogs(requestErrorLogFilterFromQuery(c), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(entries)
	common.ApiSuccess(c, pageInfo)
}

// GetRequestErrorLog returns one captured request including its body.
func GetRequestErrorLog(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "Invalid request error log id")
		return
	}
	entry, err := model.GetRequestErrorLogById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, entry)
}

func DeleteRequestErrorLog(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "Invalid request error log id")
		return
	}
	if err := model.DeleteRequestErrorLogById(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type requestErrorLogDeleteRequest struct {
	Ids []int `json:"ids"`
}

func BatchDeleteRequestErrorLogs(c *gin.Context) {
	var request requestErrorLogDeleteRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.Ids) == 0 {
		common.ApiErrorMsg(c, "No request error logs selected")
		return
	}
	if len(request.Ids) > 1000 {
		common.ApiErrorMsg(c, "Too many request error logs selected")
		return
	}
	deleted, err := model.DeleteRequestErrorLogsByIds(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

// ClearRequestErrorLogs deletes rows matching the query. An empty query
// requires confirm=true so a stray request cannot wipe the table.
func ClearRequestErrorLogs(c *gin.Context) {
	filter := requestErrorLogFilterFromQuery(c)
	if filter.IsEmpty() && c.Query("confirm") != "true" {
		common.ApiErrorMsg(c, "Clearing every request error log requires confirmation")
		return
	}
	deleted, err := model.DeleteRequestErrorLogs(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}
