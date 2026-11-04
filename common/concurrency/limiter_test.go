package concurrency

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetConcurrencyTestState(t *testing.T) {
	t.Helper()
	previousRedisEnabled, previousRedis := common.RedisEnabled, common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	globalMemoryStore.leases = make(map[string]map[string]memoryLease)
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousRedisEnabled, previousRedis
		globalMemoryStore.leases = make(map[string]map[string]memoryLease)
	})
}

func useConcurrencyMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	resetConcurrencyTestState(t)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	require.NoError(t, client.Ping(context.Background()).Err())
	common.RedisEnabled = true
	common.RDB = client
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})
	return server
}

func TestMemoryAcquireIsAtomicAcrossScopes(t *testing.T) {
	resetConcurrencyTestState(t)
	ctx := context.Background()
	first, _, err := Acquire(ctx, "first", []Scope{
		{Name: "account", Limit: 1},
		{Name: "key", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)

	_, _, err = Acquire(ctx, "failed", []Scope{
		{Name: "account", Limit: 1},
		{Name: "channel", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)
	_, retryAfter, err := Acquire(ctx, "third", []Scope{
		{Name: "account", Limit: 1},
		{Name: "channel", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, retryAfter, time.Second)

	freeLease, _, err := Acquire(ctx, "partial-check", []Scope{{Name: "channel", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "partial-check", freeLease.Owner)
	require.NoError(t, Release(ctx, freeLease))

	require.NoError(t, Release(ctx, first))
	second, _, err := Acquire(ctx, "second", []Scope{
		{Name: "account", Limit: 1},
		{Name: "channel", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)
	assert.Len(t, second.Scopes, 2)
}

func TestMemoryRefreshAndReleaseAreIdempotent(t *testing.T) {
	resetConcurrencyTestState(t)
	ctx := context.Background()
	lease, _, err := Acquire(ctx, "owner", []Scope{{Name: "refresh", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	ok, err := Refresh(ctx, lease, 2*time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)

	_, retryAfter, err := Acquire(ctx, "blocked", []Scope{{Name: "refresh", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, retryAfter, time.Second)

	require.NoError(t, Release(ctx, lease))
	require.NoError(t, Release(ctx, lease))
	next, _, err := Acquire(ctx, "next", []Scope{{Name: "refresh", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "next", next.Owner)
}

func TestRedisAcquireIsAtomicAcrossScopes(t *testing.T) {
	useConcurrencyMiniRedis(t)
	ctx := context.Background()
	first, _, err := Acquire(ctx, "first", []Scope{
		{Name: "redis-account", Limit: 1},
		{Name: "redis-key", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)

	_, retryAfter, err := Acquire(ctx, "second", []Scope{
		{Name: "redis-account", Limit: 1},
		{Name: "redis-channel", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, retryAfter, time.Second)

	freeLease, _, err := Acquire(ctx, "partial-check", []Scope{{Name: "redis-channel", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "partial-check", freeLease.Owner)
	require.NoError(t, Release(ctx, freeLease))

	require.NoError(t, Release(ctx, first))
	second, _, err := Acquire(ctx, "second", []Scope{
		{Name: "redis-account", Limit: 1},
		{Name: "redis-channel", Limit: 1},
	}, time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "second", second.Owner)
}

func TestRedisRefreshAndReleaseAreIdempotent(t *testing.T) {
	server := useConcurrencyMiniRedis(t)
	ctx := context.Background()
	lease, _, err := Acquire(ctx, "owner", []Scope{{Name: "redis-refresh", Limit: 1}}, time.Minute)
	require.NoError(t, err)
	ok, err := Refresh(ctx, lease, 2*time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Greater(t, server.TTL(redisKey("redis-refresh")), 90*time.Second)

	require.NoError(t, Release(ctx, lease))
	require.NoError(t, Release(ctx, lease))
	ok, err = Refresh(ctx, lease, time.Minute)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestRedisEnabledButUnavailableFailsClosed(t *testing.T) {
	resetConcurrencyTestState(t)
	common.RedisEnabled = true
	common.RDB = nil

	_, _, err := Acquire(context.Background(), "owner", []Scope{{Name: "unavailable", Limit: 1}}, time.Minute)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unavailable")
}
