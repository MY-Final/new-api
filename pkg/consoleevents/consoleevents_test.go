package consoleevents

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	goredis "github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// receiveEvent reads one event with a safety timeout so a broken publish path
// fails the test instead of hanging it.
func receiveEvent(t *testing.T, events <-chan Event) Event {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for console event")
		return Event{}
	}
}

// stubRedis installs a miniredis-backed client as the process Redis so
// publish/subscribe paths can be exercised without a real server.
func stubRedis(t *testing.T) (*goredis.Client, *goredis.Client) {
	t.Helper()
	previousEnabled, previousRDB := common.RedisEnabled, common.RDB
	address := os.Getenv("TEST_CONSOLE_EVENTS_REDIS_ADDR")
	if address == "" {
		address = miniredis.RunT(t).Addr()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	publisher := goredis.NewClient(&goredis.Options{Addr: address, DB: 0})
	subscriber := goredis.NewClient(&goredis.Options{Addr: address, DB: 0})
	require.NoError(t, publisher.Ping(ctx).Err())
	require.NoError(t, subscriber.Ping(ctx).Err())
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousEnabled, previousRDB
		require.NoError(t, publisher.Close())
		require.NoError(t, subscriber.Close())
	})
	common.RedisEnabled, common.RDB = true, publisher
	return publisher, subscriber
}

func disableRedisForTest(t *testing.T) {
	t.Helper()
	previousEnabled, previousRDB := common.RedisEnabled, common.RDB
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousEnabled, previousRDB
	})
	common.RedisEnabled, common.RDB = false, nil
}

func TestPublishOptionChangeSendsMappedTopics(t *testing.T) {
	disableRedisForTest(t)
	events, cancel := Subscribe()
	defer cancel()

	PublishOptionChange("console_setting.announcements")
	assert.Equal(t, []string{TopicAnnouncements}, receiveEvent(t, events).Topics)

	PublishOptionChange("console_setting.announcements_enabled")
	assert.Equal(t, []string{TopicAnnouncements}, receiveEvent(t, events).Topics)

	PublishOptionChange("Notice")
	assert.Equal(t, []string{TopicNotice}, receiveEvent(t, events).Topics)
}

func TestPublishOptionChangeIgnoresUnmappedOptions(t *testing.T) {
	disableRedisForTest(t)
	events, cancel := Subscribe()
	defer cancel()

	PublishOptionChange("SystemName")

	select {
	case event := <-events:
		t.Fatalf("unexpected event for unmapped option: %v", event.Topics)
	default:
	}
}

func TestCancelStopsDelivery(t *testing.T) {
	disableRedisForTest(t)
	events, cancel := Subscribe()
	cancel()
	cancel()

	PublishOptionChange("Notice")

	select {
	case event := <-events:
		t.Fatalf("canceled subscriber received event: %v", event.Topics)
	default:
	}
}

func TestPublishRedisCarriesKeyAndOrigin(t *testing.T) {
	_, subscriber := stubRedis(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pubsub := subscriber.Subscribe(ctx, redisTopic(subscriber.Options().DB))
	defer pubsub.Close()
	_, err := pubsub.Receive(ctx)
	require.NoError(t, err, "wait for the subscription acknowledgement before publishing")

	PublishOptionChange("Notice")

	select {
	case message := <-pubsub.Channel():
		var event redisEvent
		require.NoError(t, common.Unmarshal([]byte(message.Payload), &event))
		assert.Equal(t, []string{"Notice"}, event.Keys)
		assert.Equal(t, getOriginID(), event.Origin)
	case <-ctx.Done():
		t.Fatal("timed out waiting for the redis console event")
	}
}

func TestStartSubscriberRelaysForeignEventsAndSkipsOwnOrigin(t *testing.T) {
	publisher, _ := stubRedis(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	StartSubscriber(ctx)

	events, unsubscribe := Subscribe()
	defer unsubscribe()

	own, err := common.Marshal(redisEvent{Keys: []string{"Notice"}, Origin: getOriginID()})
	require.NoError(t, err)
	require.NoError(t, publisher.Publish(ctx, redisTopic(0), own).Err())

	foreign, err := common.Marshal(redisEvent{Keys: []string{"console_setting.announcements"}, Origin: "other-instance"})
	require.NoError(t, err)
	require.NoError(t, publisher.Publish(ctx, redisTopic(0), foreign).Err())

	// Redis preserves publication order on one channel: by the time the
	// foreign event arrives, the own-origin event must have been skipped.
	assert.Equal(t, []string{TopicAnnouncements}, receiveEvent(t, events).Topics)
}

func TestHandleRedisEventAppliesReloadFuncForKeyChanges(t *testing.T) {
	var reloaded []string
	SetReloadOptionFunc(func(key string) { reloaded = append(reloaded, key) })
	t.Cleanup(func() { SetReloadOptionFunc(nil) })

	events, unsubscribe := Subscribe()
	defer unsubscribe()

	payload, err := common.Marshal(redisEvent{
		Keys:   []string{"console_setting.announcements", "Notice"},
		Origin: "other-instance",
	})
	require.NoError(t, err)
	handleRedisEvent(payload)

	assert.Equal(t, []string{"console_setting.announcements", "Notice"}, reloaded, "the reload function owns applying and broadcasting the change")
	select {
	case event := <-events:
		t.Fatalf("unexpected direct broadcast when a reload function is set: %v", event.Topics)
	default:
	}

	handleRedisEvent([]byte("not-json"))
	assert.Equal(t, []string{"console_setting.announcements", "Notice"}, reloaded, "malformed payloads are ignored")

	own, err := common.Marshal(redisEvent{Keys: []string{"Notice"}, Origin: getOriginID()})
	require.NoError(t, err)
	handleRedisEvent(own)
	assert.Equal(t, []string{"console_setting.announcements", "Notice"}, reloaded, "own-origin events are not reloaded")
}

func TestAcquireStreamEnforcesPerIPLimit(t *testing.T) {
	const ip, otherIP = "203.0.113.7", "203.0.113.8"
	for range maxStreamsPerIP {
		require.True(t, AcquireStream(ip))
	}
	assert.False(t, AcquireStream(ip), "the limit rejects one more stream for the same IP")
	assert.True(t, AcquireStream(otherIP), "other IPs keep their own slots")
	t.Cleanup(func() {
		for range maxStreamsPerIP {
			ReleaseStream(ip)
		}
		ReleaseStream(otherIP)
	})

	ReleaseStream(ip)
	assert.True(t, AcquireStream(ip), "released slots become available again")
}

func TestShutdownClosesDone(t *testing.T) {
	Shutdown()

	select {
	case <-Done():
	default:
		t.Fatal("Done should be closed after Shutdown")
	}
}
