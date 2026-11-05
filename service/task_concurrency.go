package service

import (
	"context"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/model"
)

func refreshTaskConcurrencyLease(ctx context.Context, task *model.Task) error {
	if task == nil || task.PrivateData.ConcurrencyLeaseOwner == "" || len(task.PrivateData.ConcurrencyScopes) == 0 {
		return nil
	}
	lease := concurrency.LeaseFromScopeNames(task.PrivateData.ConcurrencyLeaseOwner, task.PrivateData.ConcurrencyScopes)
	ok, err := concurrency.Refresh(ctx, lease, concurrency.DefaultLeaseTTL)
	if err != nil {
		common.SysError(common.LogText("failed to refresh task concurrency lease %s: %s", task.PrivateData.ConcurrencyLeaseOwner, err.Error()))
		return err
	}
	if !ok {
		common.SysLog(common.LogText("task concurrency lease expired before task %s completed", task.TaskID))
		if err := concurrency.Restore(ctx, lease, concurrency.DefaultLeaseTTL); err != nil {
			common.SysError(common.LogText("failed to restore task concurrency lease %s: %s", lease.Owner, err.Error()))
			return err
		}
		return concurrency.ErrLeaseLost
	}
	return nil
}

// RestoreUserTaskConcurrency rebuilds durable occupancy before new admission,
// rather than waiting for a task's next poll after a Redis restart or outage.
func RestoreUserTaskConcurrency(ctx context.Context, userID int) error {
	tasks, err := model.GetUserConcurrencyTasks(ctx, userID)
	if err != nil {
		return err
	}
	for _, task := range tasks {
		lease := concurrency.LeaseFromScopeNames(task.PrivateData.ConcurrencyLeaseOwner, task.PrivateData.ConcurrencyScopes)
		if err := concurrency.Restore(ctx, lease, concurrency.DefaultLeaseTTL); err != nil {
			return err
		}
	}
	return nil
}

func releaseTaskConcurrencyLease(ctx context.Context, task *model.Task) {
	if task == nil || task.PrivateData.ConcurrencyLeaseOwner == "" || len(task.PrivateData.ConcurrencyScopes) == 0 {
		return
	}
	lease := concurrency.LeaseFromScopeNames(task.PrivateData.ConcurrencyLeaseOwner, task.PrivateData.ConcurrencyScopes)
	if err := concurrency.Release(ctx, lease); err != nil {
		common.SysError(common.LogText("failed to release task concurrency lease %s: %s", task.PrivateData.ConcurrencyLeaseOwner, err.Error()))
	}
}

func ReleaseTaskConcurrencyLease(ctx context.Context, task *model.Task) {
	releaseTaskConcurrencyLease(ctx, task)
}

func finishTaskConcurrencyAndUsage(ctx context.Context, task *model.Task) {
	releaseTaskConcurrencyLease(ctx, task)
	FinalizeTaskSubscriptionUsage(task)
}

func FinalizeTaskSubscriptionUsage(task *model.Task) {
	if task == nil || !taskIsSubscription(task) {
		return
	}
	requestID := task.TaskID
	if task.PrivateData.Execution != nil && task.PrivateData.Execution.RequestID != "" {
		requestID = task.PrivateData.Execution.RequestID
	}
	if err := model.FinalizeSubscriptionUsage(requestID); err != nil {
		common.SysError(common.LogText("failed to finalize task subscription usage for task %s: %s", task.TaskID, err.Error()))
	}
}
