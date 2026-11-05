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

func TestReplaceScopesIsAtomicAndDoesNotDoubleCountTheOwner(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			if backend == "redis" {
				useConcurrencyMiniRedis(t)
			} else {
				resetConcurrencyTestState(t)
			}
			ctx := context.Background()
			first, _, err := Acquire(ctx, "request", []Scope{{Name: "old", Limit: 1}, {Name: "account", Limit: 1}}, time.Minute)
			require.NoError(t, err)
			occupied, _, err := Acquire(ctx, "other", []Scope{{Name: "new", Limit: 1}}, time.Minute)
			require.NoError(t, err)
			nextScopes := []Scope{{Name: "new", Limit: 1}, {Name: "account", Limit: 1}}
			_, retry, err := Replace(ctx, first, nextScopes, time.Minute)
			require.NoError(t, err)
			assert.Positive(t, retry)
			_, retry, err = Acquire(ctx, "blocked-old", []Scope{{Name: "old", Limit: 1}}, time.Minute)
			require.NoError(t, err)
			assert.Positive(t, retry, "a failed replacement must retain the old scopes")
			require.NoError(t, Release(ctx, occupied))
			next, retry, err := Replace(ctx, first, nextScopes, time.Minute)
			require.NoError(t, err)
			assert.Zero(t, retry)
			next, retry, err = Replace(ctx, next, nextScopes, time.Minute)
			require.NoError(t, err)
			assert.Zero(t, retry, "rechecking one's own full scope must succeed")
			freed, retry, err := Acquire(ctx, "freed-old", []Scope{{Name: "old", Limit: 1}}, time.Minute)
			require.NoError(t, err)
			assert.Zero(t, retry)
			require.NoError(t, Release(ctx, freed))
			require.NoError(t, Release(ctx, next))
			_, _, err = Replace(ctx, next, nextScopes, time.Minute)
			assert.ErrorIs(t, err, ErrLeaseLost)
		})
	}
}

func TestRestoreDurableWorkBlocksNewAdmissionAfterLostLease(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			if backend == "redis" {
				useConcurrencyMiniRedis(t)
			} else {
				resetConcurrencyTestState(t)
			}
			ctx := context.Background()
			scopes := []Scope{{Name: "task-user", Limit: 1}, {Name: "task-key", Limit: 1}}
			lease, _, err := Acquire(ctx, "accepted-task", scopes, time.Minute)
			require.NoError(t, err)
			require.NoError(t, Release(ctx, lease))
			require.NoError(t, Restore(ctx, lease, time.Minute))
			require.NoError(t, Restore(ctx, lease, time.Minute))
			_, retry, err := Acquire(ctx, "new-request", scopes, time.Minute)
			require.NoError(t, err)
			assert.Positive(t, retry)
			require.NoError(t, Release(ctx, lease))
			admitted, retry, err := Acquire(ctx, "new-request", scopes, time.Minute)
			require.NoError(t, err)
			assert.Zero(t, retry)
			require.NoError(t, Release(ctx, admitted))
		})
	}
}
