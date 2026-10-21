package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cleanUsageReportTables(t *testing.T) {
	t.Helper()
	clean := func() {
		DB.Exec("DELETE FROM usage_report_recipients")
		DB.Exec("DELETE FROM usage_reports")
		DB.Exec("DELETE FROM usage_report_runs")
		DB.Exec("DELETE FROM user_verified_emails")
		DB.Exec("DELETE FROM user_notification_preferences")
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM users")
	}
	clean()
	t.Cleanup(clean)
}

func insertUsageReportUser(t *testing.T, username string, email string, password string) *User {
	t.Helper()
	user := &User{
		Username: username,
		Password: password,
		Email:    email,
		AffCode:  common.GetRandomString(8),
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func insertUsageReportLog(t *testing.T, log *Log) {
	t.Helper()
	require.NoError(t, DB.Create(log).Error)
}

func consumeLogOther(billingSource string) string {
	return fmt.Sprintf(`{"billing_source":%q}`, billingSource)
}

// The snapshot must cover [00:00, 22:00) Beijing time, add up group rows and
// the summary identically, and split the quota by funding source without
// double counting.
func TestUsageReportSnapshotWindowGroupsAndFundingSource(t *testing.T) {
	cleanUsageReportTables(t)
	user := insertUsageReportUser(t, "usage-report-window", "window@example.com", "hash")
	require.NoError(t, MarkEmailVerified(user.Id, user.Email, VerifiedEmailSourceBinding))

	start, end, err := UsageReportWindow("2026-10-20")
	require.NoError(t, err)
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: start, Type: LogTypeConsume, Group: "vip",
		Quota: 100, PromptTokens: 10, CompletionTokens: 5, Other: consumeLogOther("wallet"),
	})
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: start + 1, Type: LogTypeConsume, Group: "vip",
		Quota: 50, PromptTokens: 4, CompletionTokens: 2, Other: consumeLogOther("wallet"),
	})
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: end - 1, Type: LogTypeConsume, Group: "default",
		Quota: 200, PromptTokens: 20, CompletionTokens: 10, Other: consumeLogOther("subscription"),
	})
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: start + 10, Type: LogTypeRefund, Group: "vip",
		Quota: 50, Other: consumeLogOther("wallet"),
	})
	// Outside the window: exactly at the end and just before the start.
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: end, Type: LogTypeConsume, Group: "after",
		Quota: 9999, PromptTokens: 1, CompletionTokens: 1, Other: consumeLogOther("wallet"),
	})
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: start - 1, Type: LogTypeConsume, Group: "before",
		Quota: 9999, PromptTokens: 1, CompletionTokens: 1, Other: consumeLogOther("wallet"),
	})

	usage, err := AggregateUsageReports(start, end)
	require.NoError(t, err)
	require.Contains(t, usage, user.Id)
	stat := usage[user.Id]
	assert.EqualValues(t, 3, stat.RequestCount)
	assert.EqualValues(t, 300, stat.Quota)
	assert.EqualValues(t, 100, stat.WalletQuota)
	assert.EqualValues(t, 200, stat.SubscriptionQuota)
	assert.EqualValues(t, 4+2+10+5+20+10, stat.TotalTokens)
	require.Len(t, stat.Groups, 2)
	assert.Equal(t, "default", stat.Groups[0].Group)
	assert.Equal(t, "vip", stat.Groups[1].Group)
	assert.EqualValues(t, 100, stat.Groups[1].Quota)

	created, err := BuildDailyUsageReports("2026-10-20", start, end)
	require.NoError(t, err)
	assert.Equal(t, 1, created)

	report, err := FindUsageReport(user.Id, "2026-10-20")
	require.NoError(t, err)
	require.NotNil(t, report)
	assert.EqualValues(t, 3, report.RequestCount)
	assert.EqualValues(t, 300, report.Quota)
	assert.EqualValues(t, 100, report.WalletQuota)
	assert.EqualValues(t, 200, report.SubscriptionQuota)
	assert.Equal(t, UsageReportStatusPending, report.Status)
	groups := report.DecodeUsageReportGroups()
	require.Len(t, groups, 2)
	var groupQuota int64
	for _, group := range groups {
		groupQuota += group.Quota
	}
	assert.EqualValues(t, report.Quota, groupQuota)

	recipients, err := ListUsageReportRecipients(report.Id)
	require.NoError(t, err)
	require.Len(t, recipients, 1)
	assert.Equal(t, "window@example.com", recipients[0].Email)

	// Re-running generation must not create a second snapshot.
	created, err = BuildDailyUsageReports("2026-10-20", start, end)
	require.NoError(t, err)
	assert.Equal(t, 0, created)
	var count int64
	require.NoError(t, DB.Model(&UsageReport{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	// The stored snapshot is not refreshed by later traffic.
	insertUsageReportLog(t, &Log{
		UserId: user.Id, CreatedAt: end - 2, Type: LogTypeConsume, Group: "late",
		Quota: 1000, PromptTokens: 1, CompletionTokens: 1, Other: consumeLogOther("wallet"),
	})
	report, err = FindUsageReport(user.Id, "2026-10-20")
	require.NoError(t, err)
	assert.EqualValues(t, 300, report.Quota)
	assert.EqualValues(t, 3, report.RequestCount)
}

// A user with no verified address keeps the snapshot for audit but is never
// queued for delivery, and a duplicate address is only mailed once.
func TestUsageReportRecipientSelectionAndDeduplication(t *testing.T) {
	cleanUsageReportTables(t)
	unverified := insertUsageReportUser(t, "usage-report-unverified", "unverified@example.com", "")
	verified := insertUsageReportUser(t, "usage-report-verified", "owner@example.com", "hash")
	require.NoError(t, MarkEmailVerified(verified.Id, verified.Email, VerifiedEmailSourceBinding))

	other := verified.GetSetting()
	other.NotificationEmail = "owner@example.com"
	verified.SetSetting(other)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", verified.Id).Update("setting", verified.Setting).Error)

	start, end, err := UsageReportWindow("2026-10-21")
	require.NoError(t, err)
	insertUsageReportLog(t, &Log{UserId: unverified.Id, CreatedAt: start, Type: LogTypeConsume, Group: "default", Quota: 10, PromptTokens: 1, CompletionTokens: 1})
	insertUsageReportLog(t, &Log{UserId: verified.Id, CreatedAt: start, Type: LogTypeConsume, Group: "default", Quota: 10, PromptTokens: 1, CompletionTokens: 1})

	_, err = BuildDailyUsageReports("2026-10-21", start, end)
	require.NoError(t, err)

	missing, err := FindUsageReport(unverified.Id, "2026-10-21")
	require.NoError(t, err)
	require.NotNil(t, missing)
	assert.Equal(t, UsageReportStatusFailed, missing.Status)
	assert.Equal(t, UsageReportNoVerifiedRecipient, missing.LastError)

	found, err := FindUsageReport(verified.Id, "2026-10-21")
	require.NoError(t, err)
	require.NotNil(t, found)
	recipients, err := ListUsageReportRecipients(found.Id)
	require.NoError(t, err)
	require.Len(t, recipients, 1)
	assert.Equal(t, "owner@example.com", recipients[0].Email)
}

// The prompt state is persisted per user, boundaries use Beijing time, and a
// later verified address clears any stored suppression.
func TestEmailReminderPolicyPersistsAndExpires(t *testing.T) {
	cleanUsageReportTables(t)
	user := insertUsageReportUser(t, "email-reminder", "", "hash")
	now := time.Date(2026, 10, 21, 20, 0, 0, 0, usageReportLocation)

	state, err := GetEmailReminderState(user.Id, now)
	require.NoError(t, err)
	assert.True(t, state.NeedsBinding)
	assert.True(t, state.ShouldPrompt)

	require.NoError(t, ApplyEmailReminderAction(user.Id, EmailReminderActionSnoozeToday, now))
	state, err = GetEmailReminderState(user.Id, now)
	require.NoError(t, err)
	assert.False(t, state.ShouldPrompt)
	nextDay := time.Date(2026, 10, 22, 0, 0, 0, 0, usageReportLocation)
	state, err = GetEmailReminderState(user.Id, nextDay)
	require.NoError(t, err)
	assert.True(t, state.ShouldPrompt)

	require.NoError(t, ApplyEmailReminderAction(user.Id, EmailReminderActionSnoozeWeek, now))
	state, err = GetEmailReminderState(user.Id, now.Add(6*24*time.Hour))
	require.NoError(t, err)
	assert.False(t, state.ShouldPrompt)
	state, err = GetEmailReminderState(user.Id, now.Add(8*24*time.Hour))
	require.NoError(t, err)
	assert.True(t, state.ShouldPrompt)

	require.NoError(t, ApplyEmailReminderAction(user.Id, EmailReminderActionOff, now))
	state, err = GetEmailReminderState(user.Id, now.Add(365*24*time.Hour))
	require.NoError(t, err)
	assert.False(t, state.ShouldPrompt)

	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("email", "late@example.com").Error)
	require.NoError(t, MarkEmailVerified(user.Id, "late@example.com", VerifiedEmailSourceBinding))
	state, err = GetEmailReminderState(user.Id, now)
	require.NoError(t, err)
	assert.False(t, state.NeedsBinding)
	assert.False(t, state.ShouldPrompt)
	assert.Equal(t, EmailReminderPolicyNormal, state.Policy)

	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("email", "").Error)
	state, err = GetEmailReminderState(user.Id, now)
	require.NoError(t, err)
	assert.True(t, state.NeedsBinding)
	assert.True(t, state.ShouldPrompt)
}

// The reminder switch is independent from the usage report switch.
func TestNotificationPreferencesKeepSwitchesIndependent(t *testing.T) {
	cleanUsageReportTables(t)
	user := insertUsageReportUser(t, "notification-switches", "", "hash")

	preference, err := GetUserNotificationPreference(user.Id)
	require.NoError(t, err)
	assert.True(t, preference.UsageReportEnabled())

	require.NoError(t, SetUsageReportDisabled(user.Id, true))
	now := time.Date(2026, 10, 21, 20, 0, 0, 0, usageReportLocation)
	require.NoError(t, ApplyEmailReminderAction(user.Id, EmailReminderActionOff, now))

	preference, err = GetUserNotificationPreference(user.Id)
	require.NoError(t, err)
	assert.False(t, preference.UsageReportEnabled())
	assert.Equal(t, EmailReminderPolicyOff, preference.EmailReminderPolicy)

	require.NoError(t, SetUsageReportDisabled(user.Id, false))
	preference, err = GetUserNotificationPreference(user.Id)
	require.NoError(t, err)
	assert.True(t, preference.UsageReportEnabled())
	assert.Equal(t, EmailReminderPolicyOff, preference.EmailReminderPolicy)
}

// Local accounts that already had an email are treated as verified during the
// upgrade. OAuth accounts without a password are not.
func TestLegacyEmailMigrationMarksLocalAccountsOnly(t *testing.T) {
	cleanUsageReportTables(t)
	require.NoError(t, DB.Where(commonKeyCol+" = ?", legacyVerifiedEmailMigrationOption).Delete(&Option{}).Error)
	local := insertUsageReportUser(t, "legacy-local", "local@example.com", "hash")
	oauth := insertUsageReportUser(t, "legacy-oauth", "oauth@example.com", "")

	require.NoError(t, MigrateLegacyVerifiedEmails())
	localEmails, err := VerifiedEmails(local.Id)
	require.NoError(t, err)
	assert.Equal(t, []string{"local@example.com"}, localEmails)
	oauthEmails, err := VerifiedEmails(oauth.Id)
	require.NoError(t, err)
	assert.Empty(t, oauthEmails)

	require.NoError(t, MigrateLegacyVerifiedEmails())
	localEmails, err = VerifiedEmails(local.Id)
	require.NoError(t, err)
	assert.Len(t, localEmails, 1)
}

// The new schema must survive a repeated startup migration and an existing
// account must keep the enabled default without a preference row.
func TestUsageReportSchemaMigrationIsIdempotent(t *testing.T) {
	cleanUsageReportTables(t)
	models := []any{
		&UserNotificationPreference{},
		&UserVerifiedEmail{},
		&UsageReport{},
		&UsageReportRecipient{},
		&UsageReportRun{},
	}
	require.NoError(t, DB.AutoMigrate(models...))
	require.NoError(t, DB.AutoMigrate(models...))

	user := insertUsageReportUser(t, "usage-report-upgrade", "upgrade@example.com", "hash")
	preference, err := GetUserNotificationPreference(user.Id)
	require.NoError(t, err)
	assert.True(t, preference.UsageReportEnabled(), "an upgraded account starts enabled")
	assert.Equal(t, EmailReminderPolicyNormal, preference.EmailReminderPolicy)

	var count int64
	require.NoError(t, DB.Model(&UserNotificationPreference{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.Zero(t, count, "reading the default must not need a migration row")
}
