package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RequestErrorLog stores the client request that produced a failed relay
// response. Only requests selected by request_error_log_setting are captured,
// and the body is truncated before it is written.
type RequestErrorLog struct {
	Id            int      `json:"id"`
	RequestId     string   `json:"request_id" gorm:"type:varchar(64);index:idx_req_err_logs_request_id;default:''"`
	UserId        int      `json:"user_id" gorm:"index;default:0"`
	Username      string   `json:"username" gorm:"type:varchar(64);default:''"`
	TokenId       int      `json:"token_id" gorm:"default:0"`
	TokenName     string   `json:"token_name" gorm:"type:varchar(128);default:''"`
	ModelName     string   `json:"model_name" gorm:"type:varchar(255);index;default:''"`
	ChannelId     int      `json:"channel_id" gorm:"index;default:0"`
	Group         string   `json:"group" gorm:"type:varchar(64);default:''"`
	Ip            string   `json:"ip" gorm:"type:varchar(64);default:''"`
	StatusCode    int      `json:"status_code" gorm:"index;default:0"`
	ErrorCode     string   `json:"error_code" gorm:"type:varchar(128);default:''"`
	ErrorType     string   `json:"error_type" gorm:"type:varchar(64);default:''"`
	ErrorMessage  string   `json:"error_message" gorm:"type:text"`
	RequestPath   string   `json:"request_path" gorm:"type:varchar(255);default:''"`
	IsStream      bool     `json:"is_stream"`
	UseTime       int      `json:"use_time" gorm:"default:0"`
	Body          LongText `json:"body"`
	BodyBytes     int      `json:"body_bytes" gorm:"default:0"`
	BodyTruncated bool     `json:"body_truncated"`
	CreatedAt     int64    `json:"created_at" gorm:"bigint;index"`
}

// RequestErrorLogFilter is the administrator search over captured failures.
type RequestErrorLogFilter struct {
	RequestId      string
	Username       string
	ModelName      string
	ChannelId      int
	StatusCode     int
	Keyword        string
	StartTimestamp int64
	EndTimestamp   int64
}

func (f RequestErrorLogFilter) apply(tx *gorm.DB) *gorm.DB {
	if f.RequestId != "" {
		tx = tx.Where("request_id = ?", f.RequestId)
	}
	if f.Username != "" {
		tx = tx.Where("username LIKE ?", "%"+f.Username+"%")
	}
	if f.ModelName != "" {
		tx = tx.Where("model_name LIKE ?", "%"+f.ModelName+"%")
	}
	if f.ChannelId != 0 {
		tx = tx.Where("channel_id = ?", f.ChannelId)
	}
	if f.StatusCode != 0 {
		tx = tx.Where("status_code = ?", f.StatusCode)
	}
	if f.Keyword != "" {
		tx = tx.Where("error_message LIKE ?", "%"+f.Keyword+"%")
	}
	if f.StartTimestamp != 0 {
		tx = tx.Where("created_at >= ?", f.StartTimestamp)
	}
	if f.EndTimestamp != 0 {
		tx = tx.Where("created_at <= ?", f.EndTimestamp)
	}
	return tx
}

// IsEmpty reports whether the filter would match every captured row, so callers
// can require an explicit confirmation before clearing the table.
func (f RequestErrorLogFilter) IsEmpty() bool {
	return f.RequestId == "" && f.Username == "" && f.ModelName == "" && f.ChannelId == 0 &&
		f.StatusCode == 0 && strings.TrimSpace(f.Keyword) == "" && f.StartTimestamp == 0 && f.EndTimestamp == 0
}

func CreateRequestErrorLog(entry *RequestErrorLog) error {
	if entry.CreatedAt == 0 {
		entry.CreatedAt = common.GetTimestamp()
	}
	return DB.Create(entry).Error
}

func GetRequestErrorLogs(filter RequestErrorLogFilter, startIdx int, num int) ([]*RequestErrorLog, int64, error) {
	tx := filter.apply(DB.Model(&RequestErrorLog{}))
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var entries []*RequestErrorLog
	err := tx.Omit("body").Order("created_at desc, id desc").Limit(num).Offset(startIdx).Find(&entries).Error
	return entries, total, err
}

func GetRequestErrorLogById(id int) (*RequestErrorLog, error) {
	var entry RequestErrorLog
	if err := DB.First(&entry, id).Error; err != nil {
		return nil, err
	}
	return &entry, nil
}

func DeleteRequestErrorLogById(id int) error {
	return DB.Delete(&RequestErrorLog{}, id).Error
}

func DeleteRequestErrorLogsByIds(ids []int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	result := DB.Where("id IN ?", ids).Delete(&RequestErrorLog{})
	return result.RowsAffected, result.Error
}

func DeleteRequestErrorLogs(filter RequestErrorLogFilter) (int64, error) {
	tx := filter.apply(DB.Model(&RequestErrorLog{}))
	if filter.IsEmpty() {
		// The controller already required explicit confirmation; GORM blocks
		// unconditional deletes unless this session allows them.
		tx = tx.Session(&gorm.Session{AllowGlobalUpdate: true})
	}
	result := tx.Delete(&RequestErrorLog{})
	return result.RowsAffected, result.Error
}

func CleanupRequestErrorLogs(before int64) (int64, error) {
	result := DB.Where("created_at < ?", before).Delete(&RequestErrorLog{})
	return result.RowsAffected, result.Error
}
