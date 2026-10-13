package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"gorm.io/gorm"
)

// TicketStoredObject is a deletion journal written before uploading. It survives
// failed requests, crashes and ticket deletion so objects are never untracked.
type TicketStoredObject struct {
	ID        int    `gorm:"primaryKey"`
	ObjectKey string `gorm:"type:varchar(160);not null;uniqueIndex"`
	Endpoint  string `gorm:"type:varchar(160);not null"`
	Bucket    string `gorm:"type:varchar(63);not null"`
	CreatedAt int64  `gorm:"autoCreateTime;index"`
	ExpiresAt int64  `gorm:"not null;index"`
}

func TicketStorageConfig() system_setting.TicketStorageConfig {
	config := system_setting.TicketStorageConfig{RetentionDays: 30}
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[system_setting.TicketStorageOption]
	common.OptionMapRWMutex.RUnlock()
	if raw != "" {
		if err := common.UnmarshalJsonStr(raw, &config); err != nil || config.Validate() != nil {
			return system_setting.TicketStorageConfig{RetentionDays: 30}
		}
	}
	return config
}

func ValidateTicketStorageOption(raw string) error {
	var config system_setting.TicketStorageConfig
	if err := common.UnmarshalJsonStr(raw, &config); err != nil {
		return errors.New("Invalid ticket storage configuration")
	}
	if err := config.Validate(); err != nil {
		return err
	}
	old := TicketStorageConfig()
	if old.Endpoint == config.Endpoint && old.Bucket == config.Bucket {
		return nil
	}
	var count int64
	if err := DB.Model(&TicketStoredObject{}).Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return errors.New("R2 endpoint and bucket cannot change while ticket images await cleanup")
	}
	return nil
}

func TicketObjectsDue(now int64, afterID int) ([]TicketStoredObject, error) {
	objects := make([]TicketStoredObject, 0)
	err := DB.Where("id > ?", afterID).Where("(expires_at <= ? OR (created_at <= ? AND NOT EXISTS (SELECT 1 FROM ticket_attachments WHERE ticket_attachments.object_key = ticket_stored_objects.object_key)))", now, now-3600).Order("id ASC").Limit(100).Find(&objects).Error
	return objects, err
}

func CompleteTicketObjectDeletion(object TicketStoredObject) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&TicketAttachment{}).Where("object_key = ?", object.ObjectKey).Update("object_key", "").Error; err != nil {
			return err
		}
		return tx.Delete(&object).Error
	})
}
