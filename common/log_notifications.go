package common

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

type LogNotificationBroker struct {
	mu          sync.Mutex
	users       map[int]map[chan struct{}]bool
	admins      map[chan struct{}]bool
	connections map[int]int
	pending     map[int]bool
	source      string
}

var UsageLogNotifications = NewLogNotificationBroker()

func NewLogNotificationBroker() *LogNotificationBroker {
	return &LogNotificationBroker{
		users:       make(map[int]map[chan struct{}]bool),
		admins:      make(map[chan struct{}]bool),
		connections: make(map[int]int),
		source:      uuid.NewString(),
	}
}

func (broker *LogNotificationBroker) Subscribe(userID int, all bool) (<-chan struct{}, func()) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	if userID <= 0 || broker.connections[userID] >= 3 || len(broker.connections) >= 5000 {
		return nil, nil
	}
	changes := make(chan struct{}, 1)
	broker.connections[userID]++
	if all {
		broker.admins[changes] = true
	} else {
		if broker.users[userID] == nil {
			broker.users[userID] = make(map[chan struct{}]bool)
		}
		broker.users[userID][changes] = true
	}
	cancel := sync.OnceFunc(func() {
		broker.mu.Lock()
		defer broker.mu.Unlock()
		delete(broker.admins, changes)
		delete(broker.users[userID], changes)
		if len(broker.users[userID]) == 0 {
			delete(broker.users, userID)
		}
		broker.connections[userID]--
		if broker.connections[userID] == 0 {
			delete(broker.connections, userID)
		}
	})
	return changes, cancel
}

func (broker *LogNotificationBroker) notify(userID int) {
	for changes := range broker.users[userID] {
		select {
		case changes <- struct{}{}:
		default:
		}
	}
	for changes := range broker.admins {
		select {
		case changes <- struct{}{}:
		default:
		}
	}
}

func (broker *LogNotificationBroker) Publish(userID int) {
	broker.mu.Lock()
	defer broker.mu.Unlock()
	broker.notify(userID)
	if broker.pending != nil {
		broker.pending[userID] = true
	}
}

func (broker *LogNotificationBroker) Run(ctx context.Context, client *redis.Client) {
	if client == nil {
		return
	}
	topic := fmt.Sprintf("new-api:usage-log-changes:v1:%d", client.Options().DB)
	subscription := client.Subscribe(ctx, topic)
	defer subscription.Close()
	messages := subscription.Channel()
	broker.mu.Lock()
	broker.pending = make(map[int]bool)
	broker.mu.Unlock()
	defer func() {
		broker.mu.Lock()
		broker.pending = nil
		broker.mu.Unlock()
	}()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	publishFailed := false
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			var batch struct {
				Source string `json:"source"`
				Users  []int  `json:"users"`
			}
			if UnmarshalJsonStr(message.Payload, &batch) != nil || batch.Source == broker.source {
				continue
			}
			broker.mu.Lock()
			for _, userID := range batch.Users {
				broker.notify(userID)
			}
			broker.mu.Unlock()
		case <-ticker.C:
			broker.mu.Lock()
			users := make([]int, 0, len(broker.pending))
			for userID := range broker.pending {
				users = append(users, userID)
			}
			clear(broker.pending)
			broker.mu.Unlock()
			if len(users) == 0 {
				continue
			}
			payload, err := Marshal(struct {
				Source string `json:"source"`
				Users  []int  `json:"users"`
			}{Source: broker.source, Users: users})
			if err == nil {
				publishCtx, cancel := context.WithTimeout(ctx, time.Second)
				err = client.Publish(publishCtx, topic, payload).Err()
				cancel()
			}
			if err != nil && !publishFailed {
				SysError(LogText("failed to publish usage log notifications: %v", err))
			}
			publishFailed = err != nil
		}
	}
}
