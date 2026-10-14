package model

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrTicketNotFound = errors.New("Ticket not found")
	ErrTicketInvalid  = errors.New("Invalid ticket request")
	ErrTicketLimit    = errors.New("You have too many open tickets")
	ErrTicketConflict = errors.New("Ticket changed. Refresh and try again")
)

var TicketStatuses = []string{"pending", "processing", "waiting", "resolved", "closed"}
var TicketCategories = []string{"api", "payment", "account", "suggestion", "other"}

// TicketActor is supplied only from authenticated server context.
type TicketActor struct {
	UserID int
	Staff  bool
}

type Ticket struct {
	ID          int    `json:"id" gorm:"primaryKey"`
	UserID      int    `json:"user_id" gorm:"not null;index:idx_ticket_owner_status,priority:1;uniqueIndex:idx_ticket_create,priority:1"`
	CreateKey   string `json:"-" gorm:"type:varchar(64);not null;uniqueIndex:idx_ticket_create,priority:2"`
	CreateHash  string `json:"-" gorm:"type:char(64);not null"`
	Title       string `json:"title" gorm:"type:varchar(160);not null"`
	Category    string `json:"category" gorm:"type:varchar(32);not null;index"`
	RequestID   string `json:"request_id" gorm:"type:varchar(128)"`
	OrderNumber string `json:"order_number" gorm:"type:varchar(128)"`
	ModelName   string `json:"model_name" gorm:"type:varchar(128)"`
	OccurredAt  int64  `json:"occurred_at"`
	Status      string `json:"status" gorm:"type:varchar(20);not null;index:idx_ticket_owner_status,priority:2"`
	AssigneeID  int    `json:"assignee_id" gorm:"index"`
	Version     int64  `json:"version" gorm:"not null"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime;index"`
	ClosedAt    int64  `json:"closed_at" gorm:"index"`
	Unread      bool   `json:"unread" gorm:"->;-:migration"`
	// Account names are read-only display fields filled by scoped list queries.
	UserName     string `json:"user_name" gorm:"->;-:migration"`
	AssigneeName string `json:"assignee_name" gorm:"->;-:migration"`
	// Preview is the last message excerpt shown by the staff inbox.
	Preview           string `json:"preview" gorm:"->;-:migration"`
	PreviewSenderType string `json:"preview_sender_type" gorm:"->;-:migration"`
}

type TicketMessage struct {
	ID          int                `json:"id" gorm:"primaryKey"`
	TicketID    int                `json:"ticket_id" gorm:"not null;index;uniqueIndex:idx_ticket_message_key,priority:1"`
	SenderID    int                `json:"sender_id" gorm:"not null;uniqueIndex:idx_ticket_message_key,priority:2"`
	SenderType  string             `json:"sender_type" gorm:"type:varchar(12);not null"`
	Content     string             `json:"content" gorm:"type:text;not null"`
	RequestKey  string             `json:"-" gorm:"type:varchar(64);not null;uniqueIndex:idx_ticket_message_key,priority:3"`
	RequestHash string             `json:"-" gorm:"type:char(64);not null"`
	CreatedAt   int64              `json:"created_at" gorm:"autoCreateTime"`
	Attachments []TicketAttachment `json:"attachments" gorm:"-"`
	// Created marks a freshly inserted row. Idempotent replays load the stored
	// message instead, so callers can skip one-off side effects such as email.
	Created bool `json:"-" gorm:"-"`
	// SenderName is only filled for staff readers.
	SenderName string `json:"sender_name,omitempty" gorm:"-"`
}

// Data is retained only for migrating screenshots from the earlier DB storage.
type TicketAttachment struct {
	ID          int    `json:"id" gorm:"primaryKey"`
	TicketID    int    `json:"-" gorm:"not null;index"`
	MessageID   int    `json:"-" gorm:"not null;index"`
	Name        string `json:"name" gorm:"type:varchar(160);not null"`
	ContentType string `json:"content_type" gorm:"type:varchar(32);not null"`
	Data        []byte `json:"-"`
	ObjectKey   string `json:"-" gorm:"type:varchar(160);index"`
	Endpoint    string `json:"-" gorm:"type:varchar(160)"`
	Bucket      string `json:"-" gorm:"type:varchar(63)"`
	Size        int64  `json:"size"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	ExpiresAt   int64  `json:"expires_at" gorm:"index"`
}

type TicketEvent struct {
	ID         int    `json:"id" gorm:"primaryKey"`
	TicketID   int    `json:"-" gorm:"not null;index"`
	ActorID    int    `json:"actor_id"`
	Action     string `json:"action" gorm:"type:varchar(32);not null"`
	FromStatus string `json:"from_status" gorm:"type:varchar(20)"`
	ToStatus   string `json:"to_status" gorm:"type:varchar(20)"`
	AssigneeID int    `json:"assignee_id"`
	CreatedAt  int64  `json:"created_at" gorm:"autoCreateTime"`
}

type TicketRead struct {
	TicketID int   `gorm:"primaryKey;autoIncrement:false"`
	UserID   int   `gorm:"primaryKey;autoIncrement:false"`
	Version  int64 `gorm:"not null"`
}

type TicketDetail struct {
	Ticket    Ticket           `json:"ticket"`
	Requester *TicketRequester `json:"requester,omitempty"`
	Messages  []TicketMessage  `json:"messages"`
	Events    []TicketEvent    `json:"events"`
	HasMore   bool             `json:"has_more"`
}

// TicketRequester carries only the account fields staff need to identify and
// contact the person who opened a ticket.
type TicketRequester struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

type TicketFilter struct {
	Status, Category, Keyword string
	UserID                    int
	Offset, Limit             int
	Unread                    bool
}

// TicketStats powers the inbox sidebar counters.
type TicketStats struct {
	Pending    int64 `json:"pending"`
	Processing int64 `json:"processing"`
	Waiting    int64 `json:"waiting"`
	Resolved   int64 `json:"resolved"`
	Closed     int64 `json:"closed"`
	All        int64 `json:"all"`
	Unread     int64 `json:"unread"`
}

const ticketPreviewLimit = 120

func MigrateTickets(db *gorm.DB) error {
	if err := db.AutoMigrate(&Ticket{}, &TicketMessage{}, &TicketAttachment{}, &TicketEvent{}, &TicketRead{}, &TicketStoredObject{}); err != nil {
		return err
	}
	// Give existing images a bounded lifetime without discarding their bytes.
	now := common.GetTimestamp()
	return db.Model(&TicketAttachment{}).Where("expires_at = ? OR expires_at IS NULL", 0).Updates(map[string]any{"created_at": now, "expires_at": now + 30*86400}).Error
}

func TicketsEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap["SupportTicketsEnabled"] != "false"
}

func ValidateTicketText(value string, limit int, required bool) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit && (!required || strings.TrimSpace(value) != "")
}

func TicketScope(tx *gorm.DB, actor TicketActor) *gorm.DB {
	if !actor.Staff {
		return tx.Where("user_id = ?", actor.UserID)
	}
	return tx
}

// lockActorTicket serializes owner capacity checks before locking the ticket.
// Creation uses the same owner lock, so separate tickets cannot bypass the cap.
func lockActorTicket(tx *gorm.DB, actor TicketActor, id int) (*Ticket, error) {
	var ticket Ticket
	if err := TicketScope(tx, actor).Select("id", "user_id").First(&ticket, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTicketNotFound
		}
		return nil, err
	}
	var owner User
	if err := lockForUpdate(tx).Select("id").First(&owner, ticket.UserID).Error; err != nil {
		return nil, err
	}
	if err := TicketScope(lockForUpdate(tx), actor).First(&ticket, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTicketNotFound
		}
		return nil, err
	}
	return &ticket, nil
}

func checkTicketCapacity(tx *gorm.DB, userID int) error {
	// MySQL's default repeatable-read isolation can retain the snapshot taken
	// while locating the owner. A locking read sees capacity after the owner lock.
	var open []Ticket
	if err := lockForUpdate(tx).Select("id").Where("user_id = ? AND status IN ?", userID, []string{"pending", "processing", "waiting"}).Limit(10).Find(&open).Error; err != nil {
		return err
	}
	if len(open) >= 10 {
		return ErrTicketLimit
	}
	return nil
}

func CreateTicket(ticket *Ticket, message *TicketMessage) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, ticket.UserID).Error; err != nil {
			return err
		}
		var existing Ticket
		err := tx.Where("user_id = ? AND create_key = ?", ticket.UserID, ticket.CreateKey).First(&existing).Error
		if err == nil {
			if existing.CreateHash != ticket.CreateHash {
				return ErrTicketConflict
			}
			*ticket = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := checkTicketCapacity(tx, ticket.UserID); err != nil {
			return err
		}
		ticket.Status = "pending"
		ticket.Version = 1
		if err := tx.Create(ticket).Error; err != nil {
			return err
		}
		message.TicketID = ticket.ID
		message.SenderID = ticket.UserID
		message.SenderType = "user"
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		message.Created = true
		for i := range message.Attachments {
			message.Attachments[i].TicketID = ticket.ID
			message.Attachments[i].MessageID = message.ID
			if err := tx.Create(&message.Attachments[i]).Error; err != nil {
				return err
			}
		}
		return tx.Create(&TicketRead{TicketID: ticket.ID, UserID: ticket.UserID, Version: 1}).Error
	})
}

func ListTickets(actor TicketActor, filter TicketFilter) ([]Ticket, int64, error) {
	query := TicketScope(DB.Model(&Ticket{}), actor)
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if actor.Staff && filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.Keyword != "" {
		pattern := "%" + filter.Keyword + "%"
		id, _ := strconv.Atoi(strings.TrimPrefix(filter.Keyword, "#"))
		if actor.Staff {
			query = query.Where("title LIKE ? OR id = ? OR user_id IN (?)", pattern, id, DB.Model(&User{}).Select("id").Where("username LIKE ?", pattern))
		} else {
			query = query.Where("title LIKE ? OR id = ?", pattern, id)
		}
	}
	if filter.Unread {
		query = query.Where("tickets.version > COALESCE((SELECT version FROM ticket_reads WHERE ticket_reads.ticket_id = tickets.id AND ticket_reads.user_id = ?), 0)", actor.UserID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]Ticket, 0)
	selection := "tickets.*, CASE WHEN tickets.version > COALESCE((SELECT version FROM ticket_reads WHERE ticket_reads.ticket_id = tickets.id AND ticket_reads.user_id = ?), 0) THEN 1 ELSE 0 END AS unread"
	if actor.Staff {
		// Account names are staff-only so owners never receive them in their list.
		selection = "tickets.*, COALESCE((SELECT username FROM users WHERE users.id = tickets.user_id), '') AS user_name, CASE WHEN tickets.assignee_id = 0 THEN '' ELSE COALESCE((SELECT username FROM users WHERE users.id = tickets.assignee_id), '') END AS assignee_name, " + selection
	}
	err := query.Select(selection, actor.UserID).
		Order("updated_at DESC, id DESC").Offset(filter.Offset).Limit(filter.Limit).Find(&items).Error
	if err == nil && actor.Staff {
		loadTicketPreviews(items)
	}
	return items, total, err
}

// loadTicketPreviews fills the last-message excerpt the staff inbox renders in
// the ticket list. Two portable queries avoid database-specific SQL.
func loadTicketPreviews(items []Ticket) {
	if len(items) == 0 {
		return
	}
	ids := make([]int, 0, len(items))
	for i := range items {
		ids = append(ids, items[i].ID)
	}
	latest := make([]struct {
		TicketID  int
		MessageID int
	}, 0, len(items))
	if err := DB.Model(&TicketMessage{}).
		Select("ticket_id, MAX(id) AS message_id").
		Where("ticket_id IN ?", ids).
		Group("ticket_id").
		Find(&latest).Error; err != nil {
		return
	}
	messageIDs := make([]int, 0, len(latest))
	for _, row := range latest {
		messageIDs = append(messageIDs, row.MessageID)
	}
	if len(messageIDs) == 0 {
		return
	}
	var messages []TicketMessage
	if err := DB.Select("id", "ticket_id", "sender_type", "content").
		Where("id IN ?", messageIDs).
		Find(&messages).Error; err != nil {
		return
	}
	byTicket := make(map[int]TicketMessage, len(messages))
	for _, message := range messages {
		byTicket[message.TicketID] = message
	}
	for i := range items {
		if message, ok := byTicket[items[i].ID]; ok {
			items[i].Preview = ticketPreviewExcerpt(message.Content)
			items[i].PreviewSenderType = message.SenderType
		}
	}
}

func ticketPreviewExcerpt(content string) string {
	collapsed := strings.Join(strings.Fields(content), " ")
	if utf8.RuneCountInString(collapsed) <= ticketPreviewLimit {
		return collapsed
	}
	return string([]rune(collapsed)[:ticketPreviewLimit]) + "..."
}

func TicketStatsFor(actor TicketActor) (TicketStats, error) {
	stats := TicketStats{}
	var rows []struct {
		Status string
		Total  int64
	}
	if err := TicketScope(DB.Model(&Ticket{}), actor).
		Select("status, COUNT(*) AS total").
		Group("status").
		Find(&rows).Error; err != nil {
		return stats, err
	}
	for _, row := range rows {
		switch row.Status {
		case "pending":
			stats.Pending = row.Total
		case "processing":
			stats.Processing = row.Total
		case "waiting":
			stats.Waiting = row.Total
		case "resolved":
			stats.Resolved = row.Total
		case "closed":
			stats.Closed = row.Total
		}
		stats.All += row.Total
	}
	if err := TicketScope(DB.Model(&Ticket{}), actor).
		Where("tickets.version > COALESCE((SELECT version FROM ticket_reads WHERE ticket_reads.ticket_id = tickets.id AND ticket_reads.user_id = ?), 0)", actor.UserID).
		Count(&stats.Unread).Error; err != nil {
		return stats, err
	}
	return stats, nil
}

func GetTicketDetail(id int, actor TicketActor, before int) (*TicketDetail, error) {
	detail := &TicketDetail{Messages: make([]TicketMessage, 0), Events: make([]TicketEvent, 0)}
	err := TicketScope(DB, actor).First(&detail.Ticket, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	if actor.Staff {
		var requester User
		if err := DB.Select("id", "username", "email").First(&requester, detail.Ticket.UserID).Error; err == nil {
			detail.Requester = &TicketRequester{ID: requester.Id, Username: requester.Username, Email: requester.Email}
		}
	}
	query := DB.Where("ticket_id = ?", id)
	if !actor.Staff {
		query = query.Where("sender_type <> ?", "note")
	}
	if before > 0 {
		query = query.Where("id < ?", before)
	}
	if err := query.Order("id DESC").Limit(51).Find(&detail.Messages).Error; err != nil {
		return nil, err
	}
	detail.HasMore = len(detail.Messages) > 50
	if detail.HasMore {
		detail.Messages = detail.Messages[:50]
	}
	slices.Reverse(detail.Messages)
	ids := make([]int, 0, len(detail.Messages))
	for i := range detail.Messages {
		ids = append(ids, detail.Messages[i].ID)
		detail.Messages[i].Attachments = make([]TicketAttachment, 0)
	}
	if len(ids) > 0 {
		var attachments []TicketAttachment
		if err := DB.Omit("data").Where("ticket_id = ? AND message_id IN ?", id, ids).Order("id ASC").Find(&attachments).Error; err != nil {
			return nil, err
		}
		for i := range detail.Messages {
			for _, attachment := range attachments {
				if attachment.MessageID == detail.Messages[i].ID {
					detail.Messages[i].Attachments = append(detail.Messages[i].Attachments, attachment)
				}
			}
		}
	}
	if actor.Staff {
		senderIDs := make([]int, 0, len(detail.Messages))
		for i := range detail.Messages {
			senderIDs = append(senderIDs, detail.Messages[i].SenderID)
		}
		if len(senderIDs) > 0 {
			var senders []User
			if err := DB.Select("id", "username").Where("id IN ?", senderIDs).Find(&senders).Error; err == nil {
				names := make(map[int]string, len(senders))
				for _, sender := range senders {
					names[sender.Id] = sender.Username
				}
				for i := range detail.Messages {
					detail.Messages[i].SenderName = names[detail.Messages[i].SenderID]
				}
			}
		}
	}
	events := DB.Where("ticket_id = ?", id)
	if !actor.Staff {
		events = events.Where("action = ?", "status_changed")
	}
	if err := events.Order("id DESC").Limit(100).Find(&detail.Events).Error; err != nil {
		return nil, err
	}
	slices.Reverse(detail.Events)
	return detail, nil
}

func ReplyTicket(actor TicketActor, message *TicketMessage, resolve bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		ticket, err := lockActorTicket(tx, actor, message.TicketID)
		if err != nil {
			return err
		}
		if !actor.Staff {
			message.SenderType = "user"
		}
		var existing TicketMessage
		err = tx.Where("ticket_id = ? AND sender_id = ? AND request_key = ?", ticket.ID, actor.UserID, message.RequestKey).First(&existing).Error
		if err == nil {
			if existing.RequestHash != message.RequestHash || existing.SenderType != message.SenderType {
				return ErrTicketConflict
			}
			*message = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		message.SenderID = actor.UserID
		if !actor.Staff && slices.Contains([]string{"resolved", "closed"}, ticket.Status) {
			if err := checkTicketCapacity(tx, ticket.UserID); err != nil {
				return err
			}
		}
		if err := tx.Create(message).Error; err != nil {
			return err
		}
		message.Created = true
		for i := range message.Attachments {
			message.Attachments[i].TicketID = ticket.ID
			message.Attachments[i].MessageID = message.ID
			if err := tx.Create(&message.Attachments[i]).Error; err != nil {
				return err
			}
		}
		if message.SenderType == "note" {
			return nil
		}
		previousStatus := ticket.Status
		status := previousStatus
		if !actor.Staff && slices.Contains([]string{"waiting", "resolved", "closed"}, status) {
			status = "pending"
		}
		if actor.Staff && status == "pending" {
			status = "processing"
		}
		if resolve {
			status = "resolved"
		}
		updates := map[string]any{"version": ticket.Version + 1, "updated_at": common.GetTimestamp(), "status": status}
		if status != "closed" {
			updates["closed_at"] = 0
		}
		if err := tx.Model(ticket).Updates(updates).Error; err != nil {
			return err
		}
		if status != previousStatus {
			if err := tx.Create(&TicketEvent{TicketID: ticket.ID, ActorID: actor.UserID, Action: "status_changed", FromStatus: previousStatus, ToStatus: status}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func ChangeTicket(actor TicketActor, id int, version int64, status string, assignee *int) error {
	if status != "" && !slices.Contains(TicketStatuses, status) {
		return ErrTicketInvalid
	}
	if !actor.Staff && (assignee != nil || (status != "closed" && status != "pending")) {
		return ErrTicketInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		ticket, err := lockActorTicket(tx, actor, id)
		if err != nil {
			return err
		}
		if version != ticket.Version {
			return ErrTicketConflict
		}
		if !actor.Staff && status == "pending" && !slices.Contains([]string{"resolved", "closed"}, ticket.Status) {
			return ErrTicketInvalid
		}
		if assignee != nil && *assignee < 0 {
			return ErrTicketInvalid
		}
		if slices.Contains([]string{"resolved", "closed"}, ticket.Status) && slices.Contains([]string{"pending", "processing", "waiting"}, status) {
			if err := checkTicketCapacity(tx, ticket.UserID); err != nil {
				return err
			}
		}
		updates := map[string]any{"version": ticket.Version + 1, "updated_at": common.GetTimestamp()}
		if status != "" {
			updates["status"] = status
			updates["closed_at"] = 0
			if status == "closed" {
				updates["closed_at"] = common.GetTimestamp()
			}
			if status != ticket.Status {
				if err := tx.Create(&TicketEvent{TicketID: id, ActorID: actor.UserID, Action: "status_changed", FromStatus: ticket.Status, ToStatus: status}).Error; err != nil {
					return err
				}
			}
		}
		if assignee != nil && *assignee != ticket.AssigneeID {
			updates["assignee_id"] = *assignee
			if err := tx.Create(&TicketEvent{TicketID: id, ActorID: actor.UserID, Action: "assigned", AssigneeID: *assignee}).Error; err != nil {
				return err
			}
		}
		return tx.Model(ticket).Updates(updates).Error
	})
}

func MarkTicketRead(actor TicketActor, id int, version int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := TicketScope(lockForUpdate(tx), actor).First(&ticket, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTicketNotFound
			}
			return err
		}
		if version < 1 || version > ticket.Version {
			return ErrTicketInvalid
		}
		read := TicketRead{TicketID: id, UserID: actor.UserID, Version: 0}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&read).Error; err != nil {
			return err
		}
		return tx.Model(&TicketRead{}).Where("ticket_id = ? AND user_id = ? AND version < ?", id, actor.UserID, version).Update("version", version).Error
	})
}

func TicketUnreadCount(actor TicketActor) (int64, error) {
	var count int64
	err := TicketScope(DB.Model(&Ticket{}), actor).Where("version > COALESCE((SELECT version FROM ticket_reads WHERE ticket_reads.ticket_id = tickets.id AND ticket_reads.user_id = ?), 0)", actor.UserID).Count(&count).Error
	return count, err
}

func GetTicketAttachment(actor TicketActor, ticketID, attachmentID int) (*TicketAttachment, error) {
	var ticket Ticket
	if err := TicketScope(DB, actor).First(&ticket, ticketID).Error; err != nil {
		return nil, ErrTicketNotFound
	}
	var attachment TicketAttachment
	query := DB.Where("ticket_id = ?", ticketID)
	if !actor.Staff {
		query = query.Where("message_id IN (?)", DB.Model(&TicketMessage{}).Select("id").Where("ticket_id = ? AND sender_type <> ?", ticketID, "note"))
	}
	if err := query.First(&attachment, attachmentID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTicketNotFound
		}
		return nil, err
	}
	return &attachment, nil
}

func DeleteClosedTickets(before int64) (int, error) {
	deleted := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var ids []int
		if err := lockForUpdate(tx.Model(&Ticket{})).Where("status = ? AND closed_at > 0 AND closed_at < ?", "closed", before).Order("id ASC").Limit(100).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		for _, entity := range []any{&TicketAttachment{}, &TicketMessage{}, &TicketRead{}, &TicketEvent{}} {
			if err := tx.Where("ticket_id IN ?", ids).Delete(entity).Error; err != nil {
				return err
			}
		}
		result := tx.Where("id IN ?", ids).Delete(&Ticket{})
		deleted = int(result.RowsAffected)
		return result.Error
	})
	return deleted, err
}
