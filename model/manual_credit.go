package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const FinancialOperationManualCredit = "manual_credit"

// CreditUserByAdmin records offline paid credit and promotional credit together,
// without initiating a payment or granting an automatic referral rebate.
func CreditUserByAdmin(userID, paid, bonus int, reason, reference, clientID string, operatorID, operatorRole int) (FinancialOperation, bool, error) {
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
			if operation.TargetUserId != userID || operation.TargetPaidDelta != paid || operation.TargetBonusDelta != bonus || operation.Reason != reason || operation.SourceId != reference {
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
			TargetPaidDelta: paid, TargetBonusDelta: bonus, Reason: reason,
		}
		return tx.Create(&operation).Error
	})
	if err == nil && !already {
		if _, cacheErr := cacheApplyUserQuotaSourceDelta(userID, QuotaAllocation{Paid: paid, Bonus: bonus}); cacheErr != nil {
			common.SysError(common.LogText("failed to sync manual quota adjustment for user %d: %s", userID, cacheErr))
		}
	}
	return operation, already, err
}
