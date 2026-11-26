package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const FinancialOperationManualCredit = "manual_credit"

// RestoreManualCreditLogReasons projects reasons omitted by older log writers.
// The ledger remains authoritative; neither logs nor wallet balances are rewritten.
func RestoreManualCreditLogReasons(logs []*Log) {
	type pendingCredit struct {
		log   *Log
		other map[string]common.RawMessage
		op    struct {
			Action string                       `json:"action"`
			Params map[string]common.RawMessage `json:"params"`
		}
		operationID int
	}
	var pending []pendingCredit
	var ids []int
	for _, log := range logs {
		if log == nil || log.Type != LogTypeTopup {
			continue
		}
		item := pendingCredit{log: log}
		if common.UnmarshalJsonStr(log.Other, &item.other) != nil || common.Unmarshal(item.other["op"], &item.op) != nil || item.op.Action != "finance.manual_credit" {
			continue
		}
		if reason := item.op.Params["reason"]; len(reason) > 0 && string(reason) != "null" && string(reason) != `""` {
			continue
		}
		if common.Unmarshal(item.op.Params["financial_operation_id"], &item.operationID) != nil || item.operationID <= 0 {
			continue
		}
		pending = append(pending, item)
		ids = append(ids, item.operationID)
	}
	if len(pending) == 0 {
		return
	}
	var operations []FinancialOperation
	if err := DB.Select("id, target_user_id, reason").Where("id IN ? AND operation_type = ?", ids, FinancialOperationManualCredit).Find(&operations).Error; err != nil {
		common.SysError(common.LogText("financial audit detail unavailable: %v", err))
		return
	}
	byID := make(map[int]FinancialOperation, len(operations))
	for _, operation := range operations {
		byID[operation.Id] = operation
	}
	for _, item := range pending {
		operation, ok := byID[item.operationID]
		if !ok || operation.TargetUserId != item.log.UserId || operation.Reason == "" {
			continue
		}
		reason, err := common.Marshal(operation.Reason)
		if err != nil {
			continue
		}
		item.op.Params["reason"] = reason
		op, err := common.Marshal(item.op)
		if err != nil {
			continue
		}
		item.other["op"] = op
		other, err := common.Marshal(item.other)
		if err != nil {
			continue
		}
		item.log.Other = string(other)
		item.log.Content += "; reason: " + operation.Reason
	}
}

// CreditUserByAdmin records offline paid credit and promotional credit together,
// granting a top-up referral rebate on the paid portion without initiating a payment.
func CreditUserByAdmin(userID, paid, bonus int, reason, reference, paymentChannel, clientID string, operatorID, operatorRole int) (FinancialOperation, bool, error) {
	var operation FinancialOperation
	reason, err := validateFinancialReason(reason)
	if err != nil {
		return operation, false, err
	}
	reference, clientID = strings.TrimSpace(reference), strings.TrimSpace(clientID)
	if userID <= 0 || operatorID <= 0 || operatorRole < common.RoleAdminUser || paid < 0 || bonus < 0 || paid > common.MaxWalletQuota || bonus > common.MaxWalletQuota || int64(paid)+int64(bonus) <= 0 || int64(paid)+int64(bonus) > int64(common.MaxWalletQuota) || len([]rune(reference)) > 128 || clientID == "" || len(clientID) > 64 {
		return operation, false, common.NewMessage("Invalid parameters")
	}
	if paid > 0 && reference == "" {
		return operation, false, common.NewMessage("Payment reference is required for paid credit")
	}
	switch paymentChannel {
	case "wechat", "alipay", "qq", "bank_transfer", "usdt", "other":
	default:
		return operation, false, common.NewMessage("Select a valid payment channel")
	}
	key := fmt.Sprintf("manual_credit:%d:%s", operatorID, clientID)
	already := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var target User
		if err := lockForUpdate(tx).First(&target, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && target.Role >= operatorRole {
			return ErrFinancialRoleForbidden
		}
		if err := tx.Where("operation_key = ?", key).First(&operation).Error; err == nil {
			if operation.TargetUserId != userID || operation.TargetPaidDelta != paid || operation.TargetBonusDelta != bonus || operation.Reason != reason || operation.SourceId != reference || operation.PaymentChannel != paymentChannel {
				return ErrFinancialOperationConflict
			}
			already = true
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		after, err := walletAfterDelta(target.Quota, paid+bonus)
		if err != nil {
			return err
		}
		if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
			target.PaidQuota = target.Quota
		}
		if _, err := walletAfterDelta(target.PaidQuota, paid); err != nil {
			return err
		}
		if _, err := walletAfterDelta(target.BonusQuota, bonus); err != nil {
			return err
		}
		operatorName, err := operatorUsernameTx(tx, operatorID)
		if err != nil {
			return err
		}
		if err := creditTopUpQuotaWithAllocation(tx, userID, QuotaAllocation{Paid: paid, Bonus: bonus}, nil); err != nil {
			return err
		}
		operation = FinancialOperation{
			OperationType: FinancialOperationManualCredit, OperationKey: key,
			OperatorId: operatorID, OperatorUsername: operatorName,
			TargetUserId: userID, TargetUsername: target.Username,
			SourceType: FinancialOperationManualCredit, SourceId: reference,
			PrincipalQuota: paid + bonus, TargetMainDelta: paid + bonus,
			TargetMainBefore: target.Quota, TargetMainAfter: after,
			TargetPaidDelta: paid, TargetBonusDelta: bonus, Reason: reason, PaymentChannel: paymentChannel,
		}
		if err := tx.Create(&operation).Error; err != nil {
			return err
		}
		if paid > 0 && target.InviterId > 0 {
			_, _, err := createAffiliateRebateTx(tx, target.InviterId, userID,
				AffiliateRebateSourceManualCredit, strconv.Itoa(operation.Id), paid, common.AffiliateTopupRebateRate)
			return err
		}
		return nil
	})
	if err == nil && !already {
		if _, cacheErr := cacheApplyUserQuotaSourceDelta(userID, QuotaAllocation{Paid: paid, Bonus: bonus}); cacheErr != nil {
			common.SysError(common.LogText("failed to sync manual quota adjustment for user %d: %s", userID, cacheErr))
		}
		invalidateAffiliateRebateUserCache(AffiliateRebateSourceManualCredit, strconv.Itoa(operation.Id), "manual credit rebate")
	}
	return operation, already, err
}
