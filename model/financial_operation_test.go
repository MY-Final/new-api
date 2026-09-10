package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPaidRedemptionRefundReclaimsBuyerQuotaAndReversesRebate(t *testing.T) {
	truncateTables(t)
	inviter, invitee := createAffiliateUsers(t)
	inviter.Quota = 4
	invitee.Quota = 2
	require.NoError(t, DB.Save(inviter).Error)
	require.NoError(t, DB.Save(invitee).Error)

	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 1000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })
	redemption := &Redemption{
		UserId: invitee.Id,
		Key:    "finance-paid-refund-code",
		Name:   "paid",
		Quota:  10,
		Status: common.RedemptionCodeStatusEnabled,
		Type:   RedemptionTypePaid,
	}
	require.NoError(t, redemption.Insert())

	_, err := Redeem(redemption.Key, invitee.Id)
	require.NoError(t, err)
	var afterRedeem User
	require.NoError(t, DB.First(&afterRedeem, invitee.Id).Error)
	assert.Equal(t, 12, afterRedeem.Quota)
	assert.Equal(t, 1, afterRedeemQuota(t, inviter.Id))

	already, err := RefundRedemptionByAdmin(redemption.Id, "buyer selected the wrong code", 0)
	require.NoError(t, err)
	assert.False(t, already)
	already, err = RefundRedemptionByAdmin(redemption.Id, "duplicate request", 0)
	require.NoError(t, err)
	assert.True(t, already)

	var buyer, owner User
	require.NoError(t, DB.First(&buyer, invitee.Id).Error)
	require.NoError(t, DB.First(&owner, inviter.Id).Error)
	assert.Equal(t, 2, buyer.Quota)
	assert.Equal(t, 4, owner.Quota)
	assert.Equal(t, 0, owner.AffQuota)
	var refunded Redemption
	require.NoError(t, DB.First(&refunded, redemption.Id).Error)
	assert.Equal(t, common.RedemptionCodeStatusRefunded, refunded.Status)
	var operation FinancialOperation
	require.NoError(t, DB.Where("operation_key = ?", fmt.Sprintf("redemption_refund:%d", redemption.Id)).First(&operation).Error)
	assert.Equal(t, -10, operation.TargetMainDelta)
	assert.Equal(t, -1, operation.RelatedAffiliateDelta)
}

func TestRebateOnlyReversalDoesNotChangeInviteeQuota(t *testing.T) {
	truncateTables(t)
	originalRate := common.AffiliateRedemptionRebateRate
	common.AffiliateRedemptionRebateRate = 1000
	t.Cleanup(func() { common.AffiliateRedemptionRebateRate = originalRate })
	inviter, invitee := createAffiliateUsers(t)
	invitee.Quota = 20
	require.NoError(t, DB.Save(invitee).Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return recordAffiliateRebateForRedemptionTx(tx, &Redemption{Id: 88, Type: RedemptionTypePaid, Quota: 10}, invitee.Id)
	}))
	var rebate AffiliateRebate
	require.NoError(t, DB.Where("source_id = ?", "88").First(&rebate).Error)
	already, err := ReverseAffiliateRebateByAdmin(rebate.Id, "manual correction", 0)
	require.NoError(t, err)
	assert.False(t, already)
	var got User
	require.NoError(t, DB.First(&got, invitee.Id).Error)
	assert.Equal(t, 20, got.Quota)
	assert.Equal(t, 0, inviterQuota(t, inviter.Id))
}

func TestPenaltyAndReversalAreIdempotent(t *testing.T) {
	truncateTables(t)
	target := &User{Username: "penalty-target", AffCode: "penalty-target-code", Quota: 5}
	require.NoError(t, DB.Create(target).Error)
	operation, already, err := ApplyFinancialPenalty(target.Id, 8, "abuse correction", "request-1", 0, common.RoleRootUser)
	require.NoError(t, err)
	assert.False(t, already)
	operationAgain, already, err := ApplyFinancialPenalty(target.Id, 8, "duplicate", "request-1", 0, common.RoleRootUser)
	require.NoError(t, err)
	assert.True(t, already)
	assert.Equal(t, operation.Id, operationAgain.Id)
	var afterPenalty User
	require.NoError(t, DB.First(&afterPenalty, target.Id).Error)
	assert.Equal(t, -3, afterPenalty.Quota)

	_, already, err = ReverseFinancialPenalty(operation.Id, "appeal accepted", 0, common.RoleRootUser)
	require.NoError(t, err)
	assert.False(t, already)
	_, already, err = ReverseFinancialPenalty(operation.Id, "duplicate", 0, common.RoleRootUser)
	require.NoError(t, err)
	assert.True(t, already)
	var restored User
	require.NoError(t, DB.First(&restored, target.Id).Error)
	assert.Equal(t, 5, restored.Quota)
}

func afterRedeemQuota(t *testing.T, userId int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	return user.AffQuota
}

func inviterQuota(t *testing.T, userId int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	return user.AffQuota
}
