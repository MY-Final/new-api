package model

import (
	"crypto/rand"
	"errors"
	"math"
	"math/big"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const DailyEggSettingOption = "DailyEggSetting"
const DefaultDailyEggSetting = `{"enabled":false,"min_spend_cny":2.5,"egg_count":3,"prizes":[]}`

type DailyEggPrize struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Quota       int    `json:"quota"`
	Quantity    int    `json:"quantity"`
	Probability int    `json:"probability"`
}

type DailyEggSetting struct {
	Enabled     bool            `json:"enabled"`
	MinSpendCNY float64         `json:"min_spend_cny"`
	EggCount    int             `json:"egg_count"`
	Prizes      []DailyEggPrize `json:"prizes"`
}

type DailyEggDraw struct {
	ID        int    `json:"-" gorm:"primaryKey"`
	UserID    int    `json:"-" gorm:"not null;uniqueIndex:idx_daily_egg_user_day"`
	Day       string `json:"day" gorm:"size:10;not null;uniqueIndex:idx_daily_egg_user_day"`
	Egg       int    `json:"egg"`
	PrizeID   string `json:"-" gorm:"size:36"`
	PrizeName string `json:"prize_name" gorm:"size:100"`
	Quota     int    `json:"quota" gorm:"type:bigint"`
	CreatedAt int64  `json:"created_at"`
}

type DailyEggInventory struct {
	Day     string `gorm:"primaryKey;size:10"`
	PrizeID string `gorm:"primaryKey;size:36"`
	Count   int    `gorm:"not null"`
}

type DailyEggStatus struct {
	Enabled     bool            `json:"enabled"`
	Day         string          `json:"day"`
	MinSpendCNY float64         `json:"min_spend_cny"`
	SpendCNY    float64         `json:"spend_cny"`
	EggCount    int             `json:"egg_count"`
	Prizes      []DailyEggPrize `json:"prizes"`
	Eligible    bool            `json:"eligible"`
	Draw        *DailyEggDraw   `json:"draw"`
}

type DailyEggAdminDraw struct {
	ID        int    `json:"id"`
	UserID    int    `json:"user_id"`
	Username  string `json:"username"`
	Day       string `json:"day"`
	Egg       int    `json:"egg"`
	PrizeName string `json:"prize_name"`
	Quota     int    `json:"quota"`
	CreatedAt int64  `json:"created_at"`
}

type DailyEggAdminPrize struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Quantity  int    `json:"quantity"`
	Issued    int    `json:"issued"`
	Remaining int    `json:"remaining"`
}

func ListDailyEggDraws(day, username, prize string, page *common.PageInfo) ([]DailyEggAdminDraw, int64, error) {
	query := DB.Table("daily_egg_draws AS d").
		Joins("LEFT JOIN users AS u ON u.id = d.user_id").
		Where("d.day = ?", day)
	if username != "" {
		query = query.Where("u.username LIKE ?", "%"+username+"%")
	}
	if prize != "" {
		query = query.Where("d.prize_name LIKE ?", "%"+prize+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]DailyEggAdminDraw, 0)
	err := query.Select("d.id, d.user_id, COALESCE(u.username, '') AS username, d.day, d.egg, d.prize_name, d.quota, d.created_at").
		Order("d.created_at DESC, d.id DESC").
		Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Scan(&items).Error
	return items, total, err
}

func DailyEggPrizeInventory(day string) ([]DailyEggAdminPrize, error) {
	setting, err := loadDailyEggSetting(DB)
	if err != nil {
		return nil, err
	}
	var inventory []DailyEggInventory
	if err := DB.Where("day = ?", day).Find(&inventory).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int, len(inventory))
	for _, item := range inventory {
		counts[item.PrizeID] = item.Count
	}
	prizes := make([]DailyEggAdminPrize, 0, len(setting.Prizes))
	for _, prize := range setting.Prizes {
		issued := counts[prize.ID]
		prizes = append(prizes, DailyEggAdminPrize{
			ID: prize.ID, Name: prize.Name, Quantity: prize.Quantity,
			Issued: issued, Remaining: max(prize.Quantity-issued, 0),
		})
	}
	return prizes, nil
}

var (
	errDailyEggSetting  = common.NewMessage("Invalid daily egg settings")
	errDailyEggDisabled = common.NewMessage("Daily egg is not enabled")
	errDailyEggSpend    = common.NewMessage("Daily spending requirement has not been met")
	errDailyEggDrawn    = common.NewMessage("You have already opened an egg today")
	errDailyEggChoice   = common.NewMessage("Invalid egg choice")
)

func ParseDailyEggSetting(value string) (DailyEggSetting, error) {
	var setting DailyEggSetting
	if err := common.UnmarshalJsonStr(value, &setting); err != nil {
		return setting, errDailyEggSetting
	}
	if math.IsNaN(setting.MinSpendCNY) || math.IsInf(setting.MinSpendCNY, 0) ||
		setting.MinSpendCNY < 0 || setting.MinSpendCNY > 1_000_000 ||
		!decimal.NewFromFloat(setting.MinSpendCNY).Equal(decimal.NewFromFloat(setting.MinSpendCNY).Round(2)) ||
		setting.EggCount < 2 || setting.EggCount > 12 || len(setting.Prizes) > 20 ||
		setting.Enabled && len(setting.Prizes) == 0 {
		return setting, errDailyEggSetting
	}
	ids := make(map[string]bool, len(setting.Prizes))
	total := 0
	for _, prize := range setting.Prizes {
		if len(prize.ID) == 0 || len(prize.ID) > 36 || strings.TrimSpace(prize.ID) != prize.ID ||
			len(prize.Name) == 0 || len(prize.Name) > 100 || strings.TrimSpace(prize.Name) != prize.Name ||
			ids[prize.ID] || prize.Quota <= 0 || prize.Quota > 1_000_000_000 ||
			prize.Quantity <= 0 || prize.Quantity > 1_000_000 ||
			prize.Probability <= 0 || prize.Probability > 10_000 {
			return setting, errDailyEggSetting
		}
		for _, character := range prize.ID {
			if character != '-' && (character < 'a' || character > 'z') && (character < '0' || character > '9') {
				return setting, errDailyEggSetting
			}
		}
		ids[prize.ID] = true
		total += prize.Probability
	}
	if total > 10_000 {
		return setting, errDailyEggSetting
	}
	return setting, nil
}

func loadDailyEggSetting(tx *gorm.DB) (DailyEggSetting, error) {
	var option Option
	err := tx.Where(&Option{Key: DailyEggSettingOption}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ParseDailyEggSetting(DefaultDailyEggSetting)
	}
	if err != nil {
		return DailyEggSetting{}, err
	}
	return ParseDailyEggSetting(option.Value)
}

func dailyEggSpend(tx *gorm.DB, userID int, now time.Time, minimum float64) (decimal.Decimal, bool, error) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var quota int64
	err := tx.Model(&RequestBilling{}).
		Select("COALESCE(SUM(CASE WHEN quota > COALESCE(refunded_quota, 0) THEN quota - COALESCE(refunded_quota, 0) ELSE 0 END), 0)").
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start.Unix(), start.AddDate(0, 0, 1).Unix()).
		Where("(settled = ? OR (usage_recorded = ? AND task_id <> '' AND EXISTS (SELECT 1 FROM tasks WHERE tasks.task_id = request_billings.task_id AND tasks.user_id = request_billings.user_id AND tasks.channel_id = request_billings.channel_id AND tasks.status = ? AND tasks.quota = request_billings.quota)))", true, true, TaskStatusSuccess).
		Scan(&quota).Error
	if err != nil {
		return decimal.Zero, false, err
	}
	rate, perUnit := operation_setting.USDExchangeRate, common.QuotaPerUnit
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 ||
		math.IsNaN(perUnit) || math.IsInf(perUnit, 0) || perUnit <= 0 {
		return decimal.Zero, false, errDailyEggSetting
	}
	rateDecimal, perUnitDecimal := decimal.NewFromFloat(rate), decimal.NewFromFloat(perUnit)
	var options []Option
	if err := tx.Where(commonKeyCol+" IN ?", []string{"USDExchangeRate", "QuotaPerUnit"}).Find(&options).Error; err != nil {
		return decimal.Zero, false, err
	}
	for _, option := range options {
		value, err := decimal.NewFromString(option.Value)
		if err != nil || !value.IsPositive() {
			return decimal.Zero, false, errDailyEggSetting
		}
		if option.Key == "USDExchangeRate" {
			rateDecimal = value
		} else {
			perUnitDecimal = value
		}
	}
	numerator := decimal.NewFromInt(quota).Mul(rateDecimal)
	eligible := numerator.GreaterThanOrEqual(decimal.NewFromFloat(minimum).Mul(perUnitDecimal))
	return numerator.Div(perUnitDecimal), eligible, nil
}

func GetDailyEggStatus(userID int) (DailyEggStatus, error) {
	if userID <= 0 {
		return DailyEggStatus{}, errDailyEggChoice
	}
	now := UsageReportNow()
	setting, err := loadDailyEggSetting(DB)
	if err != nil {
		return DailyEggStatus{}, err
	}
	status := DailyEggStatus{
		Enabled: setting.Enabled, Day: now.Format("2006-01-02"),
		MinSpendCNY: setting.MinSpendCNY, EggCount: setting.EggCount, Prizes: setting.Prizes,
	}
	if !setting.Enabled {
		return status, nil
	}
	spend, eligible, err := dailyEggSpend(DB, userID, now, setting.MinSpendCNY)
	if err != nil {
		return status, err
	}
	status.SpendCNY, _ = spend.Float64()
	if math.IsInf(status.SpendCNY, 0) {
		return status, errDailyEggSetting
	}
	status.Eligible = eligible
	var draw DailyEggDraw
	err = DB.Where("user_id = ? AND day = ?", userID, status.Day).First(&draw).Error
	if err == nil {
		status.Draw = &draw
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return status, err
	}
	return status, nil
}

func OpenDailyEgg(userID, egg int) (*DailyEggDraw, error) {
	if userID <= 0 {
		return nil, errDailyEggChoice
	}
	now := UsageReportNow()
	var draw DailyEggDraw
	err := DB.Transaction(func(tx *gorm.DB) error {
		setting, err := loadDailyEggSetting(tx)
		if err != nil {
			return err
		}
		if !setting.Enabled {
			return errDailyEggDisabled
		}
		if egg < 1 || egg > setting.EggCount {
			return errDailyEggChoice
		}
		_, eligible, err := dailyEggSpend(tx, userID, now, setting.MinSpendCNY)
		if err != nil {
			return err
		}
		if !eligible {
			return errDailyEggSpend
		}
		draw = DailyEggDraw{UserID: userID, Day: now.Format("2006-01-02"), Egg: egg, CreatedAt: now.Unix()}
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&draw)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return errDailyEggDrawn
		}
		number, err := rand.Int(rand.Reader, big.NewInt(10_000))
		if err != nil {
			return err
		}
		roll := int(number.Int64())
		for _, prize := range setting.Prizes {
			if roll >= prize.Probability {
				roll -= prize.Probability
				continue
			}
			inventory := DailyEggInventory{Day: draw.Day, PrizeID: prize.ID}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&inventory).Error; err != nil {
				return err
			}
			result := tx.Model(&DailyEggInventory{}).
				Where("day = ? AND prize_id = ? AND count < ?", draw.Day, prize.ID, prize.Quantity).
				UpdateColumn("count", gorm.Expr("count + 1"))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				break
			}
			user, err := financialUserTx(tx, userID)
			if err != nil {
				return err
			}
			if user.BonusQuota == 0 && user.PaidQuota == 0 && user.Quota != 0 {
				user.PaidQuota = user.Quota
			}
			quota, err := walletAfterDelta(user.Quota, prize.Quota)
			if err != nil {
				return err
			}
			bonus, err := walletAfterDelta(user.BonusQuota, prize.Quota)
			if err != nil {
				return err
			}
			if err := tx.Model(&User{}).Where("id = ?", userID).Updates(map[string]any{
				"quota": quota, "bonus_quota": bonus, "paid_quota": user.PaidQuota,
			}).Error; err != nil {
				return err
			}
			draw.PrizeID, draw.PrizeName, draw.Quota = prize.ID, prize.Name, prize.Quota
			if err := tx.Model(&draw).Updates(map[string]any{
				"prize_id": draw.PrizeID, "prize_name": draw.PrizeName, "quota": draw.Quota,
			}).Error; err != nil {
				return err
			}
			break
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if draw.Quota > 0 {
		syncCreditUserQuotaCache(userID, draw.Quota, "daily egg")
	}
	return &draw, nil
}
