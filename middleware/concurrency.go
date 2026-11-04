package middleware

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

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

// AcquireRequestConcurrency admits one request after the channel and group are
// known. The returned release function is safe outside Gin middleware so
// transports with their own lifecycle, such as Responses WebSocket calls, can
// keep the lease until their terminal response is written.
func AcquireRequestConcurrency(c *gin.Context) (func(), *types.NewAPIError) {
	noop := func() {}
	userID := c.GetInt("id")
	if userID <= 0 {
		return noop, nil
	}
	owner := c.GetString(common.RequestIdKey)
	if owner == "" {
		owner = common.NewRequestId()
	}
	scopes := make([]concurrency.Scope, 0, 3)
	if userLimit := c.GetInt("user_max_concurrency"); userLimit > 0 {
		scopes = append(scopes, concurrency.Scope{
			Name:  fmt.Sprintf("user:%d", userID),
			Limit: userLimit,
		})
	}
	if tokenID := c.GetInt("token_id"); tokenID > 0 {
		if tokenLimit := c.GetInt("token_max_concurrency"); tokenLimit > 0 {
			scopes = append(scopes, concurrency.Scope{
				Name:  fmt.Sprintf("token:%d", tokenID),
				Limit: tokenLimit,
			})
		}
	}
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "auto" {
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyAutoGroup)
	}
	subscriptionID, planLimit, err := model.GetActiveSubscriptionConcurrency(userID, usingGroup)
	if err != nil {
		common.SysError(common.LogText("failed to load subscription concurrency limit: %s", err.Error()))
		return noop, types.NewErrorWithStatusCode(
			errors.New("Failed to load subscription concurrency limit"),
			types.ErrorCodeUpdateDataError,
			http.StatusInternalServerError,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	}
	if subscriptionID > 0 && planLimit > 0 {
		scopes = append(scopes, concurrency.Scope{
			Name:  fmt.Sprintf("subscription:%d", subscriptionID),
			Limit: planLimit,
		})
	}
	if len(scopes) == 0 {
		return noop, nil
	}

	lease, retryAfter, err := concurrency.Acquire(
		c.Request.Context(),
		owner,
		scopes,
		concurrency.DefaultLeaseTTL,
	)
	if err != nil {
		common.SysError(common.LogText("failed to acquire concurrency lease: %s", err.Error()))
		return noop, types.NewErrorWithStatusCode(
			errors.New("Concurrency limiter unavailable"),
			types.ErrorCodeUpdateDataError,
			http.StatusServiceUnavailable,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	}
	if retryAfter > 0 {
		retrySeconds := max(int64(math.Ceil(retryAfter.Seconds())), int64(1))
		c.Header("Retry-After", strconv.FormatInt(retrySeconds, 10))
		return noop, types.NewErrorWithStatusCode(
			errors.New("Too many concurrent requests"),
			types.ErrorCodeRateLimitExceeded,
			http.StatusTooManyRequests,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	}

	c.Set(concurrency.ContextKeyLease, lease)
	stopHeartbeat := startConcurrencyHeartbeat(lease)
	return func() {
		stopHeartbeat()
		if _, held := c.Get(concurrency.ContextKeyTaskHold); held {
			return
		}
		if err := concurrency.Release(context.Background(), lease); err != nil {
			common.SysError(common.LogText("failed to release concurrency lease %s: %s", lease.Owner, err.Error()))
		}
	}, nil
}

func startConcurrencyHeartbeat(lease concurrency.Lease) func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		interval := concurrency.DefaultLeaseTTL / 3
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ok, err := concurrency.Refresh(context.Background(), lease, concurrency.DefaultLeaseTTL)
				if err != nil {
					common.SysError(common.LogText("failed to refresh concurrency lease %s: %s", lease.Owner, err.Error()))
					continue
				}
				if !ok {
					return
				}
			}
		}
	}()
	return func() {
		cancel()
		<-done
	}
}
