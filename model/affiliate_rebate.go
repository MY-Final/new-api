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
	DebtOffsetQuota  int    `json:"debt_offset_quota" gorm:"type:bigint"`
	Status           string `json:"status" gorm:"type:varchar(32);index"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	SettledAt        int64  `json:"settled_at" gorm:"bigint"`
	ReversedAt       int64  `json:"reversed_at" gorm:"bigint"`
	ReverseReason    string `json:"reverse_reason" gorm:"type:varchar(255)"`
	ReversedBy       int    `json:"reversed_by" gorm:"index"`
	InviterUsername  string `json:"inviter_username,omitempty" gorm:"->;-:migration"`
	InviteeUsername  string `json:"invitee_username,omitempty" gorm:"->;-:migration"`
	InviterQuota     int    `json:"inviter_quota,omitempty" gorm:"->;-:migration"`
	InviterAffQuota  int    `json:"inviter_aff_quota,omitempty" gorm:"->;-:migration"`
	InviteeQuota     int    `json:"invitee_quota,omitempty" gorm:"->;-:migration"`
}

// AffiliateInvitee is the user-facing summary for one direct invitee.
type AffiliateInvitee struct {
	Id            int    `json:"id"`
	Username      string `json:"username"`
	Email         string `json:"email"`
	CreatedAt     int64  `json:"created_at"`
	RebateQuota   int    `json:"rebate_quota"`
	ReversedQuota int    `json:"reversed_quota"`
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
	if err := lockForUpdate(tx).Unscoped().Select("id, quota").Where("id = ?", inviterId).First(inviter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// A hard-deleted inviter has no account to credit, but a soft-deleted
			// inviter remains part of the permanent referral relationship.
			return nil, false, nil
		}
		return nil, false, err
	}
	debtOffsetQuota := 0
	if inviter.Quota < 0 && rebateQuota > 0 {
		debt := -int64(inviter.Quota)
		if debt > int64(rebateQuota) {
			debt = int64(rebateQuota)
		}
		debtOffsetQuota = int(debt)
	}
	sourceKey := fmt.Sprintf("%s:%s", sourceType, sourceId)
	rebate := &AffiliateRebate{
		InviterId:       inviterId,
		InviteeId:       inviteeId,
		SourceType:      sourceType,
		SourceId:        sourceId,
		SourceKey:       sourceKey,
		BaseQuota:       baseQuota,
		Rate:            rate,
		RebateQuota:     rebateQuota,
		DebtOffsetQuota: debtOffsetQuota,
		Status:          AffiliateRebateStatusSettled,
		SettledAt:       common.GetTimestamp(),
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
		updates := map[string]interface{}{
			"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
		}
		if debtOffsetQuota > 0 {
			updates["quota"] = gorm.Expr("quota + ?", debtOffsetQuota)
		}
		if availableQuota := rebateQuota - debtOffsetQuota; availableQuota > 0 {
			updates["aff_quota"] = gorm.Expr("aff_quota + ?", availableQuota)
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", inviterId).Updates(updates).Error; err != nil {
			return nil, false, err
		}
	}
	return rebate, true, nil
}

func recordSignupAffiliateRebate(inviterId int, inviteeId int) error {
	if common.QuotaForInviter <= 0 {
		return nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
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
	if err != nil {
		return err
	}
	invalidateAffiliateRebateUserCache(AffiliateRebateSourceSignup, fmt.Sprintf("%d", inviteeId), "signup rebate")
	return nil
}

// invalidateAffiliateRebateUserCache runs after the source transaction has
// committed, so a cached balance cannot hide a debt offset applied in that
// transaction.
func invalidateAffiliateRebateUserCache(sourceType string, sourceId string, operation string) {
	if !common.RedisEnabled || sourceId == "" {
		return
	}
	var rebate AffiliateRebate
	if err := DB.Select("inviter_id, debt_offset_quota").Where("source_key = ?", fmt.Sprintf("%s:%s", sourceType, sourceId)).First(&rebate).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysLog(fmt.Sprintf("failed to load %s affiliate rebate cache state: %s", operation, err.Error()))
		}
		return
	}
	if rebate.DebtOffsetQuota <= 0 {
		return
	}
	if err := invalidateUserCache(rebate.InviterId); err != nil {
		common.SysLog(fmt.Sprintf("failed to invalidate %s inviter cache: %s", operation, err.Error()))
	}
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

func GetUserAffiliateRebatesFiltered(userId int, filters FinanceQuery, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	filters.InviterId = userId
	return ListFinanceRebates(filters, pageInfo)
}

func GetUserAffiliateInviteeCount(userId int) (int64, error) {
	var total int64
	if err := DB.Model(&User{}).Where("inviter_id = ?", userId).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func GetUserAffiliateInvitees(userId int, pageInfo *common.PageInfo) ([]*AffiliateInvitee, int64, error) {
	query := DB.Model(&User{}).
		Select("id, username, email, created_at").
		Where("inviter_id = ?", userId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var users []User
	if err := query.Order("created_at DESC, id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&users).Error; err != nil {
		return nil, 0, err
	}

	invitees := make([]*AffiliateInvitee, 0, len(users))
	inviteeById := make(map[int]*AffiliateInvitee, len(users))
	ids := make([]int, 0, len(users))
	for i := range users {
		invitee := &AffiliateInvitee{
			Id:        users[i].Id,
			Username:  users[i].Username,
			Email:     common.MaskEmail(users[i].Email),
			CreatedAt: users[i].CreatedAt,
		}
		invitees = append(invitees, invitee)
		inviteeById[invitee.Id] = invitee
		ids = append(ids, invitee.Id)
	}
	if len(ids) == 0 {
		return invitees, total, nil
	}

	var rebates []AffiliateRebate
	if err := DB.Select("invitee_id, rebate_quota, reversed_quota").
		Where("inviter_id = ? AND invitee_id IN ?", userId, ids).
		Find(&rebates).Error; err != nil {
		return nil, 0, err
	}
	for _, rebate := range rebates {
		if invitee, ok := inviteeById[rebate.InviteeId]; ok {
			invitee.RebateQuota += rebate.RebateQuota
			invitee.ReversedQuota += rebate.ReversedQuota
		}
	}
	return invitees, total, nil
}

func GetAllAffiliateRebates(sourceType string, pageInfo *common.PageInfo) ([]*AffiliateRebate, int64, error) {
	return listAffiliateRebates(0, sourceType, pageInfo)
}

func ReverseAffiliateRebate(id int, reason string) error {
	_, err := ReverseAffiliateRebateByAdmin(id, reason, 0)
	return err
}

// RefundTopUp performs the local full-refund accounting for a direct top-up.
// It deliberately does not call an external payment provider.
func RefundTopUp(tradeNo string, reason string) (alreadyRefunded bool, err error) {
	return RefundTopUpByAdmin(tradeNo, reason, 0)
}
