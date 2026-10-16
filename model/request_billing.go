package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	FinancialOperationRequestRefund = "request_refund"
	RequestBillingContextKey        = "request_billing_snapshot"
	RequestBillingTaskContextKey    = "request_billing_task_id"
)

var (
	ErrRequestBillingNotFound       = common.NewMessage("No refundable billing record was found for this request")
	ErrRequestBillingUnsettled      = common.NewMessage("This request has not finished settlement")
	ErrRequestBillingInvalid        = common.NewMessage("The original billing allocation is unavailable")
	ErrRequestBillingPeriodChanged  = common.NewMessage("The subscription billing period has changed")
	ErrFinancialOperationConflict   = common.NewMessage("This operation was already submitted with different parameters")
	ErrFinancialRequestUserMismatch = common.NewMessage("The request does not belong to the selected user")
)

// RequestBilling survives usage-log retention. Each settlement has its own ID:
// a WebSocket request can contain several separately billed responses.
type RequestBilling struct {
	Id                  string `json:"billing_id" gorm:"type:varchar(64);primaryKey"`
	RequestId           string `json:"request_id" gorm:"type:varchar(64);index"`
	UserId              int    `json:"user_id" gorm:"index"`
	Username            string `json:"username" gorm:"type:varchar(64)"`
	ModelName           string `json:"model_name" gorm:"type:varchar(255)"`
	TokenId             int    `json:"token_id"`
	TokenName           string `json:"-" gorm:"type:varchar(255)"`
	TokenQuota          int    `json:"-" gorm:"type:bigint"`
	ChannelId           int    `json:"channel_id"`
	Group               string `json:"-" gorm:"type:varchar(64)"`
	FundingSource       string `json:"funding_source" gorm:"type:varchar(16)"`
	SubscriptionId      int    `json:"subscription_id"`
	SubscriptionResetAt int64  `json:"-" gorm:"type:bigint"`
	TaskId              string `json:"task_id,omitempty" gorm:"type:varchar(191);index"`
	Quota               int    `json:"quota" gorm:"type:bigint"`
	BonusQuota          int    `json:"bonus_quota" gorm:"type:bigint"`
	PaidQuota           int    `json:"paid_quota" gorm:"type:bigint"`
	RefundedQuota       int    `json:"refunded_quota" gorm:"type:bigint"`
	RefundedAt          int64  `json:"refunded_at" gorm:"type:bigint"`
	RefundOperationId   int    `json:"refund_operation_id"`
	RefundLogPending    bool   `json:"-" gorm:"index"`
	UsageRecorded       bool   `json:"-"`
	Settled             bool   `json:"settled"`
	CreatedAt           int64  `json:"created_at" gorm:"type:bigint;autoCreateTime"`
	BlockedReason       string `json:"blocked_reason,omitempty" gorm:"-"`
}

func RecordRequestBilling(record *RequestBilling) error {
	if (record.Quota < 0 || record.Quota == 0 && record.TaskId == "") || common.ValidateWalletQuota(record.Quota) != nil || record.UserId <= 0 || record.Id == "" || len(record.Id) > 57 || record.RequestId == "" || len(record.RequestId) > 64 || record.TokenQuota < 0 || record.TokenQuota > record.Quota {
		return ErrRequestBillingInvalid
	}
	if record.FundingSource == "wallet" {
		if record.BonusQuota < 0 || record.PaidQuota < 0 || record.BonusQuota+record.PaidQuota != record.Quota {
			return ErrRequestBillingInvalid
		}
	} else if record.FundingSource == "subscription" {
		var sub UserSubscription
		if err := DB.Where("id = ? AND user_id = ?", record.SubscriptionId, record.UserId).First(&sub).Error; err != nil {
			return err
		}
		if record.SubscriptionResetAt != sub.LastResetTime {
			return ErrRequestBillingPeriodChanged
		}
	} else {
		return ErrRequestBillingInvalid
	}
	record.Settled = record.TaskId == ""
	result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	var existing RequestBilling
	if err := DB.First(&existing, "id = ?", record.Id).Error; err != nil {
		return err
	}
	if existing.RequestId != record.RequestId || existing.UserId != record.UserId || existing.Quota != record.Quota || existing.BonusQuota != record.BonusQuota || existing.PaidQuota != record.PaidQuota {
		return ErrFinancialOperationConflict
	}
	return nil
}

func GetRequestBillings(requestId string) ([]RequestBilling, error) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || len(requestId) > 64 {
		return nil, ErrRequestBillingNotFound
	}
	var records []RequestBilling
	if err := DB.Where("request_id = ?", requestId).Order("created_at ASC, id ASC").Find(&records).Error; err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, ErrRequestBillingNotFound
	}
	for i := range records {
		err := DB.Transaction(func(tx *gorm.DB) error { return validateRequestBillingRefund(tx, &records[i]) })
		if err != nil {
			records[i].BlockedReason = err.Error()
		}
	}
	return records, nil
}

// GetUserRequestBillings lists request charges for the admin refund queue.
// Unlike the exact request lookup, an empty page is valid because a user may
// have no durable billing snapshots yet.
func GetUserRequestBillings(userId int, pageInfo *common.PageInfo) ([]RequestBilling, int64, error) {
	if userId <= 0 || pageInfo == nil {
		return nil, 0, ErrRequestBillingNotFound
	}
	query := DB.Where("user_id = ?", userId)
	var total int64
	if err := query.Model(&RequestBilling{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []RequestBilling
	if err := query.Order("created_at DESC, id DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	for i := range records {
		err := DB.Transaction(func(tx *gorm.DB) error { return validateRequestBillingRefund(tx, &records[i]) })
		if err != nil {
			records[i].BlockedReason = err.Error()
		}
	}
	return records, total, nil
}

type RequestBillingQuery struct {
	UserId        int    `form:"user_id" binding:"gte=0"`
	RequestId     string `form:"request_id" binding:"max=64"`
	ModelName     string `form:"model_name" binding:"max=255"`
	ChannelId     int    `form:"channel_id" binding:"gte=0"`
	FundingSource string `form:"funding_source" binding:"omitempty,oneof=wallet subscription"`
	Status        string `form:"status" binding:"omitempty,oneof=unrefunded refunded"`
	StartTime     int64  `form:"start_time" binding:"gte=0"`
	EndTime       int64  `form:"end_time" binding:"gte=0"`
}

func ListRequestBillings(filter RequestBillingQuery, page *common.PageInfo) ([]RequestBilling, int64, error) {
	query := DB.Model(&RequestBilling{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if filter.RequestId != "" {
		query = query.Where("request_id = ?", strings.TrimSpace(filter.RequestId))
	}
	if filter.ModelName != "" {
		query = query.Where("model_name = ?", strings.TrimSpace(filter.ModelName))
	}
	if filter.ChannelId > 0 {
		query = query.Where("channel_id = ?", filter.ChannelId)
	}
	if filter.FundingSource != "" {
		query = query.Where("funding_source = ?", filter.FundingSource)
	}
	if filter.Status == "refunded" {
		query = query.Where("refund_operation_id > 0")
	}
	if filter.Status == "unrefunded" {
		query = query.Where("refund_operation_id = 0")
	}
	if filter.StartTime > 0 {
		query = query.Where("created_at >= ?", filter.StartTime)
	}
	if filter.EndTime > 0 {
		query = query.Where("created_at <= ?", filter.EndTime)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []RequestBilling
	if err := query.Order("created_at DESC, id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	for i := range records {
		if err := DB.Transaction(func(tx *gorm.DB) error { return validateRequestBillingRefund(tx, &records[i]) }); err != nil {
			records[i].BlockedReason = err.Error()
		}
	}
	return records, total, nil
}

func validateRequestBillingRefund(tx *gorm.DB, record *RequestBilling) error {
	if record.RefundOperationId != 0 {
		return nil
	}
	if record.TaskId == "" && !record.Settled {
		return ErrRequestBillingUnsettled
	}
	if record.Quota <= 0 {
		return ErrRequestBillingNotFound
	}
	if record.TaskId != "" {
		var task Task
		if err := tx.Where("task_id = ? AND user_id = ?", record.TaskId, record.UserId).First(&task).Error; err != nil {
			return ErrRequestBillingUnsettled
		}
		if !record.UsageRecorded || task.Status != TaskStatusSuccess || task.Quota != record.Quota {
			return ErrRequestBillingUnsettled
		}
		record.Settled = true
	}
	if record.FundingSource == "subscription" {
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", record.SubscriptionId, record.UserId).First(&sub).Error; err != nil {
			return ErrRequestBillingInvalid
		}
		if sub.LastResetTime != record.SubscriptionResetAt || sub.AmountUsed < int64(record.Quota) || sub.Status != "active" || sub.EndTime <= common.GetTimestamp() || sub.NextResetTime > 0 && sub.NextResetTime <= common.GetTimestamp() {
			return ErrRequestBillingPeriodChanged
		}
	} else if record.FundingSource != "wallet" || record.BonusQuota < 0 || record.PaidQuota < 0 || record.BonusQuota+record.PaidQuota != record.Quota {
		return ErrRequestBillingInvalid
	}
	return nil
}

// AdjustTaskRequestBillingFunding retains the original wallet buckets through
// asynchronous settlement instead of converting paid refunds into bonuses.
func AdjustTaskRequestBillingFunding(task *Task, delta int) error {
	var change QuotaAllocation
	var token Token
	var cachedReservation QuotaAllocation
	err := DB.Transaction(func(tx *gorm.DB) error {
		var record RequestBilling
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND task_id = ?", task.PrivateData.BillingId, task.UserId, task.TaskID).First(&record).Error; err != nil {
			return err
		}
		if record.RefundOperationId != 0 || record.Quota != task.Quota || delta < -record.Quota || delta > common.MaxWalletQuota-record.Quota || !record.UsageRecorded {
			return ErrRequestBillingInvalid
		}
		if record.FundingSource == "subscription" {
			var sub UserSubscription
			if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", record.SubscriptionId, task.UserId).First(&sub).Error; err != nil {
				return err
			}
			if sub.LastResetTime != record.SubscriptionResetAt {
				return ErrRequestBillingPeriodChanged
			}
			next := sub.AmountUsed + int64(delta)
			if next < 0 || sub.AmountTotal > 0 && next > sub.AmountTotal {
				return ErrRequestBillingInvalid
			}
			if err := tx.Model(&sub).Update("amount_used", next).Error; err != nil {
				return err
			}
		} else {
			if record.FundingSource != "wallet" || record.BonusQuota < 0 || record.PaidQuota < 0 || record.BonusQuota+record.PaidQuota != record.Quota {
				return ErrRequestBillingInvalid
			}
			target, err := financialUserTx(tx, task.UserId)
			if err != nil {
				return err
			}
			if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
				target.PaidQuota = target.Quota
			}
			if delta > 0 {
				bonus := min(max(target.BonusQuota, 0), delta)
				change = QuotaAllocation{Bonus: bonus, Paid: delta - bonus}
				if common.RedisEnabled {
					result, allocation, cacheErr := cacheTryReserveUserQuota(task.UserId, int64(delta), true)
					if cacheErr != nil {
						return cacheErr
					}
					if result == cacheQuotaInsufficient {
						return ErrRequestBillingInvalid
					}
					if result == cacheQuotaOK {
						change, cachedReservation = allocation, allocation
					}
				}
			} else {
				paid := min(-delta, record.PaidQuota)
				change = QuotaAllocation{Bonus: delta + paid, Paid: -paid}
			}
			after, err := walletAfterDelta(target.Quota, -delta)
			if err != nil {
				return err
			}
			if err := tx.Unscoped().Model(&User{}).Where("id = ?", task.UserId).Updates(map[string]any{
				"quota": after, "bonus_quota": target.BonusQuota - change.Bonus, "paid_quota": target.PaidQuota - change.Paid,
			}).Error; err != nil {
				return err
			}
			if err := applyQuotaUsageDailyTx(tx, task.UserId, time.Now().Format("2006-01-02"), change); err != nil {
				return err
			}
		}
		nextTokenQuota := 0
		if record.TokenId > 0 && (record.TokenQuota > 0 || record.Quota == 0) {
			err := lockForUpdate(tx).Where("id = ? AND user_id = ?", record.TokenId, record.UserId).First(&token).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err == nil {
				nextTokenQuota = max(0, record.TokenQuota+delta)
				if _, err := walletAfterDelta(token.RemainQuota, -delta); err != nil {
					return err
				}
				if err := tx.Model(&token).Updates(map[string]any{
					"remain_quota": gorm.Expr("remain_quota - ?", delta), "used_quota": gorm.Expr("used_quota + ?", delta),
				}).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Model(&User{}).Where("id = ?", task.UserId).Update("used_quota", gorm.Expr("used_quota + ?", delta)).Error; err != nil {
			return err
		}
		if err := tx.Model(&Channel{}).Where("id = ?", task.ChannelId).Update("used_quota", gorm.Expr("used_quota + ?", delta)).Error; err != nil {
			return err
		}
		result := tx.Model(&Task{}).Where("id = ? AND quota = ?", task.ID, task.Quota).Update("quota", record.Quota+delta)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrRequestBillingUnsettled
		}
		return tx.Model(&record).Updates(map[string]any{
			"token_quota": nextTokenQuota,
			"quota":       record.Quota + delta, "bonus_quota": record.BonusQuota + change.Bonus, "paid_quota": record.PaidQuota + change.Paid,
		}).Error
	})
	if err != nil && cachedReservation.Total() != 0 {
		if _, cacheErr := cacheApplyUserQuotaSourceDelta(task.UserId, cachedReservation); cacheErr != nil {
			common.SysError(common.LogText("failed to compensate task wallet reservation: %s", cacheErr.Error()))
		}
	}
	if err == nil && change.Total() != 0 && cachedReservation.Total() == 0 {
		if _, cacheErr := cacheApplyUserQuotaSourceDelta(task.UserId, QuotaAllocation{Bonus: -change.Bonus, Paid: -change.Paid}); cacheErr != nil {
			common.SysError(common.LogText("failed to sync task settlement wallet cache: %s", cacheErr.Error()))
		}
	}
	if err == nil && token.Id > 0 && common.RedisEnabled {
		if _, cacheErr := cacheApplyTokenQuotaDelta(token.Id, token.Key, -int64(delta)); cacheErr != nil {
			common.SysError(common.LogText("failed to sync task token cache: %s", cacheErr.Error()))
		}
	}
	return err
}

// IsTaskBillingReady keeps polling from overtaking submission accounting.
// Untracked historical tasks retain their existing polling behavior.
func IsTaskBillingReady(task *Task) bool {
	if task.PrivateData.BillingId == "" {
		return true
	}
	var count int64
	if err := DB.Model(&RequestBilling{}).Where("id = ? AND usage_recorded = ?", task.PrivateData.BillingId, true).Count(&count).Error; err != nil {
		common.SysError(common.LogText("failed to read task billing readiness: %s", err.Error()))
		return false
	}
	return count > 0
}

// RefundRequestBilling credits one complete settled charge. The immutable
// operation and all authoritative accounting changes commit together.
func RefundRequestBilling(billingId, reason string, operatorId, operatorRole int) (FinancialOperation, bool, error) {
	var operation FinancialOperation
	reason, err := validateFinancialReason(reason)
	if err != nil {
		return operation, false, err
	}
	var record RequestBilling
	var token Token
	already := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ?", billingId).First(&record).Error; err != nil {
			return ErrRequestBillingNotFound
		}
		target, err := financialUserTx(tx, record.UserId)
		if err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && target.Role >= operatorRole {
			return ErrFinancialRoleForbidden
		}
		if record.RefundOperationId != 0 {
			already = true
			return tx.First(&operation, record.RefundOperationId).Error
		}
		if err := validateRequestBillingRefund(tx, &record); err != nil {
			return err
		}
		if target.BonusQuota == 0 && target.PaidQuota == 0 && target.Quota != 0 {
			target.PaidQuota = target.Quota
		}
		after := target.Quota
		bonus, paid := 0, 0
		if record.FundingSource == "wallet" {
			bonus, paid = record.BonusQuota, record.PaidQuota
			after, err = walletAfterDelta(target.Quota, record.Quota)
			if err != nil {
				return err
			}
			if _, err := walletAfterDelta(target.BonusQuota, bonus); err != nil {
				return err
			}
			if _, err := walletAfterDelta(target.PaidQuota, paid); err != nil {
				return err
			}
		} else {
			if err := tx.Model(&UserSubscription{}).Where("id = ?", record.SubscriptionId).
				Update("amount_used", gorm.Expr("amount_used - ?", record.Quota)).Error; err != nil {
				return err
			}
		}
		if err := tx.Unscoped().Model(&User{}).Where("id = ?", target.Id).Updates(map[string]any{
			"quota": after, "bonus_quota": target.BonusQuota + bonus, "paid_quota": target.PaidQuota + paid,
			"used_quota": gorm.Expr("used_quota - ?", record.Quota),
		}).Error; err != nil {
			return err
		}
		if record.TokenId > 0 && record.TokenQuota > 0 {
			err := lockForUpdate(tx).Where("id = ? AND user_id = ?", record.TokenId, target.Id).First(&token).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err == nil {
				if _, err := walletAfterDelta(token.RemainQuota, record.TokenQuota); err != nil {
					return err
				}
				if err := tx.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]any{
					"remain_quota": gorm.Expr("remain_quota + ?", record.TokenQuota),
					"used_quota":   gorm.Expr("used_quota - ?", record.TokenQuota),
				}).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Model(&Channel{}).Where("id = ?", record.ChannelId).
			Update("used_quota", gorm.Expr("used_quota - ?", record.Quota)).Error; err != nil {
			return err
		}
		if bonus+paid > 0 {
			if err := applyQuotaUsageDailyTx(tx, target.Id, time.Now().Format("2006-01-02"), QuotaAllocation{Bonus: -bonus, Paid: -paid}); err != nil {
				return err
			}
		}
		operatorUsername, err := operatorUsernameTx(tx, operatorId)
		if err != nil {
			return err
		}
		operation = FinancialOperation{
			OperationType: FinancialOperationRequestRefund, OperationKey: "request_refund:" + record.Id,
			OperatorId: operatorId, OperatorUsername: operatorUsername, TargetUserId: target.Id, TargetUsername: target.Username,
			SourceType: "request", SourceId: record.RequestId, PrincipalQuota: record.Quota,
			TargetMainBefore: target.Quota, TargetMainAfter: after, TargetMainDelta: bonus + paid,
			TargetBonusDelta: bonus, TargetPaidDelta: paid, Reason: reason,
		}
		if err := tx.Create(&operation).Error; err != nil {
			return err
		}
		return tx.Model(&record).Updates(map[string]any{
			"refunded_quota": record.Quota, "refunded_at": common.GetTimestamp(),
			"refund_operation_id": operation.Id, "refund_log_pending": true,
		}).Error
	})
	if err != nil || already {
		return operation, already, err
	}
	if record.FundingSource == "wallet" {
		if _, err := cacheApplyUserQuotaSourceDelta(record.UserId, QuotaAllocation{Bonus: record.BonusQuota, Paid: record.PaidQuota}); err != nil {
			common.SysError(common.LogText("failed to sync request refund wallet cache: %s", err.Error()))
		}
	}
	if token.Id > 0 && common.RedisEnabled {
		if _, err := cacheApplyTokenQuotaDelta(token.Id, token.Key, int64(record.TokenQuota)); err != nil {
			common.SysError(common.LogText("failed to sync request refund token cache: %s", err.Error()))
		}
	}
	if err := publishRequestRefundLog(record.Id); err != nil {
		common.SysError(common.LogText("request refund log publication pending: %s", err.Error()))
	}
	return operation, false, nil
}

// The main database holds the refund even when a separate log database is
// unavailable. A deterministic request ID makes publication retries safe.
func publishRequestRefundLog(billingId string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var record RequestBilling
		if err := lockForUpdate(tx).Where("id = ?", billingId).First(&record).Error; err != nil {
			return err
		}
		if !record.RefundLogPending {
			return nil
		}
		logDB := LOG_DB
		if LOG_DB == DB {
			logDB = tx
		}
		requestId := "refund_" + record.Id
		var count int64
		if err := logDB.Model(&Log{}).Where("request_id = ? AND type = ?", requestId, LogTypeRefund).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			var operation FinancialOperation
			if err := tx.First(&operation, record.RefundOperationId).Error; err != nil {
				return err
			}
			other := NewLogOther()
			other.SetPublic("billing_id", record.Id)
			other.SetPublic("original_request_id", record.RequestId)
			other.SetPublic("financial_operation_id", operation.Id)
			other.SetPublic("billing_source", record.FundingSource)
			other.SetPublic("reason", operation.Reason)
			other.SetPublic("refund_kind", "request")
			if err := logDB.Create(&Log{
				UserId: record.UserId, Username: record.Username, CreatedAt: record.RefundedAt, Type: LogTypeRefund,
				ModelName: record.ModelName, TokenId: record.TokenId, TokenName: record.TokenName, ChannelId: record.ChannelId, Group: record.Group,
				Quota: record.RefundedQuota, RequestId: requestId, Other: other.JSONString(),
			}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&record).Update("refund_log_pending", false).Error
	})
}

func FlushRequestRefundLogs(limit int) error {
	var records []RequestBilling
	if err := DB.Select("id").Where("refund_log_pending = ?", true).Limit(limit).Find(&records).Error; err != nil {
		return err
	}
	for _, record := range records {
		if err := publishRequestRefundLog(record.Id); err != nil {
			return err
		}
	}
	return nil
}
