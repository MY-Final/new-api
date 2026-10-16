package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type financeRefundRequest struct {
	TradeNo                 string `json:"trade_no"`
	RedemptionId            int    `json:"redemption_id"`
	Reason                  string `json:"reason"`
	ExternalRefundCompleted bool   `json:"external_refund_completed"`
}

type financePenaltyRequest struct {
	UserId       int    `json:"user_id"`
	Quota        int    `json:"quota"`
	Reason       string `json:"reason"`
	RequestId    string `json:"request_id"`
	RequestBased bool   `json:"request_based"`
}

type financeRequestRefund struct {
	BillingId string `json:"billing_id"`
	Reason    string `json:"reason"`
}

func GetFinanceRequestBillings(c *gin.Context) {
	records, err := model.GetRequestBillings(c.Query("request_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, records)
}

func ListFinanceRequestBillings(c *gin.Context) {
	var filter model.RequestBillingQuery
	if err := c.ShouldBindQuery(&filter); err != nil || filter.StartTime > 0 && filter.EndTime > 0 && filter.EndTime < filter.StartTime {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	page := common.GetPageQuery(c)
	records, total, err := model.ListRequestBillings(filter, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(records)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func CreateFinanceRefundBatch(c *gin.Context) {
	var req struct {
		BillingIds []string `json:"billing_ids"`
		Reason     string   `json:"reason"`
		ClientId   string   `json:"client_id"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	task, err := service.StartRequestRefundBatch(req.BillingIds, req.Reason, req.ClientId, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, task.ToResponse())
	recordManageAudit(c, "finance.refund_batch.create", map[string]any{"task_id": task.TaskID, "count": len(req.BillingIds), "reason": req.Reason})
}

func ListFinanceRefundBatches(c *gin.Context) {
	page := common.GetPageQuery(c)
	tasks, total, err := model.ListSystemTasks(model.SystemTaskFilter{Type: model.SystemTaskTypeRequestRefund}, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]model.SystemTaskResponse, 0, len(tasks))
	for _, task := range tasks {
		items = append(items, task.ToResponse())
	}
	page.SetItems(items)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func RetryFinanceRefundBatch(c *gin.Context) {
	var req struct {
		ClientId string `json:"client_id"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	task, err := service.RetryRequestRefundBatch(c.Param("task_id"), req.ClientId, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, task.ToResponse())
	recordManageAudit(c, "finance.refund_batch.retry", map[string]any{"task_id": task.TaskID, "previous_task_id": c.Param("task_id")})
}

func GetFinanceUserRequestBillings(c *gin.Context) {
	userId, err := strconv.Atoi(c.Query("user_id"))
	if err != nil || userId <= 0 {
		common.ApiError(c, model.ErrRequestBillingNotFound)
		return
	}
	pageInfo := common.GetPageQuery(c)
	records, total, err := model.GetUserRequestBillings(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}

func RefundFinanceRequest(c *gin.Context) {
	var req financeRequestRefund
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	operation, already, err := model.RefundRequestBilling(req.BillingId, req.Reason, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"operation": operation, "already_refunded": already})
	recordFinancialAudit(c, "finance.request_refund", operation, already)
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
		common.ApiError(c, common.NewMessage("External refund confirmation is required"))
		return
	}
	already, err := model.RefundTopUpByAdmin(req.TradeNo, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"trade_no": req.TradeNo, "already_refunded": already, "status": common.TopUpStatusRefunded})
	recordFinancialAuditForKey(c, "finance.topup_refund", "topup_refund:"+req.TradeNo, already)
}

func RefundFinanceRedemption(c *gin.Context) {
	var req financeRefundRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || !req.ExternalRefundCompleted {
		common.ApiError(c, common.NewMessage("External refund confirmation is required"))
		return
	}
	already, err := model.RefundRedemptionByAdmin(req.RedemptionId, req.Reason, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"redemption_id": req.RedemptionId, "already_refunded": already, "status": common.RedemptionCodeStatusRefunded})
	recordFinancialAuditForKey(c, "finance.redemption_refund", "redemption_refund:"+strconv.Itoa(req.RedemptionId), already)
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
	recordFinancialAuditForKey(c, "finance.rebate_reverse", "rebate_reversal:"+strconv.Itoa(req.RebateId), already)
}

func CreateFinanceCredit(c *gin.Context) {
	var req struct {
		UserID          int    `json:"user_id"`
		PaidQuota       int    `json:"paid_quota"`
		BonusQuota      int    `json:"bonus_quota"`
		Reason          string `json:"reason"`
		Reference       string `json:"reference"`
		PaymentChannel  string `json:"payment_channel"`
		ClientID        string `json:"client_id"`
		PaymentReceived bool   `json:"payment_received"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.PaidQuota > 0 && !req.PaymentReceived {
		common.ApiErrorT(c, "Confirm that the offline payment has been received")
		return
	}
	operation, already, err := model.CreditUserByAdmin(req.UserID, req.PaidQuota, req.BonusQuota, req.Reason, req.Reference, req.PaymentChannel, req.ClientID, c.GetInt("id"), c.GetInt("role"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"operation": operation, "already_applied": already})
	recordFinancialAudit(c, "finance.manual_credit", operation, already)
	if !already {
		model.RecordLogWithAdminInfo(operation.TargetUserId, model.LogTypeTopup, auditContentEN("finance.manual_credit", map[string]any{"target_user_id": operation.TargetUserId, "paid_delta": operation.TargetPaidDelta, "bonus_delta": operation.TargetBonusDelta}), auditOperatorInfo(c), &model.AuditOperation{Action: "finance.manual_credit", Params: model.AuditFields{"paid_delta": operation.TargetPaidDelta, "bonus_delta": operation.TargetBonusDelta, "financial_operation_id": operation.Id}}, c)
	}
}

func ApplyFinancePenalty(c *gin.Context) {
	var req financePenaltyRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	operation, already, err := model.ApplyFinancialPenalty(req.UserId, req.Quota, req.Reason, req.RequestId, c.GetInt("id"), c.GetInt("role"), req.RequestBased)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"operation": operation, "already_applied": already})
	recordFinancialAudit(c, "finance.penalty", operation, already)
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
	recordFinancialAudit(c, "finance.penalty_reverse", operation, already)
}

// Financial operations carry committed accounting values, including on retries.
func recordFinancialAudit(c *gin.Context, action string, operation model.FinancialOperation, already bool) {
	recordManageAudit(c, action, map[string]any{
		"financial_operation_id": operation.Id, "target_user_id": operation.TargetUserId,
		"source_type": operation.SourceType, "source_id": operation.SourceId,
		"quota": operation.PrincipalQuota, "from": operation.TargetMainBefore, "to": operation.TargetMainAfter,
		"bonus_delta": operation.TargetBonusDelta, "paid_delta": operation.TargetPaidDelta,
		"reason": operation.Reason, "payment_channel": operation.PaymentChannel, "already_applied": already,
		"related_user_id": operation.RelatedUserId, "related_main_delta": operation.RelatedMainDelta,
		"related_affiliate_delta": operation.RelatedAffiliateDelta, "rebate_quota": operation.RebateQuota,
		"target_main_delta": operation.TargetMainDelta,
	})
}

func recordFinancialAuditForKey(c *gin.Context, action, key string, already bool) {
	var operation model.FinancialOperation
	if err := model.DB.Where("operation_key = ?", key).First(&operation).Error; err != nil {
		// The money movement already committed. Do not report a false failure or
		// invent accounting values if its detail cannot be read back.
		common.SysError(common.LogText("financial audit detail unavailable: %v", err))
		recordManageAudit(c, action, map[string]any{"operation_key": key, "detail_unavailable": true, "already_applied": already})
		return
	}
	recordFinancialAudit(c, action, operation, already)
}
