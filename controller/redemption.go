package controller

import (
	"errors"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

func GetAllRedemptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.GetAllRedemptions(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func SearchRedemptions(c *gin.Context) {
	keyword := c.Query("keyword")
	status := c.Query("status")
	redemptionType := c.Query("type")
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.SearchRedemptions(keyword, status, redemptionType, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetRedemption(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	redemption, err := model.GetRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    redemption,
	})
	return
}

type redemptionMutationRequest struct {
	Id          int     `json:"id"`
	Name        string  `json:"name"`
	Count       int     `json:"count"`
	Quota       *int    `json:"quota"`
	PaidQuota   *int    `json:"paid_quota"`
	BonusQuota  *int    `json:"bonus_quota"`
	ExpiredTime int64   `json:"expired_time"`
	Type        *string `json:"type"`
	Status      int     `json:"status"`
}

func AddRedemption(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorI18n(c, i18n.MsgPaymentComplianceRequired)
		return
	}

	var request redemptionMutationRequest
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if utf8.RuneCountInString(request.Name) == 0 || utf8.RuneCountInString(request.Name) > 20 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionNameLength)
		return
	}
	if request.Count <= 0 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountPositive)
		return
	}
	if request.Count > 100 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountMax)
		return
	}
	if valid, msg := validateExpiredTime(c, request.ExpiredTime); !valid {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
		return
	}
	var keys []string
	totalQuota := 0
	for i := 0; i < request.Count; i++ {
		key := common.GetUUID()
		cleanRedemption := model.Redemption{
			UserId:      c.GetInt("id"),
			Name:        request.Name,
			Key:         key,
			CreatedTime: common.GetTimestamp(),
			ExpiredTime: request.ExpiredTime,
		}
		if request.Quota != nil {
			cleanRedemption.Quota = *request.Quota
		}
		if request.PaidQuota != nil {
			cleanRedemption.PaidQuota = *request.PaidQuota
		}
		if request.BonusQuota != nil {
			cleanRedemption.BonusQuota = *request.BonusQuota
		}
		if request.Type != nil {
			cleanRedemption.Type = *request.Type
		}
		err = cleanRedemption.Insert()
		if err != nil {
			common.SysError("failed to insert redemption: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgRedemptionCreateFailed),
				"data":    keys,
			})
			return
		}
		totalQuota = cleanRedemption.Quota
		keys = append(keys, key)
	}
	recordManageAudit(c, "redemption.create", map[string]any{
		"name":  request.Name,
		"count": request.Count,
		"quota": logger.LogQuota(totalQuota),
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    keys,
	})
	return
}

func DeleteRedemption(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	err := model.DeleteRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateRedemption(c *gin.Context) {
	statusOnly := c.Query("status_only")
	var request redemptionMutationRequest
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cleanRedemption, err := model.GetRedemptionById(request.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		if valid, msg := validateExpiredTime(c, request.ExpiredTime); !valid {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
			return
		}
		// If you add more fields, please also update redemption.Update()
		cleanRedemption.Name = request.Name
		if request.Quota != nil && request.PaidQuota == nil && request.BonusQuota == nil {
			cleanRedemption.PaidQuota = 0
			cleanRedemption.BonusQuota = 0
			cleanRedemption.Quota = *request.Quota
		} else if request.PaidQuota != nil {
			cleanRedemption.PaidQuota = *request.PaidQuota
		}
		if request.BonusQuota != nil {
			cleanRedemption.BonusQuota = *request.BonusQuota
		}
		cleanRedemption.ExpiredTime = request.ExpiredTime
		if request.Type != nil {
			cleanRedemption.Type = *request.Type
		}
	}
	if statusOnly != "" {
		if request.Status != common.RedemptionCodeStatusEnabled && request.Status != common.RedemptionCodeStatusDisabled {
			common.ApiError(c, errors.New("invalid redemption status"))
			return
		}
		cleanRedemption.Status = request.Status
	}
	err = cleanRedemption.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanRedemption,
	})
	return
}

type batchRedemptionRequest struct {
	IDs        []int   `json:"ids"`
	Operation  string  `json:"operation"`
	Name       *string `json:"name"`
	Type       *string `json:"type"`
	Quota      *int    `json:"quota"`
	PaidQuota  *int    `json:"paid_quota"`
	BonusQuota *int    `json:"bonus_quota"`
	Status     *int    `json:"status"`
}

func BatchRedemptionOperation(c *gin.Context) {
	var req batchRedemptionRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}

	var count int
	var err error
	switch req.Operation {
	case "update":
		count, err = model.BatchUpdateRedemptionsWithSources(req.IDs, req.Name, req.Type, req.Quota, req.PaidQuota, req.BonusQuota, req.Status)
	case "delete":
		count, err = model.BatchDeleteRedemptions(req.IDs)
	default:
		err = errors.New("invalid batch redemption operation")
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}

	recordManageAudit(c, "redemption.batch_"+req.Operation, map[string]interface{}{
		"ids":   req.IDs,
		"count": count,
	})
	common.ApiSuccess(c, gin.H{"operation": req.Operation, "count": count})
}

func DeleteInvalidRedemption(c *gin.Context) {
	rows, err := model.DeleteInvalidRedemptions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

func validateExpiredTime(c *gin.Context, expired int64) (bool, string) {
	if expired != 0 && expired < common.GetTimestamp() {
		return false, i18n.T(c, i18n.MsgRedemptionExpireTimeInvalid)
	}
	return true, ""
}

func DeleteRedemptionBatch(c *gin.Context) {
	var request struct {
		Ids []int `json:"ids" binding:"required,min=1,max=1000,dive,gt=0"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	count, err := model.BatchDeleteRedemptions(request.Ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "redemption.delete_batch", map[string]any{
		"count":                    count,
		"total":                    len(request.Ids),
		"requested_redemption_ids": request.Ids,
	})
	common.ApiSuccess(c, count)
}
