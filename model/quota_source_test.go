package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestQuotaSourcesConsumeBonusBeforePaid(t *testing.T) {
	truncateTables(t)
	oldRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = oldRedis })

	user := User{Username: "quota-source-" + common.GetRandomString(8), Password: "hash", Quota: 300, BonusQuota: 100, PaidQuota: 200}
	require.NoError(t, DB.Create(&user).Error)

	reserved, allocation, err := TryReserveUserQuotaAllocation(user.Id, 120)
	require.NoError(t, err)
	require.True(t, reserved)
	require.Equal(t, QuotaAllocation{Bonus: 100, Paid: 20}, allocation)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 0, got.BonusQuota)
	require.Equal(t, 180, got.PaidQuota)
	require.Equal(t, 180, got.Quota)

	require.NoError(t, AdjustUserQuotaAllocation(user.Id, QuotaAllocation{Paid: 20}, true))
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 0, got.BonusQuota)
	require.Equal(t, 200, got.PaidQuota)
	require.Equal(t, 200, got.Quota)
}

func TestQuotaSourceMigrationIsIdempotent(t *testing.T) {
	truncateTables(t)
	user := User{Username: "quota-migration-" + common.GetRandomString(8), Password: "hash", Quota: 1234}
	require.NoError(t, DB.Create(&user).Error)

	require.NoError(t, migrateUserQuotaSources())
	require.NoError(t, migrateUserQuotaSources())

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 0, got.BonusQuota)
	require.Equal(t, 1234, got.PaidQuota)
	require.Equal(t, 1234, got.Quota)
}

func TestQuotaSourcesConsumeBonusBeforePaidWithRedis(t *testing.T) {
	truncateTables(t)
	oldRedis := common.RedisEnabled
	common.RedisEnabled = true
	t.Cleanup(func() { common.RedisEnabled = oldRedis })
	useUserCacheMiniRedis(t)

	user := User{Username: "quota-source-redis-" + common.GetRandomString(8), Password: "hash", Quota: 300, BonusQuota: 100, PaidQuota: 200, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))

	reserved, allocation, err := TryReserveUserQuotaAllocation(user.Id, 120)
	require.NoError(t, err)
	require.True(t, reserved)
	require.Equal(t, QuotaAllocation{Bonus: 100, Paid: 20}, allocation)

	var cached UserBase
	require.NoError(t, common.RedisHGetObj(getUserCacheKey(user.Id), &cached))
	require.Equal(t, 0, cached.BonusQuota)
	require.Equal(t, 180, cached.PaidQuota)
	require.Equal(t, 180, cached.Quota)
}
