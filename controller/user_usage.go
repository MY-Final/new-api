/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const maxUserUsageRangeSeconds int64 = 31 * 24 * 60 * 60

func parseUserUsageTimeRange(c *gin.Context) (int64, int64, bool) {
	startTimestamp, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || startTimestamp <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}

	endTimestamp, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || endTimestamp <= 0 || endTimestamp < startTimestamp {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}
	if endTimestamp-startTimestamp > maxUserUsageRangeSeconds {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return 0, 0, false
	}

	return startTimestamp, endTimestamp, true
}

func GetUserUsage(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	if err != nil || userID <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	startTimestamp, endTimestamp, ok := parseUserUsageTimeRange(c)
	if !ok {
		return
	}

	user, err := model.GetUserById(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorI18n(c, i18n.MsgUserNoPermissionSameLevel)
		return
	}

	usage, err := model.GetUserUsage(userID, startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, usage)
}
