package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

var (
	ErrInviteCodeInvalid        = errors.New("invitation code is invalid")
	ErrInviteCodeDisabled       = errors.New("invitation code is disabled")
	ErrInviteCodeExpired        = errors.New("invitation code has expired")
	ErrInviteCodeLimitReached   = errors.New("invitation code registration limit has been reached")
	ErrInviteCodeAlreadyClaimed = errors.New("user has already claimed an invitation code")
)

// InviteCode is a standalone acquisition campaign. Administrators can create
// one code per channel without maintaining a separate campaign record.
type InviteCode struct {
	Id                int    `json:"id" gorm:"primaryKey"`
	Name              string `json:"name" gorm:"type:varchar(100);not null"`
	Code              string `json:"code" gorm:"type:varchar(64);not null;uniqueIndex:uk_invite_code_code"`
	Enabled           bool   `json:"enabled" gorm:"not null;index"`
	GroupName         string `json:"group" gorm:"column:group_name;type:varchar(64);not null"`
	InviterId         int    `json:"inviter_id" gorm:"not null;index"`
	RegistrationLimit int64  `json:"registration_limit" gorm:"not null"`
	RegisteredCount   int64  `json:"registered_count" gorm:"not null"`
	BonusQuota        int    `json:"bonus_quota" gorm:"not null"`
	ExpiresAt         int64  `json:"expires_at" gorm:"not null;index"`
	Remark            string `json:"remark" gorm:"type:varchar(255);not null"`
	CreatedAt         int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// InviteCodeClaim records the immutable award a user received at registration.
// A user may claim only one acquisition code.
type InviteCodeClaim struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	InviteCodeId int    `json:"invite_code_id" gorm:"not null;index:idx_invite_code_claim_code"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:uk_invite_code_claim_user"`
	InviterId    int    `json:"inviter_id" gorm:"not null;index"`
	GroupName    string `json:"group" gorm:"column:group_name;type:varchar(64);not null"`
	BonusQuota   int    `json:"bonus_quota" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"autoCreateTime"`
}

type InviteCodeClaimRecord struct {
	UserId        int    `json:"user_id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	Email         string `json:"email"`
	GroupName     string `json:"group"`
	InviterId     int    `json:"inviter_id"`
	BonusQuota    int    `json:"bonus_quota"`
	UserStatus    int    `json:"user_status"`
	UserCreatedAt int64  `json:"user_created_at"`
	ClaimedAt     int64  `json:"claimed_at"`
}

type InviteCodeRegistration struct {
	InviteCode *InviteCode
	InviterId  int
}

func NormalizeInviteCode(code string) string {
	return strings.ToLower(strings.TrimSpace(code))
}

func (code *InviteCode) RemainingRegistrations() int64 {
	if code.RegistrationLimit == 0 {
		return -1
	}
	return max(code.RegistrationLimit-code.RegisteredCount, 0)
}

func GetInviteCodeByCode(code string) (*InviteCode, error) {
	var inviteCode InviteCode
	if err := DB.Where("code = ?", NormalizeInviteCode(code)).First(&inviteCode).Error; err != nil {
		return nil, err
	}
	return &inviteCode, nil
}

func GetInviteCodeById(id int) (*InviteCode, error) {
	var inviteCode InviteCode
	if err := DB.First(&inviteCode, id).Error; err != nil {
		return nil, err
	}
	return &inviteCode, nil
}

func ListInviteCodes(keyword string, enabled *bool, offset int, limit int) ([]*InviteCode, int64, error) {
	query := DB.Model(&InviteCode{})
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		pattern := "%" + strings.ToLower(keyword) + "%"
		query = query.Where("LOWER(name) LIKE ? OR LOWER(code) LIKE ?", pattern, pattern)
	}
	if enabled != nil {
		query = query.Where("enabled = ?", *enabled)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var codes []*InviteCode
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&codes).Error; err != nil {
		return nil, 0, err
	}
	return codes, total, nil
}

func GetInviteCodeClaims(inviteCodeId int, offset int, limit int) ([]*InviteCodeClaimRecord, int64, error) {
	query := DB.Table("invite_code_claims").
		Joins("JOIN users ON users.id = invite_code_claims.user_id").
		Where("invite_code_claims.invite_code_id = ?", inviteCodeId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var claims []*InviteCodeClaimRecord
	if err := query.
		Select(`invite_code_claims.user_id,
			users.username,
			users.display_name,
			users.email,
			invite_code_claims.group_name,
			invite_code_claims.inviter_id,
			invite_code_claims.bonus_quota,
			users.status AS user_status,
			users.created_at AS user_created_at,
			invite_code_claims.created_at AS claimed_at`).
		Order("invite_code_claims.id DESC").
		Offset(offset).
		Limit(limit).
		Scan(&claims).Error; err != nil {
		return nil, 0, err
	}
	return claims, total, nil
}

// ReserveInviteCodeRegistrationWithTx reserves one registration slot. The
// conditional update protects SQLite, where SELECT FOR UPDATE is unavailable,
// while the row lock serializes MySQL and PostgreSQL registrations.
func ReserveInviteCodeRegistrationWithTx(tx *gorm.DB, code string, now time.Time) (*InviteCodeRegistration, error) {
	code = NormalizeInviteCode(code)
	if code == "" {
		return nil, ErrInviteCodeInvalid
	}
	var inviteCode InviteCode
	if err := lockForUpdate(tx).Where("code = ?", code).First(&inviteCode).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInviteCodeInvalid
		}
		return nil, err
	}
	if !inviteCode.Enabled {
		return nil, ErrInviteCodeDisabled
	}
	if inviteCode.ExpiresAt > 0 && inviteCode.ExpiresAt <= now.Unix() {
		return nil, ErrInviteCodeExpired
	}

	query := tx.Model(&InviteCode{}).Where("id = ?", inviteCode.Id)
	if inviteCode.RegistrationLimit > 0 {
		query = query.Where("registered_count < ?", inviteCode.RegistrationLimit)
	}
	result := query.UpdateColumn("registered_count", gorm.Expr("registered_count + ?", 1))
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrInviteCodeLimitReached
	}
	inviteCode.RegisteredCount++
	return &InviteCodeRegistration{
		InviteCode: &inviteCode,
		InviterId:  inviteCode.InviterId,
	}, nil
}

// ApplyInviteCodeRegistrationWithTx snapshots the award and creates the claim.
// The user row was created in this transaction.
func ApplyInviteCodeRegistrationWithTx(tx *gorm.DB, registration *InviteCodeRegistration, user *User) error {
	if registration == nil || registration.InviteCode == nil {
		return ErrInviteCodeInvalid
	}
	if registration.InviteCode.BonusQuota > 0 {
		if int64(registration.InviteCode.BonusQuota) > common.MaxWalletQuota-int64(user.BonusQuota) {
			return fmt.Errorf("invitation code bonus exceeds the wallet quota limit")
		}
		result := tx.Model(&User{}).Where("id = ?", user.Id).Updates(map[string]any{
			"bonus_quota": gorm.Expr("bonus_quota + ?", registration.InviteCode.BonusQuota),
			"quota":       gorm.Expr("quota + ?", registration.InviteCode.BonusQuota),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("failed to apply invitation code bonus")
		}
		user.BonusQuota += registration.InviteCode.BonusQuota
		user.Quota += registration.InviteCode.BonusQuota
	}
	return tx.Create(&InviteCodeClaim{
		InviteCodeId: registration.InviteCode.Id,
		UserId:       user.Id,
		InviterId:    registration.InviterId,
		GroupName:    registration.InviteCode.GroupName,
		BonusQuota:   registration.InviteCode.BonusQuota,
		CreatedAt:    time.Now().Unix(),
	}).Error
}

func RecordInviteCodeBonus(userId int, bonusQuota int) {
	if userId <= 0 || bonusQuota <= 0 {
		return
	}
	RecordLog(userId, LogTypeSystem, common.NewMessage("Invitation code bonus {{quota}}", map[string]any{
		"quota": logger.FormatQuota(bonusQuota),
	}))
}

// InsertWithInviteCode creates the account, consumes one registration slot,
// applies the campaign group and bonus, and records the claim atomically.
func (user *User) InsertWithInviteCode(code string) (*InviteCode, error) {
	var registration *InviteCodeRegistration
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		registration, err = ReserveInviteCodeRegistrationWithTx(tx, code, time.Now())
		if err != nil {
			return err
		}
		user.InviterId = registration.InviterId
		user.Group = registration.InviteCode.GroupName
		if err := user.InsertWithTx(tx, registration.InviterId); err != nil {
			return err
		}
		return ApplyInviteCodeRegistrationWithTx(tx, registration, user)
	})
	if err != nil {
		return nil, err
	}
	user.finishInsert(registration.InviterId)
	RecordInviteCodeBonus(user.Id, registration.InviteCode.BonusQuota)
	return registration.InviteCode, nil
}
