package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// EmailReminderPolicyNormal asks for an email binding again on the next
	// eligible visit.
	EmailReminderPolicyNormal = "normal"
	// EmailReminderPolicySnooze suppresses the prompt until EmailReminderUntil.
	EmailReminderPolicySnooze = "snooze"
	// EmailReminderPolicyOff suppresses automatic prompts until the user asks
	// for them again. It never touches mail delivery or the usage report.
	EmailReminderPolicyOff = "off"

	EmailReminderActionSnoozeToday = "snooze_today"
	EmailReminderActionSnoozeWeek  = "snooze_week"
	EmailReminderActionOff         = "off"
	EmailReminderActionReset       = "reset"
)

var ErrEmailReminderActionInvalid = errors.New("Unsupported reminder action")

// UserNotificationPreference holds the notification choices that are owned by
// dedicated switches. A missing row means: usage report enabled, normal email
// reminder. Keeping every column separate means changing one switch never
// rewrites the others.
type UserNotificationPreference struct {
	UserId              int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	UsageReportDisabled bool   `json:"usage_report_disabled" gorm:"not null"`
	EmailReminderPolicy string `json:"email_reminder_policy" gorm:"type:varchar(16);not null"`
	EmailReminderUntil  int64  `json:"email_reminder_until" gorm:"type:bigint;not null"`
	UpdatedAt           int64  `json:"updated_at" gorm:"bigint"`
}

// UsageReportEnabled reports whether the user still receives the daily report.
// Rows that do not exist yet belong to users who never changed the default, and
// the default is enabled for both new and existing accounts.
func (preference *UserNotificationPreference) UsageReportEnabled() bool {
	return preference == nil || !preference.UsageReportDisabled
}

func newUserNotificationPreference(userId int) *UserNotificationPreference {
	return &UserNotificationPreference{
		UserId:              userId,
		EmailReminderPolicy: EmailReminderPolicyNormal,
	}
}

// GetUserNotificationPreference returns the stored preferences, or the enabled
// defaults when the user never saved any.
func GetUserNotificationPreference(userId int) (*UserNotificationPreference, error) {
	preference := UserNotificationPreference{}
	err := DB.Where("user_id = ?", userId).First(&preference).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return newUserNotificationPreference(userId), nil
		}
		return nil, err
	}
	return &preference, nil
}

// LoadUserNotificationPreferences loads preferences for a batch of users. The
// returned map only contains explicit rows; callers apply the defaults.
func LoadUserNotificationPreferences(userIds []int) (map[int]*UserNotificationPreference, error) {
	preferences := make(map[int]*UserNotificationPreference, len(userIds))
	const batchSize = 500
	for start := 0; start < len(userIds); start += batchSize {
		batch := userIds[start:min(start+batchSize, len(userIds))]
		var rows []*UserNotificationPreference
		if err := DB.Where("user_id IN ?", batch).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			preferences[row.UserId] = row
		}
	}
	return preferences, nil
}

// SetUsageReportDisabled stores only the daily report switch. It never touches
// the reminder columns.
func SetUsageReportDisabled(userId int, disabled bool) error {
	now := common.GetTimestamp()
	row := UserNotificationPreference{
		UserId:              userId,
		UsageReportDisabled: disabled,
		EmailReminderPolicy: EmailReminderPolicyNormal,
		UpdatedAt:           now,
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"usage_report_disabled": disabled,
			"updated_at":            now,
		}),
	}).Create(&row).Error
}

// ApplyEmailReminderAction stores one reminder choice. It never touches the
// daily report switch.
func ApplyEmailReminderAction(userId int, action string, now time.Time) error {
	policy := EmailReminderPolicyNormal
	until := int64(0)
	switch action {
	case EmailReminderActionSnoozeToday:
		day, err := time.ParseInLocation("2006-01-02", UsageReportDate(now), usageReportLocation)
		if err != nil {
			return err
		}
		policy = EmailReminderPolicySnooze
		until = day.AddDate(0, 0, 1).Unix()
	case EmailReminderActionSnoozeWeek:
		policy = EmailReminderPolicySnooze
		until = now.Add(7 * 24 * time.Hour).Unix()
	case EmailReminderActionOff:
		policy = EmailReminderPolicyOff
	case EmailReminderActionReset:
		policy = EmailReminderPolicyNormal
	default:
		return ErrEmailReminderActionInvalid
	}
	row := UserNotificationPreference{
		UserId:              userId,
		EmailReminderPolicy: policy,
		EmailReminderUntil:  until,
		UpdatedAt:           now.Unix(),
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"email_reminder_policy": policy,
			"email_reminder_until":  until,
			"updated_at":            now.Unix(),
		}),
	}).Create(&row).Error
}

// EmailReminderState is what the console needs to decide whether to show the
// binding prompt. The server owns the decision so every device agrees.
type EmailReminderState struct {
	NeedsBinding   bool     `json:"needs_binding"`
	VerifiedEmails []string `json:"verified_emails"`
	Policy         string   `json:"email_reminder_policy"`
	Until          int64    `json:"email_reminder_until"`
	ShouldPrompt   bool     `json:"should_prompt"`
}

// GetEmailReminderState evaluates the binding prompt for a user. The prompt is
// only needed while no configured address is verified, and a stored "do not
// remind me" choice is cleared once a usable address appears.
func GetEmailReminderState(userId int, now time.Time) (*EmailReminderState, error) {
	user, err := GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	recipients, err := UsageReportRecipients(user)
	if err != nil {
		return nil, err
	}
	preference, err := GetUserNotificationPreference(userId)
	if err != nil {
		return nil, err
	}
	state := &EmailReminderState{
		VerifiedEmails: recipients,
		Policy:         preference.EmailReminderPolicy,
		Until:          preference.EmailReminderUntil,
	}
	if len(recipients) > 0 {
		if preference.EmailReminderPolicy != EmailReminderPolicyNormal {
			if err := ApplyEmailReminderAction(userId, EmailReminderActionReset, now); err != nil {
				return nil, err
			}
			state.Policy = EmailReminderPolicyNormal
			state.Until = 0
		}
		return state, nil
	}
	state.NeedsBinding = true
	switch preference.EmailReminderPolicy {
	case EmailReminderPolicyOff:
		state.ShouldPrompt = false
	case EmailReminderPolicySnooze:
		state.ShouldPrompt = preference.EmailReminderUntil <= now.Unix()
	default:
		state.ShouldPrompt = true
	}
	return state, nil
}
