package controller

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/pkg/consoleevents"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// readEventBlock reads one SSE block (the lines up to the blank separator).
func readEventBlock(t *testing.T, reader *bufio.Reader) string {
	t.Helper()
	var block strings.Builder
	for {
		line, err := reader.ReadString('\n')
		require.NoError(t, err)
		block.WriteString(line)
		if line == "\n" {
			return block.String()
		}
	}
}

func TestNotificationStreamPushesTopicEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// The production /api group compresses responses; the stream must keep
	// working (and stay uncompressed) through that middleware.
	engine.Use(gzip.Gzip(gzip.DefaultCompression))
	engine.GET("/api/notifications/stream", NotificationStream)
	server := httptest.NewServer(engine)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/notifications/stream", nil)
	require.NoError(t, err)
	request.Header.Set("Accept-Encoding", "gzip")
	// EventSource sends this Accept header, which is what makes the gzip
	// middleware skip the stream.
	request.Header.Set("Accept", "text/event-stream")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()

	require.Equal(t, http.StatusOK, response.StatusCode)
	assert.Equal(t, "text/event-stream", response.Header.Get("Content-Type"))
	assert.Equal(t, "no-cache", response.Header.Get("Cache-Control"))
	assert.Equal(t, "no", response.Header.Get("X-Accel-Buffering"))
	assert.Empty(t, response.Header.Get("Content-Encoding"), "the stream is not compressed")

	reader := bufio.NewReader(response.Body)
	assert.Equal(t, "retry: 15000\n\n", readEventBlock(t, reader))
	// The ready event proves registration finished, so a publish after reading
	// it must reach this stream.
	assert.Equal(t, "event: ready\ndata: {}\n\n", readEventBlock(t, reader))

	consoleevents.PublishOptionChange("console_setting.announcements")
	assert.Equal(t, "event: announcements\ndata: {}\n\n", readEventBlock(t, reader))

	consoleevents.PublishOptionChange("Notice")
	assert.Equal(t, "event: notice\ndata: {}\n\n", readEventBlock(t, reader))
}
