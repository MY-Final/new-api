/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const maxUsageStatisticsRangeSeconds int64 = 31 * 24 * 60 * 60

func parseUsageStatisticsRange(c *gin.Context) (int64, int64, bool) {
	startValue := c.Query("start_timestamp")
	endValue := c.Query("end_timestamp")
	if startValue == "" && endValue == "" {
		now := time.Now()
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
		return start, now.Unix(), true
	}
	if startValue == "" || endValue == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}
	startTimestamp, err := strconv.ParseInt(startValue, 10, 64)
	if err != nil || startTimestamp <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}
	endTimestamp, err := strconv.ParseInt(endValue, 10, 64)
	if err != nil || endTimestamp < startTimestamp || endTimestamp <= 0 || endTimestamp-startTimestamp > maxUsageStatisticsRangeSeconds {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}
	return startTimestamp, endTimestamp, true
}

func parseUsageStatisticsFilter(c *gin.Context, userID int) (model.UserUsageFilter, bool) {
	startTimestamp, endTimestamp, ok := parseUsageStatisticsRange(c)
	if !ok {
		return model.UserUsageFilter{}, false
	}
	channelID := 0
	if value := c.Query("channel"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return model.UserUsageFilter{}, false
		}
		channelID = parsed
	}
	return model.UserUsageFilter{
		UserID:    userID,
		Start:     startTimestamp,
		End:       endTimestamp,
		Username:  c.Query("username"),
		ModelName: c.Query("model_name"),
		ChannelID: channelID,
	}, true
}

func GetUserUsageStatistics(c *gin.Context) {
	filter, ok := parseUsageStatisticsFilter(c, 0)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	statistics, err := model.GetUserUsageRanking(filter, pageInfo.GetPage(), pageInfo.GetPageSize(), c.Query("sort_by"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, statistics)
}

func getManagedUserID(c *gin.Context) (int, bool) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, false
	}
	user, err := model.GetUserById(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return 0, false
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionSameLevel)
		return 0, false
	}
	return userID, true
}

func GetManagedUserUsageStatistics(c *gin.Context) {
	userID, ok := getManagedUserID(c)
	if !ok {
		return
	}
	filter, ok := parseUsageStatisticsFilter(c, userID)
	if !ok {
		return
	}
	usage, err := model.GetUserUsageWithFilter(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, usage)
}

func getUsageRequests(c *gin.Context, userID int) {
	filter, ok := parseUsageStatisticsFilter(c, userID)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	requests, err := model.GetUserUsageRequests(filter, pageInfo.GetPage(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, requests)
}

func GetManagedUserUsageRequests(c *gin.Context) {
	userID, ok := getManagedUserID(c)
	if !ok {
		return
	}
	getUsageRequests(c, userID)
}

func GetMyUsageStatistics(c *gin.Context) {
	filter, ok := parseUsageStatisticsFilter(c, c.GetInt("id"))
	if !ok {
		return
	}
	usage, err := model.GetUserUsageWithFilter(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, usage)
}

func GetMyUsageRequests(c *gin.Context) {
	getUsageRequests(c, c.GetInt("id"))
}
