package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	FinancialOperationTopUpRefund      = "topup_refund"
	FinancialOperationRedemptionRefund = "redemption_refund"
	FinancialOperationRebateReversal   = "rebate_reversal"
	FinancialOperationPenalty          = "penalty"
	FinancialOperationPenaltyReversal  = "penalty_reversal"
)

var (
	ErrFinancialReasonInvalid      = errors.New("reason must contain 1 to 255 characters")
	ErrRedemptionNotRefundable     = errors.New("redemption is not refundable")
	ErrPenaltyNotFound             = errors.New("penalty not found")
	ErrPenaltyAlreadyReversed      = errors.New("penalty already reversed")
	ErrFinancialRoleForbidden      = errors.New("cannot operate on a user with the same or higher role")
	ErrFinancialOperationKeyNeeded = errors.New("request id is required")
)

type FinancialOperation struct {
	Id                     int    `json:"id"`
	OperationType          string `json:"operation_type" gorm:"type:varchar(32);index"`
	OperationKey           string `json:"operation_key" gorm:"type:varchar(255);uniqueIndex"`
	ReversalOfId           int    `json:"reversal_of_id" gorm:"index"`
	OperatorId             int    `json:"operator_id" gorm:"index"`
	OperatorUsername       string `json:"operator_username" gorm:"type:varchar(64)"`
	TargetUserId           int    `json:"target_user_id" gorm:"index"`
	TargetUsername         string `json:"target_username" gorm:"type:varchar(64)"`
	RelatedUserId          int    `json:"related_user_id" gorm:"index"`
	RelatedUsername        string `json:"related_username" gorm:"type:varchar(64)"`
	SourceType             string `json:"source_type" gorm:"type:varchar(32);index"`
	SourceId               string `json:"source_id" gorm:"type:varchar(255);index"`
	PrincipalQuota         int    `json:"principal_quota" gorm:"type:bigint"`
	RebateQuota            int    `json:"rebate_quota" gorm:"type:bigint"`
	TargetMainDelta        int    `json:"target_main_delta" gorm:"type:bigint"`
	RelatedMainDelta       int    `json:"related_main_delta" gorm:"type:bigint"`
	RelatedAffiliateDelta  int    `json:"related_affiliate_delta" gorm:"type:bigint"`
	TargetMainBefore       int    `json:"target_main_before" gorm:"type:bigint"`
	TargetMainAfter        int    `json:"target_main_after" gorm:"type:bigint"`
	TargetBonusDelta       int    `json:"target_bonus_delta" gorm:"type:bigint"`
	TargetPaidDelta        int    `json:"target_paid_delta" gorm:"type:bigint"`
	RelatedMainBefore      int    `json:"related_main_before" gorm:"type:bigint"`
	RelatedMainAfter       int    `json:"related_main_after" gorm:"type:bigint"`
	RelatedAffiliateBefore int    `json:"related_affiliate_before" gorm:"type:bigint"`
	RelatedAffiliateAfter  int    `json:"related_affiliate_after" gorm:"type:bigint"`
	Reason                 string `json:"reason" gorm:"type:varchar(255)"`
	CreatedAt              int64  `json:"created_at" gorm:"bigint;autoCreateTime;index"`
}

type FinanceQuery struct {
	UserId        int
	InviterId     int
	InviteeId     int
	OperatorId    int
	Keyword       string
	SourceType    string
	Status        string
	Provider      string
	OperationType string
	StartTime     int64
	EndTime       int64
}

type rebateReversalSnapshot struct {
	Rebate         AffiliateRebate
	InviterBefore  User
	InviterAfter   User
	MainDebit      int
	BonusDebit     int
	PaidDebit      int
	AffiliateDebit int
	Changed        bool
}

type financeRebateSummary struct {
	SourceId         string
	InviterId        int
	RebateQuota      int
	ReversedQuota    int
	TransferredQuota int
	InviterUsername  string
	InviterQuota     int
	InviterAffQuota  int
}

func financeRebateSummaries(sourceType string, sourceIds []string) (map[string]financeRebateSummary, error) {
	result := make(map[string]financeRebateSummary, len(sourceIds))
	if len(sourceIds) == 0 {
		return result, nil
	}
	var summaries []financeRebateSummary
	err := DB.Model(&AffiliateRebate{}).
		Select("affiliate_rebates.source_id, affiliate_rebates.inviter_id, affiliate_rebates.rebate_quota, affiliate_rebates.reversed_quota, affiliate_rebates.transferred_quota, users.username AS inviter_username, users.quota AS inviter_quota, users.aff_quota AS inviter_aff_quota").
		Joins("LEFT JOIN users ON users.id = affiliate_rebates.inviter_id").
		Where("affiliate_rebates.source_type = ? AND affiliate_rebates.source_id IN ?", sourceType, sourceIds).
		Find(&summaries).Error
	if err != nil {
		return nil, err
	}
	for _, summary := range summaries {
		result[summary.SourceId] = summary
	}
	return result, nil
}

func validateFinancialReason(reason string) (string, error) {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) == 0 || len([]rune(reason)) > 255 {
		return "", ErrFinancialReasonInvalid
	}
	return reason, nil
}

func walletAfterDelta(current int, delta int) (int, error) {
	next := int64(current) + int64(delta)
	if next > int64(common.MaxWalletQuota) || next < -int64(common.MaxWalletQuota) {
		return 0, ErrWalletQuotaLimitExceeded
	}
	return int(next), nil
}

func financialUserTx(tx *gorm.DB, id int) (User, error) {
	var user User
	if id <= 0 {
		return user, nil
	}
	err := lockForUpdate(tx).Unscoped().Where("id = ?", id).First(&user).Error
	return user, err
}

func operatorUsernameTx(tx *gorm.DB, operatorId int) (string, error) {
	if operatorId <= 0 {
		return "", nil
	}
	var operator User
	if err := tx.Unscoped().Select("username").Where("id = ?", operatorId).First(&operator).Error; err != nil {
		return "", err
	}
	return operator.Username, nil
}

func reverseRebateForFinanceTx(tx *gorm.DB, rebate *AffiliateRebate, reason string, operatorId int) (rebateReversalSnapshot, error) {
	var snapshot rebateReversalSnapshot
	if rebate == nil {
		return snapshot, ErrAffiliateRebateNotFound
	}
	inviter, err := financialUserTx(tx, rebate.InviterId)
	if err != nil {
		return snapshot, err
	}
	locked := AffiliateRebate{}
	if err := lockForUpdate(tx).Where("id = ?", rebate.Id).First(&locked).Error; err != nil {
		return snapshot, ErrAffiliateRebateNotFound
	}
	snapshot.Rebate = locked
	if locked.Status == AffiliateRebateStatusReversed || locked.ReversedQuota >= locked.RebateQuota {
		return snapshot, nil
	}
	snapshot.InviterBefore = inviter
	remaining := locked.RebateQuota - locked.ReversedQuota
	debtOffset := locked.DebtOffsetQuota
	if debtOffset < 0 {
		debtOffset = 0
	}
	if debtOffset > remaining {
		debtOffset = remaining
	}
	transferred := locked.TransferredQuota
	if transferred < 0 {
		transferred = 0
	}
	if transferred > remaining-debtOffset {
		transferred = remaining - debtOffset
	}
	snapshot.MainDebit = debtOffset + transferred
	snapshot.PaidDebit = debtOffset
	snapshot.BonusDebit = transferred
	snapshot.AffiliateDebit = remaining - snapshot.MainDebit
	if _, err := walletAfterDelta(inviter.Quota, -snapshot.MainDebit); err != nil {
		return snapshot, err
	}
	if _, err := walletAfterDelta(inviter.AffQuota, -snapshot.AffiliateDebit); err != nil {
		return snapshot, err
	}
	if err := tx.Unscoped().Model(&User{}).Where("id = ?", locked.InviterId).Updates(map[string]interface{}{
		"quota":              gorm.Expr("quota - ?", snapshot.MainDebit),
		"paid_quota":         gorm.Expr("paid_quota - ?", debtOffset),
		"bonus_quota":        gorm.Expr("bonus_quota - ?", transferred),
		"aff_quota":          gorm.Expr("aff_quota - ?", snapshot.AffiliateDebit),
		"aff_reversed_quota": gorm.Expr("aff_reversed_quota + ?", remaining),
	}).Error; err != nil {
		return snapshot, err
	}
	locked.ReversedQuota += remaining
	locked.Status = AffiliateRebateStatusReversed
	locked.ReversedAt = common.GetTimestamp()
	locked.ReverseReason = reason
	locked.ReversedBy = operatorId
	if err := tx.Save(&locked).Error; err != nil {
		return snapshot, err
	}
	inviterAfter, err := financialUserTx(tx, locked.InviterId)
	if err != nil {
		return snapshot, err
	}
	snapshot.InviterAfter = inviterAfter
	snapshot.Rebate = locked
	snapshot.Changed = true
	return snapshot, nil
}

func RefundTopUpByAdmin(tradeNo string, reason string, operatorId int) (alreadyRefunded bool, err error) {
	tradeNo = strings.TrimSpace(tradeNo)
	if tradeNo == "" {
		return false, ErrTopUpNotFound
	}
	reason, err = validateFinancialReason(reason)
	if err != nil {
		return false, err
	}
	var targetId, relatedId, targetDebit, relatedMainDebit int
	var relatedAllocation QuotaAllocation
	err = DB.Transaction(func(tx *gorm.DB) error {
		var topUp TopUp
		if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if topUp.Status == common.TopUpStatusRefunded {
			alreadyRefunded = true
			return nil
		}
		if topUp.Status != common.TopUpStatusSuccess || topUp.Source != TopUpSourceTopup || topUp.CreditedQuota <= 0 {
			return ErrTopUpNotRefundable
		}
		target, err := financialUserTx(tx, topUp.UserId)
		if err != nil {
			return err
		}
		if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
			target.PaidQuota = target.Quota
		}
		targetAfter, err := walletAfterDelta(target.Quota, -topUp.CreditedQuota)
		if err != nil {
			return err
		}
		paidAfter, err := walletAfterDelta(target.PaidQuota, -topUp.CreditedQuota)
		if err != nil {
			return err
		}
		result := tx.Model(&TopUp{}).Where("id = ? AND status = ?", topUp.Id, common.TopUpStatusSuccess).Updates(map[string]interface{}{
			"status": common.TopUpStatusRefunded, "refunded_at": common.GetTimestamp(), "refund_reason": reason, "refunded_by": operatorId,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			alreadyRefunded = true
			return nil
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", target.Id).Updates(map[string]interface{}{
			"quota": targetAfter, "paid_quota": paidAfter, "bonus_quota": target.BonusQuota,
		}).Error; err != nil {
			return err
		}

		var reversal rebateReversalSnapshot
		var rebate AffiliateRebate
		if err := tx.Where("source_key = ?", AffiliateRebateSourceTopUp+":"+topUp.TradeNo).First(&rebate).Error; err == nil {
			reversal, err = reverseRebateForFinanceTx(tx, &rebate, reason, operatorId)
			if err != nil {
				return err
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		op := FinancialOperation{
			OperationType: FinancialOperationTopUpRefund, OperationKey: "topup_refund:" + tradeNo,
			OperatorId: operatorId, OperatorUsername: operatorUsername,
			TargetUserId: target.Id, TargetUsername: target.Username,
			SourceType: AffiliateRebateSourceTopUp, SourceId: tradeNo,
			PrincipalQuota: topUp.CreditedQuota, TargetMainDelta: -topUp.CreditedQuota,
			TargetMainBefore: target.Quota, TargetMainAfter: targetAfter, Reason: reason,
		}
		if reversal.Changed {
			op.RelatedUserId = reversal.InviterBefore.Id
			op.RelatedUsername = reversal.InviterBefore.Username
			op.RebateQuota = reversal.MainDebit + reversal.AffiliateDebit
			op.RelatedMainDelta = -reversal.MainDebit
			op.RelatedAffiliateDelta = -reversal.AffiliateDebit
			op.RelatedMainBefore = reversal.InviterBefore.Quota
			op.RelatedMainAfter = reversal.InviterAfter.Quota
			op.RelatedAffiliateBefore = reversal.InviterBefore.AffQuota
			op.RelatedAffiliateAfter = reversal.InviterAfter.AffQuota
		}
		if err := tx.Create(&op).Error; err != nil {
			return err
		}
		targetId, relatedId = target.Id, op.RelatedUserId
		targetDebit, relatedMainDebit = topUp.CreditedQuota, reversal.MainDebit
		relatedAllocation = QuotaAllocation{Bonus: reversal.BonusDebit, Paid: reversal.PaidDebit}
		return nil
	})
	if err != nil || alreadyRefunded {
		return alreadyRefunded, err
	}
	if targetDebit > 0 {
		_, _ = cacheApplyUserQuotaSourceDelta(targetId, QuotaAllocation{Paid: -targetDebit})
	}
	if relatedMainDebit > 0 {
		_, _ = cacheApplyUserQuotaSourceDelta(relatedId, QuotaAllocation{Bonus: -relatedAllocation.Bonus, Paid: -relatedAllocation.Paid})
	}
	return false, nil
}

func RefundRedemptionByAdmin(redemptionId int, reason string, operatorId int) (alreadyRefunded bool, err error) {
	if redemptionId <= 0 {
		return false, ErrRedemptionNotRefundable
	}
	reason, err = validateFinancialReason(reason)
	if err != nil {
		return false, err
	}
	var targetId, relatedId, targetDebit, relatedMainDebit int
	var targetRefundAllocation QuotaAllocation
	var relatedAllocation QuotaAllocation
	err = DB.Transaction(func(tx *gorm.DB) error {
		var redemption Redemption
		if err := lockForUpdate(tx).Where("id = ?", redemptionId).First(&redemption).Error; err != nil {
			return ErrRedemptionNotRefundable
		}
		if redemption.Status == common.RedemptionCodeStatusRefunded {
			alreadyRefunded = true
			return nil
		}
		if redemption.Status != common.RedemptionCodeStatusUsed || redemption.Type != RedemptionTypePaid || redemption.UsedUserId <= 0 {
			return ErrRedemptionNotRefundable
		}
		target, err := financialUserTx(tx, redemption.UsedUserId)
		if err != nil {
			return err
		}
		if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
			target.PaidQuota = target.Quota
		}
		redemptionAllocation, err := redemption.quotaAllocation()
		if err != nil {
			return ErrRedemptionNotRefundable
		}
		bonusRefund := redemptionAllocation.Bonus
		if bonusRefund > target.BonusQuota {
			bonusRefund = target.BonusQuota
		}
		if bonusRefund < 0 {
			bonusRefund = 0
		}
		paidRefund := redemptionAllocation.Paid + redemptionAllocation.Bonus - bonusRefund
		if paidRefund < 0 {
			return ErrRedemptionNotRefundable
		}
		targetAfter, err := walletAfterDelta(target.Quota, -redemptionAllocation.Total())
		if err != nil {
			return err
		}
		paidAfter, err := walletAfterDelta(target.PaidQuota, -paidRefund)
		if err != nil {
			return err
		}
		bonusAfter := target.BonusQuota - bonusRefund
		result := tx.Model(&Redemption{}).Where("id = ? AND status = ?", redemption.Id, common.RedemptionCodeStatusUsed).Updates(map[string]interface{}{
			"status": common.RedemptionCodeStatusRefunded, "refunded_at": common.GetTimestamp(), "refund_reason": reason, "refunded_by": operatorId,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			alreadyRefunded = true
			return nil
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", target.Id).Updates(map[string]interface{}{
			"quota": targetAfter, "paid_quota": paidAfter, "bonus_quota": bonusAfter,
		}).Error; err != nil {
			return err
		}

		var reversal rebateReversalSnapshot
		var rebate AffiliateRebate
		if err := tx.Where("source_key = ?", AffiliateRebateSourceRedemption+":"+strconv.Itoa(redemption.Id)).First(&rebate).Error; err == nil {
			reversal, err = reverseRebateForFinanceTx(tx, &rebate, reason, operatorId)
			if err != nil {
				return err
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		op := FinancialOperation{
			OperationType: FinancialOperationRedemptionRefund, OperationKey: fmt.Sprintf("redemption_refund:%d", redemption.Id),
			OperatorId: operatorId, OperatorUsername: operatorUsername,
			TargetUserId: target.Id, TargetUsername: target.Username,
			SourceType: AffiliateRebateSourceRedemption, SourceId: strconv.Itoa(redemption.Id),
			PrincipalQuota: redemption.Quota, TargetMainDelta: -redemption.Quota,
			TargetMainBefore: target.Quota, TargetMainAfter: targetAfter,
			TargetBonusDelta: -bonusRefund, TargetPaidDelta: -paidRefund, Reason: reason,
		}
		if reversal.Changed {
			op.RelatedUserId = reversal.InviterBefore.Id
			op.RelatedUsername = reversal.InviterBefore.Username
			op.RebateQuota = reversal.MainDebit + reversal.AffiliateDebit
			op.RelatedMainDelta = -reversal.MainDebit
			op.RelatedAffiliateDelta = -reversal.AffiliateDebit
			op.RelatedMainBefore = reversal.InviterBefore.Quota
			op.RelatedMainAfter = reversal.InviterAfter.Quota
			op.RelatedAffiliateBefore = reversal.InviterBefore.AffQuota
			op.RelatedAffiliateAfter = reversal.InviterAfter.AffQuota
		}
		if err := tx.Create(&op).Error; err != nil {
			return err
		}
		targetId, relatedId = target.Id, op.RelatedUserId
		targetDebit, relatedMainDebit = redemption.Quota, reversal.MainDebit
		targetRefundAllocation = QuotaAllocation{Bonus: bonusRefund, Paid: paidRefund}
		relatedAllocation = QuotaAllocation{Bonus: reversal.BonusDebit, Paid: reversal.PaidDebit}
		return nil
	})
	if err != nil || alreadyRefunded {
		return alreadyRefunded, err
	}
	if targetDebit > 0 {
		_, _ = cacheApplyUserQuotaSourceDelta(targetId, QuotaAllocation{
			Bonus: -targetRefundAllocation.Bonus,
			Paid:  -targetRefundAllocation.Paid,
		})
	}
	if relatedMainDebit > 0 {
		_, _ = cacheApplyUserQuotaSourceDelta(relatedId, QuotaAllocation{Bonus: -relatedAllocation.Bonus, Paid: -relatedAllocation.Paid})
	}
	return false, nil
}

func ReverseAffiliateRebateByAdmin(rebateId int, reason string, operatorId int) (alreadyReversed bool, err error) {
	if rebateId <= 0 {
		return false, ErrAffiliateRebateNotFound
	}
	reason, err = validateFinancialReason(reason)
	if err != nil {
		return false, err
	}
	var inviterId, mainDebit int
	var allocation QuotaAllocation
	err = DB.Transaction(func(tx *gorm.DB) error {
		var rebate AffiliateRebate
		if err := lockForUpdate(tx).Where("id = ?", rebateId).First(&rebate).Error; err != nil {
			return ErrAffiliateRebateNotFound
		}
		if rebate.SourceType != AffiliateRebateSourceTopUp && rebate.SourceType != AffiliateRebateSourceRedemption {
			return ErrAffiliateSourceInvalid
		}
		if rebate.Status == AffiliateRebateStatusReversed || rebate.ReversedQuota >= rebate.RebateQuota {
			alreadyReversed = true
			return nil
		}
		reversal, err := reverseRebateForFinanceTx(tx, &rebate, reason, operatorId)
		if err != nil {
			return err
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		op := FinancialOperation{
			OperationType: FinancialOperationRebateReversal, OperationKey: fmt.Sprintf("rebate_reversal:%d", rebate.Id),
			OperatorId: operatorId, OperatorUsername: operatorUsername,
			TargetUserId: rebate.InviteeId, RelatedUserId: rebate.InviterId,
			RelatedUsername: reversal.InviterBefore.Username,
			SourceType:      rebate.SourceType, SourceId: rebate.SourceId,
			RebateQuota:      reversal.MainDebit + reversal.AffiliateDebit,
			RelatedMainDelta: -reversal.MainDebit, RelatedAffiliateDelta: -reversal.AffiliateDebit,
			RelatedMainBefore: reversal.InviterBefore.Quota, RelatedMainAfter: reversal.InviterAfter.Quota,
			RelatedAffiliateBefore: reversal.InviterBefore.AffQuota, RelatedAffiliateAfter: reversal.InviterAfter.AffQuota,
			Reason: reason,
		}
		var target User
		if err := tx.Unscoped().Select("username, quota").Where("id = ?", rebate.InviteeId).First(&target).Error; err == nil {
			op.TargetUsername = target.Username
			op.TargetMainBefore, op.TargetMainAfter = target.Quota, target.Quota
		}
		if err := tx.Create(&op).Error; err != nil {
			return err
		}
		inviterId, mainDebit = rebate.InviterId, reversal.MainDebit
		allocation = QuotaAllocation{Bonus: reversal.BonusDebit, Paid: reversal.PaidDebit}
		return nil
	})
	if err == nil && !alreadyReversed && mainDebit > 0 {
		_, _ = cacheApplyUserQuotaSourceDelta(inviterId, QuotaAllocation{Bonus: -allocation.Bonus, Paid: -allocation.Paid})
	}
	return alreadyReversed, err
}

func ApplyFinancialPenalty(targetUserId int, quota int, reason string, requestId string, operatorId int, operatorRole int) (FinancialOperation, bool, error) {
	var operation FinancialOperation
	if targetUserId <= 0 || quota <= 0 || common.ValidateWalletQuota(quota) != nil {
		return operation, false, ErrInvalidTopUpQuota
	}
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || len(requestId) > 200 {
		return operation, false, ErrFinancialOperationKeyNeeded
	}
	reason, err := validateFinancialReason(reason)
	if err != nil {
		return operation, false, err
	}
	alreadyDone := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		operationKey := "penalty:" + requestId
		if err := tx.Where("operation_key = ?", operationKey).First(&operation).Error; err == nil {
			alreadyDone = true
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		target, err := financialUserTx(tx, targetUserId)
		if err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && target.Role >= operatorRole {
			return ErrFinancialRoleForbidden
		}
		if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
			target.PaidQuota = target.Quota
		}
		bonus := target.BonusQuota
		if bonus < 0 {
			bonus = 0
		}
		if bonus > quota {
			bonus = quota
		}
		allocation := QuotaAllocation{Bonus: bonus, Paid: quota - bonus}
		after, err := walletAfterDelta(target.Quota, -quota)
		if err != nil {
			return err
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		operation = FinancialOperation{
			OperationType: FinancialOperationPenalty, OperationKey: operationKey,
			OperatorId: operatorId, OperatorUsername: operatorUsername,
			TargetUserId: target.Id, TargetUsername: target.Username,
			SourceType: "user", SourceId: strconv.Itoa(target.Id), PrincipalQuota: quota,
			TargetMainDelta: -quota, TargetMainBefore: target.Quota, TargetMainAfter: after, Reason: reason,
			TargetBonusDelta: -allocation.Bonus, TargetPaidDelta: -allocation.Paid,
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", target.Id).Updates(map[string]interface{}{
			"quota": after, "bonus_quota": gorm.Expr("bonus_quota - ?", allocation.Bonus),
			"paid_quota": gorm.Expr("paid_quota - ?", allocation.Paid),
		}).Error; err != nil {
			return err
		}
		return tx.Create(&operation).Error
	})
	if err == nil && !alreadyDone {
		_, _ = cacheApplyUserQuotaSourceDelta(targetUserId, QuotaAllocation{Bonus: operation.TargetBonusDelta, Paid: operation.TargetPaidDelta})
	}
	return operation, alreadyDone, err
}

func ReverseFinancialPenalty(penaltyId int, reason string, operatorId int, operatorRole int) (FinancialOperation, bool, error) {
	var reversal FinancialOperation
	if penaltyId <= 0 {
		return reversal, false, ErrPenaltyNotFound
	}
	reason, err := validateFinancialReason(reason)
	if err != nil {
		return reversal, false, err
	}
	alreadyDone := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var penalty FinancialOperation
		if err := lockForUpdate(tx).Where("id = ? AND operation_type = ?", penaltyId, FinancialOperationPenalty).First(&penalty).Error; err != nil {
			return ErrPenaltyNotFound
		}
		operationKey := fmt.Sprintf("penalty_reversal:%d", penalty.Id)
		if err := tx.Where("operation_key = ?", operationKey).First(&reversal).Error; err == nil {
			alreadyDone = true
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		target, err := financialUserTx(tx, penalty.TargetUserId)
		if err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && target.Role >= operatorRole {
			return ErrFinancialRoleForbidden
		}
		allocation := QuotaAllocation{Bonus: -penalty.TargetBonusDelta, Paid: -penalty.TargetPaidDelta}
		if allocation.Total() == 0 {
			allocation.Paid = penalty.PrincipalQuota
		}
		after, err := walletAfterDelta(target.Quota, penalty.PrincipalQuota)
		if err != nil {
			return err
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		reversal = FinancialOperation{
			OperationType: FinancialOperationPenaltyReversal, OperationKey: operationKey, ReversalOfId: penalty.Id,
			OperatorId: operatorId, OperatorUsername: operatorUsername,
			TargetUserId: target.Id, TargetUsername: target.Username,
			SourceType: "penalty", SourceId: strconv.Itoa(penalty.Id), PrincipalQuota: penalty.PrincipalQuota,
			TargetMainDelta: penalty.PrincipalQuota, TargetMainBefore: target.Quota, TargetMainAfter: after, Reason: reason,
			TargetBonusDelta: allocation.Bonus, TargetPaidDelta: allocation.Paid,
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", target.Id).Updates(map[string]interface{}{
			"quota": after, "bonus_quota": gorm.Expr("bonus_quota + ?", allocation.Bonus),
			"paid_quota": gorm.Expr("paid_quota + ?", allocation.Paid),
		}).Error; err != nil {
			return err
		}
		return tx.Create(&reversal).Error
	})
	if err == nil && !alreadyDone {
		_, _ = cacheApplyUserQuotaSourceDelta(reversal.TargetUserId, QuotaAllocation{Bonus: reversal.TargetBonusDelta, Paid: reversal.TargetPaidDelta})
	}
	return reversal, alreadyDone, err
}

func applyFinanceTimeRange(query *gorm.DB, column string, filters FinanceQuery) *gorm.DB {
	if filters.StartTime > 0 {
		query = query.Where(column+" >= ?", filters.StartTime)
	}
	if filters.EndTime > 0 {
		query = query.Where(column+" <= ?", filters.EndTime)
	}
	return query
}

func ListFinanceTopUps(filters FinanceQuery, pageInfo *common.PageInfo) ([]*TopUp, int64, error) {
	query := DB.Model(&TopUp{}).Select("top_ups.*, users.username, users.quota AS user_quota").Joins("LEFT JOIN users ON users.id = top_ups.user_id")
	if filters.UserId > 0 {
		query = query.Where("top_ups.user_id = ?", filters.UserId)
	}
	if filters.Keyword != "" {
		query = query.Where("top_ups.trade_no = ? OR users.username = ?", filters.Keyword, filters.Keyword)
	}
	if filters.Status != "" {
		query = query.Where("top_ups.status = ?", filters.Status)
	}
	if filters.Provider != "" {
		query = query.Where("top_ups.payment_provider = ?", filters.Provider)
	}
	query = applyFinanceTimeRange(query, "top_ups.create_time", filters)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*TopUp
	err := query.Order("top_ups.id DESC").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&items).Error
	if err == nil {
		sourceIds := make([]string, 0, len(items))
		for _, item := range items {
			sourceIds = append(sourceIds, item.TradeNo)
		}
		summaries, summaryErr := financeRebateSummaries(AffiliateRebateSourceTopUp, sourceIds)
		if summaryErr != nil {
			return nil, 0, summaryErr
		}
		for _, item := range items {
			if summary, ok := summaries[item.TradeNo]; ok {
				item.RebateQuota, item.RebateReversedQuota, item.RebateTransferredQuota = summary.RebateQuota, summary.ReversedQuota, summary.TransferredQuota
				item.InviterId, item.InviterUsername, item.InviterQuota, item.InviterAffQuota = summary.InviterId, summary.InviterUsername, summary.InviterQuota, summary.InviterAffQuota
			}
		}
	}
	return items, total, err
}

func ListFinanceRedemptions(filters FinanceQuery, pageInfo *common.PageInfo) ([]*Redemption, int64, error) {
	query := DB.Model(&Redemption{}).Select("redemptions.*, users.username AS used_username, users.quota AS used_user_quota").Joins("LEFT JOIN users ON users.id = redemptions.used_user_id")
	if filters.UserId > 0 {
		query = query.Where("redemptions.used_user_id = ?", filters.UserId)
	}
	if filters.Keyword != "" {
		keyColumn := "`key`"
		if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
			keyColumn = `"key"`
		}
		if id, err := strconv.Atoi(filters.Keyword); err == nil {
			query = query.Where("redemptions.id = ? OR redemptions.name = ? OR redemptions."+keyColumn+" = ? OR users.username = ?", id, filters.Keyword, filters.Keyword, filters.Keyword)
		} else {
			query = query.Where("redemptions.name = ? OR redemptions."+keyColumn+" = ? OR users.username = ?", filters.Keyword, filters.Keyword, filters.Keyword)
		}
	}
	if filters.SourceType == RedemptionTypePaid || filters.SourceType == RedemptionTypeReward {
		query = query.Where("redemptions.type = ?", filters.SourceType)
	}
	if filters.Status != "" {
		status := filters.Status
		if status == "used" {
			status = strconv.Itoa(common.RedemptionCodeStatusUsed)
		}
		if status == "refunded" {
			status = strconv.Itoa(common.RedemptionCodeStatusRefunded)
		}
		if parsed, parseErr := strconv.Atoi(status); parseErr == nil {
			query = query.Where("redemptions.status = ?", parsed)
		}
	}
	query = applyFinanceTimeRange(query, "redemptions.redeemed_time", filters)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*Redemption
	err := query.Order("redemptions.id DESC").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&items).Error
	if err == nil {
		sourceIds := make([]string, 0, len(items))
		for _, item := range items {
			sourceIds = append(sourceIds, strconv.Itoa(item.Id))
		}
		summaries, summaryErr := financeRebateSummaries(AffiliateRebateSourceRedemption, sourceIds)
		if summaryErr != nil {
			return nil, 0, summaryErr
		}
		for _, item := range items {
			if summary, ok := summaries[strconv.Itoa(item.Id)]; ok {
				item.RebateQuota, item.RebateReversedQuota, item.RebateTransferredQuota = summary.RebateQuota, summary.ReversedQuota, summary.TransferredQuota
				item.InviterId, item.InviterUsername, item.InviterQuota, item.InviterAffQuota = summary.InviterId, summary.InviterUsername, summary.InviterQuota, summary.InviterAffQuota
			}
		}
	}
	return items, total, err
}

func ListFinanceRebates(filters FinanceQuery, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	query := DB.Model(&AffiliateRebate{}).
		Select("affiliate_rebates.*, inviter.username AS inviter_username, invitee.username AS invitee_username, inviter.quota AS inviter_quota, inviter.aff_quota AS inviter_aff_quota, invitee.quota AS invitee_quota").
		Joins("LEFT JOIN users AS inviter ON inviter.id = affiliate_rebates.inviter_id").
		Joins("LEFT JOIN users AS invitee ON invitee.id = affiliate_rebates.invitee_id")
	if filters.InviterId > 0 {
		query = query.Where("affiliate_rebates.inviter_id = ?", filters.InviterId)
	}
	if filters.InviteeId > 0 {
		query = query.Where("affiliate_rebates.invitee_id = ?", filters.InviteeId)
	}
	if filters.Keyword != "" {
		query = query.Where("affiliate_rebates.source_id = ? OR inviter.username = ? OR invitee.username = ?", filters.Keyword, filters.Keyword, filters.Keyword)
	}
	if filters.SourceType != "" {
		query = query.Where("affiliate_rebates.source_type = ?", filters.SourceType)
	}
	if filters.Status != "" {
		query = query.Where("affiliate_rebates.status = ?", filters.Status)
	}
	query = applyFinanceTimeRange(query, "affiliate_rebates.created_at", filters)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*AffiliateRebate
	err := query.Order("affiliate_rebates.id DESC").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&items).Error
	return items, total, err
}

func ListFinancialOperations(filters FinanceQuery, pageInfo *common.PageInfo) ([]*FinancialOperation, int64, error) {
	query := DB.Model(&FinancialOperation{})
	if filters.UserId > 0 {
		query = query.Where("target_user_id = ?", filters.UserId)
	}
	if filters.InviterId > 0 {
		query = query.Where("related_user_id = ?", filters.InviterId)
	}
	if filters.OperatorId > 0 {
		query = query.Where("operator_id = ?", filters.OperatorId)
	}
	if filters.Keyword != "" {
		query = query.Where("source_id = ? OR operation_key = ? OR operator_username = ? OR target_username = ?", filters.Keyword, filters.Keyword, filters.Keyword, filters.Keyword)
	}
	if filters.SourceType != "" {
		query = query.Where("source_type = ?", filters.SourceType)
	}
	if filters.OperationType != "" {
		query = query.Where("operation_type = ?", filters.OperationType)
	}
	query = applyFinanceTimeRange(query, "created_at", filters)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*FinancialOperation
	err := query.Order("id DESC").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&items).Error
	return items, total, err
}
