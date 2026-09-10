package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUserBillingHistoryMergesTopupsAndRedemptions(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "billing-history-user", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	now := common.GetTimestamp()

	require.NoError(t, DB.Create(&TopUp{
		UserId:        user.Id,
		Amount:        10,
		Money:         10,
		TradeNo:       "billing-topup",
		CreateTime:    now - 10,
		Status:        common.TopUpStatusSuccess,
		Source:        TopUpSourceTopup,
		CreditedQuota: 1000,
	}).Error)
	require.NoError(t, DB.Create(&Redemption{
		UserId:       user.Id,
		Key:          "billing-redemption-key",
		Name:         "billing-redemption",
		Status:       common.RedemptionCodeStatusUsed,
		Type:         RedemptionTypePaid,
		PaidQuota:    1500,
		BonusQuota:   500,
		RedeemedTime: now - 5,
		UsedUserId:   user.Id,
	}).Error)

	records, total, err := GetUserBillingHistory(user.Id, "", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, records, 2)
	assert.Equal(t, BillingRecordTypeRedemption, records[0].RecordType)
	assert.Equal(t, "billing-redemption-key", records[0].RedemptionKey)
	assert.Equal(t, 2000, records[0].RedemptionQuota)
	assert.Equal(t, 1500, records[0].RedemptionPaidQuota)
	assert.Equal(t, 500, records[0].RedemptionBonusQuota)
	assert.Equal(t, BillingRecordTypeTopup, records[1].RecordType)
}

func TestGetUserBillingHistorySearchesRedemptionCode(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "billing-search-user", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	otherUser := &User{
		Username: "billing-search-other-user",
		Status:   common.UserStatusEnabled,
		AffCode:  "billing-search-other-code",
	}
	require.NoError(t, DB.Create(otherUser).Error)

	require.NoError(t, DB.Create(&Redemption{
		UserId:       user.Id,
		Key:          "billing-search-key",
		Name:         "billing-search-code",
		Status:       common.RedemptionCodeStatusUsed,
		Type:         RedemptionTypeReward,
		Quota:        500,
		RedeemedTime: common.GetTimestamp(),
		UsedUserId:   user.Id,
	}).Error)
	require.NoError(t, DB.Create(&Redemption{
		UserId:       otherUser.Id,
		Key:          "billing-other-key",
		Name:         "billing-search-key",
		Status:       common.RedemptionCodeStatusUsed,
		Type:         RedemptionTypeReward,
		Quota:        500,
		RedeemedTime: common.GetTimestamp(),
		UsedUserId:   otherUser.Id,
	}).Error)

	records, total, err := GetUserBillingHistory(user.Id, "billing-search-key", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, records, 1)
	assert.Equal(t, BillingRecordTypeRedemption, records[0].RecordType)
	assert.Zero(t, records[0].RedemptionPaidQuota)
	assert.Equal(t, 500, records[0].RedemptionBonusQuota)
}
