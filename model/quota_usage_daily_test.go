package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuotaUsageDailyAggregatesSignedDeltas(t *testing.T) {
	truncateTables(t)
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	require.NoError(t, applyQuotaUsageDaily(1, today, QuotaAllocation{Bonus: 100, Paid: 50}))
	require.NoError(t, applyQuotaUsageDaily(1, today, QuotaAllocation{Bonus: -20, Paid: -10}))
	require.NoError(t, applyQuotaUsageDaily(1, yesterday, QuotaAllocation{Paid: 7}))
	require.NoError(t, applyQuotaUsageDaily(2, today, QuotaAllocation{Paid: 30}))

	items, total, err := ListQuotaUsageDaily(today, today, "", &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	assert.Len(t, items, 2)

	bonus, paid, err := SumQuotaUsageDaily(today, today, "")
	require.NoError(t, err)
	assert.EqualValues(t, 80, bonus)
	assert.EqualValues(t, 70, paid)

	bonus, paid, err = SumQuotaUsageDaily(yesterday, yesterday, "")
	require.NoError(t, err)
	assert.EqualValues(t, 0, bonus)
	assert.EqualValues(t, 7, paid)
}

func TestQuotaUsageDailyFollowsWalletConsumptionAndRefund(t *testing.T) {
	truncateTables(t)
	user := User{Username: "ledger-consume-" + common.GetRandomString(8), Password: "hash", Quota: 300, BonusQuota: 100, PaidQuota: 200}
	require.NoError(t, DB.Create(&user).Error)

	reserved, allocation, err := TryReserveUserQuotaAllocation(user.Id, 120)
	require.NoError(t, err)
	require.True(t, reserved)
	require.Equal(t, QuotaAllocation{Bonus: 100, Paid: 20}, allocation)

	today := time.Now().Format("2006-01-02")
	var row QuotaUsageDaily
	require.NoError(t, DB.Where("user_id = ? AND date = ?", user.Id, today).First(&row).Error)
	assert.Equal(t, 100, row.BonusQuota)
	assert.Equal(t, 20, row.PaidQuota)

	require.NoError(t, AdjustUserQuotaAllocation(user.Id, QuotaAllocation{Paid: 20}, false))
	require.NoError(t, DB.Where("user_id = ? AND date = ?", user.Id, today).First(&row).Error)
	assert.Equal(t, 100, row.BonusQuota)
	assert.Equal(t, 0, row.PaidQuota)

	items, _, err := ListQuotaUsageDaily(today, today, user.Username, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, user.Username, items[0].Username)
}

func TestRecordQuotaUsageFlushesBatchStore(t *testing.T) {
	truncateTables(t)
	previousBatch := common.BatchUpdateEnabled
	common.BatchUpdateEnabled = true
	t.Cleanup(func() { common.BatchUpdateEnabled = previousBatch })

	today := time.Now().Format("2006-01-02")
	RecordQuotaUsage(42, QuotaAllocation{Bonus: 5, Paid: 3})
	RecordQuotaUsage(42, QuotaAllocation{Bonus: 1})
	flushQuotaUsageDaily()

	var row QuotaUsageDaily
	require.NoError(t, DB.Where("user_id = ? AND date = ?", 42, today).First(&row).Error)
	assert.Equal(t, 6, row.BonusQuota)
	assert.Equal(t, 3, row.PaidQuota)
}

func TestGetQuotaLedgerSummary(t *testing.T) {
	truncateTables(t)
	today := time.Now().Format("2006-01-02")
	activeUser := User{Username: "ledger-summary-active", Password: "hash", AffCode: "ledger-summary-active-code", Quota: 100, BonusQuota: 40, PaidQuota: 60, UsedQuota: 900}
	debtUser := User{Username: "ledger-summary-debt", Password: "hash", AffCode: "ledger-summary-debt-code", Quota: -30, BonusQuota: 0, PaidQuota: -30, UsedQuota: 500}
	require.NoError(t, DB.Create(&activeUser).Error)
	require.NoError(t, DB.Create(&debtUser).Error)
	require.NoError(t, DB.Create(&Checkin{
		UserId:       activeUser.Id,
		CheckinDate:  today,
		QuotaAwarded: 123,
		CreatedAt:    common.GetTimestamp(),
	}).Error)
	require.NoError(t, applyQuotaUsageDaily(activeUser.Id, today, QuotaAllocation{Bonus: 10, Paid: 5}))
	require.NoError(t, applyQuotaUsageDaily(debtUser.Id, today, QuotaAllocation{Paid: 2}))

	summary, err := GetQuotaLedgerSummary(today, today)
	require.NoError(t, err)
	assert.EqualValues(t, 1400, summary.TotalConsumedQuota)
	assert.EqualValues(t, 70, summary.RemainingQuota)
	assert.EqualValues(t, 40, summary.RemainingBonusQuota)
	assert.EqualValues(t, 30, summary.RemainingPaidQuota)
	assert.EqualValues(t, 10, summary.RangeBonusQuota)
	assert.EqualValues(t, 7, summary.RangePaidQuota)
	assert.EqualValues(t, 17, summary.RangeQuota)
	assert.EqualValues(t, 1, summary.DebtUsers)
	assert.EqualValues(t, -30, summary.DebtQuota)
	assert.EqualValues(t, 123, summary.TodayCheckinBonus)
	assert.EqualValues(t, 1, summary.TodayCheckinUsers)
}
