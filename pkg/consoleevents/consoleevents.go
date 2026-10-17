// Package consoleevents delivers change signals for console panels
// (announcements, notice) to browser clients over Server-Sent Events. Local
// subscribers are notified directly; other instances receive the event
// through Redis pub/sub when Redis is enabled.
package consoleevents

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	// TopicAnnouncements signals that the console announcements changed.
	TopicAnnouncements = "announcements"
	// TopicNotice signals that the console notice changed.
	TopicNotice = "notice"

	redisChannelPrefix = "new-api:console-events"

	// maxStreamsPerIP caps concurrent streams per client IP. Browsers use one
	// stream per console tab, so the limit only rejects scripted abuse.
	maxStreamsPerIP = 64
	// subscriberBuffer absorbs bursts; a client that cannot keep up loses
	// events and recovers through the resync sent on its next connect.
	subscriberBuffer    = 8
	redisPublishTimeout = 3 * time.Second
	redisSubscribeAck   = 5 * time.Second
)

// Event carries the topics that changed.
type Event struct {
	Topics []string
}

// optionTopics maps an option key to the console topic its change affects.
var optionTopics = map[string]string{
	"console_setting.announcements":         TopicAnnouncements,
	"console_setting.announcements_enabled": TopicAnnouncements,
	"Notice":                                TopicNotice,
}

type redisEvent struct {
	Keys   []string `json:"keys"`
	Origin string   `json:"origin"`
}

var (
	subscribersMu sync.Mutex
	nextSubID     uint64
	subscribers   = map[uint64]chan Event{}

	subscriberOnce sync.Once
	originOnce     sync.Once
	originID       string

	reloadMu   sync.RWMutex
	reloadFunc func(optionKey string)

	shutdownOnce sync.Once
	shutdownCh   = make(chan struct{})

	streamsMu   sync.Mutex
	streamsByIP = map[string]int{}
)

// SetReloadOptionFunc registers how this instance applies an option change
// reported by another instance. In production this reloads the option from the
// database into the in-memory map, which then broadcasts through the normal
// change-detection path. Set it before StartSubscriber.
func SetReloadOptionFunc(fn func(optionKey string)) {
	reloadMu.Lock()
	defer reloadMu.Unlock()
	reloadFunc = fn
}

// Subscribe registers a local event subscriber. The returned cancel function
// is idempotent and stops delivery.
func Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)

	subscribersMu.Lock()
	nextSubID++
	id := nextSubID
	subscribers[id] = ch
	subscribersMu.Unlock()

	var once sync.Once
	return ch, func() {
		once.Do(func() {
			subscribersMu.Lock()
			delete(subscribers, id)
			subscribersMu.Unlock()
		})
	}
}

// PublishOptionChange notifies every console client when the option key
// affects a console panel. Callers should only invoke it after the in-memory
// option value actually changed, because console sync reloads options
// periodically without user-visible changes.
func PublishOptionChange(key string) {
	topic, ok := optionTopics[key]
	if !ok {
		return
	}
	broadcast([]string{topic})
	if common.RedisEnabled && common.RDB != nil {
		go publishRedis(key)
	}
}

// StartSubscriber relays events published by other instances into the local
// hub. It is a no-op when Redis is not enabled.
func StartSubscriber(ctx context.Context) {
	rdb := common.RDB
	if !common.RedisEnabled || rdb == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	subscriberOnce.Do(func() {
		pubsub := rdb.Subscribe(ctx, redisTopic(rdb.Options().DB))
		// Wait for the subscription acknowledgement so callers and tests know
		// the subscription is live, but never block startup on a dead Redis.
		ackCtx, cancel := context.WithTimeout(ctx, redisSubscribeAck)
		_, err := pubsub.Receive(ackCtx)
		cancel()
		if err != nil {
			common.SysLog(common.LogText("failed to subscribe console events: %s", err.Error()))
			_ = pubsub.Close()
			return
		}
		go func() {
			defer pubsub.Close()
			channel := pubsub.Channel()
			for {
				select {
				case <-ctx.Done():
					return
				case msg, ok := <-channel:
					if !ok {
						return
					}
					handleRedisEvent([]byte(msg.Payload))
				}
			}
		}()
	})
}

// handleRedisEvent applies an event published by another instance. With a
// reload function the local option map is refreshed first, and the normal
// change-detection path broadcasts; the reload-then-broadcast order keeps a
// client refetch from reading the stale in-memory value.
func handleRedisEvent(payload []byte) {
	var event redisEvent
	if err := common.Unmarshal(payload, &event); err != nil {
		common.SysLog(common.LogText("failed to unmarshal console event: %s", err.Error()))
		return
	}
	if event.Origin == getOriginID() {
		return
	}
	reloadMu.RLock()
	reload := reloadFunc
	reloadMu.RUnlock()
	if reload == nil {
		for _, key := range event.Keys {
			if topic, ok := optionTopics[key]; ok {
				broadcast([]string{topic})
			}
		}
		return
	}
	for _, key := range event.Keys {
		reload(key)
	}
}

// Shutdown asks active stream handlers to close so a graceful HTTP shutdown
// does not wait for long-lived connections.
func Shutdown() {
	shutdownOnce.Do(func() {
		close(shutdownCh)
	})
}

// Done is closed once Shutdown is called.
func Done() <-chan struct{} {
	return shutdownCh
}

// AcquireStream reserves a stream slot for the client IP. It reports false
// when the IP already holds maxStreamsPerIP streams.
func AcquireStream(ip string) bool {
	streamsMu.Lock()
	defer streamsMu.Unlock()
	if streamsByIP[ip] >= maxStreamsPerIP {
		return false
	}
	streamsByIP[ip]++
	return true
}

// ReleaseStream frees a slot reserved by AcquireStream.
func ReleaseStream(ip string) {
	streamsMu.Lock()
	defer streamsMu.Unlock()
	if streamsByIP[ip] <= 1 {
		delete(streamsByIP, ip)
		return
	}
	streamsByIP[ip]--
}

func broadcast(topics []string) {
	if len(topics) == 0 {
		return
	}
	event := Event{Topics: topics}
	subscribersMu.Lock()
	defer subscribersMu.Unlock()
	for _, ch := range subscribers {
		select {
		case ch <- event:
		default: // Slow subscriber: drop instead of blocking the publisher.
		}
	}
}

func publishRedis(key string) {
	rdb := common.RDB
	if !common.RedisEnabled || rdb == nil {
		return
	}
	payload, err := common.Marshal(redisEvent{
		Keys:   []string{key},
		Origin: getOriginID(),
	})
	if err != nil {
		common.SysLog(common.LogText("failed to marshal console event: %s", err.Error()))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), redisPublishTimeout)
	defer cancel()
	if err := rdb.Publish(ctx, redisTopic(rdb.Options().DB), payload).Err(); err != nil {
		common.SysLog(common.LogText("failed to publish console event: %s", err.Error()))
	}
}

func redisTopic(database int) string {
	// Redis Pub/Sub crosses logical databases, unlike cache keys. Include the
	// selected database so independent deployments cannot cross-notify.
	return fmt.Sprintf("%s:db:%d", redisChannelPrefix, database)
}

func getOriginID() string {
	originOnce.Do(func() {
		name := common.NodeName
		if name == "" {
			name = "node"
		}
		originID = fmt.Sprintf("%s-%d-%d", name, os.Getpid(), time.Now().UnixNano())
	})
	return originID
}
