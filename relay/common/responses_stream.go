package common

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ResponsesStreamLifetime lets an upstream stream finish reporting usage for a
// bounded time after its client disconnects. The original request context stays
// attached to the client; only the upstream request uses Context.
type ResponsesStreamLifetime struct {
	ctx        context.Context
	cancel     context.CancelFunc
	grace      time.Duration
	clientDone chan struct{}

	mu              sync.Mutex
	clientErr       error
	timer           *time.Timer
	stopClientWatch func() bool
	closed          bool
}

func NewResponsesStreamLifetime(clientCtx context.Context, grace time.Duration) *ResponsesStreamLifetime {
	upstreamCtx := context.WithoutCancel(clientCtx)
	var cancel context.CancelFunc
	if deadline, ok := clientCtx.Deadline(); ok {
		// A disconnect may delay cancellation, but must never extend an explicit
		// request deadline, including one that follows an earlier client cancel.
		upstreamCtx, cancel = context.WithDeadline(upstreamCtx, deadline)
	} else {
		upstreamCtx, cancel = context.WithCancel(upstreamCtx)
	}
	lifetime := &ResponsesStreamLifetime{
		ctx:        upstreamCtx,
		cancel:     cancel,
		grace:      min(max(grace, 0), time.Hour),
		clientDone: make(chan struct{}),
	}
	lifetime.stopClientWatch = context.AfterFunc(clientCtx, func() {
		lifetime.Disconnect(clientCtx.Err())
	})
	return lifetime
}

func (l *ResponsesStreamLifetime) Context() context.Context {
	return l.ctx
}

func (l *ResponsesStreamLifetime) ClientDone() <-chan struct{} {
	return l.clientDone
}

func (l *ResponsesStreamLifetime) ClientError() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.clientErr
}

func (l *ResponsesStreamLifetime) Disconnected() bool {
	return l.ClientError() != nil
}

// Disconnect also handles a downstream write failure before net/http cancels
// the client context. Only the first disconnect starts the grace timer.
func (l *ResponsesStreamLifetime) Disconnect(err error) {
	if err == nil {
		err = context.Canceled
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	if l.clientErr == nil {
		l.clientErr = err
		close(l.clientDone)
		if l.grace > 0 && !errors.Is(err, context.DeadlineExceeded) {
			l.timer = time.AfterFunc(l.grace, l.cancel)
			return
		}
		l.cancel()
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		l.cancel()
	}
}

func (l *ResponsesStreamLifetime) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	l.closed = true
	l.stopClientWatch()
	if l.timer != nil {
		l.timer.Stop()
	}
	l.cancel()
}
