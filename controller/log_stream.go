package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func StreamLogs(c *gin.Context) {
	streamLogChanges(c, true)
}

func StreamUserLogs(c *gin.Context) {
	streamLogChanges(c, false)
}

func logStreamAuthorized(c *gin.Context, all bool) bool {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		return false
	}
	scheme, raw, ok := strings.Cut(c.GetHeader("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return false
	}
	current, err := service.ParseAccessToken(raw)
	if err != nil || current != identity {
		return false
	}
	_, user, err := service.ValidateLoginSession(identity)
	if err != nil || !common.IsValidateRole(user.Role) || strings.TrimSpace(user.Username) == "" {
		return false
	}
	minimumRole := common.RoleCommonUser
	if all {
		minimumRole = common.RoleAdminUser
	}
	return user.Role >= minimumRole
}

func streamLogChanges(c *gin.Context, all bool) {
	if !logStreamAuthorized(c, all) {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	changes, cancel := common.UsageLogNotifications.Subscribe(c.GetInt("id"), all)
	if cancel == nil {
		c.Header("Retry-After", "30")
		c.AbortWithStatus(http.StatusTooManyRequests)
		return
	}
	defer cancel()
	intervalSeconds := common.GetEnvOrDefault("LOG_SSE_USER_REFRESH_SECONDS", 3)
	if all {
		intervalSeconds = common.GetEnvOrDefault("LOG_SSE_ADMIN_REFRESH_SECONDS", 5)
	}
	interval := time.Duration(max(1, min(intervalSeconds, 60))) * time.Second
	ready, err := common.Marshal(map[string]int64{"refresh_interval_ms": interval.Milliseconds()})
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-store, no-transform")
	c.Header("X-Accel-Buffering", "no")
	write := func(event string, data string) bool {
		if !logStreamAuthorized(c, all) {
			return false
		}
		response := http.NewResponseController(c.Writer)
		_ = response.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data); err != nil {
			return false
		}
		err := response.Flush()
		_ = response.SetWriteDeadline(time.Time{})
		return err == nil
	}
	if !write("ready", string(ready)) {
		return
	}
	flush := time.NewTicker(interval)
	defer flush.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	resync := time.NewTicker(time.Minute)
	defer resync.Stop()
	lifetime := time.NewTimer(5 * time.Minute)
	defer lifetime.Stop()
	dirty := false
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-lifetime.C:
			return
		case <-changes:
			dirty = true
		case <-flush.C:
			if dirty {
				dirty = false
				if !write("changed", "{}") {
					return
				}
			}
		case <-heartbeat.C:
			if !write("heartbeat", "{}") {
				return
			}
		case <-resync.C:
			if !write("resync", "{}") {
				return
			}
		}
	}
}
