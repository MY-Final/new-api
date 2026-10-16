package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRequestRefundQueueFilters(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.RequestBilling{}, &model.UserSubscription{}))
	rows := []model.RequestBilling{
		{Id: "queue-a", RequestId: "incident-a", UserId: 1, ModelName: "model-a", ChannelId: 17, FundingSource: "wallet", Quota: 20, PaidQuota: 20, Settled: true, CreatedAt: 100},
		{Id: "queue-b", RequestId: "incident-b", UserId: 2, ModelName: "model-a", ChannelId: 17, FundingSource: "wallet", Quota: 30, PaidQuota: 30, Settled: true, CreatedAt: 200},
		{Id: "queue-c", RequestId: "incident-c", UserId: 2, ModelName: "model-b", ChannelId: 18, FundingSource: "wallet", Quota: 40, PaidQuota: 40, Settled: true, CreatedAt: 300, RefundOperationId: 1, RefundedQuota: 40},
	}
	require.NoError(t, db.Create(&rows).Error)
	page := &common.PageInfo{Page: 1, PageSize: 20}
	for _, tc := range []struct {
		name   string
		filter model.RequestBillingQuery
		ids    []string
	}{
		{"incident across users", model.RequestBillingQuery{ChannelId: 17, ModelName: "model-a", StartTime: 150, EndTime: 250}, []string{"queue-b"}},
		{"user and refund status", model.RequestBillingQuery{UserId: 2, Status: "refunded"}, []string{"queue-c"}},
		{"not refunded", model.RequestBillingQuery{Status: "unrefunded"}, []string{"queue-b", "queue-a"}},
		{"exact request", model.RequestBillingQuery{RequestId: "incident-a"}, []string{"queue-a"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			records, total, err := model.ListRequestBillings(tc.filter, page)
			require.NoError(t, err)
			assert.Equal(t, int64(len(tc.ids)), total)
			ids := make([]string, 0, len(records))
			for _, record := range records {
				ids = append(ids, record.Id)
			}
			assert.Equal(t, tc.ids, ids)
		})
	}
}

func TestRequestRefundBatchPersistsResultsAndRetriesOnlyFailures(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.RequestBilling{}, &model.FinancialOperation{}, &model.SystemTask{}, &model.SystemTaskLock{}, &model.Channel{}, &model.QuotaUsageDaily{}))
	operator := model.User{Username: "batch-operator", AffCode: "batch-operator", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	target := model.User{Username: "batch-target", AffCode: "batch-target", Role: common.RoleCommonUser, Quota: 100, BonusQuota: 40, PaidQuota: 60, UsedQuota: 30}
	require.NoError(t, db.Create(&operator).Error)
	require.NoError(t, db.Create(&target).Error)
	rows := []model.RequestBilling{
		{Id: "batch-good", RequestId: "request-good", UserId: target.Id, Username: target.Username, FundingSource: "wallet", Quota: 20, BonusQuota: 10, PaidQuota: 10, Settled: true},
		{Id: "batch-pending", RequestId: "request-pending", UserId: target.Id, Username: target.Username, FundingSource: "wallet", Quota: 10, PaidQuota: 10, Settled: false},
	}
	require.NoError(t, db.Create(&rows).Error)
	ids := []string{"batch-good", "batch-pending"}
	task, err := service.StartRequestRefundBatch(ids, "incident correction", "submit-1", operator.Id)
	require.NoError(t, err)
	duplicate, err := service.StartRequestRefundBatch(ids, "incident correction", "submit-1", operator.Id)
	require.NoError(t, err)
	assert.Equal(t, task.TaskID, duplicate.TaskID)
	_, err = service.StartRequestRefundBatch(ids, "different reason", "submit-1", operator.Id)
	assert.ErrorIs(t, err, model.ErrFinancialOperationConflict)
	claimed, ok, err := model.ClaimSystemTask(task.ID, model.SystemTaskTypeRequestRefund, "batch-test-runner", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	service.RunRequestRefundBatch(context.Background(), claimed, "batch-test-runner")
	saved, err := model.GetRequestRefundBatch(task.TaskID)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusFailed, saved.Status)
	var state model.RequestRefundBatchState
	require.NoError(t, saved.DecodeState(&state))
	assert.Equal(t, 1, state.Succeeded)
	assert.Equal(t, 1, state.Failed)
	assert.Equal(t, "request-good", state.Items[0].RequestId)
	assert.NotEmpty(t, state.Items[1].Error)
	require.NoError(t, db.Model(&rows[1]).Update("settled", true).Error)
	retried, err := service.RetryRequestRefundBatch(task.TaskID, "submit-retry", operator.Id)
	require.NoError(t, err)
	var payload model.RequestRefundBatchPayload
	require.NoError(t, retried.DecodePayload(&payload))
	assert.Equal(t, []string{"batch-pending"}, payload.BillingIds)
	claimed, ok, err = model.ClaimSystemTask(retried.ID, model.SystemTaskTypeRequestRefund, "retry-runner", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	service.RunRequestRefundBatch(context.Background(), claimed, "retry-runner")
	require.NoError(t, db.First(&target, target.Id).Error)
	assert.Equal(t, 130, target.Quota)
	assert.Equal(t, 50, target.BonusQuota)
	assert.Equal(t, 80, target.PaidQuota)
	assert.Zero(t, target.UsedQuota)
	var count int64
	require.NoError(t, db.Model(&model.FinancialOperation{}).Where("operation_type = ?", model.FinancialOperationRequestRefund).Count(&count).Error)
	assert.Equal(t, int64(2), count)
	// Authority is checked again by the worker, after submission.
	queued, err := service.StartRequestRefundBatch([]string{"batch-good"}, "already refunded", "revoked", operator.Id)
	require.NoError(t, err)
	require.NoError(t, db.Model(&operator).Update("role", common.RoleCommonUser).Error)
	claimed, ok, err = model.ClaimSystemTask(queued.ID, model.SystemTaskTypeRequestRefund, "revoked-runner", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	service.RunRequestRefundBatch(context.Background(), claimed, "revoked-runner")
	saved, err = model.GetRequestRefundBatch(queued.TaskID)
	require.NoError(t, err)
	require.NoError(t, saved.DecodeState(&state))
	assert.Equal(t, 1, state.Failed)
	assert.Equal(t, model.ErrFinancialRoleForbidden.Error(), state.Items[0].Error)

	// Concurrent submissions are queued, while the task-type lease serializes execution.
	require.NoError(t, db.Model(&operator).Update("role", common.RoleRootUser).Error)
	first, err := service.StartRequestRefundBatch([]string{"batch-good"}, "retry after interrupted state write", "queued-a", operator.Id)
	require.NoError(t, err)
	second, err := service.StartRequestRefundBatch([]string{"batch-pending"}, "next queued batch", "queued-b", operator.Id)
	require.NoError(t, err)
	claimed, ok, err = model.ClaimSystemTask(first.ID, model.SystemTaskTypeRequestRefund, "queue-a", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	_, ok, err = model.ClaimSystemTask(second.ID, model.SystemTaskTypeRequestRefund, "queue-b", common.GetTimestamp()+60)
	require.NoError(t, err)
	assert.False(t, ok)
	service.RunRequestRefundBatch(context.Background(), claimed, "queue-a")
	saved, err = model.GetRequestRefundBatch(first.TaskID)
	require.NoError(t, err)
	require.NoError(t, saved.DecodeState(&state))
	assert.True(t, state.Items[0].AlreadyRefunded)
	assert.Equal(t, 1, state.Succeeded)
	claimed, ok, err = model.ClaimSystemTask(second.ID, model.SystemTaskTypeRequestRefund, "queue-b", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	service.RunRequestRefundBatch(context.Background(), claimed, "queue-b")
	require.NoError(t, db.First(&target, target.Id).Error)
	assert.Equal(t, 130, target.Quota, "a retry after refund commit cannot credit the wallet twice")
	require.NoError(t, db.Model(&model.FinancialOperation{}).Where("operation_type = ?", model.FinancialOperationRequestRefund).Count(&count).Error)
	assert.Equal(t, int64(2), count)
	_, err = service.RetryRequestRefundBatch(first.TaskID, "nothing-left", operator.Id)
	assert.Error(t, err)
	// Generic housekeeping must not remove refund history or its idempotency keys.
	deleted, err := model.DeleteSystemTaskHistory(model.SystemTaskFilter{})
	require.NoError(t, err)
	assert.Zero(t, deleted)
}

func TestRequestRefundAccounting(t *testing.T) {
	db := setupManageUserTestDB(t)
	oldBatch := common.BatchUpdateEnabled
	oldLogConsume := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() { common.LogConsumeEnabled = oldLogConsume })
	common.BatchUpdateEnabled = false
	t.Cleanup(func() { common.BatchUpdateEnabled = oldBatch })
	tables := []any{&model.RequestBilling{}, &model.FinancialOperation{}, &model.Token{}, &model.Channel{}, &model.Task{}, &model.QuotaUsageDaily{}, &model.UserSubscription{}}
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.AutoMigrate(tables...))

	for _, tc := range []struct {
		name                         string
		reserve, actual, bonus, paid int
	}{
		{"mixed", 150, 120, 100, 20}, {"extra", 50, 180, 100, 80}, {"zero reserve", 0, 80, 80, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			target := model.User{Username: "refund-" + tc.name, AffCode: tc.name, Quota: 300, BonusQuota: 100, PaidQuota: 200, Role: common.RoleCommonUser}
			require.NoError(t, db.Create(&target).Error)
			token := model.Token{UserId: target.Id, Key: "refund-key-" + tc.name, RemainQuota: 1000}
			require.NoError(t, db.Create(&token).Error)
			channel := model.Channel{Key: "test"}
			require.NoError(t, db.Create(&channel).Error)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			requestID := "request-" + tc.name
			c.Set(common.RequestIdKey, requestID)
			c.Set("username", target.Username)
			c.Set("token_name", "original-token")
			info := &relaycommon.RelayInfo{UserId: target.Id, TokenId: token.Id, TokenKey: token.Key, RequestId: requestID, OriginModelName: "test-model"}
			info.ChannelMeta = &relaycommon.ChannelMeta{ChannelId: channel.Id}
			info.UserSetting.BillingPreference = "wallet_only"
			require.Nil(t, service.PreConsumeBilling(c, tc.reserve, info))
			model.UpdateUserUsedQuotaAndRequestCount(target.Id, tc.actual)
			model.UpdateChannelUsedQuota(channel.Id, tc.actual)
			require.NoError(t, service.SettleBilling(c, info, tc.actual))
			require.NoError(t, service.SettleBilling(c, info, tc.actual))
			records, err := model.GetRequestBillings(requestID)
			require.NoError(t, err)
			require.Len(t, records, 1)
			record := records[0]
			assert.Equal(t, tc.bonus, record.BonusQuota)
			assert.Equal(t, tc.paid, record.PaidQuota)
			model.RecordConsumeLog(c, target.Id, model.RecordConsumeLogParams{Quota: tc.actual, TokenId: token.Id, TokenName: "original-token", Other: model.NewLogOther()})
			var originalLog model.Log
			require.NoError(t, model.LOG_DB.Where("request_id = ? AND type = ?", requestID, model.LogTypeConsume).First(&originalLog).Error)
			var metadata map[string]any
			require.NoError(t, common.UnmarshalJsonStr(originalLog.Other, &metadata))
			assert.Equal(t, record.Id, metadata["billing_id"])
			assert.EqualValues(t, tc.bonus, metadata["wallet_bonus_quota"])
			assert.EqualValues(t, tc.paid, metadata["wallet_paid_quota"])

			_, _, err = model.RefundRequestBilling(record.Id, "", 0, common.RoleRootUser)
			require.Error(t, err)
			require.NoError(t, db.Model(&target).Update("role", common.RoleAdminUser).Error)
			_, _, err = model.RefundRequestBilling(record.Id, "correction", 0, common.RoleAdminUser)
			require.ErrorIs(t, err, model.ErrFinancialRoleForbidden)
			require.NoError(t, db.Model(&target).Update("role", common.RoleCommonUser).Error)
			// A failed audit insert must roll back the wallet, token, usage and refund marker.
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:refund_rollback", func(tx *gorm.DB) {
				if tx.Statement.Table == "financial_operations" {
					tx.AddError(errors.New("audit unavailable"))
				}
			}))
			_, _, err = model.RefundRequestBilling(record.Id, "correction", 0, common.RoleRootUser)
			require.Error(t, err)
			require.NoError(t, db.Callback().Create().Remove("test:refund_rollback"))
			var unchanged model.User
			require.NoError(t, db.First(&unchanged, target.Id).Error)
			assert.Equal(t, 300-tc.actual, unchanged.Quota)
			response := httptest.NewRecorder()
			refundCtx, _ := gin.CreateTestContext(response)
			refundCtx.Request = httptest.NewRequest("POST", "/api/finance/requests/refund", strings.NewReader(fmt.Sprintf(`{"billing_id":%q,"reason":"upstream error"}`, record.Id)))
			refundCtx.Set("role", common.RoleRootUser)
			RefundFinanceRequest(refundCtx)
			assert.Contains(t, response.Body.String(), `"success":true`)
			op, already, err := model.RefundRequestBilling(record.Id, "retry", 0, common.RoleRootUser)
			require.NoError(t, err)
			assert.True(t, already)
			assert.Equal(t, tc.actual, op.PrincipalQuota)
			assert.Equal(t, requestID, op.SourceId)
			var got model.User
			require.NoError(t, db.First(&got, target.Id).Error)
			assert.Equal(t, 300, got.Quota)
			assert.Equal(t, 100, got.BonusQuota)
			assert.Equal(t, 200, got.PaidQuota)
			assert.Zero(t, got.UsedQuota)
			assert.Equal(t, 1, got.RequestCount)
			require.NoError(t, db.First(&token, token.Id).Error)
			assert.Equal(t, 1000, token.RemainQuota)
			assert.Zero(t, token.UsedQuota)
			require.NoError(t, db.First(&channel, channel.Id).Error)
			assert.Zero(t, channel.UsedQuota)
			var dailySum struct {
				Bonus int
				Paid  int
			}
			require.NoError(t, db.Model(&model.QuotaUsageDaily{}).Select("COALESCE(SUM(bonus_quota),0) AS bonus, COALESCE(SUM(paid_quota),0) AS paid").Where("user_id = ?", target.Id).Scan(&dailySum).Error)
			assert.Zero(t, dailySum.Bonus)
			assert.Zero(t, dailySum.Paid)
			require.NoError(t, model.FlushRequestRefundLogs(100))
			var count int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("request_id = ?", "refund_"+record.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			var refundLog model.Log
			require.NoError(t, model.LOG_DB.Where("request_id = ?", "refund_"+record.Id).First(&refundLog).Error)
			assert.Equal(t, "original-token", refundLog.TokenName)
			// Retaining the billing row prevents another credit even after log retention.
			require.NoError(t, model.LOG_DB.Where("request_id = ?", "refund_"+record.Id).Delete(&model.Log{}).Error)
			_, already, err = model.RefundRequestBilling(record.Id, "after retention", 0, common.RoleRootUser)
			require.NoError(t, err)
			assert.True(t, already)
		})
	}
	t.Run("pending task and original buckets", func(t *testing.T) {
		user := model.User{Username: "task-refund", AffCode: "task-refund", Quota: 180, BonusQuota: 0, PaidQuota: 180, UsedQuota: 120}
		require.NoError(t, db.Create(&user).Error)
		task := model.Task{TaskID: "task-original", UserId: user.Id, Quota: 120, Status: model.TaskStatusSubmitted}
		task.PrivateData.BillingId = "task-billing"
		assert.False(t, model.IsTaskBillingReady(&task))
		require.NoError(t, db.Create(&task).Error)
		record := model.RequestBilling{Id: "task-billing", RequestId: "task-request", TaskId: task.TaskID, UserId: user.Id, FundingSource: "wallet", Quota: 120, BonusQuota: 100, PaidQuota: 20, UsageRecorded: true}
		require.NoError(t, model.RecordRequestBilling(&record))
		assert.True(t, model.IsTaskBillingReady(&task))
		_, _, err := model.RefundRequestBilling(record.Id, "too soon", 0, common.RoleRootUser)
		require.ErrorIs(t, err, model.ErrRequestBillingUnsettled)
		service.RecalculateTaskQuota(context.Background(), &task, 80, common.NewMessage("correction"))
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 220, user.Quota)
		assert.Equal(t, 20, user.BonusQuota)
		assert.Equal(t, 200, user.PaidQuota)
		task.Status = model.TaskStatusSuccess
		require.NoError(t, db.Model(&task).Update("status", task.Status).Error)
		_, _, err = model.RefundRequestBilling(record.Id, "completed task refund", 0, common.RoleRootUser)
		require.NoError(t, err)
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 300, user.Quota)
		assert.Equal(t, 100, user.BonusQuota)
		assert.Equal(t, 200, user.PaidQuota)
		assert.Zero(t, user.UsedQuota)
		assert.False(t, service.RefundTaskQuota(context.Background(), &task, "late retry"))
	})
	t.Run("zero estimate task settles a positive charge", func(t *testing.T) {
		user := model.User{Username: "zero-estimate", AffCode: "zero-estimate", Quota: 300, BonusQuota: 100, PaidQuota: 200}
		require.NoError(t, db.Create(&user).Error)
		token := model.Token{UserId: user.Id, Key: "zero-estimate-token", RemainQuota: 1000}
		require.NoError(t, db.Create(&token).Error)
		task := model.Task{TaskID: "zero-estimate-task", UserId: user.Id, Status: model.TaskStatusSuccess}
		task.PrivateData.BillingId = "zero-estimate-billing"
		task.PrivateData.TokenId = token.Id
		require.NoError(t, db.Create(&task).Error)
		record := model.RequestBilling{Id: task.PrivateData.BillingId, RequestId: "zero-estimate-request", TaskId: task.TaskID, UserId: user.Id, TokenId: token.Id, FundingSource: "wallet", UsageRecorded: true}
		require.NoError(t, model.RecordRequestBilling(&record))
		service.RecalculateTaskQuota(context.Background(), &task, 120, common.NewMessage("completed usage"))
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 180, user.Quota)
		assert.Equal(t, 120, user.UsedQuota)
		require.NoError(t, db.First(&token, token.Id).Error)
		assert.Equal(t, 880, token.RemainQuota)
		_, _, err := model.RefundRequestBilling(record.Id, "zero estimate refund", 0, common.RoleRootUser)
		require.NoError(t, err)
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 300, user.Quota)
		assert.Equal(t, 100, user.BonusQuota)
		assert.Equal(t, 200, user.PaidQuota)
		require.NoError(t, db.First(&token, token.Id).Error)
		assert.Equal(t, 1000, token.RemainQuota)
	})

	t.Run("failed task restores paid funds and token once", func(t *testing.T) {
		user := model.User{Username: "failed-task", AffCode: "failed-task", Quota: 180, PaidQuota: 180, UsedQuota: 120, RequestCount: 1}
		require.NoError(t, db.Create(&user).Error)
		token := model.Token{UserId: user.Id, Key: "failed-token", RemainQuota: 880, UsedQuota: 120}
		require.NoError(t, db.Create(&token).Error)
		channel := model.Channel{Key: "test", UsedQuota: 120}
		require.NoError(t, db.Create(&channel).Error)
		task := model.Task{TaskID: "failed-task", UserId: user.Id, ChannelId: channel.Id, Quota: 120, Status: model.TaskStatusFailure}
		task.PrivateData.BillingId = "failed-billing"
		task.PrivateData.TokenId = token.Id
		require.NoError(t, db.Create(&task).Error)
		record := model.RequestBilling{Id: "failed-billing", RequestId: "failed-request", TaskId: task.TaskID, UserId: user.Id, TokenId: token.Id, TokenQuota: 120, FundingSource: "wallet", Quota: 120, BonusQuota: 100, PaidQuota: 20, UsageRecorded: true}
		require.NoError(t, model.RecordRequestBilling(&record))
		stale := task
		require.True(t, service.RefundTaskQuota(context.Background(), &task, "failed upstream"))
		assert.False(t, service.RefundTaskQuota(context.Background(), &stale, "duplicate callback"))
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 300, user.Quota)
		assert.Equal(t, 100, user.BonusQuota)
		assert.Equal(t, 200, user.PaidQuota)
		assert.Zero(t, user.UsedQuota)
		assert.Equal(t, 1, user.RequestCount)
		require.NoError(t, db.First(&token, token.Id).Error)
		assert.Equal(t, 1000, token.RemainQuota)
		assert.Zero(t, token.UsedQuota)
		require.NoError(t, db.First(&channel, channel.Id).Error)
		assert.Zero(t, channel.UsedQuota)
	})
	t.Run("task settlement preserves outstanding cached source reservations", func(t *testing.T) {
		server := miniredis.RunT(t)
		oldRedis, oldRDB := common.RedisEnabled, common.RDB
		common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
		common.RedisEnabled = true
		t.Cleanup(func() { _ = common.RDB.Close(); common.RDB = oldRDB; common.RedisEnabled = oldRedis })
		user := model.User{Username: "cached-task", AffCode: "cached-task", Quota: 300, BonusQuota: 100, PaidQuota: 200, UsedQuota: 120}
		require.NoError(t, db.Create(&user).Error)
		_, err := model.GetUserCache(user.Id)
		require.NoError(t, err)
		for _, key := range server.Keys() {
			if server.HGet(key, "Username") == user.Username {
				server.HSet(key, "Quota", "180")
				server.HSet(key, "BonusQuota", "0")
				server.HSet(key, "PaidQuota", "180")
			}
		}
		task := model.Task{TaskID: "cached-task", UserId: user.Id, Quota: 120, Status: model.TaskStatusSuccess}
		task.PrivateData.BillingId = "cached-billing"
		require.NoError(t, db.Create(&task).Error)
		record := model.RequestBilling{Id: "cached-billing", RequestId: "cached-request", TaskId: task.TaskID, UserId: user.Id, FundingSource: "wallet", Quota: 120, BonusQuota: 100, PaidQuota: 20, UsageRecorded: true}
		require.NoError(t, model.RecordRequestBilling(&record))
		require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:task_cache_rollback", func(tx *gorm.DB) {
			if tx.Statement.Table == "tasks" {
				tx.AddError(errors.New("task update unavailable"))
			}
		}))
		require.Error(t, model.AdjustTaskRequestBillingFunding(&task, 30))
		require.NoError(t, db.Callback().Update().Remove("test:task_cache_rollback"))
		cached, err := model.GetUserCache(user.Id)
		require.NoError(t, err)
		assert.Equal(t, 180, cached.Quota)
		service.RecalculateTaskQuota(context.Background(), &task, 150, common.NewMessage("actual usage"))
		cached, err = model.GetUserCache(user.Id)
		require.NoError(t, err)
		assert.Equal(t, 150, cached.Quota)
		assert.Zero(t, cached.BonusQuota)
		assert.Equal(t, 150, cached.PaidQuota)
		require.NoError(t, db.First(&record, "id = ?", record.Id).Error)
		assert.Equal(t, 100, record.BonusQuota)
		assert.Equal(t, 50, record.PaidQuota)
		// Simulate the original reservation's delayed database flush.
		require.NoError(t, db.Model(&user).Updates(map[string]any{"quota": gorm.Expr("quota - 120"), "bonus_quota": gorm.Expr("bonus_quota - 100"), "paid_quota": gorm.Expr("paid_quota - 20")}).Error)
		_, _, err = model.RefundRequestBilling(record.Id, "cached request refund", 0, common.RoleRootUser)
		require.NoError(t, err)
		cached, err = model.GetUserCache(user.Id)
		require.NoError(t, err)
		assert.Equal(t, 300, cached.Quota)
		assert.Equal(t, 100, cached.BonusQuota)
		assert.Equal(t, 200, cached.PaidQuota)
	})

	t.Run("subscription keeps wallet unchanged and rejects a new period", func(t *testing.T) {
		user := model.User{Username: "sub-refund", AffCode: "sub-refund", Quota: 50, PaidQuota: 50, UsedQuota: 60}
		require.NoError(t, db.Create(&user).Error)
		sub := model.UserSubscription{UserId: user.Id, Status: "active", EndTime: time.Now().Unix() + 3600, LastResetTime: 10, AmountTotal: 100, AmountUsed: 60}
		require.NoError(t, db.Create(&sub).Error)
		record := model.RequestBilling{Id: "sub-billing", RequestId: "sub-request", UserId: user.Id, FundingSource: "subscription", SubscriptionId: sub.Id, SubscriptionResetAt: 10, Quota: 30}
		require.NoError(t, model.RecordRequestBilling(&record))
		require.NoError(t, db.Model(&sub).Update("last_reset_time", 11).Error)
		_, _, err := model.RefundRequestBilling(record.Id, "wrong period", 0, common.RoleRootUser)
		require.ErrorIs(t, err, model.ErrRequestBillingPeriodChanged)
		require.NoError(t, db.Model(&sub).Update("last_reset_time", 10).Error)
		_, _, err = model.RefundRequestBilling(record.Id, "same period", 0, common.RoleRootUser)
		require.NoError(t, err)
		require.NoError(t, db.First(&sub, sub.Id).Error)
		assert.EqualValues(t, 30, sub.AmountUsed)
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 50, user.Quota)
		assert.Equal(t, 50, user.PaidQuota)
		assert.Equal(t, 30, user.UsedQuota)
	})
	t.Run("concurrent refunds credit once", func(t *testing.T) {
		user := model.User{Username: "concurrent-refund", AffCode: "concurrent-refund", UsedQuota: 10}
		require.NoError(t, db.Create(&user).Error)
		record := model.RequestBilling{Id: "concurrent-billing", RequestId: "concurrent-request", UserId: user.Id, FundingSource: "wallet", Quota: 10, PaidQuota: 10}
		require.NoError(t, model.RecordRequestBilling(&record))
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for range 2 {
			wg.Go(func() {
				_, _, err := model.RefundRequestBilling(record.Id, "retry", 0, common.RoleRootUser)
				errs <- err
			})
		}
		wg.Wait()
		close(errs)
		// SQLite may reject a concurrent writer; retry the same durable operation.
		for err := range errs {
			if err != nil {
				_, _, err = model.RefundRequestBilling(record.Id, "retry", 0, common.RoleRootUser)
				require.NoError(t, err)
			}
		}
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 10, user.Quota)
		var count int64
		require.NoError(t, db.Model(&model.FinancialOperation{}).Where("source_id = ?", record.RequestId).Count(&count).Error)
		assert.EqualValues(t, 1, count)
	})
	t.Run("request penalty validates ownership and conflicting retries", func(t *testing.T) {
		user := model.User{Username: "penalty-owner", AffCode: "penalty-owner", Quota: 20, PaidQuota: 20}
		require.NoError(t, db.Create(&user).Error)
		require.NoError(t, db.Create(&model.RequestBilling{Id: "penalty-billing", RequestId: "penalty-request", UserId: user.Id}).Error)
		_, _, err := model.ApplyFinancialPenalty(user.Id+1000, 5, "wrong owner", "penalty-request", 0, common.RoleRootUser, true)
		require.ErrorIs(t, err, model.ErrFinancialRequestUserMismatch)
		_, _, err = model.ApplyFinancialPenalty(user.Id, 5, "penalty", "penalty-request", 0, common.RoleRootUser, true)
		require.NoError(t, err)
		_, _, err = model.ApplyFinancialPenalty(user.Id, 6, "conflict", "penalty-request", 0, common.RoleRootUser, true)
		require.ErrorIs(t, err, model.ErrFinancialOperationConflict)
	})
	t.Run("separate log outage retries without recredit", func(t *testing.T) {
		if model.LOG_DB == db {
			t.Skip("requires separate log database")
		}
		user := model.User{Username: "outbox-refund", AffCode: "outbox-refund", UsedQuota: 10}
		require.NoError(t, db.Create(&user).Error)
		record := model.RequestBilling{Id: "outbox-billing", RequestId: "outbox-request", UserId: user.Id, FundingSource: "wallet", Quota: 10, PaidQuota: 10}
		require.NoError(t, model.RecordRequestBilling(&record))
		require.NoError(t, model.LOG_DB.Callback().Create().Before("gorm:create").Register("test:log_outage", func(tx *gorm.DB) { tx.AddError(errors.New("log unavailable")) }))
		_, _, err := model.RefundRequestBilling(record.Id, "log outage", 0, common.RoleRootUser)
		require.NoError(t, err)
		require.NoError(t, db.First(&record, "id = ?", record.Id).Error)
		assert.True(t, record.RefundLogPending)
		require.NoError(t, model.LOG_DB.Callback().Create().Remove("test:log_outage"))
		require.NoError(t, model.FlushRequestRefundLogs(100))
		require.NoError(t, model.FlushRequestRefundLogs(100))
		var count int64
		require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("request_id = ?", "refund_"+record.Id).Count(&count).Error)
		assert.EqualValues(t, 1, count)
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 10, user.Quota)
	})
	t.Run("user request list paginates", func(t *testing.T) {
		user := model.User{Username: "request-list-user", AffCode: "request-list-user"}
		require.NoError(t, db.Create(&user).Error)
		for i := range 2 {
			record := model.RequestBilling{
				Id: "request-list-billing-" + fmt.Sprint(i), RequestId: "request-list-" + fmt.Sprint(i),
				UserId: user.Id, Username: user.Username, FundingSource: "wallet", Quota: 10,
				PaidQuota: 10, Settled: true,
			}
			require.NoError(t, model.RecordRequestBilling(&record))
		}
		page := &common.PageInfo{Page: 1, PageSize: 1}
		records, total, err := model.GetUserRequestBillings(user.Id, page)
		require.NoError(t, err)
		assert.EqualValues(t, 2, total)
		require.Len(t, records, 1)
		firstRequestID := records[0].RequestId
		page.Page = 2
		records, total, err = model.GetUserRequestBillings(user.Id, page)
		require.NoError(t, err)
		assert.EqualValues(t, 2, total)
		require.Len(t, records, 1)
		assert.NotEqual(t, firstRequestID, records[0].RequestId)
		response := httptest.NewRecorder()
		requestCtx, _ := gin.CreateTestContext(response)
		requestCtx.Request = httptest.NewRequest("GET", "/api/finance/requests/by-user?user_id="+fmt.Sprint(user.Id)+"&p=1&page_size=1", nil)
		GetFinanceUserRequestBillings(requestCtx)
		assert.Contains(t, response.Body.String(), `"success":true`)
		assert.Contains(t, response.Body.String(), `"total":2`)
	})
}
