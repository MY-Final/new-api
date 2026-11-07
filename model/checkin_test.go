package model

import (
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func enableCheckinForTest(t *testing.T, minQuota, maxQuota int) {
	t.Helper()
	setting := operation_setting.GetCheckinSetting()
	previous := *setting
	setting.Enabled = true
	setting.MinQuota = minQuota
	setting.MaxQuota = maxQuota
	t.Cleanup(func() { *setting = previous })
}

func TestCheckinStatsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open("file:checkin_stats_test?mode=memory&cache=shared")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			oldDB := DB
			table := "checkin_stats_test_" + common.GetRandomString(8)
			DB = db.Table(table).Session(&gorm.Session{})
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(table))
				DB = oldDB
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, DB.AutoMigrate(&Checkin{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)

			today := UsageReportNow()
			for _, daysAgo := range []int{1, 2, 4} {
				require.NoError(t, DB.Create(&Checkin{UserId: 1, CheckinDate: today.AddDate(0, 0, -daysAgo).Format("2006-01-02"), QuotaAwarded: 100}).Error)
			}
			stats, err := GetUserCheckinStats(1, today.Format("2006-01"))
			require.NoError(t, err)
			assert.False(t, stats["checked_in_today"].(bool))
			assert.Equal(t, 2, stats["current_streak"])
			assert.EqualValues(t, 300, stats["total_quota"])

			require.NoError(t, DB.Create(&Checkin{UserId: 1, CheckinDate: today.Format("2006-01-02"), QuotaAwarded: 50}).Error)
			stats, err = GetUserCheckinStats(1, today.Format("2006-01"))
			require.NoError(t, err)
			assert.True(t, stats["checked_in_today"].(bool))
			assert.Equal(t, 3, stats["current_streak"])
			assert.Equal(t, today.Format("2006-01-02"), stats["today"])
		})
	}
}

func TestUserCheckinAwardsBonusQuota(t *testing.T) {
	truncateTables(t)
	enableCheckinForTest(t, 100, 100)

	user := User{Username: "checkin-" + common.GetRandomString(8), Password: "hash", Quota: 0}
	require.NoError(t, DB.Create(&user).Error)

	checkin, err := UserCheckin(user.Id)
	require.NoError(t, err)
	require.Equal(t, 100, checkin.QuotaAwarded)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 100, got.Quota)
	require.Equal(t, 100, got.BonusQuota)
	require.Equal(t, 0, got.PaidQuota)

	_, err = UserCheckin(user.Id)
	require.Error(t, err)
}

func TestUserCheckinTransactionNormalizesLegacyWallet(t *testing.T) {
	truncateTables(t)

	user := User{Username: "checkin-legacy-" + common.GetRandomString(8), Password: "hash", Quota: 1000}
	require.NoError(t, DB.Create(&user).Error)

	checkin := &Checkin{
		UserId:       user.Id,
		CheckinDate:  time.Now().Format("2006-01-02"),
		QuotaAwarded: 100,
		CreatedAt:    time.Now().Unix(),
	}
	_, err := userCheckinWithTransaction(checkin, user.Id, checkin.QuotaAwarded)
	require.NoError(t, err)

	var got User
	require.NoError(t, DB.First(&got, user.Id).Error)
	require.Equal(t, 1100, got.Quota)
	require.Equal(t, 100, got.BonusQuota)
	require.Equal(t, 1000, got.PaidQuota)
	require.Equal(t, got.Quota, got.BonusQuota+got.PaidQuota)
}
