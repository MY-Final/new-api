package model

import (
	"os"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestFreeGroupDailyLimitDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open("file:free_group_test?mode=memory&cache=shared")
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "free_group_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			if dialect != "sqlite" {
				sqlDB.SetMaxOpenConns(8)
			}
			oldDB := DB
			DB = db
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&FreeGroupDailyUsage{}))
				DB = oldDB
				require.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.Migrator().DropTable(&FreeGroupDailyUsage{}))
			require.NoError(t, db.AutoMigrate(&FreeGroupDailyUsage{}))
			require.NoError(t, db.AutoMigrate(&FreeGroupDailyUsage{}))
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)

			now := time.Date(2026, 11, 6, 15, 59, 0, 0, time.UTC)
			allowed, err := ReserveFreeGroupDailyCall(now, 1, 2, 1)
			require.NoError(t, err)
			assert.True(t, allowed)
			allowed, err = ReserveFreeGroupDailyCall(now, 1, 2, 1)
			require.NoError(t, err)
			assert.False(t, allowed)
			allowed, err = ReserveFreeGroupDailyCall(now, 2, 2, 1)
			require.NoError(t, err)
			assert.True(t, allowed, "a rejected personal reservation must not consume a global slot")
			allowed, err = ReserveFreeGroupDailyCall(now, 3, 2, 1)
			require.NoError(t, err)
			assert.False(t, allowed)
			allowed, err = ReserveFreeGroupDailyCall(now.Add(time.Minute), 1, 2, 1)
			require.NoError(t, err)
			assert.True(t, allowed, "the limit resets at midnight UTC+8")

			// Turning on the personal limit must include calls made earlier
			// while the personal limit was disabled.
			allowed, err = ReserveFreeGroupDailyCall(now.Add(72*time.Hour), 1, 10, 0)
			require.NoError(t, err)
			assert.True(t, allowed)
			allowed, err = ReserveFreeGroupDailyCall(now.Add(72*time.Hour), 1, 10, 1)
			require.NoError(t, err)
			assert.False(t, allowed)

			var wg sync.WaitGroup
			results := make(chan bool, 8)
			errors := make(chan error, 8)
			for id := range 8 {
				wg.Go(func() {
					ok, err := ReserveFreeGroupDailyCall(now.Add(48*time.Hour), id+1, 3, 0)
					results <- ok
					errors <- err
				})
			}
			wg.Wait()
			close(results)
			close(errors)
			for err := range errors {
				require.NoError(t, err)
			}
			count := 0
			for ok := range results {
				if ok {
					count++
				}
			}
			assert.Equal(t, 3, count)
		})
	}
}
