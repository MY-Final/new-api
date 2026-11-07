package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const FreeGroupSettingOption = "FreeGroupSetting"

type FreeGroupSetting struct {
	Enabled    bool   `json:"enabled"`
	Group      string `json:"group"`
	DailyLimit int64  `json:"daily_limit"`
	UserLimit  int64  `json:"user_limit"`
}

func ParseFreeGroupSetting(value string) (FreeGroupSetting, error) {
	var setting FreeGroupSetting
	if err := common.UnmarshalJsonStr(value, &setting); err != nil {
		return setting, err
	}
	if setting.DailyLimit < 0 || setting.DailyLimit > 1_000_000_000 ||
		setting.UserLimit < 0 || setting.UserLimit > 1_000_000_000 ||
		setting.Enabled && (setting.Group == "" || setting.Group == "auto" ||
			strings.TrimSpace(setting.Group) != setting.Group || setting.DailyLimit == 0) {
		return setting, fmt.Errorf("invalid free group settings")
	}
	return setting, nil
}

// LoadFreeGroupSetting reads the database so every node sees the same rules.
func LoadFreeGroupSetting() (FreeGroupSetting, error) {
	var option Option
	err := DB.Where(&Option{Key: FreeGroupSettingOption}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return FreeGroupSetting{}, nil
	}
	if err != nil {
		return FreeGroupSetting{}, err
	}
	return ParseFreeGroupSetting(option.Value)
}

// FreeGroupDailyUsage stores the shared counter under user ID zero and
// individual counters under the corresponding user ID.
type FreeGroupDailyUsage struct {
	Day    string `gorm:"primaryKey;size:10"`
	UserID int    `gorm:"primaryKey;autoIncrement:false"`
	Count  int64  `gorm:"not null"`
}

var errFreeGroupDailyLimit = errors.New("free group daily limit reached")

func freeGroupDay(now time.Time) string {
	return now.In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02")
}

func FreeGroupDailyCount(now time.Time) (int64, error) {
	var usage FreeGroupDailyUsage
	err := DB.Where("day = ? AND user_id = ?", freeGroupDay(now), 0).First(&usage).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	return usage.Count, err
}

type FreeGroupUserUsage struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Count    int64  `json:"count"`
}

// ListFreeGroupUserUsage returns the same reserved calls used by the limiter.
func ListFreeGroupUserUsage(day, username string, page *common.PageInfo) ([]FreeGroupUserUsage, int64, error) {
	query := DB.Table("free_group_daily_usages AS f").
		Joins("LEFT JOIN users AS u ON u.id = f.user_id").
		Where("f.day = ? AND f.user_id > ?", day, 0)
	if username != "" {
		query = query.Where("u.username LIKE ?", "%"+username+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]FreeGroupUserUsage, 0)
	err := query.Select("f.user_id, COALESCE(u.username, '') AS username, f.count").
		Order("f.count DESC, f.user_id ASC").
		Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Scan(&items).Error
	return items, total, err
}

// ReserveFreeGroupDailyCall atomically reserves one call from both limits.
// A zero user limit disables the individual limit.
func ReserveFreeGroupDailyCall(now time.Time, userID int, globalLimit, userLimit int64) (bool, error) {
	if userID <= 0 || globalLimit <= 0 || userLimit < 0 {
		return false, errors.New("invalid free group daily limit")
	}
	day := freeGroupDay(now)
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, id := range []int{0, userID} {
			usage := FreeGroupDailyUsage{Day: day, UserID: id}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&usage).Error; err != nil {
				return err
			}
			limit := globalLimit
			if id != 0 {
				limit = userLimit
			}
			query := tx.Model(&FreeGroupDailyUsage{}).Where("day = ? AND user_id = ?", day, id)
			if limit > 0 {
				query = query.Where("count < ?", limit)
			}
			result := query.UpdateColumn("count", gorm.Expr("count + ?", 1))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errFreeGroupDailyLimit
			}
		}
		return nil
	})
	if errors.Is(err, errFreeGroupDailyLimit) {
		return false, nil
	}
	return err == nil, err
}
