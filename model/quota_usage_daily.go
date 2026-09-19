package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// QuotaUsageDaily 汇总每个用户每天的付费/福利额度净消耗。
// 正数表示消耗，负数表示退款或结算回退；bonus_quota 与 paid_quota
// 的加和始终对应用户钱包当天实际的额度变动。
type QuotaUsageDaily struct {
	Id         int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"user_id" gorm:"not null;uniqueIndex:idx_quota_usage_daily_user_date"`
	Date       string `json:"date" gorm:"type:varchar(10);not null;uniqueIndex:idx_quota_usage_daily_user_date;index:idx_quota_usage_daily_date"`
	BonusQuota int    `json:"bonus_quota" gorm:"type:bigint;default:0;column:bonus_quota"`
	PaidQuota  int    `json:"paid_quota" gorm:"type:bigint;default:0;column:paid_quota"`
	UpdatedAt  int64  `json:"updated_at" gorm:"bigint"`
}

func (QuotaUsageDaily) TableName() string {
	return "quota_usage_daily"
}

type QuotaUsageDailyItem struct {
	UserId     int    `json:"user_id"`
	Username   string `json:"username"`
	Date       string `json:"date"`
	BonusQuota int    `json:"bonus_quota"`
	PaidQuota  int    `json:"paid_quota"`
	UpdatedAt  int64  `json:"updated_at"`
}

// QuotaLedgerSummary 总账汇总卡片数据。累计消耗来自 users.used_quota，
// 剩余额度来自 users 分桶余额，区间消耗来自每日账单表。
type QuotaLedgerSummary struct {
	TotalConsumedQuota  int64 `json:"total_consumed_quota"`
	RemainingQuota      int64 `json:"remaining_quota"`
	RemainingBonusQuota int64 `json:"remaining_bonus_quota"`
	RemainingPaidQuota  int64 `json:"remaining_paid_quota"`
	RangeQuota          int64 `json:"range_quota"`
	RangeBonusQuota     int64 `json:"range_bonus_quota"`
	RangePaidQuota      int64 `json:"range_paid_quota"`
	DebtUsers           int64 `json:"debt_users"`
	DebtQuota           int64 `json:"debt_quota"`
	TodayCheckinBonus   int64 `json:"today_checkin_bonus"`
	TodayCheckinUsers   int64 `json:"today_checkin_users"`
}

var (
	quotaUsageDailyStore = make(map[quotaUsageDailyKey]QuotaAllocation)
	quotaUsageDailyLock  sync.Mutex
)

type quotaUsageDailyKey struct {
	userId int
	date   string
}

// RecordQuotaUsage 记录一笔钱包额度变动到当日账单。
// 消耗为正、退款为负；仅钱包分桶变动会被记录，管理端手工调整
// 与支付退款不计入使用量。
func RecordQuotaUsage(userId int, allocation QuotaAllocation) {
	if userId <= 0 || allocation.Total() == 0 {
		return
	}
	date := time.Now().Format("2006-01-02")
	if common.BatchUpdateEnabled {
		quotaUsageDailyLock.Lock()
		key := quotaUsageDailyKey{userId: userId, date: date}
		current := quotaUsageDailyStore[key]
		quotaUsageDailyStore[key] = QuotaAllocation{
			Bonus: current.Bonus + allocation.Bonus,
			Paid:  current.Paid + allocation.Paid,
		}
		quotaUsageDailyLock.Unlock()
		return
	}
	if err := applyQuotaUsageDaily(userId, date, allocation); err != nil {
		common.SysError(fmt.Sprintf("failed to record quota usage for user %d: %s", userId, err.Error()))
	}
}

// flushQuotaUsageDaily 由批量更新协程调用，把内存中的当日账单落库。
func flushQuotaUsageDaily() {
	quotaUsageDailyLock.Lock()
	if len(quotaUsageDailyStore) == 0 {
		quotaUsageDailyLock.Unlock()
		return
	}
	store := quotaUsageDailyStore
	quotaUsageDailyStore = make(map[quotaUsageDailyKey]QuotaAllocation)
	quotaUsageDailyLock.Unlock()

	for key, allocation := range store {
		if err := applyQuotaUsageDaily(key.userId, key.date, allocation); err != nil {
			common.SysError(fmt.Sprintf("failed to flush quota usage for user %d: %s", key.userId, err.Error()))
		}
	}
}

func quotaUsageDailyUpdates(allocation QuotaAllocation) map[string]any {
	return map[string]any{
		"bonus_quota": gorm.Expr("bonus_quota + ?", allocation.Bonus),
		"paid_quota":  gorm.Expr("paid_quota + ?", allocation.Paid),
		"updated_at":  common.GetTimestamp(),
	}
}

// applyQuotaUsageDaily 先原子累加已存在的当日行，不存在时插入；
// 并发插入撞唯一键时重试一次累加。
func applyQuotaUsageDaily(userId int, date string, allocation QuotaAllocation) error {
	result := DB.Model(&QuotaUsageDaily{}).
		Where("user_id = ? AND date = ?", userId, date).
		Updates(quotaUsageDailyUpdates(allocation))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		return nil
	}
	row := QuotaUsageDaily{
		UserId:     userId,
		Date:       date,
		BonusQuota: allocation.Bonus,
		PaidQuota:  allocation.Paid,
		UpdatedAt:  common.GetTimestamp(),
	}
	if err := DB.Create(&row).Error; err != nil {
		retry := DB.Model(&QuotaUsageDaily{}).
			Where("user_id = ? AND date = ?", userId, date).
			Updates(quotaUsageDailyUpdates(allocation))
		if retry.Error != nil {
			return retry.Error
		}
		if retry.RowsAffected == 0 {
			return err
		}
	}
	return nil
}

func quotaUsageDailyQuery(startDate, endDate, username string) *gorm.DB {
	query := DB.Table("quota_usage_daily AS q").
		Joins("LEFT JOIN users AS u ON u.id = q.user_id").
		Where("q.date >= ? AND q.date <= ?", startDate, endDate)
	if username != "" {
		query = query.Where("u.username LIKE ?", "%"+username+"%")
	}
	return query
}

func ListQuotaUsageDaily(startDate, endDate, username string, pageInfo *common.PageInfo) ([]*QuotaUsageDailyItem, int64, error) {
	var total int64
	if err := quotaUsageDailyQuery(startDate, endDate, username).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []*QuotaUsageDailyItem
	if err := quotaUsageDailyQuery(startDate, endDate, username).
		Select("q.user_id, u.username, q.date, q.bonus_quota, q.paid_quota, q.updated_at").
		Order("q.date DESC, q.user_id ASC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

type quotaUsageDailySum struct {
	Bonus int64 `gorm:"column:bonus_quota"`
	Paid  int64 `gorm:"column:paid_quota"`
}

func SumQuotaUsageDaily(startDate, endDate, username string) (bonus int64, paid int64, err error) {
	var row quotaUsageDailySum
	if err = quotaUsageDailyQuery(startDate, endDate, username).
		Select("COALESCE(SUM(q.bonus_quota), 0) AS bonus_quota, COALESCE(SUM(q.paid_quota), 0) AS paid_quota").
		Scan(&row).Error; err != nil {
		return 0, 0, err
	}
	return row.Bonus, row.Paid, nil
}

func GetQuotaLedgerSummary(startDate, endDate string) (*QuotaLedgerSummary, error) {
	summary := &QuotaLedgerSummary{}
	row := DB.Table("users").
		Select("COALESCE(SUM(used_quota), 0), COALESCE(SUM(quota), 0), COALESCE(SUM(bonus_quota), 0), COALESCE(SUM(paid_quota), 0)").
		Row()
	if err := row.Scan(
		&summary.TotalConsumedQuota,
		&summary.RemainingQuota,
		&summary.RemainingBonusQuota,
		&summary.RemainingPaidQuota,
	); err != nil {
		return nil, err
	}
	row = DB.Table("users").
		Select("COUNT(*), COALESCE(SUM(quota), 0)").
		Where("quota < 0").
		Row()
	if err := row.Scan(&summary.DebtUsers, &summary.DebtQuota); err != nil {
		return nil, err
	}
	bonus, paid, err := SumQuotaUsageDaily(startDate, endDate, "")
	if err != nil {
		return nil, err
	}
	summary.RangeBonusQuota = bonus
	summary.RangePaidQuota = paid
	summary.RangeQuota = bonus + paid
	row = DB.Table("checkins").
		Select("COALESCE(SUM(quota_awarded), 0), COUNT(*)").
		Where("checkin_date = ?", time.Now().Format("2006-01-02")).
		Row()
	if err := row.Scan(&summary.TodayCheckinBonus, &summary.TodayCheckinUsers); err != nil {
		return nil, err
	}
	return summary, nil
}
