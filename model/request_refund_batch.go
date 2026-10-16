package model

import (
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const MaxRequestRefundBatchSize = 200

// PublishRequestRefundBatchAudit can recover after completion but before audit
// publication. Only durable audit storage (database or recovery queue) allows
// the task's publication marker to advance.
func PublishRequestRefundBatchAudit(taskId string) error {
	task, err := GetRequestRefundBatch(taskId)
	if err != nil {
		return err
	}
	if task.Status != SystemTaskStatusSucceeded && task.Status != SystemTaskStatusFailed {
		return nil
	}
	var payload RequestRefundBatchPayload
	var state RequestRefundBatchState
	if err := task.DecodePayload(&payload); err != nil {
		return err
	}
	if err := task.DecodeState(&state); err != nil {
		return err
	}
	if state.AuditPublished {
		return nil
	}
	for _, item := range state.Items {
		params := AuditFields{"task_id": task.TaskID, "source_type": "request", "source_id": item.RequestId, "billing_id": item.BillingId, "target_user_id": item.UserId, "financial_operation_id": item.OperationId, "quota": item.Quota, "already_applied": item.AlreadyRefunded}
		entry := AuditLog{EventId: AccessTokenFingerprint("refund-item:" + task.TaskID + ":" + item.BillingId), UserId: payload.OperatorId, Username: payload.OperatorUsername, ActorRole: payload.OperatorRole, Category: AuditCategoryOperation, Action: "finance.refund_batch.item", Content: "Batch refund item result", AuthMethod: "system_task", Success: item.Status == "succeeded", Other: AuditOther{Op: &AuditOperation{Action: "finance.refund_batch.item", Params: params}}}
		if err := RecordAuditLog(nil, entry); err != nil {
			return err
		}
	}
	params := AuditFields{"task_id": task.TaskID, "total": state.Total, "succeeded": state.Succeeded, "failed": state.Failed, "reason": payload.Reason}
	if err := RecordAuditLog(nil, AuditLog{EventId: AccessTokenFingerprint("refund-complete:" + task.TaskID), UserId: payload.OperatorId, Username: payload.OperatorUsername, ActorRole: payload.OperatorRole, Category: AuditCategoryOperation, Action: "finance.refund_batch.complete", Content: "Batch refund completed", AuthMethod: "system_task", Success: task.Status == SystemTaskStatusSucceeded && state.Failed == 0 && state.Processed == state.Total, Other: AuditOther{Op: &AuditOperation{Action: "finance.refund_batch.complete", Params: params}}}); err != nil {
		return err
	}
	state.AuditPublished = true
	encoded, err := common.Marshal(state)
	if err != nil {
		return err
	}
	return DB.Model(task).Where("state = ?", task.State).Update("state", string(encoded)).Error
}

func FlushRequestRefundAudits(limit int) error {
	var tasks []SystemTask
	if err := DB.Where("type = ? AND status IN ? AND state LIKE ?", SystemTaskTypeRequestRefund, []SystemTaskStatus{SystemTaskStatusSucceeded, SystemTaskStatusFailed}, "%\"audit_published\":false%").Order("id ASC").Limit(limit).Find(&tasks).Error; err != nil {
		return err
	}
	for _, task := range tasks {
		if err := PublishRequestRefundBatchAudit(task.TaskID); err != nil {
			return err
		}
	}
	return nil
}

type RequestRefundBatchPayload struct {
	BillingIds       []string `json:"billing_ids"`
	Reason           string   `json:"reason"`
	OperatorId       int      `json:"operator_id"`
	OperatorRole     int      `json:"operator_role"`
	OperatorUsername string   `json:"operator_username"`
}

type RequestRefundBatchItem struct {
	UserId          int    `json:"user_id"`
	BillingId       string `json:"billing_id"`
	RequestId       string `json:"request_id"`
	Username        string `json:"username"`
	Quota           int    `json:"quota"`
	Status          string `json:"status"`
	Error           string `json:"error,omitempty"`
	OperationId     int    `json:"operation_id,omitempty"`
	AlreadyRefunded bool   `json:"already_refunded"`
}

type RequestRefundBatchState struct {
	AuditPublished bool                     `json:"audit_published"`
	Items          []RequestRefundBatchItem `json:"items"`
	Total          int                      `json:"total"`
	Processed      int                      `json:"processed"`
	Succeeded      int                      `json:"succeeded"`
	Failed         int                      `json:"failed"`
	Progress       int                      `json:"progress"`
}

// Queued refunds use the existing leased system-task runner. Each submission
// has a stable ID, while the shared task-type lease serializes batch execution.
func CreateRequestRefundBatch(ids []string, reason, clientId string, operatorId int) (*SystemTask, error) {
	reason, err := validateFinancialReason(reason)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 || len(ids) > MaxRequestRefundBatchSize || operatorId <= 0 || len(clientId) == 0 || len(clientId) > 36 {
		return nil, common.NewMessage("Invalid refund batch")
	}
	for _, c := range clientId {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return nil, common.NewMessage("Invalid refund batch")
		}
	}
	normalized := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 64 {
			return nil, common.NewMessage("Invalid refund batch")
		}
		if !slices.Contains(normalized, id) {
			normalized = append(normalized, id)
		}
	}
	var operator User
	if err := DB.Select("id", "username", "role").First(&operator, operatorId).Error; err != nil {
		return nil, err
	}
	payload := RequestRefundBatchPayload{BillingIds: normalized, Reason: reason, OperatorId: operatorId, OperatorRole: operator.Role, OperatorUsername: operator.Username}
	taskId := "refund_" + strconv.Itoa(operatorId) + "_" + clientId
	if len(taskId) > 64 {
		return nil, common.NewMessage("Invalid refund batch")
	}
	payloadJSON, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var records []RequestBilling
	if err := DB.Where("id IN ?", normalized).Find(&records).Error; err != nil {
		return nil, err
	}
	state := RequestRefundBatchState{Total: len(normalized), Items: make([]RequestRefundBatchItem, 0, len(normalized))}
	for _, id := range normalized {
		item := RequestRefundBatchItem{BillingId: id, Status: "pending"}
		for _, record := range records {
			if record.Id == id {
				item.UserId = record.UserId
				item.RequestId, item.Username, item.Quota = record.RequestId, record.Username, record.Quota
				break
			}
		}
		state.Items = append(state.Items, item)
	}
	stateJSON, err := common.Marshal(state)
	if err != nil {
		return nil, err
	}
	task := &SystemTask{TaskID: taskId, Type: SystemTaskTypeRequestRefund, Status: SystemTaskStatusPending, Payload: string(payloadJSON), State: string(stateJSON)}
	// The primary DB already has a unique task_id. Insertion is atomic across
	// nodes; a retry must retrieve the identical submission, never replace it.
	if err := DB.Create(task).Error; err != nil {
		existing, lookupErr := GetSystemTaskByTaskID(taskId)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if existing == nil {
			return nil, err
		}
		var previous RequestRefundBatchPayload
		if err := existing.DecodePayload(&previous); err != nil {
			return nil, err
		}
		if existing.Type != task.Type || previous.OperatorId != operatorId || previous.Reason != reason || !slices.Equal(previous.BillingIds, normalized) {
			return nil, ErrFinancialOperationConflict
		}
		return existing, nil
	}
	return task, nil
}

func GetRequestRefundBatch(taskId string) (*SystemTask, error) {
	task, err := GetSystemTaskByTaskID(taskId)
	if err != nil {
		return nil, err
	}
	if task == nil || task.Type != SystemTaskTypeRequestRefund {
		return nil, gorm.ErrRecordNotFound
	}
	return task, nil
}

func RequestRefundBatchRetryIds(task *SystemTask) ([]string, RequestRefundBatchPayload, error) {
	var payload RequestRefundBatchPayload
	if task.Status == SystemTaskStatusPending || task.Status == SystemTaskStatusRunning {
		return nil, payload, common.NewMessage("This refund batch is still processing")
	}
	if err := task.DecodePayload(&payload); err != nil {
		return nil, payload, err
	}
	var state RequestRefundBatchState
	if err := task.DecodeState(&state); err != nil {
		return nil, payload, err
	}
	var ids []string
	for _, item := range state.Items {
		if item.Status != "succeeded" {
			ids = append(ids, item.BillingId)
		}
	}
	if len(ids) == 0 {
		return nil, payload, common.NewMessage("This refund batch has no unfinished items")
	}
	return ids, payload, nil
}
