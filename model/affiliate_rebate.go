package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateRebateSourceSignup     = "signup"
	AffiliateRebateSourceTopUp      = "topup"
	AffiliateRebateSourceRedemption = "redemption"

	AffiliateRebateStatusSettled  = "settled"
	AffiliateRebateStatusReversed = "reversed"
)

// AffiliateRebate is the immutable source record for one affiliate credit.
// Reversal and transfer columns track the current accounting position without
// changing the original rate or amount snapshot.
type AffiliateRebate struct {
	Id               int    `json:"id"`
	InviterId        int    `json:"inviter_id" gorm:"index"`
	InviteeId        int    `json:"invitee_id" gorm:"index"`
	SourceType       string `json:"source_type" gorm:"type:varchar(32);index"`
	SourceId         string `json:"source_id" gorm:"type:varchar(255)"`
	SourceKey        string `json:"source_key" gorm:"type:varchar(255);uniqueIndex"`
	BaseQuota        int    `json:"base_quota" gorm:"type:bigint"`
	Rate             int    `json:"rate"`
	RebateQuota      int    `json:"rebate_quota" gorm:"type:bigint"`
	ReversedQuota    int    `json:"reversed_quota" gorm:"type:bigint"`
	TransferredQuota int    `json:"transferred_quota" gorm:"type:bigint"`
	Status           string `json:"status" gorm:"type:varchar(32);index"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	SettledAt        int64  `json:"settled_at" gorm:"bigint"`
	ReversedAt       int64  `json:"reversed_at" gorm:"bigint"`
	ReverseReason    string `json:"reverse_reason" gorm:"type:varchar(255)"`
	InviterUsername  string `json:"inviter_username,omitempty" gorm:"->;-:migration"`
	InviteeUsername  string `json:"invitee_username,omitempty" gorm:"->;-:migration"`
}

var (
	ErrAffiliateRateInvalid     = errors.New("affiliate rebate rate must be between 0 and 10000")
	ErrAffiliateSourceInvalid   = errors.New("invalid affiliate rebate source")
	ErrAffiliateRebateNotFound  = errors.New("affiliate rebate not found")
	ErrAffiliateAlreadyReversed = errors.New("affiliate rebate already reversed")
	ErrTopUpNotRefundable       = errors.New("top-up is not refundable")
)

func affiliateSourceAllowed(sourceType string) bool {
	switch sourceType {
	case AffiliateRebateSourceSignup, AffiliateRebateSourceTopUp, AffiliateRebateSourceRedemption:
		return true
	default:
		return false
	}
}

func affiliateRebateAmount(baseQuota int, rate int) (int, error) {
	if rate < 0 || rate > 10000 {
		return 0, ErrAffiliateRateInvalid
	}
	if baseQuota < 0 || baseQuota > common.MaxWalletQuota {
		return 0, ErrInvalidTopUpQuota
	}
	amount := decimal.NewFromInt(int64(baseQuota)).
		Mul(decimal.NewFromInt(int64(rate))).
		Div(decimal.NewFromInt(10000))
	return common.WalletQuotaFromDecimalStrict(amount)
}

// createAffiliateRebateTx records and settles a rebate exactly once. The
// unique source key protects against duplicate callbacks and repeated hooks.
func createAffiliateRebateTx(tx *gorm.DB, inviterId int, inviteeId int, sourceType string, sourceId string, baseQuota int, rate int) (*AffiliateRebate, bool, error) {
	if tx == nil || inviterId <= 0 || inviteeId <= 0 || strings.TrimSpace(sourceId) == "" {
		return nil, false, ErrAffiliateSourceInvalid
	}
	if !affiliateSourceAllowed(sourceType) {
		return nil, false, ErrAffiliateSourceInvalid
	}
	rebateQuota, err := affiliateRebateAmount(baseQuota, rate)
	if err != nil {
		return nil, false, err
	}
	inviter := &User{}
	if err := lockForUpdate(tx).Unscoped().Select("id").Where("id = ?", inviterId).First(inviter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// A hard-deleted inviter has no account to credit, but a soft-deleted
			// inviter remains part of the permanent referral relationship.
			return nil, false, nil
		}
		return nil, false, err
	}
	sourceKey := fmt.Sprintf("%s:%s", sourceType, sourceId)
	rebate := &AffiliateRebate{
		InviterId:   inviterId,
		InviteeId:   inviteeId,
		SourceType:  sourceType,
		SourceId:    sourceId,
		SourceKey:   sourceKey,
		BaseQuota:   baseQuota,
		Rate:        rate,
		RebateQuota: rebateQuota,
		Status:      AffiliateRebateStatusSettled,
		SettledAt:   common.GetTimestamp(),
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source_key"}},
		DoNothing: true,
	}).Create(rebate)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 0 {
		existing := &AffiliateRebate{}
		if err := tx.Where("source_key = ?", sourceKey).First(existing).Error; err != nil {
			return nil, false, err
		}
		return existing, false, nil
	}

	if rebateQuota > 0 {
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", inviterId).Updates(map[string]interface{}{
			"aff_quota":   gorm.Expr("aff_quota + ?", rebateQuota),
			"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
		}).Error; err != nil {
			return nil, false, err
		}
	}
	return rebate, true, nil
}

func recordSignupAffiliateRebate(inviterId int, inviteeId int) error {
	if common.QuotaForInviter <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		rebate, created, err := createAffiliateRebateTx(
			tx,
			inviterId,
			inviteeId,
			AffiliateRebateSourceSignup,
			fmt.Sprintf("%d", inviteeId),
			common.QuotaForInviter,
			10000,
		)
		if err != nil {
			return err
		}
		if created && rebate.RebateQuota > 0 {
			return tx.Model(&User{}).Where("id = ?", inviterId).Update("aff_count", gorm.Expr("aff_count + ?", 1)).Error
		}
		return nil
	})
}

func recordAffiliateRebateForTopUpTx(tx *gorm.DB, topUp *TopUp) error {
	if topUp == nil || topUp.Status != common.TopUpStatusSuccess || topUp.Source != TopUpSourceTopup || topUp.CreditedQuota <= 0 {
		return nil
	}
	var invitee User
	if err := tx.Select("id, inviter_id").Where("id = ?", topUp.UserId).First(&invitee).Error; err != nil {
		return err
	}
	if invitee.InviterId <= 0 {
		return nil
	}
	_, _, err := createAffiliateRebateTx(
		tx,
		invitee.InviterId,
		invitee.Id,
		AffiliateRebateSourceTopUp,
		topUp.TradeNo,
		topUp.CreditedQuota,
		common.AffiliateTopupRebateRate,
	)
	return err
}

func recordAffiliateRebateForRedemptionTx(tx *gorm.DB, redemption *Redemption, userId int) error {
	if redemption == nil || redemption.Type != RedemptionTypePaid {
		return nil
	}
	var invitee User
	if err := tx.Select("id, inviter_id").Where("id = ?", userId).First(&invitee).Error; err != nil {
		return err
	}
	if invitee.InviterId <= 0 {
		return nil
	}
	_, _, err := createAffiliateRebateTx(
		tx,
		invitee.InviterId,
		invitee.Id,
		AffiliateRebateSourceRedemption,
		fmt.Sprintf("%d", redemption.Id),
		redemption.Quota,
		common.AffiliateRedemptionRebateRate,
	)
	return err
}

func listAffiliateRebates(userId int, sourceType string, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	query := DB.Model(&AffiliateRebate{}).
		Select("affiliate_rebates.*, inviter.username AS inviter_username, invitee.username AS invitee_username").
		Joins("LEFT JOIN users AS inviter ON inviter.id = affiliate_rebates.inviter_id").
		Joins("LEFT JOIN users AS invitee ON invitee.id = affiliate_rebates.invitee_id")
	if userId > 0 {
		query = query.Where("affiliate_rebates.inviter_id = ?", userId)
	}
	if sourceType != "" {
		if !affiliateSourceAllowed(sourceType) {
			return nil, 0, ErrAffiliateSourceInvalid
		}
		query = query.Where("affiliate_rebates.source_type = ?", sourceType)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rebates []*AffiliateRebate
	err := query.Order("affiliate_rebates.id DESC").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&rebates).Error
	return rebates, total, err
}

func GetUserAffiliateRebates(userId int, sourceType string, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	return listAffiliateRebates(userId, sourceType, pageInfo)
}

func GetAllAffiliateRebates(sourceType string, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	return listAffiliateRebates(0, sourceType, pageInfo)
}

func reverseAffiliateRebateTx(tx *gorm.DB, rebate *AffiliateRebate, reason string) error {
	if rebate == nil {
		return ErrAffiliateRebateNotFound
	}
	// Transfers lock the inviter before updating rebate provenance. Keep the
	// same order here so a concurrent transfer and reversal cannot deadlock.
	inviter := &User{}
	if err := lockForUpdate(tx).Unscoped().Where("id = ?", rebate.InviterId).First(inviter).Error; err != nil {
		return err
	}
	lockedRebate := &AffiliateRebate{}
	if err := lockForUpdate(tx).Where("id = ?", rebate.Id).First(lockedRebate).Error; err != nil {
		return err
	}
	rebate = lockedRebate
	remaining := rebate.RebateQuota - rebate.ReversedQuota
	if remaining <= 0 {
		return ErrAffiliateAlreadyReversed
	}
	transferred := rebate.TransferredQuota
	if transferred < 0 {
		transferred = 0
	}
	if transferred > remaining {
		transferred = remaining
	}
	affiliateAmount := remaining - transferred
	if err := tx.Unscoped().Model(&User{}).Where("id = ?", rebate.InviterId).Updates(map[string]interface{}{
		"quota":              gorm.Expr("quota - ?", transferred),
		"aff_quota":          gorm.Expr("aff_quota - ?", affiliateAmount),
		"aff_reversed_quota": gorm.Expr("aff_reversed_quota + ?", remaining),
	}).Error; err != nil {
		return err
	}
	rebate.ReversedQuota += remaining
	rebate.Status = AffiliateRebateStatusReversed
	rebate.ReversedAt = common.GetTimestamp()
	rebate.ReverseReason = reason
	return tx.Save(rebate).Error
}

func reverseAffiliateRebateBySourceTx(tx *gorm.DB, sourceType string, sourceId string, reason string) (bool, error) {
	var rebate AffiliateRebate
	if err := tx.Where("source_key = ?", sourceType+":"+sourceId).First(&rebate).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if rebate.Status == AffiliateRebateStatusReversed || rebate.ReversedQuota >= rebate.RebateQuota {
		return true, nil
	}
	return true, reverseAffiliateRebateTx(tx, &rebate, reason)
}

func ReverseAffiliateRebate(id int, reason string) error {
	if id <= 0 {
		return ErrAffiliateRebateNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var rebate AffiliateRebate
		if err := tx.Where("id = ?", id).First(&rebate).Error; err != nil {
			return ErrAffiliateRebateNotFound
		}
		if rebate.SourceType != AffiliateRebateSourceRedemption {
			return ErrAffiliateSourceInvalid
		}
		if rebate.Status == AffiliateRebateStatusReversed || rebate.ReversedQuota >= rebate.RebateQuota {
			return nil
		}
		return reverseAffiliateRebateTx(tx, &rebate, reason)
	})
}

// RefundTopUp performs the local full-refund accounting for a direct top-up.
// It deliberately does not call an external payment provider.
func RefundTopUp(tradeNo string, reason string) (alreadyRefunded bool, err error) {
	tradeNo = strings.TrimSpace(tradeNo)
	if tradeNo == "" {
		return false, ErrTopUpNotFound
	}
	var userId int
	var creditedQuota int
	var inviterId int
	var inviterMainDebit int
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

		result := tx.Unscoped().Model(&User{}).Where("id = ?", topUp.UserId).Update("quota", gorm.Expr("quota - ?", topUp.CreditedQuota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		var rebate AffiliateRebate
		rebateFound := false
		if err := tx.Where("source_key = ?", AffiliateRebateSourceTopUp+":"+topUp.TradeNo).First(&rebate).Error; err == nil {
			rebateFound = true
			inviterId = rebate.InviterId
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if _, err := reverseAffiliateRebateBySourceTx(tx, AffiliateRebateSourceTopUp, topUp.TradeNo, reason); err != nil {
			return err
		}
		if rebateFound {
			var reversedRebate AffiliateRebate
			if err := tx.Where("id = ?", rebate.Id).First(&reversedRebate).Error; err != nil {
				return err
			}
			inviterMainDebit = reversedRebate.TransferredQuota
			if inviterMainDebit < 0 {
				inviterMainDebit = 0
			}
		}

		topUp.Status = common.TopUpStatusRefunded
		topUp.RefundedAt = common.GetTimestamp()
		topUp.RefundReason = strings.TrimSpace(reason)
		if err := tx.Save(&topUp).Error; err != nil {
			return err
		}
		userId = topUp.UserId
		creditedQuota = topUp.CreditedQuota
		return nil
	})
	if err != nil || alreadyRefunded {
		return alreadyRefunded, err
	}
	if creditedQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(creditedQuota)); err != nil {
			common.SysLog("failed to sync refunded top-up quota: " + err.Error())
		}
	}
	if inviterId > 0 && inviterMainDebit > 0 {
		if err := cacheDecrUserQuota(inviterId, int64(inviterMainDebit)); err != nil {
			common.SysLog("failed to sync refunded affiliate quota: " + err.Error())
		}
	}
	return false, nil
}
