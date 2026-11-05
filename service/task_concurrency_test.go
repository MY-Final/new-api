package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskConcurrencyLeaseRefreshAndRelease(t *testing.T) {
	previousRedisEnabled, previousRedis := common.RedisEnabled, common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousRedisEnabled, previousRedis
	})

	ctx := context.Background()
	scope := concurrency.Scope{Name: "task-concurrency-test", Limit: 1}
	lease, _, err := concurrency.Acquire(ctx, "task-owner", []concurrency.Scope{scope}, time.Minute)
	require.NoError(t, err)
	task := &model.Task{
		TaskID: "task-concurrency-test",
		PrivateData: model.TaskPrivateData{
			ConcurrencyLeaseOwner: lease.Owner,
			ConcurrencyScopes:     concurrency.ScopeFromLease(lease),
		},
	}

	require.NoError(t, refreshTaskConcurrencyLease(ctx, task))
	_, retryAfter, err := concurrency.Acquire(ctx, "blocked-owner", []concurrency.Scope{scope}, time.Minute)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, retryAfter, time.Second)

	ReleaseTaskConcurrencyLease(ctx, task)
	next, _, err := concurrency.Acquire(ctx, "next-owner", []concurrency.Scope{scope}, time.Minute)
	require.NoError(t, err)
	assert.Equal(t, "next-owner", next.Owner)
	require.NoError(t, concurrency.Release(ctx, next))
}

func TestTaskConcurrencyLeaseLossStopsPollingAndRestoresOccupancy(t *testing.T) {
	previousRedisEnabled, previousRedis := common.RedisEnabled, common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousRedisEnabled, previousRedis
	})

	ctx := context.Background()
	scope := concurrency.Scope{Name: "task-lease-loss-test", Limit: 1}
	lease, _, err := concurrency.Acquire(ctx, "lost-task-owner", []concurrency.Scope{scope}, time.Minute)
	require.NoError(t, err)
	task := &model.Task{
		TaskID: "task-lease-loss-test",
		PrivateData: model.TaskPrivateData{
			ConcurrencyLeaseOwner: lease.Owner,
			ConcurrencyScopes:     concurrency.ScopeFromLease(lease),
		},
	}
	require.NoError(t, concurrency.Release(ctx, lease))
	require.ErrorIs(t, refreshTaskConcurrencyLease(ctx, task), concurrency.ErrLeaseLost)

	_, retryAfter, err := concurrency.Acquire(ctx, "blocked-after-loss", []concurrency.Scope{scope}, time.Minute)
	require.NoError(t, err)
	assert.Positive(t, retryAfter)
	require.NoError(t, concurrency.Release(ctx, lease))
}
