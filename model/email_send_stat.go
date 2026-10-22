package model

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EmailSendStat aggregates delivery attempts per local calendar day, purpose and
// transport. One row per bucket instead of one row per message keeps the table
// at a few thousand rows a year while still answering how much of a monthly plan
// quota each kind of mail consumed.
type EmailSendStat struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Date      string `json:"date" gorm:"column:stat_date;type:varchar(10);not null;uniqueIndex:idx_email_send_stat_day,priority:1"`
	Purpose   string `json:"purpose" gorm:"type:varchar(32);not null;uniqueIndex:idx_email_send_stat_day,priority:2"`
	Provider  string `json:"provider" gorm:"type:varchar(16);not null;uniqueIndex:idx_email_send_stat_day,priority:3"`
	Delivered int64  `json:"delivered" gorm:"not null"`
	Failed    int64  `json:"failed" gorm:"not null"`
}

func (EmailSendStat) TableName() string {
	return "email_send_stats"
}

// RecordEmailDelivery adds one delivery attempt to today's counter for its
// purpose and transport. Statistics must never break mail delivery, so write
// failures are logged instead of returned.
func RecordEmailDelivery(purpose string, provider string, delivered bool) {
	counter := "failed"
	if delivered {
		counter = "delivered"
	}
	row := EmailSendStat{
		Date:     time.Now().Format("2006-01-02"),
		Purpose:  normalizeEmailStatLabel(purpose, 32),
		Provider: normalizeEmailStatLabel(provider, 16),
	}
	// The insert path stores the first attempt of a bucket; the conflict path
	// below adds later attempts to the existing counters.
	if delivered {
		row.Delivered = 1
	} else {
		row.Failed = 1
	}
	err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "stat_date"},
			{Name: "purpose"},
			{Name: "provider"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			counter: gorm.Expr("? + ?", clause.Column{Table: "email_send_stats", Name: counter}, 1),
		}),
	}).Create(&row).Error
	if err != nil {
		common.SysError(common.LogText("failed to record email delivery statistics: %s", err.Error()))
	}
}

// normalizeEmailStatLabel keeps a bucket name inside its column width so an
// unexpected caller cannot break the unique index with an oversized value.
func normalizeEmailStatLabel(value string, limit int) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || len(value) > limit || strings.ContainsAny(value, "\x00\r\n") {
		return common.EmailPurposeOther
	}
	return value
}

// ListEmailSendStats returns the bucket rows between two inclusive local
// calendar dates (YYYY-MM-DD), oldest first.
func ListEmailSendStats(startDate string, endDate string) ([]EmailSendStat, error) {
	var rows []EmailSendStat
	err := DB.Where("stat_date >= ? AND stat_date <= ?", startDate, endDate).
		Order("stat_date ASC").
		Find(&rows).Error
	return rows, err
}
