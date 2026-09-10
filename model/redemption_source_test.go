package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRedemptionQuotaAllocationNormalizesLegacyRows(t *testing.T) {
	redemption := &Redemption{Key: "debug-redemption-source", Quota: 500, Status: common.RedemptionCodeStatusEnabled}
	t.Cleanup(func() {
		DB.Unscoped().Where("key = ?", redemption.Key).Delete(&Redemption{})
		DB.Unscoped().Where("username = ?", "debug-redemption-user").Delete(&User{})
	})
	require.NoError(t, DB.Create(redemption).Error)
	t.Logf("created: %+v", redemption)
	var loaded Redemption
	require.NoError(t, DB.Where("id = ?", redemption.Id).First(&loaded).Error)
	t.Logf("loaded: %+v", loaded)
	allocation, err := loaded.quotaAllocation()
	require.NoError(t, err)
	t.Logf("allocation: %+v", allocation)

	user := &User{Username: "debug-redemption-user", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	quota, err := Redeem(redemption.Key, user.Id)
	t.Logf("redeem result: quota=%d err=%v", quota, err)
	require.NoError(t, err)
}

func TestPaidRedemptionCreditsBothSourcesAndRebatesPaidQuota(t *testing.T) {
	truncateTables(t)
	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 10000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })

	inviter, invitee := createAffiliateUsers(t)
	redemption := &Redemption{
		Name:       "paid-with-bonus",
		Key:        "paid-with-bonus-code",
		Status:     common.RedemptionCodeStatusEnabled,
		Type:       RedemptionTypePaid,
		PaidQuota:  500,
		BonusQuota: 100,
	}
	require.NoError(t, redemption.Insert())

	quota, err := Redeem(redemption.Key, invitee.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, quota)

	var user User
	require.NoError(t, DB.First(&user, invitee.Id).Error)
	assert.Equal(t, 600, user.Quota)
	assert.Equal(t, 100, user.BonusQuota)
	assert.Equal(t, 500, user.PaidQuota)

	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_key = ?", fmt.Sprintf("redemption:%d", redemption.Id)).First(&rebate).Error)
	assert.Equal(t, 500, rebate.BaseQuota)
	assert.Equal(t, 500, rebate.RebateQuota)
	assert.Equal(t, inviter.Id, rebate.InviterId)
}

func TestRedemptionQuotaSourceMigrationIsIdempotent(t *testing.T) {
	truncateTables(t)
	paid := &Redemption{Key: "legacy-paid-code", Quota: 500, Type: RedemptionTypePaid, Status: common.RedemptionCodeStatusEnabled}
	reward := &Redemption{Key: "legacy-reward-code", Quota: 600, Type: RedemptionTypeReward, Status: common.RedemptionCodeStatusEnabled}
	require.NoError(t, DB.Create(paid).Error)
	require.NoError(t, DB.Create(reward).Error)
	require.NoError(t, DB.Model(&Redemption{}).Where("id IN ?", []int{paid.Id, reward.Id}).Updates(map[string]interface{}{
		"paid_quota":  0,
		"bonus_quota": 0,
	}).Error)

	require.NoError(t, migrateRedemptionQuotaSources())
	require.NoError(t, migrateRedemptionQuotaSources())

	var gotPaid, gotReward Redemption
	require.NoError(t, DB.First(&gotPaid, paid.Id).Error)
	require.NoError(t, DB.First(&gotReward, reward.Id).Error)
	assert.Equal(t, 500, gotPaid.PaidQuota)
	assert.Equal(t, 0, gotPaid.BonusQuota)
	assert.Equal(t, 0, gotReward.PaidQuota)
	assert.Equal(t, 600, gotReward.BonusQuota)
}

func TestPaidRedemptionRefundMovesConsumedBonusShortfallToPaid(t *testing.T) {
	truncateTables(t)
	user := &User{
		Username:   "redemption-refund-source",
		Quota:      200,
		PaidQuota:  200,
		BonusQuota: 0,
		Status:     common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(user).Error)
	redemption := &Redemption{
		Name:       "refund-source-code",
		Key:        "refund-source-code",
		Status:     common.RedemptionCodeStatusEnabled,
		Type:       RedemptionTypePaid,
		PaidQuota:  500,
		BonusQuota: 100,
	}
	require.NoError(t, redemption.Insert())
	require.NoError(t, func() error {
		_, err := Redeem(redemption.Key, user.Id)
		return err
	}())

	reserved, allocation, err := TryReserveUserQuotaAllocation(user.Id, 100)
	require.NoError(t, err)
	assert.True(t, reserved)
	assert.Equal(t, QuotaAllocation{Bonus: 100, Paid: 0}, allocation)

	alreadyRefunded, err := RefundRedemptionByAdmin(redemption.Id, "refund source test", 0)
	require.NoError(t, err)
	assert.False(t, alreadyRefunded)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	assert.Equal(t, 100, got.Quota)
	assert.Equal(t, 0, got.BonusQuota)
	assert.Equal(t, 100, got.PaidQuota)
}

func TestPaidRedemptionBonusCapacityFailureDoesNotCredit(t *testing.T) {
	truncateTables(t)
	user := &User{
		Username:  "redemption-capacity-source",
		Quota:     common.MaxWalletQuota - 10,
		PaidQuota: common.MaxWalletQuota - 10,
		Status:    common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(user).Error)
	redemption := &Redemption{
		Name:       "capacity-source-code",
		Key:        "capacity-source-code",
		Status:     common.RedemptionCodeStatusEnabled,
		Type:       RedemptionTypePaid,
		PaidQuota:  10,
		BonusQuota: 1,
	}
	require.NoError(t, redemption.Insert())

	_, err := Redeem(redemption.Key, user.Id)
	require.ErrorIs(t, err, ErrRedeemFailed)

	var gotUser User
	require.NoError(t, DB.First(&gotUser, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota-10, gotUser.Quota)
	assert.Equal(t, common.MaxWalletQuota-10, gotUser.PaidQuota)
	assert.Zero(t, gotUser.BonusQuota)

	var gotRedemption Redemption
	require.NoError(t, DB.First(&gotRedemption, redemption.Id).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, gotRedemption.Status)
}
