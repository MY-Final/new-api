package model

import (
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const MaxRequestRefundBatchSize = 200

type RequestRefundBatchPayload struct {
	BillingIds []string `json:"billing_ids"`
	Reason     string   `json:"reason"`
	OperatorId int      `json:"operator_id"`
}

type RequestRefundBatchItem struct {
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
	Items     []RequestRefundBatchItem `json:"items"`
	Total     int                      `json:"total"`
	Processed int                      `json:"processed"`
	Succeeded int                      `json:"succeeded"`
	Failed    int                      `json:"failed"`
	Progress  int                      `json:"progress"`
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
	payload := RequestRefundBatchPayload{BillingIds: normalized, Reason: reason, OperatorId: operatorId}
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
