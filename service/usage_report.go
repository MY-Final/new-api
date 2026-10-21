package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	usageReportTickInterval = time.Minute
	// usageReportStaleAfter is how long a claimed job may stay unfinished before
	// another instance may take it over. It must be longer than a normal run.
	usageReportStaleAfter   = 15 * time.Minute
	usageReportDeliverySize = 200
	usageReportRetention    = 90 * 24 * time.Hour
	usageReportCleanupEvery = 24 * time.Hour
)

var (
	usageReportStartOnce   sync.Once
	usageReportGenerating  atomic.Bool
	usageReportDelivering  atomic.Bool
	usageReportLastCleanup atomic.Int64
	// usageReportSendEmail is a seam for tests; production always sends mail.
	usageReportSendEmail = common.SendEmail
)

// StartUsageReportTask starts the once-per-minute scheduler that generates the
// daily Beijing-time snapshots and retries their delivery. Only the master node
// schedules, and every write is additionally guarded by database leases so a
// restart or a second instance cannot duplicate a snapshot or a mail.
func StartUsageReportTask() {
	usageReportStartOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), common.LogText("usage report task started: tick=%s", usageReportTickInterval))
			ticker := time.NewTicker(usageReportTickInterval)
			defer ticker.Stop()
			runUsageReportOnce()
			for range ticker.C {
				runUsageReportOnce()
			}
		})
	})
}

func runUsageReportOnce() {
	now := model.UsageReportNow()
	runUsageReportGeneration(now)
	runUsageReportDelivery(now)
}

// usageReportGenerationDate picks the date whose window is complete. After
// 22:00 it is today; before 22:00 only an interrupted run for yesterday is
// resumed, so a fresh deployment never mails a report for a day that was never
// scheduled.
func usageReportGenerationDate(now time.Time) (string, bool) {
	if now.Hour() >= model.UsageReportWindowEndHour {
		return model.UsageReportDate(now), true
	}
	yesterday := model.UsageReportDate(now.AddDate(0, 0, -1))
	if model.UsageReportRunNeedsRecovery(yesterday, now.Unix(), now.Add(-usageReportStaleAfter).Unix()) {
		return yesterday, true
	}
	return "", false
}

func runUsageReportGeneration(now time.Time) {
	date, ok := usageReportGenerationDate(now)
	if !ok {
		return
	}
	if !usageReportGenerating.CompareAndSwap(false, true) {
		return
	}
	defer usageReportGenerating.Store(false)

	nowUnix := now.Unix()
	claimed, err := model.ClaimUsageReportRun(date, nowUnix, now.Add(-usageReportStaleAfter).Unix())
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to claim usage report run for %s: %s", date, err.Error()))
		return
	}
	if !claimed {
		return
	}
	start, end, err := model.UsageReportWindow(date)
	if err != nil {
		_ = model.FinishUsageReportRun(date, true, truncateUsageReportError(err.Error()), nowUnix)
		return
	}
	count, err := model.BuildDailyUsageReports(date, start, end)
	if err != nil {
		_ = model.FinishUsageReportRun(date, true, truncateUsageReportError(err.Error()), nowUnix)
		logger.LogWarn(context.Background(), common.LogText("failed to build usage reports for %s: %s", date, err.Error()))
		return
	}
	if err := model.FinishUsageReportRun(date, false, "", nowUnix); err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to finish usage report run for %s: %s", date, err.Error()))
	}
	logger.LogInfo(context.Background(), common.LogText("usage report snapshots generated: date=%s users=%d", date, count))
	runUsageReportCleanup(now)
}

func runUsageReportCleanup(now time.Time) {
	last := usageReportLastCleanup.Load()
	if last != 0 && now.Sub(time.Unix(last, 0)) < usageReportCleanupEvery {
		return
	}
	cutoff := model.UsageReportDate(now.Add(-usageReportRetention))
	for range 10 {
		removed, err := model.CleanupUsageReports(cutoff, 500)
		if err != nil {
			logger.LogWarn(context.Background(), common.LogText("failed to clean up usage reports: %s", err.Error()))
			return
		}
		if removed < 500 {
			break
		}
	}
	usageReportLastCleanup.Store(now.Unix())
}

func runUsageReportDelivery(now time.Time) {
	if !usageReportDelivering.CompareAndSwap(false, true) {
		return
	}
	defer usageReportDelivering.Store(false)

	nowUnix := now.Unix()
	if err := model.RecoverStaleUsageReports(nowUnix, now.Add(-usageReportStaleAfter).Unix()); err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to recover stale usage reports: %s", err.Error()))
	}
	reports, err := model.ListDueUsageReports(nowUnix, usageReportDeliverySize)
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to load due usage reports: %s", err.Error()))
		return
	}
	for _, report := range reports {
		deliverUsageReport(report.Id, now)
	}
}

// deliverUsageReport sends one snapshot. The snapshot content is never rebuilt
// here: retries reuse the stored rows, so late traffic cannot change an email.
func deliverUsageReport(reportId int, now time.Time) {
	report, err := model.GetUsageReportById(reportId)
	if err != nil || report == nil {
		return
	}
	preference, err := model.GetUserNotificationPreference(report.UserId)
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to load notification preference of user %d: %s", report.UserId, err.Error()))
		return
	}
	if !preference.UsageReportEnabled() {
		if err := model.CancelUnscheduledUsageReports(report.UserId, now.Unix()); err != nil {
			logger.LogWarn(context.Background(), common.LogText("failed to cancel usage reports of user %d: %s", report.UserId, err.Error()))
		}
		return
	}
	claimed, err := model.ClaimUsageReport(report.Id, now.Unix())
	if err != nil || !claimed {
		return
	}
	report, err = model.GetUsageReportById(report.Id)
	if err != nil || report == nil {
		return
	}
	// Re-check after claiming: a user may have closed the subscription between
	// the scheduler listing the snapshot and this instance picking it up.
	freshPreference, err := model.GetUserNotificationPreference(report.UserId)
	if err != nil {
		return
	}
	if !freshPreference.UsageReportEnabled() {
		if err := model.CancelUsageReportForDisabledUser(report.Id, now.Unix()); err != nil {
			logger.LogWarn(context.Background(), common.LogText("failed to cancel usage report %d: %s", report.Id, err.Error()))
		}
		return
	}
	recipients, err := model.ListUsageReportRecipients(report.Id)
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to load usage report recipients: %s", err.Error()))
		return
	}
	pending := make([]*model.UsageReportRecipient, 0, len(recipients))
	outcome := model.UsageReportDeliveryOutcome{}
	for _, recipient := range recipients {
		switch recipient.Status {
		case model.UsageReportRecipientSent:
			outcome.Sent++
		case model.UsageReportRecipientFailed:
			outcome.Failed++
		default:
			pending = append(pending, recipient)
			outcome.Pending++
		}
	}
	if len(pending) == 0 {
		_ = model.FinishUsageReport(report, outcome, "", now.Unix())
		return
	}

	user, err := model.GetUserById(report.UserId, false)
	if err != nil || user.Status != common.UserStatusEnabled {
		reason := "user is unavailable"
		if err != nil {
			reason = truncateUsageReportError(err.Error())
		}
		failUsageReport(report, recipients, reason, now)
		return
	}
	subject, body, err := renderUsageReportEmail(report, user.Username, user.GetSetting().Language, usageReportEmailWindow{})
	if err != nil {
		failUsageReport(report, recipients, truncateUsageReportError(err.Error()), now)
		return
	}

	lastError := ""
	for _, recipient := range pending {
		sendErr := usageReportSendEmail(subject, recipient.Email, body)
		if sendErr == nil {
			outcome.Sent++
			outcome.Pending--
			if err := model.MarkUsageReportRecipient(recipient.Id, model.UsageReportRecipientSent, "", now.Unix()); err != nil {
				logger.LogWarn(context.Background(), common.LogText("failed to record usage report recipient %d: %s", recipient.Id, err.Error()))
			}
			continue
		}
		if lastError == "" {
			lastError = truncateUsageReportError(sendErr.Error())
		}
		if err := model.MarkUsageReportRecipient(recipient.Id, model.UsageReportRecipientPending, truncateUsageReportError(sendErr.Error()), now.Unix()); err != nil {
			logger.LogWarn(context.Background(), common.LogText("failed to record usage report recipient %d: %s", recipient.Id, err.Error()))
		}
	}

	if outcome.Pending > 0 && report.Attempts >= model.UsageReportMaxAttempts {
		if err := model.FailRemainingUsageReportRecipients(report.Id, lastError, now.Unix()); err != nil {
			logger.LogWarn(context.Background(), common.LogText("failed to close usage report %d: %s", report.Id, err.Error()))
		}
		outcome.Failed += outcome.Pending
		outcome.Pending = 0
	}
	if err := model.FinishUsageReport(report, outcome, lastError, now.Unix()); err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to finish usage report %d: %s", report.Id, err.Error()))
		return
	}
	logger.LogInfo(context.Background(), common.LogText(
		"usage report delivery: date=%s user=%d attempt=%d sent=%d failed=%d pending=%d",
		report.Date, report.UserId, report.Attempts, outcome.Sent, outcome.Failed, outcome.Pending,
	))
}

func failUsageReport(report *model.UsageReport, recipients []*model.UsageReportRecipient, reason string, now time.Time) {
	if err := model.FailRemainingUsageReportRecipients(report.Id, reason, now.Unix()); err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to fail usage report %d: %s", report.Id, err.Error()))
		return
	}
	outcome := model.UsageReportDeliveryOutcome{}
	for _, recipient := range recipients {
		switch recipient.Status {
		case model.UsageReportRecipientSent:
			outcome.Sent++
		default:
			outcome.Failed++
		}
	}
	_ = model.FinishUsageReport(report, outcome, reason, now.Unix())
}

func truncateUsageReportError(message string) string {
	const limit = 255
	runes := []rune(message)
	if len(runes) <= limit {
		return message
	}
	return string(runes[:limit])
}
