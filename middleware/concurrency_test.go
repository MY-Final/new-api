/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
package middleware

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupConcurrencyAdmissionDB(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousDatabaseTypes := [2]common.DatabaseType{
		common.MainDatabaseType(),
		common.LogDatabaseType(),
	}
	previousRedisEnabled, previousRedis := common.RedisEnabled, common.RDB
	common.RedisEnabled = false
	common.RDB = nil
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)

	dsn := fmt.Sprintf(
		"file:%s?mode=memory&cache=shared",
		strings.ReplaceAll(t.Name(), "/", "_"),
	)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.UserSubscription{},
		&model.UserSubscriptionRouteGroup{},
		&model.Task{},
	))
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousDatabaseTypes[0], previousDatabaseTypes[1])
		common.RedisEnabled, common.RDB = previousRedisEnabled, previousRedis
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func concurrencyAdmissionContext(userID int, tokenID int, tokenLimit int, userLimit int, group string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	c.Request = c.Request.WithContext(c.Request.Context())
	c.Set("id", userID)
	c.Set("token_id", tokenID)
	c.Set("token_max_concurrency", tokenLimit)
	c.Set("user_max_concurrency", userLimit)
	c.Set(common.RequestIdKey, common.NewRequestId())
	common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
	return c
}

func TestConcurrencyAdmissionEnforcesAccountTokenAndSubscriptionScopes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupConcurrencyAdmissionDB(t)
	user := model.User{
		Username: "concurrency-admission-user",
		Password: "unused-password-hash",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "vip",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	subscription := model.UserSubscription{
		UserId:         user.Id,
		PlanId:         1,
		Status:         "active",
		StartTime:      time.Now().Unix(),
		EndTime:        time.Now().Add(time.Hour).Unix(),
		UpgradeGroup:   "vip",
		MaxConcurrency: 1,
	}
	require.NoError(t, model.DB.Create(&subscription).Error)
	require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscription.Id, []string{"deepseek-a", "deepseek-b"}))

	t.Run("different API keys and route groups share subscription concurrency", func(t *testing.T) {
		first := concurrencyAdmissionContext(user.Id, 11, 0, 0, "deepseek-a")
		second := concurrencyAdmissionContext(user.Id, 12, 0, 0, "deepseek-b")
		release, apiErr := AcquireRequestConcurrency(first)
		require.Nil(t, apiErr)
		t.Cleanup(release)

		_, apiErr = AcquireRequestConcurrency(second)
		require.NotNil(t, apiErr)
		assert.Equal(t, 429, apiErr.StatusCode)
		assert.Equal(t, types.ErrorCodeRateLimitExceeded, apiErr.GetErrorCode())
		assert.NotEmpty(t, second.Writer.Header().Get("Retry-After"))
	})

	t.Run("different API keys cannot bypass a user concurrency limit", func(t *testing.T) {
		first := concurrencyAdmissionContext(user.Id, 21, 0, 1, "standard")
		second := concurrencyAdmissionContext(user.Id, 22, 0, 1, "standard")
		release, apiErr := AcquireRequestConcurrency(first)
		require.Nil(t, apiErr)
		t.Cleanup(release)

		_, apiErr = AcquireRequestConcurrency(second)
		require.NotNil(t, apiErr)
		assert.Equal(t, 429, apiErr.StatusCode)
	})

	t.Run("a single API key remains independently limited", func(t *testing.T) {
		first := concurrencyAdmissionContext(user.Id, 31, 1, 0, "standard")
		second := concurrencyAdmissionContext(user.Id, 31, 1, 0, "standard")
		release, apiErr := AcquireRequestConcurrency(first)
		require.Nil(t, apiErr)
		t.Cleanup(release)

		_, apiErr = AcquireRequestConcurrency(second)
		require.NotNil(t, apiErr)
		assert.Equal(t, 429, apiErr.StatusCode)
	})
}

func TestRetryIntoSubscriptionGroupMustAcquireItsCapacity(t *testing.T) {
	setupConcurrencyAdmissionDB(t)
	user := model.User{Username: "retry-concurrency-user", Group: "default", Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&user).Error)
	subscription := model.UserSubscription{UserId: user.Id, Status: "active", EndTime: time.Now().Add(time.Hour).Unix(), MaxConcurrency: 1}
	require.NoError(t, model.DB.Create(&subscription).Error)
	require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscription.Id, []string{"deepseek-a"}))
	first := concurrencyAdmissionContext(user.Id, 11, 0, 0, "paid")
	releaseFirst, apiErr := AcquireRequestConcurrency(first)
	require.Nil(t, apiErr)
	t.Cleanup(releaseFirst)
	occupied := concurrencyAdmissionContext(user.Id, 12, 0, 0, "deepseek-a")
	releaseOccupied, apiErr := AcquireRequestConcurrency(occupied)
	require.Nil(t, apiErr)
	t.Cleanup(releaseOccupied)
	common.SetContextKey(first, constant.ContextKeyUsingGroup, "auto")
	common.SetContextKey(first, constant.ContextKeyAutoGroup, "deepseek-a")
	apiErr = RecheckRequestConcurrency(first)
	require.NotNil(t, apiErr)
	assert.Equal(t, 429, apiErr.StatusCode)
	releaseOccupied()
	require.Nil(t, RecheckRequestConcurrency(first))
	require.Nil(t, RecheckRequestConcurrency(first), "retries must not count the same request twice")
	third := concurrencyAdmissionContext(user.Id, 13, 0, 0, "deepseek-a")
	_, apiErr = AcquireRequestConcurrency(third)
	require.NotNil(t, apiErr)
	assert.Equal(t, 429, apiErr.StatusCode)
}

func TestLostConcurrencyLeaseCancelsTheUpstreamContextAndTransport(t *testing.T) {
	setupConcurrencyAdmissionDB(t)
	c := concurrencyAdmissionContext(901, 1, 0, 1, "paid")
	transportClosed := make(chan struct{})
	SetConcurrencyCancellation(c, func() { close(transportClosed) })
	release, apiErr := AcquireRequestConcurrency(c)
	require.Nil(t, apiErr)
	t.Cleanup(release)
	leaseValue, exists := c.Get(concurrency.ContextKeyLease)
	require.True(t, exists)
	require.NoError(t, concurrency.Release(context.Background(), leaseValue.(concurrency.Lease)))
	assert.False(t, CurrentRequestConcurrency(c).refresh())
	assert.ErrorIs(t, context.Cause(c.Request.Context()), concurrency.ErrLeaseLost)
	select {
	case <-transportClosed:
	case <-time.After(time.Second):
		t.Fatal("losing concurrency protection did not close the transport")
	}
}

func TestAdmissionRestoresDurableTaskCapacityBeforeAcceptingNewWork(t *testing.T) {
	setupConcurrencyAdmissionDB(t)
	lease := concurrency.Lease{Owner: "durable-task-owner", Scopes: []concurrency.Scope{{Name: "user:902", Limit: 1}}}
	task := model.Task{TaskID: "durable-concurrency-task", UserId: 902, Status: model.TaskStatusSubmitted,
		PrivateData: model.TaskPrivateData{ConcurrencyLeaseOwner: lease.Owner, ConcurrencyScopes: concurrency.ScopeFromLease(lease)}}
	require.NoError(t, model.DB.Create(&task).Error)
	c := concurrencyAdmissionContext(902, 1, 0, 1, "paid")
	_, apiErr := AcquireRequestConcurrency(c)
	require.NotNil(t, apiErr)
	assert.Equal(t, 429, apiErr.StatusCode)
	require.NoError(t, model.DB.Model(&task).Update("status", model.TaskStatusSuccess).Error)
	require.NoError(t, concurrency.Release(context.Background(), lease))
	next := concurrencyAdmissionContext(902, 1, 0, 1, "paid")
	release, apiErr := AcquireRequestConcurrency(next)
	require.Nil(t, apiErr)
	t.Cleanup(release)
}
