package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetUserAffiliateRebates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	filters := financeQuery(c)
	filters.SourceType = c.Query("source_type")
	rebates, total, err := model.GetUserAffiliateRebatesFiltered(c.GetInt("id"), filters, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rebates)
	common.ApiSuccess(c, pageInfo)
}

func GetUserAffiliateInvitees(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	invitees, total, err := model.GetUserAffiliateInvitees(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invitees)
	common.ApiSuccess(c, pageInfo)
}

func GetAllAffiliateRebates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	rebates, total, err := model.GetAllAffiliateRebates(c.Query("source_type"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rebates)
	common.ApiSuccess(c, pageInfo)
}

type ReverseAffiliateRebateRequest struct {
	RebateId int    `json:"rebate_id"`
	Reason   string `json:"reason"`
}

func ReverseAffiliateRebate(c *gin.Context) {
	var req ReverseAffiliateRebateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.RebateId <= 0 {
		common.ApiError(c, errors.New("invalid rebate id"))
		return
	}
	alreadyReversed, err := model.ReverseAffiliateRebateByAdmin(req.RebateId, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": req.RebateId, "status": model.AffiliateRebateStatusReversed, "already_reversed": alreadyReversed})
}
