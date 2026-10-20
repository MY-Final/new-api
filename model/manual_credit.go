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
	case "wechat", "alipay", "bank_transfer", "usdt", "other":
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
