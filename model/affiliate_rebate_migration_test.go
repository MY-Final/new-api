package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type legacyAffiliateRebateMigration struct {
	Id          int    `gorm:"primaryKey"`
	SourceKey   string `gorm:"type:varchar(255);uniqueIndex"`
	RebateQuota int    `gorm:"type:bigint"`
}

func testAffiliateRebateMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	tableName := fmt.Sprintf("affiliate_rebate_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })

	require.NoError(t, db.Table(tableName).AutoMigrate(&legacyAffiliateRebateMigration{}))
	require.NoError(t, db.Table(tableName).Create(&legacyAffiliateRebateMigration{
		Id:          1,
		SourceKey:   "topup:legacy",
		RebateQuota: 100,
	}).Error)

	require.NoError(t, db.Table(tableName).AutoMigrate(&AffiliateRebate{}))
	var rebate AffiliateRebate
	require.NoError(t, db.Table(tableName).Where("source_key = ?", "topup:legacy").First(&rebate).Error)
	assert.Equal(t, 100, rebate.RebateQuota)
	assert.Zero(t, rebate.DebtOffsetQuota)

	require.NoError(t, db.Table(tableName).AutoMigrate(&AffiliateRebate{}))
	var migrated AffiliateRebate
	require.NoError(t, db.Table(tableName).Where("source_key = ?", "topup:legacy").First(&migrated).Error)
	assert.Equal(t, rebate.RebateQuota, migrated.RebateQuota)
	assert.Zero(t, migrated.DebtOffsetQuota)
}

func TestAffiliateRebateMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testAffiliateRebateMigration(t, db)
}

func TestAffiliateRebateMigrationConfiguredDatabases(t *testing.T) {
	tests := []struct {
		name      string
		env       string
		dialector func(string) gorm.Dialector
	}{
		{name: "mysql", env: "TEST_MYSQL_DSN", dialector: func(dsn string) gorm.Dialector { return mysql.Open(dsn) }},
		{name: "postgres", env: "TEST_POSTGRES_DSN", dialector: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := strings.TrimSpace(os.Getenv(test.env))
			if dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			db, err := gorm.Open(test.dialector(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			testAffiliateRebateMigration(t, db)
		})
	}
}
