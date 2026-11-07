package model

import (
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestDailyEggSettingsValidation(t *testing.T) {
	valid := `{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"first","name":"First","quota":100,"quantity":1,"probability":10000}]}`
	_, err := ParseDailyEggSetting(valid)
	require.NoError(t, err)
	for _, value := range []string{
		`{"enabled":true,"min_spend_cny":2.501,"egg_count":3,"prizes":[]}`,
		`{"enabled":true,"min_spend_cny":2.5,"egg_count":1,"prizes":[]}`,
		`{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"A","name":"First","quota":100,"quantity":1,"probability":10000}]}`,
		`{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"a","name":"First","quota":100,"quantity":0,"probability":10000}]}`,
		`{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"a","name":"First","quota":100,"quantity":1,"probability":8000},{"id":"b","name":"Second","quota":100,"quantity":1,"probability":3000}]}`,
	} {
		_, err := ParseDailyEggSetting(value)
		assert.Error(t, err)
	}
}

func TestDailyEggDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			databaseType := common.DatabaseTypeSQLite
			switch dialect {
			case "sqlite":
				driver = sqlite.Open("file:daily_egg_matrix?mode=memory&cache=shared&_pragma=busy_timeout(5000)")
			case "mysql":
				dsn := os.Getenv("TEST_DAILY_EGG_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_DAILY_EGG_MYSQL_DSN not configured")
				}
				driver, databaseType = mysql.Open(dsn), common.DatabaseTypeMySQL
			case "postgres":
				dsn := os.Getenv("TEST_DAILY_EGG_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_DAILY_EGG_POSTGRES_DSN not configured")
				}
				driver, databaseType = postgres.Open(dsn), common.DatabaseTypePostgreSQL
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(8)
			for _, table := range []any{&DailyEggDraw{}, &DailyEggInventory{}, &Option{}, &User{}, &RequestBilling{}, &Task{}} {
				require.False(t, db.Migrator().HasTable(table), "test requires an empty database")
			}
			oldDB, oldMain, oldLog := DB, common.MainDatabaseType(), common.LogDatabaseType()
			DB = db
			common.SetDatabaseTypes(databaseType, databaseType)
			initCol()
			t.Cleanup(func() {
				DB = oldDB
				common.SetDatabaseTypes(oldMain, oldLog)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&Option{}, &User{}, &RequestBilling{}, &Task{}, &DailyEggDraw{}, &DailyEggInventory{}))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&DailyEggInventory{}, &DailyEggDraw{}, &Task{}, &RequestBilling{}, &User{}, &Option{}))
			})
			require.NoError(t, db.AutoMigrate(&Option{}, &User{}, &RequestBilling{}, &Task{}, &DailyEggDraw{}, &DailyEggInventory{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.NoError(t, db.Create(&[]Option{
				{Key: "USDExchangeRate", Value: "5"},
				{Key: "QuotaPerUnit", Value: "500000"},
				{Key: DailyEggSettingOption, Value: `{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"first","name":"First","quota":100,"quantity":1,"probability":10000}]}`},
			}).Error)
			now := UsageReportNow()
			users := make([]User, 3)
			for index := range users {
				users[index] = User{Username: "egg-user-" + string(rune('a'+index)), Password: "hash", AffCode: "egg-" + string(rune('a'+index)), Quota: 1000}
				require.NoError(t, db.Create(&users[index]).Error)
				require.NoError(t, db.Create(&RequestBilling{
					Id: users[index].Username, UserId: users[index].Id, Quota: 250000,
					Settled: true, CreatedAt: now.Unix(),
				}).Error)
			}
			require.NoError(t, db.Model(&RequestBilling{}).Where("id = ?", users[0].Username).Update("refunded_quota", 1).Error)
			status, err := GetDailyEggStatus(users[0].Id)
			require.NoError(t, err)
			assert.False(t, status.Eligible)
			_, err = OpenDailyEgg(users[0].Id, 1)
			require.ErrorIs(t, err, errDailyEggSpend)
			require.NoError(t, db.Model(&RequestBilling{}).Where("id = ?", users[0].Username).Update("refunded_quota", 0).Error)

			var wg sync.WaitGroup
			type drawResult struct {
				userID int
				draw   *DailyEggDraw
				err    error
			}
			results := make(chan drawResult, len(users))
			for _, user := range users {
				wg.Go(func() {
					draw, err := OpenDailyEgg(user.Id, 1)
					results <- drawResult{user.Id, draw, err}
				})
			}
			wg.Wait()
			close(results)
			winners := 0
			for result := range results {
				if result.err != nil {
					require.True(t, dialect == "sqlite" && strings.Contains(result.err.Error(), "locked"), "unexpected draw error: %v", result.err)
					result.draw, result.err = OpenDailyEgg(result.userID, 1)
					require.NoError(t, result.err)
				}
				if result.draw.Quota > 0 {
					winners++
				}
			}
			assert.Equal(t, 1, winners)
			var inventory DailyEggInventory
			require.NoError(t, db.First(&inventory, "day = ? AND prize_id = ?", now.Format("2006-01-02"), "first").Error)
			assert.Equal(t, 1, inventory.Count)
			var count int64
			require.NoError(t, db.Model(&DailyEggDraw{}).Where("quota > 0").Count(&count).Error)
			assert.EqualValues(t, 1, count)
			for _, user := range users {
				var draw DailyEggDraw
				err := db.Where("user_id = ?", user.Id).First(&draw).Error
				if err == nil {
					_, duplicateErr := OpenDailyEgg(user.Id, 2)
					require.ErrorIs(t, duplicateErr, errDailyEggDrawn)
				}
			}
			var winner DailyEggDraw
			require.NoError(t, db.Where("quota > 0").First(&winner).Error)
			var credited User
			require.NoError(t, db.First(&credited, winner.UserID).Error)
			assert.Equal(t, 1100, credited.Quota)
			assert.Equal(t, 100, credited.BonusQuota)
			assert.Equal(t, 1000, credited.PaidQuota)

			concurrentUser := User{Username: "egg-concurrent", Password: "hash", AffCode: "egg-concurrent"}
			require.NoError(t, db.Create(&concurrentUser).Error)
			require.NoError(t, db.Create(&RequestBilling{Id: "egg-concurrent", UserId: concurrentUser.Id, Quota: 250000, Settled: true, CreatedAt: now.Unix()}).Error)
			sameUserResults := make(chan error, 2)
			for range 2 {
				wg.Go(func() {
					_, err := OpenDailyEgg(concurrentUser.Id, 1)
					sameUserResults <- err
				})
			}
			wg.Wait()
			close(sameUserResults)
			for err := range sameUserResults {
				if err != nil && dialect == "sqlite" && strings.Contains(err.Error(), "locked") {
					_, err = OpenDailyEgg(concurrentUser.Id, 1)
				}
				assert.True(t, err == nil || errors.Is(err, errDailyEggDrawn), "unexpected draw error: %v", err)
			}
			require.NoError(t, db.Model(&DailyEggDraw{}).Where("user_id = ?", concurrentUser.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)

			limitUser := User{Username: "egg-limit", Password: "hash", AffCode: "egg-limit", Quota: common.MaxWalletQuota}
			require.NoError(t, db.Create(&limitUser).Error)
			require.NoError(t, db.Create(&RequestBilling{Id: "egg-limit", UserId: limitUser.Id, Quota: 250000, Settled: true, CreatedAt: now.Unix()}).Error)
			require.NoError(t, db.Model(&Option{}).Where(commonKeyCol+" = ?", DailyEggSettingOption).Update("value", `{"enabled":true,"min_spend_cny":2.5,"egg_count":3,"prizes":[{"id":"first","name":"First","quota":100,"quantity":2,"probability":10000}]}`).Error)
			_, err = OpenDailyEgg(limitUser.Id, 1)
			require.Error(t, err)
			require.NoError(t, db.First(&inventory, "day = ? AND prize_id = ?", now.Format("2006-01-02"), "first").Error)
			assert.Equal(t, 1, inventory.Count)
			require.NoError(t, db.Model(&DailyEggDraw{}).Where("user_id = ?", limitUser.Id).Count(&count).Error)
			assert.Zero(t, count)

			tomorrow := now.AddDate(0, 0, 1)
			spend, eligible, err := dailyEggSpend(db, users[0].Id, tomorrow, 2.5)
			require.NoError(t, err)
			assert.False(t, eligible)
			assert.True(t, spend.IsZero())

			taskUser := User{Username: "egg-task", Password: "hash", AffCode: "egg-task"}
			require.NoError(t, db.Create(&taskUser).Error)
			task := Task{TaskID: "egg-task-id", UserId: taskUser.Id, ChannelId: 7, Quota: 250000, Status: TaskStatusInProgress}
			require.NoError(t, db.Create(&task).Error)
			taskBilling := RequestBilling{Id: "egg-task-billing", UserId: taskUser.Id, TaskId: task.TaskID, ChannelId: 7, Quota: task.Quota, UsageRecorded: true, CreatedAt: now.Unix()}
			require.NoError(t, db.Create(&taskBilling).Error)
			spend, eligible, err = dailyEggSpend(db, taskUser.Id, now, 2.5)
			require.NoError(t, err)
			assert.False(t, eligible)
			assert.True(t, spend.IsZero())
			require.NoError(t, db.Model(&task).Update("status", TaskStatusSuccess).Error)
			spend, eligible, err = dailyEggSpend(db, taskUser.Id, now, 2.5)
			require.NoError(t, err)
			assert.True(t, eligible)
			assert.Equal(t, "2.5", spend.String())
			require.NoError(t, db.Model(&task).Update("quota", task.Quota-1).Error)
			_, eligible, err = dailyEggSpend(db, taskUser.Id, now, 2.5)
			require.NoError(t, err)
			assert.False(t, eligible)
		})
	}
}
