package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// VerifiedEmailSourceRegistration is set when the platform verified the
	// address with a code during registration.
	VerifiedEmailSourceRegistration = "registration"
	// VerifiedEmailSourceBinding is set when the account email was confirmed by
	// the email binding flow.
	VerifiedEmailSourceBinding = "binding"
	// VerifiedEmailSourceProvider is set when an OAuth provider confirmed the
	// address itself.
	VerifiedEmailSourceProvider = "provider"
	// VerifiedEmailSourceLegacy marks addresses that already belonged to local
	// accounts before verification was tracked.
	VerifiedEmailSourceLegacy = "legacy"
)

const legacyVerifiedEmailMigrationOption = "LegacyVerifiedEmailMigration"

// UserVerifiedEmail records an address the platform itself has confirmed. Only
// these addresses may receive mail that the platform generates on its own
// schedule; an address an OAuth provider merely reported is not enough.
type UserVerifiedEmail struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_verified_email"`
	Email      string `json:"email" gorm:"type:varchar(50);not null;uniqueIndex:idx_user_verified_email;index"`
	Source     string `json:"source" gorm:"type:varchar(16);not null"`
	VerifiedAt int64  `json:"verified_at" gorm:"bigint;not null"`
}

// MarkEmailVerified records a verified address. Recording the same address
// again keeps the first confirmation and its source.
func MarkEmailVerified(userId int, email string, source string) error {
	return markEmailVerifiedTx(DB, userId, email, source)
}

// markEmailVerifiedTx records a confirmed address. The record is a proof that
// the platform verified this address once; whether it may receive mail right
// now is decided by UsageReportRecipients, which only considers the addresses
// currently configured on the account.
func markEmailVerifiedTx(tx *gorm.DB, userId int, email string, source string) error {
	email = NormalizeEmail(email)
	if userId <= 0 || email == "" {
		return nil
	}
	record := UserVerifiedEmail{
		UserId:     userId,
		Email:      email,
		Source:     source,
		VerifiedAt: common.GetTimestamp(),
	}
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "email"}},
		DoNothing: true,
	}).Create(&record).Error; err != nil {
		return err
	}
	// A confirmed address ends the binding prompt, so clear any snooze or
	// "do not remind me" choice that was stored while the account had none.
	return tx.Model(&UserNotificationPreference{}).
		Where("user_id = ? AND email_reminder_policy <> ?", userId, EmailReminderPolicyNormal).
		Updates(map[string]any{
			"email_reminder_policy": EmailReminderPolicyNormal,
			"email_reminder_until":  0,
		}).Error
}

// VerifiedEmails lists the confirmed addresses of a user in normalized form.
func VerifiedEmails(userId int) ([]string, error) {
	emails := make([]string, 0)
	if userId <= 0 {
		return emails, nil
	}
	err := DB.Model(&UserVerifiedEmail{}).
		Where("user_id = ?", userId).
		Order("id ASC").
		Pluck("email", &emails).Error
	return emails, err
}

// IsEmailVerifiedForUser reports whether the address is confirmed for the user.
func IsEmailVerifiedForUser(userId int, email string) (bool, error) {
	email = NormalizeEmail(email)
	if userId <= 0 || email == "" {
		return false, nil
	}
	var count int64
	err := DB.Model(&UserVerifiedEmail{}).
		Where("user_id = ? AND email = ?", userId, email).
		Count(&count).Error
	return count > 0, err
}

// MigrateLegacyVerifiedEmails seeds the verification registry for accounts
// that already have an email and a local password. Local registration only
// stored an email after a code was verified, and later changes went through
// the verified binding flow, so those addresses count as platform-confirmed.
// Password-less accounts were created by OAuth, where the profile email is not
// proof of ownership: those users get the binding prompt instead.
//
// The migration is recorded in the options table and never runs twice, so an
// account that later becomes password-based does not retroactively become
// verified.
func MigrateLegacyVerifiedEmails() error {
	var marker Option
	err := DB.Where(commonKeyCol+" = ?", legacyVerifiedEmailMigrationOption).First(&marker).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	const batchSize = 500
	lastId := 0
	for {
		var users []User
		if err := DB.Select("id", "email", "password").
			Where("id > ? AND email <> '' AND password <> ''", lastId).
			Order("id ASC").
			Limit(batchSize).
			Find(&users).Error; err != nil {
			return err
		}
		if len(users) == 0 {
			break
		}
		now := common.GetTimestamp()
		records := make([]UserVerifiedEmail, 0, len(users))
		for _, user := range users {
			lastId = user.Id
			email := NormalizeEmail(user.Email)
			if email == "" {
				continue
			}
			records = append(records, UserVerifiedEmail{
				UserId:     user.Id,
				Email:      email,
				Source:     VerifiedEmailSourceLegacy,
				VerifiedAt: now,
			})
		}
		if len(records) > 0 {
			if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&records).Error; err != nil {
				return err
			}
		}
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{
		Key:   legacyVerifiedEmailMigrationOption,
		Value: "true",
	}).Error
}
