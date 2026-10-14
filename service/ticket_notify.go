package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const ticketNotifyExcerptLimit = 1000

// ticketNotifySender is a variable so tests can observe outgoing mail without
// running a live SMTP server.
var ticketNotifySender = common.SendEmail

func NotifyTicketCreated(ticket *model.Ticket, username string, content string) {
	notifyTicketEmail(ticket, username, content, "New ticket")
}

func NotifyTicketReplied(ticket *model.Ticket, username string, content string) {
	notifyTicketEmail(ticket, username, content, "New reply")
}

// notifyTicketEmail sends in the background: a slow or unreachable mail server
// must never delay or fail the ticket request that triggered it.
func notifyTicketEmail(ticket *model.Ticket, username string, content string, kind string) {
	if ticket == nil {
		return
	}
	receiver := model.TicketNotifyEmail()
	if receiver == "" {
		return
	}
	subject, body, err := RenderEmailTemplate("ticket", map[string]string{
		"Kind":     kind,
		"TicketID": fmt.Sprint(ticket.ID),
		"Title":    ticket.Title,
		"Category": ticket.Category,
		"Status":   ticket.Status,
		"User":     username,
		"Content":  ticketNotifyExcerpt(content),
	})
	if err != nil {
		common.SysError(fmt.Sprintf("failed to render ticket notification #%d", ticket.ID))
		return
	}
	go func() {
		if err := ticketNotifySender(subject, receiver, body); err != nil {
			common.SysError(fmt.Sprintf("failed to send ticket notification #%d: %s", ticket.ID, err.Error()))
		}
	}()
}

func ticketNotifyExcerpt(content string) string {
	trimmed := strings.TrimSpace(content)
	if utf8.RuneCountInString(trimmed) <= ticketNotifyExcerptLimit {
		return trimmed
	}
	return string([]rune(trimmed)[:ticketNotifyExcerptLimit]) + "..."
}
