package service

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sentUsageReportEmail struct {
	to      string
	subject string
	body    string
}

func setupUsageReportServiceTest(t *testing.T) (*model.User, *[]sentUsageReportEmail) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(
		&model.UserVerifiedEmail{},
		&model.UserNotificationPreference{},
		&model.UsageReport{},
		&model.UsageReportRecipient{},
		&model.UsageReportRun{},
	))
	suffix := common.GetRandomString(8)
	user := &model.User{
		Username: "usage-report-service-" + suffix,
		Password: "hash",
		Email:    "owner-" + suffix + "@example.com",
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, model.DB.Create(user).Error)
	require.NoError(t, model.MarkEmailVerified(user.Id, user.Email, model.VerifiedEmailSourceBinding))
	second := "notify-" + suffix + "@example.com"
	require.NoError(t, model.MarkEmailVerified(user.Id, second, model.VerifiedEmailSourceBinding))
	settings := dto.UserSetting{NotificationEmail: second}
	require.NoError(t, model.UpdateUserSetting(user.Id, settings))
	require.NoError(t, model.DB.Where("id = ?", user.Id).First(user).Error)
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM usage_report_recipients WHERE report_id IN (SELECT id FROM usage_reports WHERE user_id = ?)", user.Id)
		model.DB.Exec("DELETE FROM usage_reports WHERE user_id = ?", user.Id)
		model.DB.Exec("DELETE FROM usage_report_runs")
		model.DB.Exec("DELETE FROM user_verified_emails WHERE user_id = ?", user.Id)
		model.DB.Exec("DELETE FROM user_notification_preferences WHERE user_id = ?", user.Id)
		model.DB.Exec("DELETE FROM logs WHERE user_id = ?", user.Id)
		model.DB.Exec("DELETE FROM users WHERE id = ?", user.Id)
	})

	sent := make([]sentUsageReportEmail, 0)
	previous := usageReportSendEmail
	usageReportSendEmail = func(subject string, receiver string, content string) error {
		sent = append(sent, sentUsageReportEmail{to: receiver, subject: subject, body: content})
		return nil
	}
	t.Cleanup(func() { usageReportSendEmail = previous })
	return user, &sent
}

func savePendingUsageReport(t *testing.T, userId int, date string, now time.Time, emails []string) *model.UsageReport {
	t.Helper()
	start, end, err := model.UsageReportWindow(date)
	require.NoError(t, err)
	report := &model.UsageReport{
		UserId:        userId,
		Date:          date,
		WindowStart:   start,
		WindowEnd:     end,
		RequestCount:  12,
		Quota:         250,
		WalletQuota:   250,
		TotalTokens:   3456,
		Groups:        `[{"group":"default","request_count":12,"quota":250,"tokens":3456}]`,
		StatsVersion:  model.UsageReportStatsVersion,
		Status:        model.UsageReportStatusPending,
		NextAttemptAt: now.Add(-time.Minute).Unix(),
		GeneratedAt:   now.Unix(),
	}
	created, err := model.SaveUsageReport(report, emails)
	require.NoError(t, err)
	require.True(t, created)
	return report
}

// A failing address is retried on its own, a delivered address is never mailed
// twice, and the third attempt is the last one.
func TestUsageReportDeliveryRetriesOnlyFailedRecipients(t *testing.T) {
	user, sent := setupUsageReportServiceTest(t)
	failing := model.NormalizeEmail("notify-" + strings.TrimPrefix(user.Email, "owner-"))
	usageReportSendEmail = func(subject string, receiver string, content string) error {
		*sent = append(*sent, sentUsageReportEmail{to: receiver, subject: subject, body: content})
		if receiver == failing {
			return errors.New("mailbox rejected")
		}
		return nil
	}
	now := time.Date(2026, 10, 21, 22, 5, 0, 0, model.UsageReportNow().Location())
	report := savePendingUsageReport(t, user.Id, "2026-10-21", now, []string{user.Email, failing})

	deliverUsageReport(report.Id, now)
	current, err := model.GetUsageReportById(report.Id)
	require.NoError(t, err)
	assert.Equal(t, model.UsageReportStatusRetry, current.Status)
	assert.Equal(t, 1, current.Attempts)
	assert.Greater(t, current.NextAttemptAt, now.Unix())

	// The successful address is not contacted again on the retry.
	deliverUsageReport(report.Id, now.Add(6*time.Minute))
	current, err = model.GetUsageReportById(report.Id)
	require.NoError(t, err)
	assert.Equal(t, model.UsageReportStatusRetry, current.Status)
	assert.Equal(t, 2, current.Attempts)

	deliverUsageReport(report.Id, now.Add(25*time.Minute))
	current, err = model.GetUsageReportById(report.Id)
	require.NoError(t, err)
	assert.Equal(t, model.UsageReportStatusSent, current.Status)
	assert.Equal(t, 3, current.Attempts)
	assert.NotZero(t, current.SentAt)

	recipients, err := model.ListUsageReportRecipients(report.Id)
	require.NoError(t, err)
	require.Len(t, recipients, 2)
	for _, recipient := range recipients {
		if recipient.Email == failing {
			assert.Equal(t, model.UsageReportRecipientFailed, recipient.Status)
			assert.Equal(t, 3, recipient.Attempts)
			continue
		}
		assert.Equal(t, model.UsageReportRecipientSent, recipient.Status)
		assert.Equal(t, 1, recipient.Attempts)
	}

	// A settled report is never delivered again.
	deliverUsageReport(report.Id, now.Add(48*time.Hour))
	assert.Len(t, *sent, 4)
}

// Retries must render the stored snapshot, not re-read the log window, so a
// request that arrives between attempts cannot change the message.
func TestUsageReportRetryReusesGeneratedSnapshot(t *testing.T) {
	user, sent := setupUsageReportServiceTest(t)
	start, end, err := model.UsageReportWindow("2026-10-20")
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: start + 60, Type: model.LogTypeConsume, Group: "default",
		Quota: 100, PromptTokens: 100, CompletionTokens: 100,
	}).Error)
	created, err := model.BuildDailyUsageReports("2026-10-20", start, end)
	require.NoError(t, err)
	require.Equal(t, 1, created)
	report, err := model.FindUsageReport(user.Id, "2026-10-20")
	require.NoError(t, err)
	require.NotNil(t, report)
	now := time.Date(2026, 10, 20, 22, 1, 0, 0, model.UsageReportNow().Location())
	require.NoError(t, model.DB.Model(&model.UsageReport{}).Where("id = ?", report.Id).
		Update("next_attempt_at", now.Add(-time.Minute).Unix()).Error)

	failRound := true
	usageReportSendEmail = func(subject string, receiver string, content string) error {
		*sent = append(*sent, sentUsageReportEmail{to: receiver, subject: subject, body: content})
		if failRound {
			return errors.New("temporary smtp failure")
		}
		return nil
	}
	now = time.Date(2026, 10, 20, 22, 1, 0, 0, model.UsageReportNow().Location())
	deliverUsageReport(report.Id, now)
	require.Len(t, *sent, 2)
	firstBodies := make([]string, 0, len(*sent))
	for _, email := range *sent {
		firstBodies = append(firstBodies, email.body)
	}
	failRound = false

	// New traffic after snapshot generation must not leak into the retry.
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: end - 60, Type: model.LogTypeConsume, Group: "late",
		Quota: 99999, PromptTokens: 1, CompletionTokens: 1,
	}).Error)

	deliverUsageReport(report.Id, now.Add(6*time.Minute))
	require.Len(t, *sent, 4)
	for i := 0; i < 2; i++ {
		assert.Equal(t, firstBodies[i], (*sent)[2+i].body)
	}
	current, err := model.GetUsageReportById(report.Id)
	require.NoError(t, err)
	assert.Equal(t, model.UsageReportStatusSent, current.Status)
	assert.EqualValues(t, 200, current.TotalTokens)
}

// Turning the subscription off cancels snapshots that have not been sent yet.
func TestUsageReportDeliveryStopsAfterSubscriptionDisabled(t *testing.T) {
	user, sent := setupUsageReportServiceTest(t)
	now := time.Date(2026, 10, 21, 22, 5, 0, 0, model.UsageReportNow().Location())
	report := savePendingUsageReport(t, user.Id, "2026-10-21", now, []string{user.Email})
	require.NoError(t, model.SetUsageReportDisabled(user.Id, true))

	deliverUsageReport(report.Id, now)
	assert.Empty(t, *sent)
	current, err := model.GetUsageReportById(report.Id)
	require.NoError(t, err)
	assert.Equal(t, model.UsageReportStatusCancelled, current.Status)
}

// The generation job is claimed once per date, including across restarts, and
// after 22:00 it targets the current Beijing date.
func TestUsageReportRunDatesAndClaim(t *testing.T) {
	setupUsageReportServiceTest(t)
	now := time.Date(2026, 10, 21, 21, 59, 0, 0, model.UsageReportNow().Location())
	date, ok := usageReportGenerationDate(now)
	assert.False(t, ok)
	assert.Empty(t, date)

	at22 := time.Date(2026, 10, 21, 22, 0, 0, 0, model.UsageReportNow().Location())
	date, ok = usageReportGenerationDate(at22)
	assert.True(t, ok)
	assert.Equal(t, "2026-10-21", date)

	// A run that was interrupted before 22:00 is resumed for yesterday.
	stale := now.Add(-24 * time.Hour)
	claimed, err := model.ClaimUsageReportRun("2026-10-20", stale.Unix(), stale.Unix())
	require.NoError(t, err)
	require.True(t, claimed)
	require.NoError(t, model.FinishUsageReportRun("2026-10-20", true, "interrupted", stale.Unix()))
	early := time.Date(2026, 10, 21, 3, 0, 0, 0, model.UsageReportNow().Location())
	date, ok = usageReportGenerationDate(early)
	assert.True(t, ok)
	assert.Equal(t, "2026-10-20", date)

	claimed, err = model.ClaimUsageReportRun("2026-10-21", at22.Unix(), at22.Add(-15*time.Minute).Unix())
	require.NoError(t, err)
	assert.True(t, claimed)
	claimed, err = model.ClaimUsageReportRun("2026-10-21", at22.Unix(), at22.Add(-15*time.Minute).Unix())
	require.NoError(t, err)
	assert.False(t, claimed)
	require.NoError(t, model.FinishUsageReportRun("2026-10-21", false, "", at22.Unix()))
	claimed, err = model.ClaimUsageReportRun("2026-10-21", at22.Unix(), at22.Add(-15*time.Minute).Unix())
	require.NoError(t, err)
	assert.False(t, claimed)
}

// An administrator-triggered email covers the requested range, reports
// per-address delivery, and leaves no scheduled snapshot behind.
func TestSendUsageReportUsesRequestedRangeAndReportsDelivery(t *testing.T) {
	user, sent := setupUsageReportServiceTest(t)
	now := time.Date(2026, 10, 22, 15, 30, 0, 0, model.UsageReportNow().Location())
	start, _, err := model.UsageReportWindow("2026-10-22")
	require.NoError(t, err)
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: start, Type: model.LogTypeConsume, Group: "default",
		Quota: 100, PromptTokens: 10, CompletionTokens: 5, Other: `{"billing_source":"wallet"}`,
	}).Error)
	// Before the window and exactly at the cutoff must both be excluded.
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: start - 1, Type: model.LogTypeConsume, Group: "default",
		Quota: 999, PromptTokens: 1, CompletionTokens: 1,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: now.Unix(), Type: model.LogTypeConsume, Group: "default",
		Quota: 999, PromptTokens: 1, CompletionTokens: 1,
	}).Error)

	failFirst := true
	usageReportSendEmail = func(subject string, receiver string, content string) error {
		*sent = append(*sent, sentUsageReportEmail{to: receiver, subject: subject, body: content})
		if failFirst {
			failFirst = false
			return errors.New("mailbox rejected")
		}
		return nil
	}

	result, err := SendUsageReport(user, start, now.Unix(), now)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, start, result.WindowStart)
	assert.Equal(t, now.Unix(), result.WindowEnd)
	assert.EqualValues(t, 1, result.RequestCount)
	assert.EqualValues(t, 100, result.Quota)
	assert.EqualValues(t, 15, result.TotalTokens)
	assert.Equal(t, 1, result.Sent)
	assert.Equal(t, 1, result.Failed)
	require.Len(t, *sent, 2)
	assert.Contains(t, (*sent)[0].body, "2026-10-22 00:00–15:30")
	assert.Contains(t, (*sent)[0].body, "Statistics cover")
	assert.Contains(t, (*sent)[0].body, "2026-10-22 15:30")

	var count int64
	require.NoError(t, model.DB.Model(&model.UsageReport{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.Zero(t, count, "a manual send must not create a scheduled snapshot")
}

// The admin action needs both usage in the requested window and a verified
// address.
func TestSendUsageReportRejectsEmptyUsageAndNoRecipient(t *testing.T) {
	user, _ := setupUsageReportServiceTest(t)
	now := time.Date(2026, 10, 22, 15, 0, 0, 0, model.UsageReportNow().Location())
	start, _, err := model.UsageReportWindow("2026-10-22")
	require.NoError(t, err)

	_, err = SendUsageReport(user, start, now.Unix(), now)
	assert.ErrorIs(t, err, model.ErrUsageReportNoUsage)

	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: start + 60, Type: model.LogTypeConsume, Group: "default",
		Quota: 10, PromptTokens: 1, CompletionTokens: 1,
	}).Error)

	unverified := &model.User{Username: "usage-report-manual-" + common.GetRandomString(8), Password: "hash", Email: "unverified-" + common.GetRandomString(6) + "@example.com", AffCode: common.GetRandomString(8), Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(unverified).Error)
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM logs WHERE user_id = ?", unverified.Id)
		model.DB.Exec("DELETE FROM users WHERE id = ?", unverified.Id)
	})
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: unverified.Id, CreatedAt: start + 60, Type: model.LogTypeConsume, Group: "default",
		Quota: 10, PromptTokens: 1, CompletionTokens: 1,
	}).Error)
	_, err = SendUsageReport(unverified, start, now.Unix(), now)
	assert.ErrorIs(t, err, model.ErrUsageReportNoRecipient)
}

// Any range within the cap is supported, with a label that keeps both dates,
// and a longer range is rejected before any log scan.
func TestSendUsageReportSupportsMultiDayRangeAndBounds(t *testing.T) {
	user, sent := setupUsageReportServiceTest(t)
	start, _, err := model.UsageReportWindow("2026-10-20")
	require.NoError(t, err)
	end, _, err := model.UsageReportWindow("2026-10-22")
	require.NoError(t, err)
	end += 15 * 60 * 60
	now := time.Unix(end, 0).Add(time.Hour)

	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: start + 12*60*60, Type: model.LogTypeConsume, Group: "default",
		Quota: 40, PromptTokens: 2, CompletionTokens: 3, Other: `{"billing_source":"subscription"}`,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Log{
		UserId: user.Id, CreatedAt: end - 60, Type: model.LogTypeConsume, Group: "vip",
		Quota: 60, PromptTokens: 4, CompletionTokens: 1, Other: `{"billing_source":"wallet"}`,
	}).Error)

	result, err := SendUsageReport(user, start, end, now)
	require.NoError(t, err)
	assert.EqualValues(t, 2, result.RequestCount)
	assert.EqualValues(t, 100, result.Quota)
	require.Len(t, *sent, 2)
	assert.Contains(t, (*sent)[0].body, "2026-10-20 00:00 – 2026-10-22 15:00")
	assert.Contains(t, (*sent)[0].body, "2026-10-20 00:00")
	assert.Contains(t, (*sent)[0].body, "2026-10-22 15:00")

	_, err = SendUsageReport(user, start, start+32*24*60*60, now.Add(40*24*time.Hour))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "31")
}
