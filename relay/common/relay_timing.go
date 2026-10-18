package common

import (
	"sync"
	"time"
)

// RelayInfo is occasionally copied by value. Keep timing's lock behind a
// pointer; the initialization lock also supports directly constructed infos.
var relayTimingInit sync.Mutex

type relayTiming struct {
	mu                  sync.Mutex
	entry               time.Time
	entrySource         string
	relayStarted        time.Time
	attempt             int
	channelID           int
	upstreamRequested   time.Time
	upstreamHeaders     time.Time
	firstOutputReceived time.Time
	firstOutputWritten  time.Time
	responseCompleted   time.Time
}

func (info *RelayInfo) relayTimingState() *relayTiming {
	if info == nil {
		return nil
	}
	relayTimingInit.Lock()
	defer relayTimingInit.Unlock()
	if info.timing == nil {
		entry := info.StartTime
		entrySource := "request_start"
		if entry.IsZero() {
			entry = time.Now()
			entrySource = "timing_initialized"
		}
		info.timing = &relayTiming{entry: entry, entrySource: entrySource}
	}
	return info.timing
}

func (info *RelayInfo) beginTimingAttempt(attempt, channelID int) {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	timing.attempt = attempt
	timing.channelID = channelID
	timing.upstreamRequested = time.Time{}
	timing.upstreamHeaders = time.Time{}
	timing.firstOutputReceived = time.Time{}
	timing.firstOutputWritten = time.Time{}
	timing.responseCompleted = time.Time{}
}

// MarkUpstreamRequestStarted starts the current HTTP exchange. A new exchange
// cannot inherit response milestones from a failed attempt.
func (info *RelayInfo) MarkUpstreamRequestStarted() {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	timing.upstreamRequested = time.Now()
	timing.upstreamHeaders = time.Time{}
	timing.firstOutputReceived = time.Time{}
	timing.firstOutputWritten = time.Time{}
	timing.responseCompleted = time.Time{}
}

func (info *RelayInfo) MarkUpstreamResponseHeaders() {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	if !timing.upstreamRequested.IsZero() && timing.upstreamHeaders.IsZero() {
		timing.upstreamHeaders = time.Now()
	}
}

// MarkFirstOutputReceived excludes role-only, usage-only and keepalive events.
// The protocol handler calls it only after recognizing meaningful output.
func (info *RelayInfo) MarkFirstOutputReceived() {
	info.MarkFirstOutputReceivedAt(time.Now())
}

// MarkFirstOutputReceivedAt retains the scanner's receive time so waiting in
// the handler queue is not charged to upstream generation latency.
func (info *RelayInfo) MarkFirstOutputReceivedAt(receivedAt time.Time) {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	if timing.firstOutputReceived.IsZero() {
		if receivedAt.IsZero() {
			receivedAt = time.Now()
		}
		timing.firstOutputReceived = receivedAt
	}
}

// MarkFirstOutputWritten records a successful output write, not an upstream
// arrival or an attempted write that failed after the client disconnected.
func (info *RelayInfo) MarkFirstOutputWritten() {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	if !timing.firstOutputReceived.IsZero() && timing.firstOutputWritten.IsZero() {
		timing.firstOutputWritten = time.Now()
	}
}

// MarkResponseCompleted is called only after the complete response was sent.
// Log sampling itself must not mark a cancelled or partial response complete.
func (info *RelayInfo) MarkResponseCompleted() {
	timing := info.relayTimingState()
	if timing == nil {
		return
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	if timing.responseCompleted.IsZero() {
		timing.responseCompleted = time.Now()
	}
}

// TimingSnapshot returns millisecond offsets from request entry. Response
// milestones describe only the current attempt; unavailable stages are omitted.
// elapsed_at_log_ms is a sample, never a claim that delivery completed.
func (info *RelayInfo) TimingSnapshot() map[string]any {
	timing := info.relayTimingState()
	if timing == nil {
		return nil
	}
	timing.mu.Lock()
	defer timing.mu.Unlock()
	snapshot := map[string]any{
		"offsets_from":      timing.entrySource,
		"elapsed_at_log_ms": float64(time.Since(timing.entry)) / float64(time.Millisecond),
	}
	if timing.attempt > 0 {
		snapshot["attempt"] = timing.attempt
		snapshot["channel_id"] = timing.channelID
	}
	for name, stamp := range map[string]time.Time{
		"relay_start_ms":           timing.relayStarted,
		"upstream_request_ms":      timing.upstreamRequested,
		"upstream_headers_ms":      timing.upstreamHeaders,
		"first_output_received_ms": timing.firstOutputReceived,
		"first_output_written_ms":  timing.firstOutputWritten,
		"response_completed_ms":    timing.responseCompleted,
	} {
		if !stamp.IsZero() && !stamp.Before(timing.entry) {
			snapshot[name] = float64(stamp.Sub(timing.entry)) / float64(time.Millisecond)
		}
	}
	return snapshot
}
