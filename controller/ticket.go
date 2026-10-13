package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

type ticketScreenshot struct {
	Name string `json:"name"`
	Data string `json:"data"`
}
type ticketRequest struct {
	Title       string             `json:"title"`
	Category    string             `json:"category"`
	Content     string             `json:"content"`
	RequestID   string             `json:"request_id"`
	OrderNumber string             `json:"order_number"`
	ModelName   string             `json:"model_name"`
	OccurredAt  int64              `json:"occurred_at"`
	RequestKey  string             `json:"request_key"`
	Resolve     bool               `json:"resolve"`
	Screenshots []ticketScreenshot `json:"screenshots"`
}

func ticketActor(c *gin.Context) model.TicketActor {
	return model.TicketActor{UserID: c.GetInt("id"), Staff: c.GetBool("ticket_staff")}
}

func ticketError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrTicketImagesDisabled) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": err.Error()})
		return
	}
	if errors.Is(err, service.ErrTicketImageExpired) {
		c.JSON(http.StatusGone, gin.H{"success": false, "message": err.Error()})
		return
	}
	status := http.StatusBadRequest
	if errors.Is(err, model.ErrTicketNotFound) {
		status = http.StatusNotFound
	}
	if errors.Is(err, model.ErrTicketConflict) {
		status = http.StatusConflict
	}
	if !errors.Is(err, model.ErrTicketNotFound) && !errors.Is(err, model.ErrTicketInvalid) && !errors.Is(err, model.ErrTicketConflict) && !errors.Is(err, model.ErrTicketLimit) {
		status = http.StatusInternalServerError
		err = errors.New("Ticket operation failed")
	}
	c.JSON(status, gin.H{"success": false, "message": err.Error()})
}

func ticketID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		ticketError(c, model.ErrTicketNotFound)
		return 0, false
	}
	return id, true
}

func decodeTicketRequest(c *gin.Context) (*ticketRequest, *model.TicketMessage, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 22*1024*1024)
	defer c.Request.Body.Close()
	var request ticketRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		ticketError(c, model.ErrTicketInvalid)
		return nil, nil, false
	}
	if !model.ValidateTicketText(request.Content, 20000, true) || !model.ValidateTicketText(request.RequestKey, 64, true) || len(request.Screenshots) > 3 {
		ticketError(c, model.ErrTicketInvalid)
		return nil, nil, false
	}
	config := model.TicketStorageConfig()
	if len(request.Screenshots) > 0 && (!config.Enabled || !config.Ready()) {
		ticketError(c, service.ErrTicketImagesDisabled)
		return nil, nil, false
	}
	encoded, err := common.Marshal(request)
	if err != nil {
		ticketError(c, err)
		return nil, nil, false
	}
	message := &model.TicketMessage{Content: strings.TrimSpace(request.Content), RequestKey: request.RequestKey, RequestHash: fmt.Sprintf("%x", sha256.Sum256(encoded)), Attachments: make([]model.TicketAttachment, 0)}
	for _, file := range request.Screenshots {
		data, err := base64.StdEncoding.DecodeString(file.Data)
		if err != nil || len(data) == 0 || len(data) > 5*1024*1024 || !model.ValidateTicketText(file.Name, 160, true) {
			ticketError(c, model.ErrTicketInvalid)
			return nil, nil, false
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 40000000 {
			ticketError(c, model.ErrTicketInvalid)
			return nil, nil, false
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			ticketError(c, model.ErrTicketInvalid)
			return nil, nil, false
		}
		message.Attachments = append(message.Attachments, model.TicketAttachment{Name: file.Name, ContentType: "image/" + format, Data: data})
	}
	return &request, message, true
}

func ListTickets(c *gin.Context) {
	page := common.GetPageQuery(c)
	page.Page = max(1, page.Page)
	page.PageSize = max(1, page.PageSize)
	filter := model.TicketFilter{Status: c.Query("status"), Category: c.Query("category"), Keyword: strings.TrimSpace(c.Query("keyword")), Offset: page.GetStartIdx(), Limit: page.PageSize}
	filter.UserID, _ = strconv.Atoi(c.Query("user_id"))
	if (filter.Status != "" && !slices.Contains(model.TicketStatuses, filter.Status)) || (filter.Category != "" && !slices.Contains(model.TicketCategories, filter.Category)) || !model.ValidateTicketText(filter.Keyword, 160, false) {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	items, total, err := model.ListTickets(ticketActor(c), filter)
	if err != nil {
		ticketError(c, err)
		return
	}
	page.SetItems(items)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

func CreateTicket(c *gin.Context) {
	if !model.TicketsEnabled() {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Ticket submissions are disabled"})
		return
	}
	request, message, ok := decodeTicketRequest(c)
	if !ok {
		return
	}
	if !model.ValidateTicketText(request.Title, 160, true) || !slices.Contains(model.TicketCategories, request.Category) || !model.ValidateTicketText(request.RequestID, 128, false) || !model.ValidateTicketText(request.OrderNumber, 128, false) || !model.ValidateTicketText(request.ModelName, 128, false) || request.OccurredAt < 0 {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	ticket := &model.Ticket{UserID: c.GetInt("id"), Title: strings.TrimSpace(request.Title), Category: request.Category, RequestID: request.RequestID, OrderNumber: request.OrderNumber, ModelName: request.ModelName, OccurredAt: request.OccurredAt, CreateKey: request.RequestKey, CreateHash: message.RequestHash}
	objects, err := service.PersistTicketImages(c.Request.Context(), message)
	if err != nil {
		service.DiscardTicketImages(objects)
		ticketError(c, err)
		return
	}
	if err := model.CreateTicket(ticket, message); err != nil {
		service.DiscardTicketImages(objects)
		ticketError(c, err)
		return
	}
	if message.ID == 0 {
		service.DiscardTicketImages(objects)
	}
	common.ApiSuccess(c, gin.H{"id": ticket.ID})
}

func GetTicket(c *gin.Context) {
	id, ok := ticketID(c)
	if !ok {
		return
	}
	before, _ := strconv.Atoi(c.Query("before"))
	detail, err := model.GetTicketDetail(id, ticketActor(c), before)
	if err != nil {
		ticketError(c, err)
		return
	}
	common.ApiSuccess(c, detail)
}

func ReplyTicket(c *gin.Context) {
	id, ok := ticketID(c)
	if !ok {
		return
	}
	request, message, ok := decodeTicketRequest(c)
	if !ok {
		return
	}
	actor := ticketActor(c)
	message.TicketID = id
	message.SenderType = "user"
	if actor.Staff {
		message.SenderType = "admin"
	}
	if c.GetBool("ticket_note") {
		message.SenderType = "note"
	}
	if request.Resolve && (!actor.Staff || message.SenderType == "note" || !authz.Can(actor.UserID, c.GetInt("role"), authz.TicketManage)) {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	// Authorize the ticket before sending any screenshot to external storage.
	var ticket model.Ticket
	if err := model.TicketScope(model.DB, actor).First(&ticket, id).Error; err != nil {
		ticketError(c, model.ErrTicketNotFound)
		return
	}
	objects, err := service.PersistTicketImages(c.Request.Context(), message)
	if err != nil {
		service.DiscardTicketImages(objects)
		ticketError(c, err)
		return
	}
	attachments := message.Attachments
	if err := model.ReplyTicket(actor, message, request.Resolve); err != nil {
		service.DiscardTicketImages(objects)
		ticketError(c, err)
		return
	}
	if len(attachments) > 0 && attachments[0].ID == 0 {
		service.DiscardTicketImages(objects)
	}
	if actor.Staff {
		recordManageAudit(c, "ticket.reply", map[string]any{"ticket_id": id, "internal": message.SenderType == "note"})
	}
	common.ApiSuccess(c, gin.H{"id": message.ID})
}

func ChangeTicket(c *gin.Context) {
	id, ok := ticketID(c)
	if !ok {
		return
	}
	var request struct {
		Status     string `json:"status"`
		AssigneeID *int   `json:"assignee_id"`
		Version    int64  `json:"version"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil || (request.Status == "" && request.AssigneeID == nil) {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	if request.AssigneeID != nil && *request.AssigneeID > 0 {
		user, err := model.GetUserById(*request.AssigneeID, false)
		if err != nil || user.Status != common.UserStatusEnabled || !authz.Can(user.Id, user.Role, authz.TicketRead) {
			ticketError(c, model.ErrTicketInvalid)
			return
		}
	}
	if err := model.ChangeTicket(ticketActor(c), id, request.Version, request.Status, request.AssigneeID); err != nil {
		ticketError(c, err)
		return
	}
	if c.GetBool("ticket_staff") {
		recordManageAudit(c, "ticket.update", map[string]any{"ticket_id": id, "status": request.Status, "assignee_id": request.AssigneeID})
	}
	common.ApiSuccess(c, nil)
}

func ReadTicket(c *gin.Context) {
	id, ok := ticketID(c)
	if !ok {
		return
	}
	var request struct {
		Version int64 `json:"version"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	if err := model.MarkTicketRead(ticketActor(c), id, request.Version); err != nil {
		ticketError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func TicketUnread(c *gin.Context) {
	count, err := model.TicketUnreadCount(ticketActor(c))
	if err != nil {
		ticketError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

func GetTicketScreenshot(c *gin.Context) {
	id, ok := ticketID(c)
	if !ok {
		return
	}
	attachmentID, _ := strconv.Atoi(c.Param("attachment"))
	if attachmentID < 1 {
		ticketError(c, model.ErrTicketNotFound)
		return
	}
	attachment, err := model.GetTicketAttachment(ticketActor(c), id, attachmentID)
	if err != nil {
		ticketError(c, err)
		return
	}
	data, err := service.ReadTicketImage(c.Request.Context(), attachment)
	if err != nil {
		ticketError(c, err)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "attachment; filename=screenshot")
	c.Data(http.StatusOK, attachment.ContentType, data)
}

func GetTicketStorageSettings(c *gin.Context) {
	config := model.TicketStorageConfig()
	common.ApiSuccess(c, gin.H{"enabled": config.Enabled, "retention_days": config.RetentionDays, "endpoint": config.Endpoint, "bucket": config.Bucket, "credentials_configured": config.AccessKey != "" && config.SecretKey != ""})
}

func UpdateTicketStorageSettings(c *gin.Context) {
	var config system_setting.TicketStorageConfig
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &config); err != nil {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	old := model.TicketStorageConfig()
	if config.AccessKey == "" {
		config.AccessKey = old.AccessKey
	}
	if config.SecretKey == "" {
		config.SecretKey = old.SecretKey
	}
	encoded, err := common.Marshal(config)
	if err != nil {
		ticketError(c, err)
		return
	}
	// Bulk persistence checks DB errors and writes this credential set atomically.
	if err := model.UpdateOptionsBulk(map[string]string{system_setting.TicketStorageOption: string(encoded)}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	recordManageAudit(c, "ticket.storage.update", nil)
	GetTicketStorageSettings(c)
}

func CleanupTickets(c *gin.Context) {
	var request struct {
		Days int `json:"days"`
	}
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request); err != nil || request.Days < 30 || request.Days > 3650 {
		ticketError(c, model.ErrTicketInvalid)
		return
	}
	deleted, err := model.DeleteClosedTickets(time.Now().Add(-time.Duration(request.Days) * 24 * time.Hour).Unix())
	if err != nil {
		ticketError(c, err)
		return
	}
	recordManageAudit(c, "ticket.cleanup", map[string]any{"days": request.Days, "deleted": deleted})
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}
