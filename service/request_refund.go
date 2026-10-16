package service

import (
	"context"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type requestRefundBatchHandler struct{}

func (requestRefundBatchHandler) Type() string { return model.SystemTaskTypeRequestRefund }

func init() { RegisterSystemTaskHandler(requestRefundBatchHandler{}) }

func StartRequestRefundBatch(ids []string, reason, clientId string, operatorId int) (*model.SystemTask, error) {
	operator, err := model.GetUserById(operatorId, false)
	if err != nil {
		return nil, err
	}
	if operator.Status != common.UserStatusEnabled || operator.Role < common.RoleAdminUser {
		return nil, model.ErrFinancialRoleForbidden
	}
	task, err := model.CreateRequestRefundBatch(ids, reason, clientId, operatorId)
	if err == nil {
		notifySystemTaskRunner()
	}
	return task, err
}

func RetryRequestRefundBatch(taskId, clientId string, operatorId int) (*model.SystemTask, error) {
	task, err := model.GetRequestRefundBatch(taskId)
	if err != nil {
		return nil, err
	}
	ids, payload, err := model.RequestRefundBatchRetryIds(task)
	if err != nil {
		return nil, err
	}
	return StartRequestRefundBatch(ids, payload.Reason, clientId, operatorId)
}

func (requestRefundBatchHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	RunRequestRefundBatch(ctx, task, runnerID)
}

// RunRequestRefundBatch saves every outcome. A lease expiry may interrupt a
// batch after a committed refund; the refund's own idempotency makes retry safe.
func RunRequestRefundBatch(ctx context.Context, task *model.SystemTask, runnerID string) {
	var payload model.RequestRefundBatchPayload
	var state model.RequestRefundBatchState
	if err := task.DecodePayload(&payload); err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := task.DecodeState(&state); err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	for i := range state.Items {
		if ctx.Err() != nil {
			return
		}
		// Persisting also verifies ownership before each money-moving operation.
		if err := model.UpdateSystemTaskState(task.TaskID, runnerID, state); err != nil {
			logSystemTaskLockError(ctx, task, err)
			return
		}
		item := &state.Items[i]
		if item.Status == "succeeded" {
			continue
		}
		operator, err := model.GetUserById(payload.OperatorId, false)
		if err == nil && (operator.Status != common.UserStatusEnabled || operator.Role < common.RoleAdminUser) {
			err = model.ErrFinancialRoleForbidden
		}
		if err == nil {
			var operation model.FinancialOperation
			operation, item.AlreadyRefunded, err = model.RefundRequestBilling(item.BillingId, payload.Reason, payload.OperatorId, operator.Role)
			if err == nil {
				item.OperationId = operation.Id
			}
		}
		item.Status = "succeeded"
		if err != nil {
			item.Status, item.Error = "failed", err.Error()
			state.Failed++
		} else {
			state.Succeeded++
		}
		state.Processed++
		state.Progress = state.Processed * 100 / max(1, state.Total)
		if err := model.UpdateSystemTaskState(task.TaskID, runnerID, state); err != nil {
			logSystemTaskLockError(ctx, task, err)
			return
		}
	}
	status := model.SystemTaskStatusSucceeded
	if state.Failed > 0 {
		status = model.SystemTaskStatusFailed
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, state, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
		return
	}
	notifySystemTaskRunner()
}
