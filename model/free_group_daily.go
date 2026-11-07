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
	Enabled    bool                    `json:"enabled"`
	Group      string                  `json:"group"`
	DailyLimit int64                   `json:"daily_limit"`
	UserLimit  int64                   `json:"user_limit"`
	Weekly     []FreeGroupWeeklySlot   `json:"weekly,omitempty"`
	Schedule   []FreeGroupScheduleSlot `json:"schedule,omitempty"`
}

// FreeGroupWeeklySlot assigns a recurring weekday to a group. Weekday follows
// time.Weekday, where Sunday is 0.
type FreeGroupWeeklySlot struct {
	Weekday int    `json:"weekday"`
	Group   string `json:"group"`
}

// FreeGroupScheduleSlot overrides one calendar day and wins over Weekly.
type FreeGroupScheduleSlot struct {
	Date  string `json:"date"`
	Group string `json:"group"`
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
	if len(setting.Weekly) > 7 || len(setting.Schedule) > 366 {
		return setting, fmt.Errorf("invalid free group settings")
	}
	weekdays := make(map[int]struct{}, len(setting.Weekly))
	for _, slot := range setting.Weekly {
		if slot.Weekday < 0 || slot.Weekday > 6 ||
			slot.Group == "" || slot.Group == "auto" || strings.TrimSpace(slot.Group) != slot.Group {
			return setting, fmt.Errorf("invalid free group settings")
		}
		if _, ok := weekdays[slot.Weekday]; ok {
			return setting, fmt.Errorf("invalid free group settings")
		}
		weekdays[slot.Weekday] = struct{}{}
	}
	dates := make(map[string]struct{}, len(setting.Schedule))
	for _, slot := range setting.Schedule {
		date, err := time.Parse("2006-01-02", slot.Date)
		if err != nil || date.Format("2006-01-02") != slot.Date ||
			slot.Group == "" || slot.Group == "auto" || strings.TrimSpace(slot.Group) != slot.Group {
			return setting, fmt.Errorf("invalid free group settings")
		}
		if _, ok := dates[slot.Date]; ok {
			return setting, fmt.Errorf("invalid free group settings")
		}
		dates[slot.Date] = struct{}{}
	}
	return setting, nil
}

// Groups lists every group referenced by the default and the schedule so the
// option validator can reject groups that no longer exist.
func (setting FreeGroupSetting) Groups() []string {
	groups := make([]string, 0, 1+len(setting.Weekly)+len(setting.Schedule))
	if setting.Group != "" {
		groups = append(groups, setting.Group)
	}
	for _, slot := range setting.Weekly {
		groups = append(groups, slot.Group)
	}
	for _, slot := range setting.Schedule {
		groups = append(groups, slot.Group)
	}
	return groups
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
	Day            string `gorm:"primaryKey;size:10"`
	UserID         int    `gorm:"primaryKey;autoIncrement:false"`
	Count          int64  `gorm:"not null"`
	RejectedCount  int64  `gorm:"not null;default:0"`
	LastRejectedAt int64  `gorm:"not null;default:0"`
}

var errFreeGroupDailyLimit = errors.New("free group daily limit reached")

var freeGroupZone = time.FixedZone("UTC+8", 8*60*60)

func freeGroupDay(now time.Time) string {
	return now.In(freeGroupZone).Format("2006-01-02")
}

func freeGroupAssignment(setting FreeGroupSetting, now time.Time) (string, string) {
	if !setting.Enabled {
		return setting.Group, "default"
	}
	local := now.In(freeGroupZone)
	day := local.Format("2006-01-02")
	for _, slot := range setting.Schedule {
		if slot.Date == day {
			return slot.Group, "date"
		}
	}
	for _, slot := range setting.Weekly {
		if slot.Weekday == int(local.Weekday()) {
			return slot.Group, "weekly"
		}
	}
	return setting.Group, "default"
}

// ResolveFreeGroupSetting returns the group that is free on the given day.
// Date overrides win over weekly slots, and both win over the default group.
func ResolveFreeGroupSetting(setting FreeGroupSetting, now time.Time) FreeGroupSetting {
	setting.Group, _ = freeGroupAssignment(setting, now)
	return setting
}

type FreeGroupScheduleDay struct {
	Date       string `json:"date"`
	Group      string `json:"group"`
	Source     string `json:"source"`
	Enabled    bool   `json:"enabled"`
	DailyLimit int64  `json:"daily_limit"`
	UserLimit  int64  `json:"user_limit"`
}

// FreeGroupSchedule resolves every day in the inclusive range so clients can
// render the roster without duplicating the override rules.
func FreeGroupSchedule(setting FreeGroupSetting, from, to time.Time) []FreeGroupScheduleDay {
	days := make([]FreeGroupScheduleDay, 0, int(to.Sub(from).Hours()/24)+1)
	for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
		group, source := freeGroupAssignment(setting, day)
		days = append(days, FreeGroupScheduleDay{
			Date:       day.In(freeGroupZone).Format("2006-01-02"),
			Group:      group,
			Source:     source,
			Enabled:    setting.Enabled,
			DailyLimit: setting.DailyLimit,
			UserLimit:  setting.UserLimit,
		})
	}
	return days
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
	UserID         int    `json:"user_id"`
	Username       string `json:"username"`
	Count          int64  `json:"count"`
	RejectedCount  int64  `json:"rejected_count"`
	LastRejectedAt int64  `json:"last_rejected_at"`
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
	err := query.Select("f.user_id, COALESCE(u.username, '') AS username, f.count, f.rejected_count, f.last_rejected_at").
		Order("f.count DESC, f.user_id ASC").
		Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Scan(&items).Error
	return items, total, err
}

func RecordFreeGroupRejection(now time.Time, userID int) error {
	usage := FreeGroupDailyUsage{
		Day: freeGroupDay(now), UserID: userID, RejectedCount: 1, LastRejectedAt: now.Unix(),
	}
	rejectedCount := clause.Column{Table: clause.CurrentTable, Name: "rejected_count"}
	lastRejectedAt := clause.Column{Table: clause.CurrentTable, Name: "last_rejected_at"}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "day"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"rejected_count":   gorm.Expr("? + 1", rejectedCount),
			"last_rejected_at": gorm.Expr("CASE WHEN ? < ? THEN ? ELSE ? END", lastRejectedAt, now.Unix(), now.Unix(), lastRejectedAt),
		}),
	}).Create(&usage).Error
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
