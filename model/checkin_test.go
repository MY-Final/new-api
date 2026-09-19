package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/require"
)

func enableCheckinForTest(t *testing.T, minQuota, maxQuota int) {
	t.Helper()
	setting := operation_setting.GetCheckinSetting()
	previous := *setting
	setting.Enabled = true
	setting.MinQuota = minQuota
	setting.MaxQuota = maxQuota
	t.Cleanup(func() { *setting = previous })
}

func TestUserCheckinAwardsBonusQuota(t *testing.T) {
	truncateTables(t)
	enableCheckinForTest(t, 100, 100)

	user := User{Username: "checkin-" + common.GetRandomString(8), Password: "hash", Quota: 0}
	require.NoError(t, DB.Create(&user).Error)

	checkin, err := UserCheckin(user.Id)
	require.NoError(t, err)
	require.Equal(t, 100, checkin.QuotaAwarded)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 100, got.Quota)
	require.Equal(t, 100, got.BonusQuota)
	require.Equal(t, 0, got.PaidQuota)

	_, err = UserCheckin(user.Id)
	require.Error(t, err)
}

func TestUserCheckinTransactionNormalizesLegacyWallet(t *testing.T) {
	truncateTables(t)

	user := User{Username: "checkin-legacy-" + common.GetRandomString(8), Password: "hash", Quota: 1000}
	require.NoError(t, DB.Create(&user).Error)

	checkin := &Checkin{
		UserId:       user.Id,
		CheckinDate:  time.Now().Format("2006-01-02"),
		QuotaAwarded: 100,
		CreatedAt:    time.Now().Unix(),
	}
	_, err := userCheckinWithTransaction(checkin, user.Id, checkin.QuotaAwarded)
	require.NoError(t, err)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 1100, got.Quota)
	require.Equal(t, 100, got.BonusQuota)
	require.Equal(t, 1000, got.PaidQuota)
	require.Equal(t, got.Quota, got.BonusQuota+got.PaidQuota)
}
