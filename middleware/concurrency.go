package middleware

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const requestConcurrencyKey = "request_concurrency_guard"
const concurrencyCancellationKey = "concurrency_cancel_upstream"

// RequestConcurrency owns one logical request or WebSocket connection. Retries
// replace its scopes without creating another owner or another heartbeat.
type RequestConcurrency struct {
	mu               sync.Mutex
	lease            concurrency.Lease
	ctx              context.Context
	cancel           context.CancelCauseFunc
	onFailure        func()
	done             chan struct{}
	heartbeatStarted bool
	closed           bool
	once             sync.Once
}

func CurrentRequestConcurrency(c *gin.Context) *RequestConcurrency {
	value, _ := c.Get(requestConcurrencyKey)
	guard, _ := value.(*RequestConcurrency)
	return guard
}

func BindRequestConcurrency(c *gin.Context, guard *RequestConcurrency) {
	if guard != nil {
		c.Set(requestConcurrencyKey, guard)
	}
}

// SetConcurrencyCancellation closes non-HTTP transports when their lease is
// lost. HTTP transports are stopped through the request context as well.
func SetConcurrencyCancellation(c *gin.Context, cancel func()) {
	c.Set(concurrencyCancellationKey, cancel)
	if guard := CurrentRequestConcurrency(c); guard != nil {
		guard.mu.Lock()
		guard.onFailure = cancel
		lost := guard.ctx.Err() != nil && !guard.closed
		guard.mu.Unlock()
		if lost && cancel != nil {
			go cancel()
		}
	}
}

func ConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		release, apiErr := AcquireRequestConcurrency(c)
		if apiErr != nil {
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.ToOpenAIError()})
			c.Abort()
			return
		}
		defer release()
		c.Next()
	}
}

// RecheckRequestConcurrency is required after channel/group selection and
// before each upstream attempt. The outer middleware retains release ownership.
func RecheckRequestConcurrency(c *gin.Context) *types.NewAPIError {
	if CurrentRequestConcurrency(c) == nil {
		return nil
	}
	_, apiErr := AcquireRequestConcurrency(c)
	return apiErr
}

func AcquireRequestConcurrency(c *gin.Context) (func(), *types.NewAPIError) {
	noop := func() {}
	userID := c.GetInt("id")
	if userID <= 0 {
		return noop, nil
	}
	scopes := make([]concurrency.Scope, 0, 3)
	if limit := c.GetInt("user_max_concurrency"); limit > 0 {
		scopes = append(scopes, concurrency.Scope{Name: fmt.Sprintf("user:%d", userID), Limit: limit})
	}
	if tokenID := c.GetInt("token_id"); tokenID > 0 {
		if limit := c.GetInt("token_max_concurrency"); limit > 0 {
			scopes = append(scopes, concurrency.Scope{Name: fmt.Sprintf("token:%d", tokenID), Limit: limit})
		}
	}
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "auto" {
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyAutoGroup)
	}
	if apiErr := service.ValidateSubscriptionEndpoint(c, usingGroup); apiErr != nil {
		return noop, apiErr
	}
	subscriptionID, limit, err := model.GetActiveSubscriptionConcurrency(userID, usingGroup)
	if err == nil && subscriptionID > 0 && limit > 0 {
		scopes = append(scopes, concurrency.Scope{Name: fmt.Sprintf("subscription:%d", subscriptionID), Limit: limit})
	}
	// Rebuild already accepted asynchronous work before admitting new work. This
	// also closes the Redis-restart window before the next poller heartbeat.
	if err == nil && len(scopes) > 0 {
		err = service.RestoreUserTaskConcurrency(c.Request.Context(), userID)
	}
	if err != nil {
		return noop, concurrencyUnavailable(err)
	}
	guard := CurrentRequestConcurrency(c)
	if guard == nil {
		owner := c.GetString(common.RequestIdKey)
		if owner == "" {
			owner = common.NewRequestId()
		}
		ctx, cancel := context.WithCancelCause(c.Request.Context())
		guard = &RequestConcurrency{lease: concurrency.Lease{Owner: owner}, ctx: ctx, cancel: cancel, done: make(chan struct{})}
		if value, ok := c.Get(concurrencyCancellationKey); ok {
			guard.onFailure, _ = value.(func())
		}
		c.Request = c.Request.WithContext(ctx)
		c.Set(requestConcurrencyKey, guard)
	}
	guard.mu.Lock()
	if guard.ctx.Err() != nil || guard.closed {
		guard.mu.Unlock()
		return noop, concurrencyUnavailable(concurrency.ErrLeaseLost)
	}
	next, retryAfter, err := concurrency.Replace(c.Request.Context(), guard.lease, scopes, concurrency.DefaultLeaseTTL)
	if err == nil && retryAfter == 0 {
		guard.lease = next
		c.Set(concurrency.ContextKeyLease, next)
		if len(next.Scopes) > 0 && !guard.heartbeatStarted {
			guard.heartbeatStarted = true
			go guard.heartbeat()
		}
	}
	guard.mu.Unlock()
	if err != nil {
		guard.fail(err)
		return noop, concurrencyUnavailable(err)
	}
	if retryAfter > 0 {
		c.Header("Retry-After", strconv.FormatInt(max(int64(math.Ceil(retryAfter.Seconds())), 1), 10))
		return noop, types.NewErrorWithStatusCode(errors.New("Too many concurrent requests"), types.ErrorCodeRateLimitExceeded, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return func() {
		_, held := c.Get(concurrency.ContextKeyTaskHold)
		guard.release(held)
	}, nil
}

func concurrencyUnavailable(err error) *types.NewAPIError {
	common.SysError(common.LogText("concurrency admission unavailable: %s", err.Error()))
	return types.NewErrorWithStatusCode(errors.New("Concurrency limiter unavailable"), types.ErrorCodeUpdateDataError, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
}

func (g *RequestConcurrency) fail(err error) {
	g.mu.Lock()
	if g.closed || g.ctx.Err() != nil {
		g.mu.Unlock()
		return
	}
	g.cancel(err)
	callback := g.onFailure
	g.mu.Unlock()
	// A WebSocket shutdown releases this guard and waits for the heartbeat.
	// Dispatching the transport close avoids joining the current goroutine.
	if callback != nil {
		go callback()
	}
}

func (g *RequestConcurrency) refresh() bool {
	g.mu.Lock()
	if g.closed || g.ctx.Err() != nil {
		g.mu.Unlock()
		return false
	}
	ok, err := concurrency.Refresh(g.ctx, g.lease, concurrency.DefaultLeaseTTL)
	g.mu.Unlock()
	if err == nil && ok {
		return true
	}
	if err == nil {
		err = concurrency.ErrLeaseLost
	}
	common.SysError(common.LogText("request concurrency lease lost: %s", err.Error()))
	g.fail(err)
	return false
}

func (g *RequestConcurrency) heartbeat() {
	defer close(g.done)
	ticker := time.NewTicker(concurrency.DefaultLeaseTTL / 3)
	defer ticker.Stop()
	for {
		select {
		case <-g.ctx.Done():
			return
		case <-ticker.C:
			if !g.refresh() {
				return
			}
		}
	}
}

func (g *RequestConcurrency) release(held bool) {
	g.once.Do(func() {
		g.mu.Lock()
		g.closed = true
		g.cancel(context.Canceled)
		lease, started := g.lease, g.heartbeatStarted
		g.mu.Unlock()
		if started {
			<-g.done
		}
		if !held {
			if err := concurrency.Release(context.Background(), lease); err != nil {
				common.SysError(common.LogText("failed to release concurrency lease %s: %s", lease.Owner, err.Error()))
			}
		}
	})
}
