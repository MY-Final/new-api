package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	TotalConsumedQuota  int64                       `json:"total_consumed_quota"`
	RemainingQuota      int64                       `json:"remaining_quota"`
	RemainingBonusQuota int64                       `json:"remaining_bonus_quota"`
	RemainingPaidQuota  int64                       `json:"remaining_paid_quota"`
	RangeQuota          int64                       `json:"range_quota"`
	RangeBonusQuota     int64                       `json:"range_bonus_quota"`
	RangePaidQuota      int64                       `json:"range_paid_quota"`
	DebtUsers           int64                       `json:"debt_users"`
	DebtQuota           int64                       `json:"debt_quota"`
	TodayCheckinBonus   int64                       `json:"today_checkin_bonus"`
	TodayCheckinUsers   int64                       `json:"today_checkin_users"`
	DailyPaidUsage      []QuotaLedgerDailyPaidUsage `json:"daily_paid_usage"`
	PaidUsers           []QuotaLedgerPaidUser       `json:"paid_users"`
	Credits             *QuotaLedgerCredits         `json:"credits,omitempty"`
}

// QuotaLedgerCredits reports gross credited quota, not cash received. Refunds
// do not erase the original credit; each source remains separate.
type QuotaLedgerCredits struct {
	ManualPaid           int64 `json:"manual_paid"`
	ManualBonus          int64 `json:"manual_bonus"`
	RedemptionPaid       int64 `json:"redemption_paid"`
	RedemptionBonus      int64 `json:"redemption_bonus"`
	RedemptionIncomplete int64 `json:"redemption_incomplete"`
	RedemptionDeleted    int64 `json:"redemption_deleted"`
	OnlinePaid           int64 `json:"online_paid"`
	OnlineIncomplete     int64 `json:"online_incomplete"`
}

func GetQuotaLedgerCredits(start, end time.Time) (*QuotaLedgerCredits, error) {
	credits := &QuotaLedgerCredits{}
	var manual struct {
		Paid  int64
		Bonus int64
	}
	if err := DB.Model(&FinancialOperation{}).
		Select("COALESCE(SUM(target_paid_delta), 0) AS paid, COALESCE(SUM(target_bonus_delta), 0) AS bonus").
		Where("operation_type = ? AND created_at >= ? AND created_at < ?", FinancialOperationManualCredit, start.Unix(), end.Unix()).
		Scan(&manual).Error; err != nil {
		return nil, err
	}
	credits.ManualPaid, credits.ManualBonus = manual.Paid, manual.Bonus
	var redemption struct {
		Paid       int64
		Bonus      int64
		Incomplete int64
		Deleted    int64
	}
	if err := DB.Unscoped().Model(&Redemption{}).
		Select("COALESCE(SUM(paid_quota), 0) AS paid, COALESCE(SUM(bonus_quota), 0) AS bonus, COALESCE(SUM(CASE WHEN quota IS NULL OR paid_quota IS NULL OR bonus_quota IS NULL OR paid_quota + bonus_quota <> quota THEN 1 ELSE 0 END), 0) AS incomplete, COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS deleted").
		Where("redeemed_time >= ? AND redeemed_time < ? AND used_user_id > ? AND status IN ?", start.Unix(), end.Unix(), 0, []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusRefunded}).
		Scan(&redemption).Error; err != nil {
		return nil, err
	}
	credits.RedemptionPaid, credits.RedemptionBonus, credits.RedemptionIncomplete = redemption.Paid, redemption.Bonus, redemption.Incomplete
	credits.RedemptionDeleted = redemption.Deleted
	var online struct {
		Paid       int64
		Incomplete int64
	}
	if err := DB.Model(&TopUp{}).
		Select("COALESCE(SUM(CASE WHEN source = ? AND credited_quota > 0 THEN credited_quota ELSE 0 END), 0) AS paid, COALESCE(SUM(CASE WHEN source IS NULL OR source <> ? OR credited_quota IS NULL OR credited_quota <= 0 THEN 1 ELSE 0 END), 0) AS incomplete", TopUpSourceTopup, TopUpSourceTopup).
		Where("complete_time >= ? AND complete_time < ? AND status IN ? AND (source = ? OR source = ? OR source IS NULL)", start.Unix(), end.Unix(), []string{common.TopUpStatusSuccess, common.TopUpStatusRefunded}, TopUpSourceTopup, "").
		Scan(&online).Error; err != nil {
		return nil, err
	}
	credits.OnlinePaid, credits.OnlineIncomplete = online.Paid, online.Incomplete
	return credits, nil
}

type QuotaLedgerDailyPaidUsage struct {
	Date      string `json:"date"`
	PaidQuota int64  `json:"paid_quota"`
}

type QuotaLedgerPaidUser struct {
	UserId    int    `json:"user_id"`
	Username  string `json:"username"`
	PaidQuota int64  `json:"paid_quota"`
}

func GetQuotaLedgerPaidUsers(startDate, endDate string) ([]QuotaLedgerPaidUser, error) {
	users := make([]QuotaLedgerPaidUser, 0)
	err := DB.Table("quota_usage_daily AS q").
		Joins("LEFT JOIN users AS u ON u.id = q.user_id").
		Select("q.user_id, COALESCE(u.username, '') AS username, SUM(q.paid_quota) AS paid_quota").
		Where("q.date >= ? AND q.date <= ?", startDate, endDate).
		Group("q.user_id, u.username").
		Having("SUM(q.paid_quota) <> 0").
		Order("paid_quota DESC, q.user_id ASC").Limit(10).Scan(&users).Error
	return users, err
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

// applyQuotaUsageDaily atomically accumulates the daily source totals.
func applyQuotaUsageDaily(userId int, date string, allocation QuotaAllocation) error {
	return applyQuotaUsageDailyTx(DB, userId, date, allocation)
}

func applyQuotaUsageDailyTx(tx *gorm.DB, userId int, date string, allocation QuotaAllocation) error {
	row := QuotaUsageDaily{UserId: userId, Date: date, BonusQuota: allocation.Bonus, PaidQuota: allocation.Paid, UpdatedAt: common.GetTimestamp()}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "date"}},
		DoUpdates: clause.Assignments(map[string]any{
			"bonus_quota": gorm.Expr("? + ?", clause.Column{Table: "quota_usage_daily", Name: "bonus_quota"}, allocation.Bonus),
			"paid_quota":  gorm.Expr("? + ?", clause.Column{Table: "quota_usage_daily", Name: "paid_quota"}, allocation.Paid),
			"updated_at":  common.GetTimestamp(),
		}),
	}).Create(&row).Error
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

type quotaUsageDailyUserSum struct {
	UserId int `gorm:"column:user_id"`
	Bonus  int `gorm:"column:bonus_quota"`
	Paid   int `gorm:"column:paid_quota"`
}

// SumQuotaUsageDailyByUsers 汇总一批用户全时段的付费/福利额度净消耗。
// 用户列表用它一次性取得当页所有用户的实充与赠送累计用量，避免逐行查询。
// 返回的 map 只包含有账单记录的用户，缺失即代表没有消耗。
func SumQuotaUsageDailyByUsers(userIds []int) (map[int]QuotaAllocation, error) {
	if len(userIds) == 0 {
		return map[int]QuotaAllocation{}, nil
	}
	var rows []quotaUsageDailyUserSum
	if err := DB.Table("quota_usage_daily").
		Select("user_id, COALESCE(SUM(bonus_quota), 0) AS bonus_quota, COALESCE(SUM(paid_quota), 0) AS paid_quota").
		Where("user_id IN ?", userIds).
		Group("user_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	usage := make(map[int]QuotaAllocation, len(rows))
	for _, row := range rows {
		usage[row.UserId] = QuotaAllocation{Bonus: row.Bonus, Paid: row.Paid}
	}
	return usage, nil
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
	summary.DailyPaidUsage = make([]QuotaLedgerDailyPaidUsage, 0)
	if err := DB.Model(&QuotaUsageDaily{}).
		Select("date, COALESCE(SUM(paid_quota), 0) AS paid_quota").
		Where("date >= ? AND date <= ?", startDate, endDate).
		Group("date").Order("date ASC").Scan(&summary.DailyPaidUsage).Error; err != nil {
		return nil, err
	}
	row = DB.Table("checkins").
		Select("COALESCE(SUM(quota_awarded), 0), COUNT(*)").
		Where("checkin_date = ?", time.Now().Format("2006-01-02")).
		Row()
	if err := row.Scan(&summary.TodayCheckinBonus, &summary.TodayCheckinUsers); err != nil {
		return nil, err
	}
	return summary, nil
}
