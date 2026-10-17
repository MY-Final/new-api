package model

import (
	"gorm.io/gorm"
)

// ConsoleImage journals an announcement image stored in the shared R2 bucket.
// The row is written before the upload so a crash can never leave an object
// untracked; scheduled cleanup removes rows that no announcement references.
type ConsoleImage struct {
	ID          int    `gorm:"primaryKey"`
	ObjectKey   string `gorm:"type:varchar(160);not null;uniqueIndex"`
	Endpoint    string `gorm:"type:varchar(160);not null"`
	Bucket      string `gorm:"type:varchar(63);not null"`
	ContentType string `gorm:"type:varchar(64);not null"`
	Size        int64  `gorm:"not null"`
	CreatedAt   int64  `gorm:"autoCreateTime;index"`
}

func MigrateConsoleImages(db *gorm.DB) error {
	return db.AutoMigrate(&ConsoleImage{})
}

func GetConsoleImage(id int) (*ConsoleImage, error) {
	var stored ConsoleImage
	if err := DB.First(&stored, id).Error; err != nil {
		return nil, err
	}
	return &stored, nil
}

// ListConsoleImagesBefore lists cleanup candidates older than the grace
// window in id order, so callers can page with a cursor.
func ListConsoleImagesBefore(before int64, afterID int) ([]ConsoleImage, error) {
	images := make([]ConsoleImage, 0)
	err := DB.Where("id > ?", afterID).Where("created_at <= ?", before).Order("id ASC").Limit(100).Find(&images).Error
	return images, err
}
