package controller

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/pkg/consoleevents"

	"github.com/gin-gonic/gin"
)

const notificationStreamHeartbeat = 25 * time.Second

// NotificationStream keeps a Server-Sent Events connection open and pushes one
// named event per changed console topic. The payload is intentionally empty:
// clients refetch /api/status and /api/notice, which remain the single source
// of truth. A "ready" event is sent right after registration so a client can
// resync when it reconnects after a missed window.
func NotificationStream(c *gin.Context) {
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	ip := c.ClientIP()
	if !consoleevents.AcquireStream(ip) {
		c.AbortWithStatus(http.StatusTooManyRequests)
		return
	}
	defer consoleevents.ReleaseStream(ip)

	events, unsubscribe := consoleevents.Subscribe()
	defer unsubscribe()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	// Browsers only honor the retry field from the stream body; it applies to
	// every reconnect after a drop.
	fmt.Fprint(c.Writer, "retry: 15000\n\n")
	fmt.Fprint(c.Writer, "event: ready\ndata: {}\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(notificationStreamHeartbeat)
	defer heartbeat.Stop()
	ctx := c.Request.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case <-consoleevents.Done():
			return
		case <-heartbeat.C:
			fmt.Fprint(c.Writer, ": keep-alive\n\n")
			flusher.Flush()
		case event, ok := <-events:
			if !ok {
				return
			}
			for _, topic := range event.Topics {
				fmt.Fprintf(c.Writer, "event: %s\ndata: {}\n\n", topic)
			}
			flusher.Flush()
		}
	}
}
