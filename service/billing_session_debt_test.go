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

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewBillingSessionRejectsNegativeWalletBalance(t *testing.T) {
	truncate(t)
	const userID = 901
	seedUser(t, userID, -1)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId:       userID,
		IsPlayground: true,
		UserSetting: dto.UserSetting{
			BillingPreference: "wallet_only",
		},
	}

	session, apiErr := NewBillingSession(ctx, relayInfo, 1)
	require.Nil(t, session)
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	assert.Equal(t, -1, getUserQuota(t, userID))
}

func TestNewBillingSessionDoesNotBypassDebtThroughSubscriptionFallback(t *testing.T) {
	truncate(t)
	const userID = 902
	seedUser(t, userID, -1)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId:       userID,
		IsPlayground: true,
		UserSetting: dto.UserSetting{
			BillingPreference: "wallet_first",
		},
	}

	session, apiErr := NewBillingSession(ctx, relayInfo, 1)
	require.Nil(t, session)
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	assert.Contains(t, apiErr.Error(), "欠款")
}

func TestNewBillingSessionUsesResolvedAutoGroupForSubscription(t *testing.T) {
	truncate(t)
	const userID = 903
	seedUser(t, userID, 0)

	plan := model.SubscriptionPlan{
		Id:            903,
		Title:         "Auto group plan",
		Currency:      "CNY",
		DurationUnit:  model.SubscriptionDurationDay,
		DurationValue: 1,
		UpgradeGroup:  "vip",
		Enabled:       true,
	}
	require.NoError(t, model.DB.Create(&plan).Error)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", userID).Update("group", "vip").Error)
	now := time.Now().Unix()
	subscription := model.UserSubscription{
		UserId:       userID,
		PlanId:       plan.Id,
		Status:       "active",
		StartTime:    now,
		EndTime:      now + 3600,
		UpgradeGroup: "vip",
	}
	require.NoError(t, model.DB.Create(&subscription).Error)
	require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscription.Id, []string{"vip"}))

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(ctx, constant.ContextKeyAutoGroup, "vip")
	relayInfo := &relaycommon.RelayInfo{
		UserId:       userID,
		RequestId:    "auto-group-subscription-request",
		IsPlayground: true,
		UsingGroup:   "auto",
		UserSetting: dto.UserSetting{
			BillingPreference: "subscription_only",
		},
	}

	session, apiErr := NewBillingSession(ctx, relayInfo, 7)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	subscriptionFunding, ok := session.funding.(*SubscriptionFunding)
	require.True(t, ok)
	assert.Equal(t, "vip", subscriptionFunding.usingGroup)

	var record model.SubscriptionPreConsumeRecord
	require.NoError(t, model.DB.Where("request_id = ?", relayInfo.RequestId).First(&record).Error)
	assert.EqualValues(t, 7, record.UsageQuota)
}

func TestNewBillingSessionHonorsPackageWalletPreference(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for index, preference := range []string{"wallet_only", "wallet_first", "subscription_first"} {
		t.Run(preference, func(t *testing.T) {
			truncate(t)
			userID := 910 + index
			seedUser(t, userID, 1000)
			now := time.Now().Unix()
			plan := model.SubscriptionPlan{
				Id:            905 + index,
				Title:         "DeepSeek one-day card",
				Currency:      "CNY",
				DurationUnit:  model.SubscriptionDurationDay,
				DurationValue: 1,
				UpgradeGroup:  "deepseek-day",
				Enabled:       true,
			}
			require.NoError(t, model.DB.Create(&plan).Error)
			subscription := model.UserSubscription{
				UserId:              userID,
				PlanId:              plan.Id,
				Status:              "active",
				StartTime:           now,
				EndTime:             now + 3600,
				UpgradeGroup:        "deepseek-day",
				AllowWalletOverflow: true,
			}
			require.NoError(t, model.DB.Create(&subscription).Error)
			require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscription.Id, []string{"deepseek-a"}))

			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			relayInfo := &relaycommon.RelayInfo{
				UserId:       userID,
				RequestId:    "package-group-" + preference,
				IsPlayground: true,
				UsingGroup:   "deepseek-a",
				UserSetting: dto.UserSetting{
					BillingPreference: preference,
				},
			}

			session, apiErr := NewBillingSession(ctx, relayInfo, 50)
			require.Nil(t, apiErr)
			require.NotNil(t, session)
			require.NoError(t, session.Settle(70))
			if preference == "subscription_first" {
				assert.Equal(t, BillingSourceSubscription, session.funding.Source())
				assert.Equal(t, 1000, getUserQuota(t, userID))
				var record model.SubscriptionPreConsumeRecord
				require.NoError(t, model.DB.Where("request_id = ?", relayInfo.RequestId).First(&record).Error)
				assert.EqualValues(t, 70, record.UsageQuota)
				return
			}
			assert.Equal(t, BillingSourceWallet, session.funding.Source())
			assert.Equal(t, 930, getUserQuota(t, userID))
		})
	}
}

func TestNewBillingSessionUsesWalletOutsidePackageRoutes(t *testing.T) {
	truncate(t)
	const userID = 915
	seedUser(t, userID, 1000)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, RequestId: "outside-package-route", IsPlayground: true,
		UsingGroup:  "paid-gpt",
		UserSetting: dto.UserSetting{BillingPreference: "subscription_first"},
	}

	session, apiErr := NewBillingSession(ctx, relayInfo, 50)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceWallet, session.funding.Source())
	require.NoError(t, session.Settle(70))
	assert.Equal(t, 930, getUserQuota(t, userID))
}

func TestNewBillingSessionExhaustedPackageWindowHonorsPreference(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for index, tc := range []struct {
		name                string
		preference          string
		allowWalletOverflow bool
		wantSource          string
		wantWalletQuota     int
		wantError           types.ErrorCode
	}{
		{
			name:            "wallet first",
			preference:      "wallet_first",
			wantSource:      BillingSourceWallet,
			wantWalletQuota: 930,
		},
		{
			name:            "subscription first without fallback",
			preference:      "subscription_first",
			wantWalletQuota: 1000,
			wantError:       types.ErrorCodeRateLimitExceeded,
		},
		{
			name:                "subscription first with fallback",
			preference:          "subscription_first",
			allowWalletOverflow: true,
			wantSource:          BillingSourceWallet,
			wantWalletQuota:     930,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			truncate(t)
			userID := 920 + index
			seedUser(t, userID, 1000)
			now := time.Now().Unix()
			plan := model.SubscriptionPlan{
				Id:            906 + index,
				Title:         "DeepSeek rolling card",
				Currency:      "CNY",
				DurationUnit:  model.SubscriptionDurationDay,
				DurationValue: 1,
				UpgradeGroup:  "deepseek-day",
				Enabled:       true,
			}
			require.NoError(t, model.DB.Create(&plan).Error)
			subscription := model.UserSubscription{
				UserId:              userID,
				PlanId:              plan.Id,
				Status:              "active",
				StartTime:           now,
				EndTime:             now + 3600,
				UpgradeGroup:        "deepseek-day",
				AllowWalletOverflow: tc.allowWalletOverflow,
			}
			require.NoError(t, model.DB.Create(&subscription).Error)
			require.NoError(t, model.SnapshotPlanQuotaWindowsTx(model.DB, subscription.Id, []model.SubscriptionQuotaWindow{
				{WindowSeconds: 5 * 60 * 60, QuotaLimit: 40},
			}))
			require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscription.Id, []string{"deepseek-a"}))

			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			relayInfo := &relaycommon.RelayInfo{
				UserId:                          userID,
				RequestId:                       "exhausted-package-window-" + tc.preference,
				IsPlayground:                    true,
				UsingGroup:                      "deepseek-a",
				SubscriptionId:                  subscription.Id,
				SubscriptionOutputLimit:         4096,
				SubscriptionAllowWalletOverflow: tc.allowWalletOverflow,
				UserSetting: dto.UserSetting{
					BillingPreference: tc.preference,
				},
			}

			session, apiErr := NewBillingSession(ctx, relayInfo, 50)
			if tc.wantError != "" {
				require.Nil(t, session)
				require.NotNil(t, apiErr)
				assert.Equal(t, tc.wantError, apiErr.GetErrorCode())
				assert.NotEmpty(t, recorder.Header().Get("Retry-After"))
				assert.Empty(t, relayInfo.SubscriptionUsageRequestId)
			} else {
				require.Nil(t, apiErr)
				require.NotNil(t, session)
				assert.Equal(t, tc.wantSource, session.funding.Source())
				require.NoError(t, session.Settle(70))
				if tc.wantSource == BillingSourceSubscription {
					assert.Empty(t, recorder.Header().Get("Retry-After"))
				} else {
					assert.Empty(t, relayInfo.SubscriptionUsageRequestId)
				}
			}
			assert.Equal(t, tc.wantWalletQuota, getUserQuota(t, userID))
		})
	}
}

func TestPostConsumeQuotaSubscriptionFallbackUpdatesRollingUsage(t *testing.T) {
	truncate(t)
	const (
		userID         = 904
		subscriptionID = 904
	)
	seedUser(t, userID, 0)
	now := time.Now().Unix()
	plan := model.SubscriptionPlan{
		Id:            subscriptionID,
		Title:         "Fallback plan",
		Currency:      "CNY",
		DurationUnit:  model.SubscriptionDurationDay,
		DurationValue: 1,
		UpgradeGroup:  "vip",
		Enabled:       true,
	}
	require.NoError(t, model.DB.Create(&plan).Error)
	subscription := model.UserSubscription{
		Id:                  subscriptionID,
		UserId:              userID,
		PlanId:              plan.Id,
		Status:              "active",
		StartTime:           now,
		EndTime:             now + 3600,
		UpgradeGroup:        "vip",
		AllowWalletOverflow: false,
	}
	require.NoError(t, model.DB.Create(&subscription).Error)
	require.NoError(t, model.SnapshotPlanQuotaWindowsTx(model.DB, subscriptionID, []model.SubscriptionQuotaWindow{
		{WindowSeconds: 300, QuotaLimit: 1000},
	}))
	require.NoError(t, model.SnapshotPlanRouteGroupsTx(model.DB, subscriptionID, []string{"vip"}))

	const requestID = "subscription-fallback-request"
	_, err := model.PreConsumeUserSubscription(requestID, userID, "deepseek-chat", 0, "vip", 50)
	require.NoError(t, err)
	require.NoError(t, model.FinalizeSubscriptionUsage(requestID))

	relayInfo := &relaycommon.RelayInfo{
		UserId:                userID,
		RequestId:             requestID,
		BillingSource:         BillingSourceSubscription,
		SubscriptionId:        subscriptionID,
		SubscriptionPostDelta: 0,
	}
	require.NoError(t, PostConsumeQuota(relayInfo, 25, 50, false))

	var record model.SubscriptionPreConsumeRecord
	require.NoError(t, model.DB.Where("request_id = ?", requestID).First(&record).Error)
	assert.EqualValues(t, 75, record.UsageQuota)
	assert.EqualValues(t, 25, relayInfo.SubscriptionPostDelta)

	var updated model.UserSubscription
	require.NoError(t, model.DB.First(&updated, subscriptionID).Error)
	assert.EqualValues(t, 75, updated.AmountUsed)
}
