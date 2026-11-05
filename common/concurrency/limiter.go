package concurrency

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	DefaultLeaseTTL    = 5 * time.Minute
	MinimumRetryMillis = int64(1000)
)

type Scope struct {
	Name  string
	Limit int
}

type Lease struct {
	Owner  string
	Scopes []Scope
}

type Snapshot struct {
	Owner      string   `json:"owner"`
	ScopeNames []string `json:"scope_names"`
}

const (
	ContextKeyLease    = "concurrency_lease"
	ContextKeyTaskHold = "concurrency_task_hold"
)

type memoryLease struct {
	owner     string
	expiresAt time.Time
}

type memoryStore struct {
	mu     sync.Mutex
	leases map[string]map[string]memoryLease
}

var globalMemoryStore = &memoryStore{leases: make(map[string]map[string]memoryLease)}

var ErrLeaseLost = errors.New("concurrency lease was lost")

const replaceScript = `
local owner = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local retry = tonumber(ARGV[4])
local oldCount = tonumber(ARGV[5])
for i = 1, oldCount do
  local score = redis.call('ZSCORE', KEYS[i], owner)
  if not score or tonumber(score) <= now then
    return {-1, 0}
  end
end
for i = oldCount + 1, #KEYS do
  local key = KEYS[i]
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  local limit = tonumber(ARGV[5 + i - oldCount])
  local count = tonumber(redis.call('ZCARD', key))
  if redis.call('ZSCORE', key, owner) then
    count = count - 1
  end
  if count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    if oldest[2] then
      local wait = tonumber(oldest[2]) - now
      if wait > retry then
        retry = wait
      end
    end
    return {0, retry}
  end
end
for i = 1, oldCount do
  redis.call('ZREM', KEYS[i], owner)
end
for i = oldCount + 1, #KEYS do
  local key = KEYS[i]
  redis.call('ZADD', key, now + ttl, owner)
  redis.call('PEXPIRE', key, ttl + 1000)
end
return {1, 0}
`

const restoreScript = `
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, ARGV[2] + ARGV[3], ARGV[1])
  redis.call('PEXPIRE', key, ARGV[3] + 1000)
end
return 1
`

const refreshScript = `
local owner = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
for i, key in ipairs(KEYS) do
  if not redis.call('ZSCORE', key, owner) then
    return 0
  end
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now + ttl, owner)
  redis.call('PEXPIRE', key, ttl + 1000)
end
return 1
`

const releaseScript = `
local owner = ARGV[1]
for i, key in ipairs(KEYS) do
  redis.call('ZREM', key, owner)
end
return 1
`

func normalizeScopes(scopes []Scope) []Scope {
	result := make([]Scope, 0, len(scopes))
	index := make(map[string]int, len(scopes))
	for _, scope := range scopes {
		if scope.Name == "" || scope.Limit <= 0 {
			continue
		}
		if existing, ok := index[scope.Name]; ok {
			if scope.Limit < result[existing].Limit {
				result[existing].Limit = scope.Limit
			}
			continue
		}
		index[scope.Name] = len(result)
		result = append(result, scope)
	}
	return result
}

func redisKey(scopeName string) string {
	return "concurrency:v1:" + scopeName
}

func Acquire(ctx context.Context, owner string, scopes []Scope, ttl time.Duration) (Lease, time.Duration, error) {
	return Replace(ctx, Lease{Owner: owner}, scopes, ttl)
}

// Replace atomically switches an existing reservation to the scopes required by
// the next upstream attempt. A failed admission retains every previous slot.
func Replace(ctx context.Context, previous Lease, scopes []Scope, ttl time.Duration) (Lease, time.Duration, error) {
	owner := previous.Owner
	if owner == "" {
		return Lease{}, 0, errors.New("concurrency lease owner is empty")
	}
	scopes = normalizeScopes(scopes)
	if len(scopes) == 0 && len(previous.Scopes) == 0 {
		return Lease{Owner: owner}, 0, nil
	}
	if ttl <= 0 {
		ttl = DefaultLeaseTTL
	}
	if common.RedisEnabled {
		if common.RDB == nil {
			return Lease{}, 0, errors.New("Redis is enabled but unavailable for concurrency limiting")
		}
		keys := make([]string, 0, len(previous.Scopes)+len(scopes))
		for _, scope := range previous.Scopes {
			keys = append(keys, redisKey(scope.Name))
		}
		args := []any{owner, time.Now().UnixMilli(), ttl.Milliseconds(), MinimumRetryMillis, len(previous.Scopes)}
		for _, scope := range scopes {
			keys = append(keys, redisKey(scope.Name))
			args = append(args, scope.Limit)
		}
		values, err := common.RDB.Eval(ctx, replaceScript, keys, args...).Slice()
		if err != nil {
			return Lease{}, 0, fmt.Errorf("acquire concurrency lease: %w", err)
		}
		if len(values) != 2 {
			return Lease{}, 0, fmt.Errorf("unexpected concurrency acquire reply: %v", values)
		}
		allowed, err := redisInteger(values[0])
		if err != nil {
			return Lease{}, 0, err
		}
		retryMillis, err := redisInteger(values[1])
		if err != nil {
			return Lease{}, 0, err
		}
		if allowed == 0 {
			return Lease{}, max(time.Duration(retryMillis)*time.Millisecond, time.Second), nil
		}
		if allowed < 0 {
			return Lease{}, 0, ErrLeaseLost
		}
		return Lease{Owner: owner, Scopes: scopes}, 0, nil
	}
	return replaceMemory(previous, scopes, ttl)
}

func replaceMemory(previous Lease, scopes []Scope, ttl time.Duration) (Lease, time.Duration, error) {
	owner := previous.Owner
	now := time.Now()
	globalMemoryStore.mu.Lock()
	defer globalMemoryStore.mu.Unlock()
	for _, scope := range previous.Scopes {
		entry, exists := globalMemoryStore.leases[scope.Name][owner]
		if !exists || !entry.expiresAt.After(now) {
			return Lease{}, 0, ErrLeaseLost
		}
	}
	for scopeName, entries := range globalMemoryStore.leases {
		for entryOwner, entry := range entries {
			if !entry.expiresAt.After(now) {
				delete(entries, entryOwner)
			}
		}
		if len(entries) == 0 {
			delete(globalMemoryStore.leases, scopeName)
		}
	}
	retry := time.Duration(0)
	for _, scope := range scopes {
		entries := globalMemoryStore.leases[scope.Name]
		count := len(entries)
		if _, exists := entries[owner]; exists {
			count--
		}
		if count < scope.Limit {
			continue
		}
		for _, entry := range entries {
			wait := time.Until(entry.expiresAt)
			if wait > retry {
				retry = wait
			}
		}
	}
	if retry > 0 {
		return Lease{}, max(retry, time.Second), nil
	}
	for _, scope := range previous.Scopes {
		delete(globalMemoryStore.leases[scope.Name], owner)
	}
	expiresAt := now.Add(ttl)
	for _, scope := range scopes {
		entries := globalMemoryStore.leases[scope.Name]
		if entries == nil {
			entries = make(map[string]memoryLease)
			globalMemoryStore.leases[scope.Name] = entries
		}
		entries[owner] = memoryLease{owner: owner, expiresAt: expiresAt}
	}
	return Lease{Owner: owner, Scopes: scopes}, 0, nil
}

// Restore reserves capacity already consumed by a durable asynchronous task.
// It may exceed the current limit: existing upstream work cannot be cancelled
// by forgetting its slot, and subsequent admissions must see that occupancy.
func Restore(ctx context.Context, lease Lease, ttl time.Duration) error {
	if lease.Owner == "" || len(lease.Scopes) == 0 {
		return nil
	}
	if ttl <= 0 {
		ttl = DefaultLeaseTTL
	}
	if common.RedisEnabled {
		if common.RDB == nil {
			return errors.New("Redis is enabled but unavailable for concurrency limiting")
		}
		keys := make([]string, 0, len(lease.Scopes))
		for _, scope := range lease.Scopes {
			keys = append(keys, redisKey(scope.Name))
		}
		return common.RDB.Eval(ctx, restoreScript, keys, lease.Owner, time.Now().UnixMilli(), ttl.Milliseconds()).Err()
	}
	globalMemoryStore.mu.Lock()
	defer globalMemoryStore.mu.Unlock()
	for _, scope := range lease.Scopes {
		entries := globalMemoryStore.leases[scope.Name]
		if entries == nil {
			entries = make(map[string]memoryLease)
			globalMemoryStore.leases[scope.Name] = entries
		}
		entries[lease.Owner] = memoryLease{owner: lease.Owner, expiresAt: time.Now().Add(ttl)}
	}
	return nil
}

func Refresh(ctx context.Context, lease Lease, ttl time.Duration) (bool, error) {
	if lease.Owner == "" || len(lease.Scopes) == 0 {
		return true, nil
	}
	if ttl <= 0 {
		ttl = DefaultLeaseTTL
	}
	if common.RedisEnabled {
		if common.RDB == nil {
			return false, errors.New("Redis is enabled but unavailable for concurrency limiting")
		}
		keys := make([]string, 0, len(lease.Scopes))
		for _, scope := range lease.Scopes {
			keys = append(keys, redisKey(scope.Name))
		}
		value, err := common.RDB.Eval(
			ctx,
			refreshScript,
			keys,
			lease.Owner,
			time.Now().UnixMilli(),
			ttl.Milliseconds(),
		).Int()
		return value == 1, err
	}
	return refreshMemory(lease, ttl)
}

func refreshMemory(lease Lease, ttl time.Duration) (bool, error) {
	now := time.Now()
	globalMemoryStore.mu.Lock()
	defer globalMemoryStore.mu.Unlock()
	for _, scope := range lease.Scopes {
		entries := globalMemoryStore.leases[scope.Name]
		entry, ok := entries[lease.Owner]
		if !ok || !entry.expiresAt.After(now) {
			return false, nil
		}
	}
	for _, scope := range lease.Scopes {
		entries := globalMemoryStore.leases[scope.Name]
		entries[lease.Owner] = memoryLease{owner: lease.Owner, expiresAt: now.Add(ttl)}
	}
	return true, nil
}

func Release(ctx context.Context, lease Lease) error {
	if lease.Owner == "" || len(lease.Scopes) == 0 {
		return nil
	}
	if common.RedisEnabled {
		if common.RDB == nil {
			return errors.New("Redis is enabled but unavailable for concurrency limiting")
		}
		keys := make([]string, 0, len(lease.Scopes))
		for _, scope := range lease.Scopes {
			keys = append(keys, redisKey(scope.Name))
		}
		_, err := common.RDB.Eval(ctx, releaseScript, keys, lease.Owner).Result()
		return err
	}
	releaseMemory(lease)
	return nil
}

func releaseMemory(lease Lease) {
	globalMemoryStore.mu.Lock()
	defer globalMemoryStore.mu.Unlock()
	for _, scope := range lease.Scopes {
		entries := globalMemoryStore.leases[scope.Name]
		delete(entries, lease.Owner)
		if len(entries) == 0 {
			delete(globalMemoryStore.leases, scope.Name)
		}
	}
}

func redisInteger(value any) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return 0, fmt.Errorf("unexpected Redis integer type %T", value)
	}
}

func ScopeFromLease(lease Lease) []string {
	result := make([]string, 0, len(lease.Scopes))
	for _, scope := range lease.Scopes {
		result = append(result, scope.Name)
	}
	return result
}

func LeaseFromScopeNames(owner string, scopeNames []string) Lease {
	result := Lease{Owner: owner, Scopes: make([]Scope, 0, len(scopeNames))}
	for _, name := range scopeNames {
		if name == "" {
			continue
		}
		result.Scopes = append(result.Scopes, Scope{Name: name})
	}
	return result
}

func SnapshotFromLease(lease Lease) Snapshot {
	return Snapshot{Owner: lease.Owner, ScopeNames: ScopeFromLease(lease)}
}

func LeaseFromSnapshot(snapshot Snapshot) Lease {
	return LeaseFromScopeNames(snapshot.Owner, snapshot.ScopeNames)
}
