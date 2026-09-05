package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func createAffiliateUsers(t *testing.T) (*User, *User) {
	t.Helper()
	inviter := &User{Username: "affiliate-inviter", AffCode: "affiliate-inviter-code", Status: common.UserStatusEnabled}
	invitee := &User{Username: "affiliate-invitee", AffCode: "affiliate-invitee-code", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(inviter).Error)
	invitee.InviterId = inviter.Id
	require.NoError(t, DB.Create(invitee).Error)
	return inviter, invitee
}

func TestSignupAffiliateRebateIsIdempotent(t *testing.T) {
	truncateTables(t)
	originalRate := common.QuotaForInviter
	common.QuotaForInviter = 500
	t.Cleanup(func() { common.QuotaForInviter = originalRate })
	inviter, invitee := createAffiliateUsers(t)

	require.NoError(t, recordSignupAffiliateRebate(inviter.Id, invitee.Id))
	require.NoError(t, recordSignupAffiliateRebate(inviter.Id, invitee.Id))

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", fmt.Sprintf("signup:%d", invitee.Id)).First(&rebate).Error)
	assert.Equal(t, 500, rebate.RebateQuota)
	assert.Equal(t, int64(1), countAffiliateRebates(t))

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, 1, got.AffCount)
	assert.Equal(t, 500, got.AffQuota)
	assert.Equal(t, 500, got.AffHistoryQuota)
}

func TestInviterRelationshipIsImmutable(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	other := &User{Username: "affiliate-other", AffCode: "affiliate-other-code", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(other).Error)

	invitee.InviterId = other.Id
	invitee.DisplayName = "updated-profile"
	require.NoError(t, invitee.Update(false))

	var got User
	require.NoError(t, DB.First(&got, invitee.Id).Error)
	assert.Equal(t, inviter.Id, got.InviterId)
	assert.Equal(t, "updated-profile", got.DisplayName)
}

func TestTopUpAffiliateRebateUsesRateSnapshotAndIsIdempotent(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	topUp := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-topup-once",
		Source:        TopUpSourceTopup,
		CreditedQuota: 1000,
		Status:        common.TopUpStatusSuccess,
	}
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })

	record := func() {
		require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
			return recordAffiliateRebateForTopUpTx(tx, topUp)
		}))
	}
	record()
	common.AffiliateTopupRebateRate = 5000
	record()

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", "topup:affiliate-topup-once").First(&rebate).Error)
	assert.Equal(t, 100, rebate.RebateQuota)
	assert.Equal(t, 1000, rebate.Rate)
	assert.Equal(t, int64(1), countAffiliateRebates(t))

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, 100, got.AffQuota)
	assert.Equal(t, 100, got.AffHistoryQuota)
}

func TestTopUpAffiliateRebateRequiresSuccessfulOrder(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	topUp := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-topup-pending",
		Source:        TopUpSourceTopup,
		CreditedQuota: 1000,
		Status:        common.TopUpStatusPending,
	}
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topUp)
	}))
	assert.Equal(t, int64(0), countAffiliateRebates(t))

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Zero(t, got.AffQuota)
}

func TestHistoricalTopUpWithoutSourceIsNotRebatedOrRefundable(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	topUp := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-historical-topup",
		CreditedQuota: 1000,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("quota", topUp.CreditedQuota).Error)

	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topUp)
	}))
	assert.Equal(t, int64(0), countAffiliateRebates(t))

	_, err := RefundTopUp(topUp.TradeNo, "historical order")
	assert.ErrorIs(t, err, ErrTopUpNotRefundable)

	var gotTopUp TopUp
	var gotInvitee, gotInviter User
	require.NoError(t, DB.First(&gotTopUp, topUp.Id).Error)
	require.NoError(t, DB.First(&gotInvitee, invitee.Id).Error)
	require.NoError(t, DB.First(&gotInviter, inviter.Id).Error)
	assert.Equal(t, common.TopUpStatusSuccess, gotTopUp.Status)
	assert.Equal(t, topUp.CreditedQuota, gotInvitee.Quota)
	assert.Zero(t, gotInviter.AffQuota)
}

func TestEpayCompletionCreatesOneAffiliateRebate(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	topup := &TopUp{
		UserId:          invitee.Id,
		Amount:          2,
		Money:           10,
		TradeNo:         "affiliate-epay-once",
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, DB.Create(topup).Error)
	originalQuotaPerUnit := common.QuotaPerUnit
	originalRate := common.AffiliateTopupRebateRate
	common.QuotaPerUnit = 500000
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		common.AffiliateTopupRebateRate = originalRate
	})

	alreadyDone, err := RechargeEpay(topup.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	alreadyDone, err = RechargeEpay(topup.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", "topup:affiliate-epay-once").First(&rebate).Error)
	assert.Equal(t, 1000000, rebate.BaseQuota)
	assert.Equal(t, 100000, rebate.RebateQuota)
	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, 100000, got.AffQuota)
}

func TestAffiliateRebateAmountValidatesRateAndQuotaBounds(t *testing.T) {
	amount, err := affiliateRebateAmount(1000, 0)
	require.NoError(t, err)
	assert.Zero(t, amount)

	amount, err = affiliateRebateAmount(common.MaxWalletQuota, 10000)
	require.NoError(t, err)
	assert.Equal(t, common.MaxWalletQuota, amount)

	_, err = affiliateRebateAmount(1000, 10001)
	assert.ErrorIs(t, err, ErrAffiliateRateInvalid)

	_, err = affiliateRebateAmount(common.MaxWalletQuota+1, 10000)
	assert.ErrorIs(t, err, ErrInvalidTopUpQuota)
}

func TestAffiliateRebateRateOptionValidation(t *testing.T) {
	for _, rate := range []string{"0", "10000"} {
		require.NoError(t, validateOptionValue("AffiliateTopupRebateRate", rate))
	}
	for _, rate := range []string{"-1", "10001", "invalid"} {
		assert.ErrorIs(t, validateOptionValue("AffiliateTopupRebateRate", rate), ErrAffiliateRateInvalid)
	}
}

func TestPaidRedemptionRebatesButRewardCodeDoesNot(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 1000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })

	paid := &Redemption{Name: "paid", Key: "affiliate-paid-code", Status: common.RedemptionCodeStatusEnabled, Quota: 1000, Type: RedemptionTypePaid}
	reward := &Redemption{Name: "reward", Key: "affiliate-reward-code", Status: common.RedemptionCodeStatusEnabled, Quota: 2000, Type: RedemptionTypeReward}
	require.NoError(t, DB.Create(paid).Error)
	require.NoError(t, DB.Create(reward).Error)

	_, err := Redeem(paid.Key, invitee.Id)
	require.NoError(t, err)
	_, err = Redeem(paid.Key, invitee.Id)
	require.Error(t, err)
	_, err = Redeem(reward.Key, invitee.Id)
	require.NoError(t, err)

	assert.Equal(t, int64(1), countAffiliateRebates(t))
	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, 100, got.AffQuota)
}

func TestAffiliateRebateListingIncludesUsernames(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	topup := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-listing",
		Source:        TopUpSourceTopup,
		CreditedQuota: 1000,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topup)
	}))

	rebates, total, err := GetAllAffiliateRebates("", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	if assert.Equal(t, int64(1), total) && assert.Len(t, rebates, 1) {
		assert.Equal(t, inviter.Username, rebates[0].InviterUsername)
		assert.Equal(t, invitee.Username, rebates[0].InviteeUsername)
	}
}

func TestAffiliateInviteeListingAggregatesRebatesAndKeepsUsersWithoutRebates(t *testing.T) {
	truncateTables(t)
	inviter, firstInvitee := createAffiliateUsers(t)
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })
	firstInvitee.Email = "first@example.com"
	require.NoError(t, firstInvitee.Update(false))
	secondInvitee := &User{
		Username:  "affiliate-second-invitee",
		Email:     "second@example.com",
		InviterId: inviter.Id,
		Status:    common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(secondInvitee).Error)

	topup := &TopUp{
		UserId:        firstInvitee.Id,
		TradeNo:       "affiliate-invitee-summary",
		Source:        TopUpSourceTopup,
		CreditedQuota: 1000,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topup)
	}))

	invitees, total, err := GetUserAffiliateInvitees(inviter.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, invitees, 2)

	byUsername := make(map[string]*AffiliateInvitee, len(invitees))
	for _, invitee := range invitees {
		byUsername[invitee.Username] = invitee
	}
	assert.Equal(t, "***@example.com", byUsername[firstInvitee.Username].Email)
	assert.Equal(t, 100, byUsername[firstInvitee.Username].RebateQuota)
	assert.Zero(t, byUsername[secondInvitee.Username].RebateQuota)
}

func TestPaidRedemptionRebateCanBeReversedIdempotently(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 1000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })

	redemption := &Redemption{
		Name:   "reversible-paid-code",
		Key:    "affiliate-reversible-paid-code",
		Status: common.RedemptionCodeStatusEnabled,
		Quota:  1000,
		Type:   RedemptionTypePaid,
	}
	require.NoError(t, DB.Create(redemption).Error)
	_, err := Redeem(redemption.Key, invitee.Id)
	require.NoError(t, err)

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", fmt.Sprintf("redemption:%d", redemption.Id)).First(&rebate).Error)
	require.NoError(t, ReverseAffiliateRebate(rebate.Id, "store refund"))
	require.NoError(t, ReverseAffiliateRebate(rebate.Id, "duplicate store refund"))

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Zero(t, got.AffQuota)
	assert.Equal(t, rebate.RebateQuota, got.AffReversedQuota)
	require.NoError(t, DB.First(&rebate, rebate.Id).Error)
	assert.Equal(t, AffiliateRebateStatusReversed, rebate.Status)
	assert.Equal(t, rebate.RebateQuota, rebate.ReversedQuota)
}

func TestRedemptionInsertDefaultsToRewardCode(t *testing.T) {
	truncateTables(t)
	redemption := &Redemption{
		Name:   "default-reward-code",
		Key:    "affiliate-default-reward-code",
		Status: common.RedemptionCodeStatusEnabled,
		Quota:  1000,
	}
	require.NoError(t, redemption.Insert())
	assert.Equal(t, RedemptionTypeReward, redemption.Type)

	directCreate := &Redemption{
		Name:   "direct-reward-code",
		Key:    "affiliate-direct-reward-code",
		Status: common.RedemptionCodeStatusEnabled,
		Quota:  1000,
	}
	require.NoError(t, DB.Create(directCreate).Error)
	assert.Equal(t, RedemptionTypeReward, directCreate.Type)
}

func TestSubscriptionTopUpDoesNotCreateAffiliateRebate(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 10000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })

	topup := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-subscription",
		Source:        TopUpSourceSubscription,
		CreditedQuota: 1000,
	}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topup)
	}))

	assert.Equal(t, int64(0), countAffiliateRebates(t))
	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Zero(t, got.AffQuota)
}

func TestRefundTopUpReversesTransferredRebateExactlyOnce(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	const creditedQuota = 10000000
	topUp := &TopUp{
		UserId:        invitee.Id,
		Amount:        20,
		TradeNo:       "affiliate-refund-once",
		Source:        TopUpSourceTopup,
		CreditedQuota: creditedQuota,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("quota", creditedQuota).Error)
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topUp)
	}))

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", "topup:affiliate-refund-once").First(&rebate).Error)
	var loadedInviter User
	require.NoError(t, DB.First(&loadedInviter, inviter.Id).Error)
	require.NoError(t, loadedInviter.TransferAffQuotaToQuota(rebate.RebateQuota))

	alreadyRefunded, err := RefundTopUp(topUp.TradeNo, "provider refund")
	require.NoError(t, err)
	assert.False(t, alreadyRefunded)
	alreadyRefunded, err = RefundTopUp(topUp.TradeNo, "duplicate refund")
	require.NoError(t, err)
	assert.True(t, alreadyRefunded)

	var gotInvitee, gotInviter User
	require.NoError(t, DB.First(&gotInvitee, invitee.Id).Error)
	require.NoError(t, DB.First(&gotInviter, inviter.Id).Error)
	assert.Equal(t, 0, gotInvitee.Quota)
	assert.Equal(t, 0, gotInviter.Quota)
	assert.Equal(t, 0, gotInviter.AffQuota)
	assert.Equal(t, rebate.RebateQuota, gotInviter.AffReversedQuota)

	require.NoError(t, DB.First(&rebate, rebate.Id).Error)
	assert.Equal(t, AffiliateRebateStatusReversed, rebate.Status)
	assert.Equal(t, rebate.RebateQuota, rebate.ReversedQuota)
	assert.Equal(t, rebate.RebateQuota, rebate.TransferredQuota)
	var gotTopUp TopUp
	require.NoError(t, DB.First(&gotTopUp, topUp.Id).Error)
	assert.Equal(t, common.TopUpStatusRefunded, gotTopUp.Status)
}

func TestRefundTopUpAllowsNegativeBalanceWhenRebateWasSpent(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	const creditedQuota = 10000000
	topUp := &TopUp{
		UserId:        invitee.Id,
		Amount:        20,
		TradeNo:       "affiliate-refund-negative",
		Source:        TopUpSourceTopup,
		CreditedQuota: creditedQuota,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("quota", creditedQuota).Error)
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topUp)
	}))

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", "topup:affiliate-refund-negative").First(&rebate).Error)
	var loadedInviter User
	require.NoError(t, DB.First(&loadedInviter, inviter.Id).Error)
	require.NoError(t, loadedInviter.TransferAffQuotaToQuota(rebate.RebateQuota))
	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Update("quota", 0).Error)

	alreadyRefunded, err := RefundTopUp(topUp.TradeNo, "provider refund")
	require.NoError(t, err)
	assert.False(t, alreadyRefunded)

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, -rebate.RebateQuota, got.Quota)
	assert.Zero(t, got.AffQuota)
}

func TestRefundTopUpDoesNotDebitMainQuotaForLegacyAffiliateTransfer(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	const creditedQuota = 10000000
	topUp := &TopUp{
		UserId:        invitee.Id,
		TradeNo:       "affiliate-refund-legacy-transfer",
		Source:        TopUpSourceTopup,
		CreditedQuota: creditedQuota,
		Status:        common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("quota", creditedQuota).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Updates(map[string]interface{}{
		"aff_quota":   1000000,
		"aff_history": 1000000,
	}).Error)
	originalRate := common.AffiliateTopupRebateRate
	common.AffiliateTopupRebateRate = 1000
	t.Cleanup(func() { common.AffiliateTopupRebateRate = originalRate })
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForTopUpTx(tx, topUp)
	}))

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", "topup:affiliate-refund-legacy-transfer").First(&rebate).Error)
	var loadedInviter User
	require.NoError(t, DB.First(&loadedInviter, inviter.Id).Error)
	require.NoError(t, loadedInviter.TransferAffQuotaToQuota(rebate.RebateQuota))
	_, err := RefundTopUp(topUp.TradeNo, "provider refund")
	require.NoError(t, err)

	var got User
	require.NoError(t, DB.First(&got, inviter.Id).Error)
	assert.Equal(t, rebate.RebateQuota, got.Quota)
	assert.Zero(t, got.AffQuota)
}

func TestAffiliateRebateReversalSupportsSoftDeletedInviter(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 1000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })
	redemption := &Redemption{
		Name:   "affiliate-soft-deleted-inviter",
		Key:    "affiliate-soft-deleted-inviter",
		Status: common.RedemptionCodeStatusEnabled,
		Quota:  1000,
		Type:   RedemptionTypePaid,
	}
	require.NoError(t, DB.Create(redemption).Error)
	_, err := Redeem(redemption.Key, invitee.Id)
	require.NoError(t, err)

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", fmt.Sprintf("redemption:%d", redemption.Id)).First(&rebate).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Update("deleted_at", time.Now()).Error)
	require.NoError(t, ReverseAffiliateRebate(rebate.Id, "store refund"))

	var got User
	require.NoError(t, DB.Unscoped().First(&got, inviter.Id).Error)
	assert.Zero(t, got.AffQuota)
	assert.Equal(t, rebate.RebateQuota, got.AffReversedQuota)
}

func countAffiliateRebates(t *testing.T) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&AffiliateRebate{}).Count(&count).Error)
	return count
}
