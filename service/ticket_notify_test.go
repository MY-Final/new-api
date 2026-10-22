package service

import (
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type ticketNotification struct {
	purpose  string
	subject  string
	receiver string
	body     string
}

// stubTicketNotifySender swaps the mail transport and the option map so the
// notification path runs end to end without SMTP or a database.
func stubTicketNotifySender(t *testing.T, notifyEmail string) <-chan ticketNotification {
	t.Helper()
	options := map[string]string{}
	if notifyEmail != "" {
		encoded, err := common.Marshal(system_setting.TicketStorageConfig{RetentionDays: 30, NotifyEmail: notifyEmail})
		require.NoError(t, err)
		options[system_setting.TicketStorageOption] = string(encoded)
	}
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = options
	common.OptionMapRWMutex.Unlock()
	oldSender := ticketNotifySender
	sent := make(chan ticketNotification, 1)
	ticketNotifySender = func(purpose string, subject string, receiver string, content string) error {
		sent <- ticketNotification{purpose: purpose, subject: subject, receiver: receiver, body: content}
		return nil
	}
	t.Cleanup(func() {
		ticketNotifySender = oldSender
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	return sent
}

func requireTicketNotification(t *testing.T, sent <-chan ticketNotification) ticketNotification {
	t.Helper()
	select {
	case message := <-sent:
		return message
	case <-time.After(5 * time.Second):
		t.Fatal("ticket notification email was not sent")
		return ticketNotification{}
	}
}

func TestTicketNotificationEmailsTheConfiguredRecipient(t *testing.T) {
	sent := stubTicketNotifySender(t, "owner@example.com")
	ticket := &model.Ticket{ID: 12, Title: "Cannot call <model>", Category: "api", Status: "pending"}
	NotifyTicketCreated(ticket, "alice", "Failure details <script>alert(1)</script>")
	message := requireTicketNotification(t, sent)
	assert.Equal(t, common.EmailPurposeTicket, message.purpose)
	assert.Equal(t, "owner@example.com", message.receiver)
	assert.Equal(t, "[New API] New ticket #12: Cannot call <model>", message.subject)
	assert.Contains(t, message.body, "alice")
	assert.Contains(t, message.body, "Failure details")
	assert.Contains(t, message.body, "&lt;script&gt;")
	assert.NotContains(t, message.body, "<script>")
}

func TestTicketReplyNotificationGoesToEveryConfiguredRecipient(t *testing.T) {
	sent := stubTicketNotifySender(t, "owner@example.com;second@example.com")
	ticket := &model.Ticket{ID: 8, Title: "Quota issue", Category: "account", Status: "processing"}
	NotifyTicketReplied(ticket, "bob", "Still failing")
	message := requireTicketNotification(t, sent)
	assert.Equal(t, "owner@example.com;second@example.com", message.receiver)
	assert.Equal(t, "[New API] New reply #8: Quota issue", message.subject)
	assert.Contains(t, message.body, "Still failing")
}

func TestTicketNotificationTruncatesLongMessages(t *testing.T) {
	sent := stubTicketNotifySender(t, "owner@example.com")
	ticket := &model.Ticket{ID: 3, Title: "Long", Category: "api", Status: "pending"}
	NotifyTicketCreated(ticket, "alice", strings.Repeat("x", 1200))
	message := requireTicketNotification(t, sent)
	assert.Contains(t, message.body, "...")
	assert.NotContains(t, message.body, strings.Repeat("x", 1001))
}

func TestTicketNotificationStaysOffWithoutARecipient(t *testing.T) {
	sent := stubTicketNotifySender(t, "")
	assert.Empty(t, model.TicketNotifyEmail())
	NotifyTicketCreated(&model.Ticket{ID: 4, Title: "No recipient"}, "alice", "hello")
	select {
	case message := <-sent:
		t.Fatalf("unexpected notification email: %+v", message)
	default:
	}
}
