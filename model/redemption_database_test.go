package model

import (
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBatchRedemptionOperationsConfiguredDatabases(t *testing.T) {
	tests := []struct {
		name      string
		env       string
		dbType    common.DatabaseType
		dialector func(string) gorm.Dialector
	}{
		{
			name:      "sqlite",
			dbType:    common.DatabaseTypeSQLite,
			dialector: func(dsn string) gorm.Dialector { return sqlite.Open(dsn) },
		},
		{
			name:   "mysql",
			env:    "TEST_MYSQL_DSN",
			dbType: common.DatabaseTypeMySQL,
			dialector: func(dsn string) gorm.Dialector {
				return mysql.Open(dsn)
			},
		},
		{
			name:   "postgres",
			env:    "TEST_POSTGRES_DSN",
			dbType: common.DatabaseTypePostgreSQL,
			dialector: func(dsn string) gorm.Dialector {
				return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			dsn := ":memory:"
			if testCase.env != "" {
				dsn = strings.TrimSpace(os.Getenv(testCase.env))
				if dsn == "" {
					t.Skip(testCase.env + " is not configured")
				}
			}

			db, err := gorm.Open(testCase.dialector(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)

			previousDB := DB
			previousMainType := common.MainDatabaseType()
			previousLogType := common.LogDatabaseType()
			t.Cleanup(func() {
				DB = previousDB
				common.SetDatabaseTypes(previousMainType, previousLogType)
				require.NoError(t, sqlDB.Close())
			})
			DB = db
			common.SetDatabaseTypes(testCase.dbType, testCase.dbType)

			require.NoError(t, DB.AutoMigrate(&Redemption{}))
			t.Cleanup(func() {
				require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
			})

			redemption := &Redemption{
				Name:   "database-batch",
				Key:    "database-batch-code-" + testCase.name,
				Quota:  100,
				Status: common.RedemptionCodeStatusEnabled,
				Type:   RedemptionTypeReward,
			}
			require.NoError(t, DB.Create(redemption).Error)

			name := "database-updated"
			quota := 300
			count, err := BatchUpdateRedemptions([]int{redemption.Id, redemption.Id}, &name, nil, &quota, nil)
			require.NoError(t, err)
			assert.Equal(t, 1, count)

			deleted, err := BatchDeleteRedemptions([]int{redemption.Id})
			require.NoError(t, err)
			assert.Equal(t, 1, deleted)
		})
	}
}
