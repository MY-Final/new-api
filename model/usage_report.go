package model

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The daily usage report is defined in Beijing time so the schedule and the
// statistics window stay identical on servers running in any time zone.
// Asia/Shanghai has no daylight saving transitions, so a fixed zone is exact
// and does not depend on tzdata being present in the container image.
var usageReportLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

const (
	// UsageReportWindowEndHour is the Beijing hour that closes a report window.
	UsageReportWindowEndHour = 22
	// UsageReportMaxAttempts bounds automatic delivery retries: the scheduled
	// run plus two retries, never more.
	UsageReportMaxAttempts = 3
	// UsageReportStatsVersion records the calculation rules of a snapshot.
	UsageReportStatsVersion = 1

	// UsageReportNoVerifiedRecipient records why a snapshot never queued mail.
	UsageReportNoVerifiedRecipient = "no verified recipient email"

	UsageReportStatusPending   = "pending"
	UsageReportStatusSending   = "sending"
	UsageReportStatusRetry     = "retry"
	UsageReportStatusSent      = "sent"
	UsageReportStatusFailed    = "failed"
	UsageReportStatusCancelled = "cancelled"

	UsageReportRecipientPending = "pending"
	UsageReportRecipientSent    = "sent"
	UsageReportRecipientFailed  = "failed"

	UsageReportRunRunning  = "running"
	UsageReportRunFinished = "finished"
	UsageReportRunFailed   = "failed"
	UsageReportRunMaxTries = 3
)

// Errors of an administrator-triggered report. Their texts are also keys of the
// web console locale files.
var (
	ErrUsageReportNoUsage     = common.NewMessage("This user has no usage in the selected period")
	ErrUsageReportNoRecipient = common.NewMessage("This user has no verified email address")
)

// UsageReportGroup is one group's share of a snapshot. Totals are computed
// from the same rows, so the group rows always add up to the summary.
type UsageReportGroup struct {
	Group        string `json:"group"`
	RequestCount int64  `json:"request_count"`
	Quota        int64  `json:"quota"`
	Tokens       int64  `json:"tokens"`
}

// UsageReport is the immutable daily snapshot. It is created before any mail
// is sent and every retry reuses it, so later requests can never change the
// content of a report that was already generated.
type UsageReport struct {
	Id                int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId            int    `json:"user_id" gorm:"not null;uniqueIndex:idx_usage_report_user_date"`
	Date              string `json:"date" gorm:"type:varchar(10);not null;uniqueIndex:idx_usage_report_user_date;index:idx_usage_report_status,priority:2"`
	WindowStart       int64  `json:"window_start" gorm:"type:bigint;not null"`
	WindowEnd         int64  `json:"window_end" gorm:"type:bigint;not null"`
	RequestCount      int64  `json:"request_count" gorm:"type:bigint;not null"`
	Quota             int64  `json:"quota" gorm:"type:bigint;not null"`
	WalletQuota       int64  `json:"wallet_quota" gorm:"type:bigint;not null"`
	SubscriptionQuota int64  `json:"subscription_quota" gorm:"type:bigint;not null"`
	TotalTokens       int64  `json:"total_tokens" gorm:"type:bigint;not null"`
	Groups            string `json:"groups" gorm:"type:text"`
	StatsVersion      int    `json:"stats_version" gorm:"not null"`
	Status            string `json:"status" gorm:"type:varchar(16);not null;index:idx_usage_report_status,priority:1"`
	Attempts          int    `json:"attempts" gorm:"not null;default:0"`
	NextAttemptAt     int64  `json:"next_attempt_at" gorm:"type:bigint;not null;default:0"`
	LastError         string `json:"last_error" gorm:"type:varchar(255)"`
	GeneratedAt       int64  `json:"generated_at" gorm:"type:bigint;not null"`
	SentAt            int64  `json:"sent_at" gorm:"type:bigint;not null;default:0"`
	CreatedAt         int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// UsageReportRecipient keeps delivery state per address so a failure for one
// mailbox never hides or repeats the delivery recorded for another.
type UsageReportRecipient struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	ReportId  int    `json:"report_id" gorm:"not null;uniqueIndex:idx_usage_report_recipient"`
	Email     string `json:"email" gorm:"type:varchar(50);not null;uniqueIndex:idx_usage_report_recipient"`
	Status    string `json:"status" gorm:"type:varchar(16);not null"`
	Attempts  int    `json:"attempts" gorm:"not null;default:0"`
	LastError string `json:"last_error" gorm:"type:varchar(255)"`
	SentAt    int64  `json:"sent_at" gorm:"type:bigint;not null;default:0"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// UsageReportRun records that snapshot generation for one date has started and
// finished. It is the idempotency guard for the scheduled job, including
// restarts and multiple instances.
type UsageReportRun struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Date       string `json:"date" gorm:"type:varchar(10);not null;uniqueIndex:idx_usage_report_run_date"`
	Status     string `json:"status" gorm:"type:varchar(16);not null"`
	Attempts   int    `json:"attempts" gorm:"not null;default:0"`
	StartedAt  int64  `json:"started_at" gorm:"type:bigint;not null"`
	FinishedAt int64  `json:"finished_at" gorm:"type:bigint;not null;default:0"`
	LastError  string `json:"last_error" gorm:"type:varchar(255)"`
}

// UsageReportNow returns the current time in Beijing time.
func UsageReportNow() time.Time {
	return time.Now().In(usageReportLocation)
}

// UsageReportDate formats a time as the Beijing calendar date.
func UsageReportDate(t time.Time) string {
	return t.In(usageReportLocation).Format("2006-01-02")
}

// UsageReportWindow returns the [00:00, 22:00) Beijing window of date.
func UsageReportWindow(date string) (start int64, end int64, err error) {
	day, err := time.ParseInLocation("2006-01-02", date, usageReportLocation)
	if err != nil {
		return 0, 0, err
	}
	return day.Unix(), day.Add(UsageReportWindowEndHour * time.Hour).Unix(), nil
}

// UsageReportTimeLabel formats a Unix second in Beijing time for report copy.
func UsageReportTimeLabel(timestamp int64) string {
	return time.Unix(timestamp, 0).In(usageReportLocation).Format("2006-01-02 15:04")
}

// UsageReportRangeLabel renders [start, end) in Beijing time. The repeated date
// is omitted when both ends stay on the same day.
func UsageReportRangeLabel(start int64, end int64) string {
	startTime := time.Unix(start, 0).In(usageReportLocation)
	endTime := time.Unix(end, 0).In(usageReportLocation)
	if startTime.Format("2006-01-02") == endTime.Format("2006-01-02") {
		return startTime.Format("2006-01-02 15:04") + "–" + endTime.Format("15:04")
	}
	return startTime.Format("2006-01-02 15:04") + " – " + endTime.Format("2006-01-02 15:04")
}

func usageReportNextRetryAt(attempts int, now int64) int64 {
	switch attempts {
	case 1:
		return now + 5*60
	case 2:
		return now + 15*60
	default:
		return 0
	}
}

func usageReportGroupsJSON(groups []UsageReportGroup) string {
	encoded, err := common.Marshal(groups)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

// DecodeUsageReportGroups returns the snapshot group rows.
func (report *UsageReport) DecodeUsageReportGroups() []UsageReportGroup {
	groups := make([]UsageReportGroup, 0)
	if report == nil || report.Groups == "" {
		return groups
	}
	if err := common.UnmarshalJsonStr(report.Groups, &groups); err != nil {
		return make([]UsageReportGroup, 0)
	}
	return groups
}

// SaveUsageReport persists a snapshot and its recipients exactly once. The
// second caller for the same user and date gets created=false and no rows.
func SaveUsageReport(report *UsageReport, emails []string) (bool, error) {
	created := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}},
			DoNothing: true,
		}).Create(report)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		created = true
		now := common.GetTimestamp()
		for _, email := range emails {
			recipient := UsageReportRecipient{
				ReportId:  report.Id,
				Email:     NormalizeEmail(email),
				Status:    UsageReportRecipientPending,
				UpdatedAt: now,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "report_id"}, {Name: "email"}},
				DoNothing: true,
			}).Create(&recipient).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return created, err
}

// FindUsageReport returns the snapshot for one user and date, or nil.
func FindUsageReport(userId int, date string) (*UsageReport, error) {
	var report UsageReport
	err := DB.Where("user_id = ? AND date = ?", userId, date).First(&report).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &report, nil
}

// GetUsageReportById loads one snapshot.
func GetUsageReportById(id int) (*UsageReport, error) {
	var report UsageReport
	err := DB.Where("id = ?", id).First(&report).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &report, nil
}

// ListDueUsageReports returns snapshots whose next delivery attempt is due.
func ListDueUsageReports(now int64, limit int) ([]*UsageReport, error) {
	if limit <= 0 {
		limit = 50
	}
	var reports []*UsageReport
	err := DB.Where("status IN ? AND next_attempt_at <= ?", []string{UsageReportStatusPending, UsageReportStatusRetry}, now).
		Order("id ASC").
		Limit(limit).
		Find(&reports).Error
	return reports, err
}

// ClaimUsageReport marks one due snapshot as being delivered. The conditional
// update is the cross-instance lock: only the caller that flips the row sends.
func ClaimUsageReport(id int, now int64) (bool, error) {
	result := DB.Model(&UsageReport{}).
		Where("id = ? AND status IN ? AND next_attempt_at <= ?", id, []string{UsageReportStatusPending, UsageReportStatusRetry}, now).
		Updates(map[string]any{
			"status":     UsageReportStatusSending,
			"attempts":   gorm.Expr("attempts + 1"),
			"updated_at": now,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// RecoverStaleUsageReports returns snapshots abandoned by a crashed instance to
// the retry queue. The update keeps the attempt counter so recovery cannot
// extend the retry budget.
func RecoverStaleUsageReports(now int64, staleBefore int64) error {
	return DB.Model(&UsageReport{}).
		Where("status = ? AND updated_at < ?", UsageReportStatusSending, staleBefore).
		Updates(map[string]any{
			"status":          UsageReportStatusRetry,
			"next_attempt_at": now,
			"updated_at":      now,
		}).Error
}

// UsageReportDeliveryOutcome summarizes one delivery round.
type UsageReportDeliveryOutcome struct {
	Sent    int
	Failed  int
	Pending int
}

// FinishUsageReport stores the round result: either schedule another retry or
// settle the snapshot as sent, failed, or cancelled.
func FinishUsageReport(report *UsageReport, outcome UsageReportDeliveryOutcome, lastError string, now int64) error {
	status := UsageReportStatusSent
	nextAttemptAt := int64(0)
	sentAt := int64(0)
	switch {
	case outcome.Sent > 0 && outcome.Pending == 0:
		status = UsageReportStatusSent
		sentAt = now
	case outcome.Pending > 0 && report.Attempts < UsageReportMaxAttempts:
		status = UsageReportStatusRetry
		nextAttemptAt = usageReportNextRetryAt(report.Attempts, now)
	case outcome.Sent > 0:
		status = UsageReportStatusSent
		sentAt = now
	default:
		status = UsageReportStatusFailed
	}
	updates := map[string]any{
		"status":          status,
		"next_attempt_at": nextAttemptAt,
		"last_error":      lastError,
		"sent_at":         sentAt,
		"updated_at":      now,
	}
	return DB.Model(&UsageReport{}).Where("id = ?", report.Id).Updates(updates).Error
}

// CancelUnscheduledUsageReports drops snapshots that have not been delivered
// yet, so closing the subscription never sends a report that is already past
// its window.
func CancelUnscheduledUsageReports(userId int, now int64) error {
	return DB.Model(&UsageReport{}).
		Where("user_id = ? AND status IN ?", userId, []string{UsageReportStatusPending, UsageReportStatusRetry}).
		Updates(map[string]any{
			"status":          UsageReportStatusCancelled,
			"next_attempt_at": 0,
			"updated_at":      now,
		}).Error
}

// CancelUsageReportForDisabledUser cancels one report when the owner turned the
// subscription off between generation and delivery.
func CancelUsageReportForDisabledUser(reportId int, now int64) error {
	return DB.Model(&UsageReport{}).
		Where("id = ? AND status = ?", reportId, UsageReportStatusSending).
		Updates(map[string]any{
			"status":     UsageReportStatusCancelled,
			"updated_at": now,
		}).Error
}

// ListUsageReportRecipients returns every recipient row of a snapshot.
func ListUsageReportRecipients(reportId int) ([]*UsageReportRecipient, error) {
	var recipients []*UsageReportRecipient
	err := DB.Where("report_id = ?", reportId).Order("id ASC").Find(&recipients).Error
	return recipients, err
}

// MarkUsageReportRecipient records the delivery result of one address.
func MarkUsageReportRecipient(recipientId int, status string, lastError string, now int64) error {
	updates := map[string]any{
		"status":     status,
		"last_error": lastError,
		"attempts":   gorm.Expr("attempts + 1"),
		"updated_at": now,
	}
	if status == UsageReportRecipientSent {
		updates["sent_at"] = now
	}
	return DB.Model(&UsageReportRecipient{}).Where("id = ?", recipientId).Updates(updates).Error
}

// FailRemainingUsageReportRecipients closes a snapshot whose retry budget is
// exhausted, so no pending recipient is left behind.
func FailRemainingUsageReportRecipients(reportId int, lastError string, now int64) error {
	return DB.Model(&UsageReportRecipient{}).
		Where("report_id = ? AND status = ?", reportId, UsageReportRecipientPending).
		Updates(map[string]any{
			"status":     UsageReportRecipientFailed,
			"last_error": lastError,
			"updated_at": now,
		}).Error
}

// ClaimUsageReportRun acquires the generation job for one date. It returns true
// only for the caller that may build the snapshots.
func ClaimUsageReportRun(date string, now int64, staleBefore int64) (bool, error) {
	run := UsageReportRun{Date: date, Status: UsageReportRunRunning, Attempts: 1, StartedAt: now}
	result := DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "date"}},
		DoNothing: true,
	}).Create(&run)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		return true, nil
	}
	claimed := DB.Model(&UsageReportRun{}).
		Where("date = ? AND attempts < ? AND ((status = ? AND started_at < ?) OR (status = ? AND started_at < ?))",
			date, UsageReportRunMaxTries,
			UsageReportRunRunning, staleBefore,
			UsageReportRunFailed, staleBefore).
		Updates(map[string]any{
			"status":      UsageReportRunRunning,
			"attempts":    gorm.Expr("attempts + 1"),
			"started_at":  now,
			"finished_at": 0,
			"last_error":  "",
		})
	if claimed.Error != nil {
		return false, claimed.Error
	}
	return claimed.RowsAffected == 1, nil
}

// FinishUsageReportRun marks a generation job as finished or failed.
func FinishUsageReportRun(date string, failed bool, lastError string, now int64) error {
	status := UsageReportRunFinished
	if failed {
		status = UsageReportRunFailed
	}
	return DB.Model(&UsageReportRun{}).Where("date = ?", date).Updates(map[string]any{
		"status":      status,
		"finished_at": now,
		"last_error":  lastError,
	}).Error
}

// UsageReportRunNeedsRecovery reports whether a generation job for date was
// started but never completed successfully.
func UsageReportRunNeedsRecovery(date string, now int64, staleBefore int64) bool {
	var count int64
	err := DB.Model(&UsageReportRun{}).
		Where("date = ? AND attempts < ? AND ((status = ? AND started_at < ?) OR status = ?)",
			date, UsageReportRunMaxTries, UsageReportRunRunning, staleBefore, UsageReportRunFailed).
		Count(&count).Error
	return err == nil && count > 0
}

// CleanupUsageReports removes snapshots older than date (inclusive).
func CleanupUsageReports(beforeDate string, limit int) (int64, error) {
	if limit <= 0 {
		limit = 500
	}
	var ids []int
	if err := DB.Model(&UsageReport{}).Where("date < ?", beforeDate).Order("id ASC").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result := DB.Where("id IN ?", ids).Delete(&UsageReport{})
	if result.Error != nil {
		return 0, result.Error
	}
	if err := DB.Where("report_id IN ?", ids).Delete(&UsageReportRecipient{}).Error; err != nil {
		return 0, err
	}
	return result.RowsAffected, nil
}

// usageReportUser is the user fields the report needs.
type usageReportUser struct {
	Id       int
	Username string
	Email    string
	Setting  string
	Status   int
}

func (usageReportUser) TableName() string {
	return "users"
}

// usageReportLoadBatch bounds IN lists so SQLite's variable limit is never the
// reason a busy day's report generation fails.
const usageReportLoadBatch = 500

func loadUsageReportUsers(userIds []int) (map[int]*usageReportUser, error) {
	users := make(map[int]*usageReportUser, len(userIds))
	for start := 0; start < len(userIds); start += usageReportLoadBatch {
		batch := userIds[start:min(start+usageReportLoadBatch, len(userIds))]
		var rows []usageReportUser
		if err := DB.Select("id", "username", "email", "setting", "status").
			Where("id IN ?", batch).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		for i := range rows {
			users[rows[i].Id] = &rows[i]
		}
	}
	return users, nil
}

// UsageReportRecipients returns the verified addresses that may receive the
// report for a user. The account email and the notification email are both
// considered, and the result is de-duplicated.
func UsageReportRecipients(user *User) ([]string, error) {
	if user == nil || user.Id <= 0 {
		return nil, nil
	}
	verified, err := VerifiedEmails(user.Id)
	if err != nil {
		return nil, err
	}
	if len(verified) == 0 {
		return nil, nil
	}
	verifiedSet := make(map[string]struct{}, len(verified))
	for _, email := range verified {
		verifiedSet[email] = struct{}{}
	}
	recipients := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	add := func(email string) {
		email = NormalizeEmail(email)
		if email == "" {
			return
		}
		if _, ok := verifiedSet[email]; !ok {
			return
		}
		if _, ok := seen[email]; ok {
			return
		}
		seen[email] = struct{}{}
		recipients = append(recipients, email)
	}
	add(user.Email)
	add(user.GetSetting().NotificationEmail)
	return recipients, nil
}

func usageReportUserIDList(usage map[int]*UsageReportUserUsage) []int {
	return slices.Collect(maps.Keys(usage))
}

// BuildDailyUsageReports aggregates the log window and stores one snapshot per
// user that actually had requests. Users without usage get no snapshot, so no
// empty report can be sent, and users who disabled the subscription are
// skipped without touching the accounting data.
func BuildDailyUsageReports(date string, start int64, end int64) (int, error) {
	usage, err := AggregateUsageReports(start, end)
	if err != nil {
		return 0, err
	}
	if len(usage) == 0 {
		return 0, nil
	}
	userIds := usageReportUserIDList(usage)
	users, err := loadUsageReportUsers(userIds)
	if err != nil {
		return 0, err
	}
	preferences, err := LoadUserNotificationPreferences(userIds)
	if err != nil {
		return 0, err
	}
	createdCount := 0
	now := common.GetTimestamp()
	for _, userId := range userIds {
		user := users[userId]
		if user == nil || user.Status != common.UserStatusEnabled {
			continue
		}
		preference := preferences[userId]
		if preference != nil && preference.UsageReportDisabled {
			continue
		}
		stat := usage[userId]
		if stat == nil || stat.RequestCount == 0 {
			continue
		}
		recipients, err := UsageReportRecipients(&User{Id: user.Id, Email: user.Email, Setting: user.Setting})
		if err != nil {
			return createdCount, err
		}
		report := &UsageReport{
			UserId:            userId,
			Date:              date,
			WindowStart:       start,
			WindowEnd:         end,
			RequestCount:      stat.RequestCount,
			Quota:             stat.Quota,
			WalletQuota:       stat.WalletQuota,
			SubscriptionQuota: stat.SubscriptionQuota,
			TotalTokens:       stat.TotalTokens,
			Groups:            usageReportGroupsJSON(stat.Groups),
			StatsVersion:      UsageReportStatsVersion,
			Status:            UsageReportStatusPending,
			Attempts:          0,
			NextAttemptAt:     now,
			GeneratedAt:       now,
		}
		if len(recipients) == 0 {
			// Nothing to deliver: keep the snapshot for audit but never queue it.
			report.Status = UsageReportStatusFailed
			report.NextAttemptAt = 0
			report.LastError = UsageReportNoVerifiedRecipient
		}
		created, err := SaveUsageReport(report, recipients)
		if err != nil {
			return createdCount, fmt.Errorf("failed to save usage report for user %d: %w", userId, err)
		}
		if created {
			createdCount++
		}
	}
	return createdCount, nil
}
