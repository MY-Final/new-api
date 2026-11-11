package model

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	MaxSubscriptionQuotaWindows        = 8
	MaxSubscriptionQuotaWindowSeconds  = int64(366 * 24 * 60 * 60)
	MinSubscriptionQuotaWindowSeconds  = int64(1)
	subscriptionQuotaWindowCursorChunk = 200
)

// SubscriptionQuotaWindow is the public plan representation of one rolling
// quota window. QuotaLimit is stored in internal quota units.
type SubscriptionQuotaWindow struct {
	Id            int   `json:"id,omitempty"`
	WindowSeconds int64 `json:"window_seconds"`
	QuotaLimit    int64 `json:"quota_limit"`
	SortOrder     int   `json:"sort_order"`
}

type SubscriptionQuotaWindowUsage struct {
	WindowSeconds int64 `json:"window_seconds"`
	QuotaLimit    int64 `json:"quota_limit"`
	// Used is settled usage. Reserved is held by requests still in progress,
	// and Remaining is the quota left after settled usage.
	Used          int64 `json:"used"`
	Reserved      int64 `json:"reserved"`
	Remaining     int64 `json:"remaining"`
	NextReleaseAt int64 `json:"next_release_at"`
	SortOrder     int   `json:"sort_order"`
}

type SubscriptionPlanQuotaWindow struct {
	Id            int   `json:"id"`
	PlanId        int   `json:"plan_id" gorm:"index;not null;uniqueIndex:idx_subscription_plan_window,priority:1"`
	WindowSeconds int64 `json:"window_seconds" gorm:"not null;uniqueIndex:idx_subscription_plan_window,priority:2"`
	QuotaLimit    int64 `json:"quota_limit" gorm:"type:bigint;not null"`
	SortOrder     int   `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt     int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt     int64 `json:"updated_at" gorm:"bigint"`
}

func (w *SubscriptionPlanQuotaWindow) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	w.CreatedAt = now
	w.UpdatedAt = now
	return nil
}

func (w *SubscriptionPlanQuotaWindow) BeforeUpdate(tx *gorm.DB) error {
	w.UpdatedAt = common.GetTimestamp()
	return nil
}

type UserSubscriptionQuotaWindow struct {
	Id                 int   `json:"id"`
	UserSubscriptionId int   `json:"user_subscription_id" gorm:"index;not null;uniqueIndex:idx_user_subscription_window,priority:1"`
	WindowSeconds      int64 `json:"window_seconds" gorm:"not null;uniqueIndex:idx_user_subscription_window,priority:2"`
	QuotaLimit         int64 `json:"quota_limit" gorm:"type:bigint;not null"`
	SortOrder          int   `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt          int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64 `json:"updated_at" gorm:"bigint"`
}

func (w *UserSubscriptionQuotaWindow) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	w.CreatedAt = now
	w.UpdatedAt = now
	return nil
}

func (w *UserSubscriptionQuotaWindow) BeforeUpdate(tx *gorm.DB) error {
	w.UpdatedAt = common.GetTimestamp()
	return nil
}

func NormalizeSubscriptionQuotaWindows(windows []SubscriptionQuotaWindow) ([]SubscriptionQuotaWindow, error) {
	if len(windows) > MaxSubscriptionQuotaWindows {
		return nil, fmt.Errorf("at most %d quota windows are allowed", MaxSubscriptionQuotaWindows)
	}
	if len(windows) == 0 {
		return []SubscriptionQuotaWindow{}, nil
	}

	result := make([]SubscriptionQuotaWindow, 0, len(windows))
	seen := make(map[int64]struct{}, len(windows))
	for index, window := range windows {
		if window.WindowSeconds < MinSubscriptionQuotaWindowSeconds || window.WindowSeconds > MaxSubscriptionQuotaWindowSeconds {
			return nil, fmt.Errorf("quota window must be between %d and %d seconds", MinSubscriptionQuotaWindowSeconds, MaxSubscriptionQuotaWindowSeconds)
		}
		if window.QuotaLimit <= 0 {
			return nil, errors.New("quota window limit must be positive")
		}
		if _, exists := seen[window.WindowSeconds]; exists {
			return nil, errors.New("quota window durations must be unique")
		}
		seen[window.WindowSeconds] = struct{}{}
		window.Id = 0
		window.SortOrder = index
		result = append(result, window)
	}
	slices.SortFunc(result, func(a, b SubscriptionQuotaWindow) int {
		switch {
		case a.WindowSeconds < b.WindowSeconds:
			return -1
		case a.WindowSeconds > b.WindowSeconds:
			return 1
		default:
			return 0
		}
	})
	for index := range result {
		result[index].SortOrder = index
	}
	return result, nil
}

func HasSubscriptionQuotaWindows(tx *gorm.DB, planId int) (bool, error) {
	if tx == nil {
		tx = DB
	}
	var count int64
	if err := tx.Model(&SubscriptionPlanQuotaWindow{}).
		Where("plan_id = ?", planId).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func ReplaceSubscriptionPlanQuotaWindowsTx(tx *gorm.DB, planId int, windows []SubscriptionQuotaWindow) error {
	if tx == nil || planId <= 0 {
		return errors.New("invalid plan quota windows args")
	}
	normalized, err := NormalizeSubscriptionQuotaWindows(windows)
	if err != nil {
		return err
	}
	if err := tx.Where("plan_id = ?", planId).Delete(&SubscriptionPlanQuotaWindow{}).Error; err != nil {
		return err
	}
	if len(normalized) == 0 {
		return nil
	}
	rows := make([]SubscriptionPlanQuotaWindow, 0, len(normalized))
	for _, window := range normalized {
		rows = append(rows, SubscriptionPlanQuotaWindow{
			PlanId:        planId,
			WindowSeconds: window.WindowSeconds,
			QuotaLimit:    window.QuotaLimit,
			SortOrder:     window.SortOrder,
		})
	}
	return tx.Create(&rows).Error
}

func LoadSubscriptionPlanQuotaWindowsTx(tx *gorm.DB, plan *SubscriptionPlan) error {
	if plan == nil || plan.Id <= 0 {
		return errors.New("invalid subscription plan")
	}
	if tx == nil {
		tx = DB
	}
	var rows []SubscriptionPlanQuotaWindow
	if err := tx.Where("plan_id = ?", plan.Id).
		Order("sort_order asc, window_seconds asc, id asc").
		Find(&rows).Error; err != nil {
		return err
	}
	plan.QuotaWindows = make([]SubscriptionQuotaWindow, 0, len(rows))
	for _, row := range rows {
		plan.QuotaWindows = append(plan.QuotaWindows, SubscriptionQuotaWindow{
			Id:            row.Id,
			WindowSeconds: row.WindowSeconds,
			QuotaLimit:    row.QuotaLimit,
			SortOrder:     row.SortOrder,
		})
	}
	return nil
}

func HydrateSubscriptionPlansQuotaWindows(plans []SubscriptionPlan) error {
	for index := range plans {
		if err := LoadSubscriptionPlanQuotaWindowsTx(nil, &plans[index]); err != nil {
			return err
		}
	}
	return nil
}

func SnapshotPlanQuotaWindowsTx(tx *gorm.DB, subscriptionId int, windows []SubscriptionQuotaWindow) error {
	if tx == nil || subscriptionId <= 0 {
		return errors.New("invalid subscription quota snapshot args")
	}
	if len(windows) == 0 {
		return nil
	}
	rows := make([]UserSubscriptionQuotaWindow, 0, len(windows))
	for index, window := range windows {
		rows = append(rows, UserSubscriptionQuotaWindow{
			UserSubscriptionId: subscriptionId,
			WindowSeconds:      window.WindowSeconds,
			QuotaLimit:         window.QuotaLimit,
			SortOrder:          index,
		})
	}
	return tx.Create(&rows).Error
}

func LoadUserSubscriptionQuotaWindowsTx(tx *gorm.DB, subscriptionId int) ([]UserSubscriptionQuotaWindow, error) {
	if tx == nil {
		tx = DB
	}
	var rows []UserSubscriptionQuotaWindow
	err := tx.Where("user_subscription_id = ?", subscriptionId).
		Order("sort_order asc, window_seconds asc, id asc").
		Find(&rows).Error
	return rows, err
}

func subscriptionUsageSinceTx(tx *gorm.DB, subscriptionId int, since int64) (int64, int64, error) {
	if tx == nil {
		tx = DB
	}
	type aggregate struct {
		Used     int64
		OldestAt int64
	}
	var result aggregate
	err := tx.Model(&SubscriptionPreConsumeRecord{}).
		Select("COALESCE(SUM(usage_quota), 0) AS used, COALESCE(MIN(created_at), 0) AS oldest_at").
		Where("user_subscription_id = ? AND created_at > ? AND status <> ?", subscriptionId, since, SubscriptionUsageStatusRefunded).
		Scan(&result).Error
	if err != nil {
		return 0, 0, err
	}
	if result.Used < 0 {
		return 0, 0, errors.New("subscription rolling usage sum is invalid")
	}
	return result.Used, result.OldestAt, nil
}

func checkSubscriptionQuotaWindowsTx(tx *gorm.DB, subscriptionId int, windows []UserSubscriptionQuotaWindow, amount, now int64) error {
	var limitErr *SubscriptionWindowLimitError
	for _, window := range windows {
		used, _, err := subscriptionUsageSinceTx(tx, subscriptionId, now-window.WindowSeconds)
		if err != nil {
			return err
		}
		if used <= window.QuotaLimit && amount <= window.QuotaLimit-used {
			continue
		}
		recoveryAt, err := subscriptionWindowRecoveryAfterTx(tx, subscriptionId,
			now-window.WindowSeconds, max(used+amount-window.QuotaLimit, 0))
		if err != nil {
			return err
		}
		retryAfter := max(recoveryAt+window.WindowSeconds-now, int64(1))
		candidate := &SubscriptionWindowLimitError{
			WindowSeconds: window.WindowSeconds, QuotaLimit: window.QuotaLimit,
			Used: used, RetryAfter: retryAfter,
		}
		// Admission needs every window to recover, not merely the first one.
		if limitErr == nil || candidate.RetryAfter > limitErr.RetryAfter {
			limitErr = candidate
		}
	}
	if limitErr != nil {
		return limitErr
	}
	return nil
}

func subscriptionWindowRecoveryAfterTx(tx *gorm.DB, subscriptionId int, since int64, releaseAmount int64) (int64, error) {
	if releaseAmount <= 0 {
		return 0, nil
	}
	if tx == nil {
		tx = DB
	}
	var rows []SubscriptionPreConsumeRecord
	if err := tx.
		Select("created_at", "usage_quota").
		Where("user_subscription_id = ? AND created_at > ? AND status <> ?", subscriptionId, since, SubscriptionUsageStatusRefunded).
		Order("created_at asc, id asc").
		Find(&rows).Error; err != nil {
		return 0, err
	}
	var released int64
	for _, row := range rows {
		released += max(row.UsageQuota, 0)
		if released >= releaseAmount {
			return row.CreatedAt, nil
		}
	}
	return 0, nil
}

func PopulateSubscriptionQuotaWindowUsage(subscription *UserSubscription, now int64) error {
	if subscription == nil || subscription.Id <= 0 {
		return errors.New("invalid user subscription")
	}
	rows, err := LoadUserSubscriptionQuotaWindowsTx(nil, subscription.Id)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		subscription.QuotaWindows = []SubscriptionQuotaWindowUsage{}
		return nil
	}
	usage := make([]SubscriptionQuotaWindowUsage, 0, len(rows))
	for _, row := range rows {
		cutoff := now - row.WindowSeconds
		totalUsed, oldestAt, err := subscriptionUsageSinceTx(nil, subscription.Id, cutoff)
		if err != nil {
			return err
		}
		reserved, err := subscriptionReservedQuota(subscription.Id, cutoff)
		if err != nil {
			return err
		}
		settled := max(totalUsed-reserved, 0)
		remaining := max(row.QuotaLimit-settled, 0)
		nextReleaseAt := int64(0)
		if totalUsed > 0 && oldestAt > 0 {
			nextReleaseAt = oldestAt + row.WindowSeconds
		}
		usage = append(usage, SubscriptionQuotaWindowUsage{
			WindowSeconds: row.WindowSeconds,
			QuotaLimit:    row.QuotaLimit,
			Used:          settled,
			Reserved:      reserved,
			Remaining:     remaining,
			NextReleaseAt: nextReleaseAt,
			SortOrder:     row.SortOrder,
		})
	}
	subscription.QuotaWindows = usage
	return nil
}

func subscriptionQuotaWindowRetentionSecondsTx(tx *gorm.DB) (int64, error) {
	if tx == nil {
		tx = DB
	}
	var maxWindow int64
	if err := tx.Model(&UserSubscriptionQuotaWindow{}).
		Select("COALESCE(MAX(window_seconds), 0)").
		Scan(&maxWindow).Error; err != nil {
		return 0, err
	}
	if maxWindow <= 0 {
		return 7 * 24 * 60 * 60, nil
	}
	const grace = int64(7 * 24 * 60 * 60)
	if maxWindow > (1<<63-1)-grace {
		return 1<<63 - 1, nil
	}
	return maxWindow + grace, nil
}

func nextWindowBoundary(now int64, windowSeconds int64) int64 {
	if windowSeconds <= 0 {
		return now
	}
	return time.Unix(now, 0).Truncate(time.Duration(windowSeconds) * time.Second).Add(time.Duration(windowSeconds) * time.Second).Unix()
}
