package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type financeRefundRequest struct {
	TradeNo                 string `json:"trade_no"`
	RedemptionId            int    `json:"redemption_id"`
	Reason                  string `json:"reason"`
	ExternalRefundCompleted bool   `json:"external_refund_completed"`
}

type financePenaltyRequest struct {
	UserId    int    `json:"user_id"`
	Quota     int    `json:"quota"`
	Reason    string `json:"reason"`
	RequestId string `json:"request_id"`
}

type financePenaltyReverseRequest struct {
	PenaltyId int    `json:"penalty_id"`
	Reason    string `json:"reason"`
}

func financeQuery(c *gin.Context) model.FinanceQuery {
	parseInt := func(key string) int {
		value, _ := strconv.Atoi(c.Query(key))
		return value
	}
	parseInt64 := func(key string) int64 {
		value, _ := strconv.ParseInt(c.Query(key), 10, 64)
		return value
	}
	return model.FinanceQuery{
		UserId: parseInt("user_id"), InviterId: parseInt("inviter_id"), InviteeId: parseInt("invitee_id"),
		OperatorId: parseInt("operator_id"), Keyword: strings.TrimSpace(c.Query("keyword")),
		SourceType: c.Query("source_type"), Status: c.Query("status"), Provider: c.Query("provider"),
		OperationType: c.Query("operation_type"), StartTime: parseInt64("start_time"), EndTime: parseInt64("end_time"),
	}
}

func GetFinanceTopUps(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListFinanceTopUps(financeQuery(c), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func GetFinanceRedemptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListFinanceRedemptions(financeQuery(c), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func GetFinanceRebates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListFinanceRebates(financeQuery(c), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func GetFinancialOperations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListFinancialOperations(financeQuery(c), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func RefundFinanceTopUp(c *gin.Context) {
	var req financeRefundRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !req.ExternalRefundCompleted {
		common.ApiError(c, errors.New("external refund confirmation is required"))
		return
	}
	already, err := model.RefundTopUpByAdmin(req.TradeNo, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"trade_no": req.TradeNo, "already_refunded": already, "status": common.TopUpStatusRefunded})
}

func RefundFinanceRedemption(c *gin.Context) {
	var req financeRefundRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !req.ExternalRefundCompleted {
		common.ApiError(c, errors.New("external refund confirmation is required"))
		return
	}
	already, err := model.RefundRedemptionByAdmin(req.RedemptionId, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"redemption_id": req.RedemptionId, "already_refunded": already, "status": common.RedemptionCodeStatusRefunded})
}

func ReverseFinanceRebate(c *gin.Context) {
	var req ReverseAffiliateRebateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	already, err := model.ReverseAffiliateRebateByAdmin(req.RebateId, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"rebate_id": req.RebateId, "already_reversed": already, "status": model.AffiliateRebateStatusReversed})
}

func ApplyFinancePenalty(c *gin.Context) {
	var req financePenaltyRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	operation, already, err := model.ApplyFinancialPenalty(req.UserId, req.Quota, req.Reason, req.RequestId, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"operation": operation, "already_applied": already})
}

func ReverseFinancePenalty(c *gin.Context) {
	var req financePenaltyReverseRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	operation, already, err := model.ReverseFinancialPenalty(req.PenaltyId, req.Reason, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"operation": operation, "already_reversed": already})
}
