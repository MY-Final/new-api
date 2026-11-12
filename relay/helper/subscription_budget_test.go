package helper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type subscriptionBudgetTestSettler struct {
	preConsumed int
}

func (s *subscriptionBudgetTestSettler) Settle(int) error    { return nil }
func (s *subscriptionBudgetTestSettler) Refund(*gin.Context) {}
func (s *subscriptionBudgetTestSettler) NeedsRefund() bool   { return false }
func (s *subscriptionBudgetTestSettler) GetPreConsumedQuota() int {
	return s.preConsumed
}

func (s *subscriptionBudgetTestSettler) Reserve(target int) error {
	if target > s.preConsumed {
		s.preConsumed = target
	}
	return nil
}

func (s *subscriptionBudgetTestSettler) ReserveBeforeSubmit(target int) error {
	return s.Reserve(target)
}

func TestSubscriptionRequestLimitUsesClientOutputBound(t *testing.T) {
	limit, err := subscriptionRequestLimit(&dto.GeneralOpenAIRequest{
		Model:            "gpt-test",
		WebSearchOptions: &dto.WebSearchOptions{SearchContextSize: "medium"},
	}, 4096)
	require.NoError(t, err)
	assert.EqualValues(t, 4096, limit)

	limit, err = subscriptionRequestLimit(&dto.OpenAIResponsesRequest{
		Model: "gpt-test",
		Input: json.RawMessage(`[{"type":"message","role":"user","content":[{"type":"input_image","image_url":"https://example.com/image.png"}]}]`),
	}, 4096)
	require.NoError(t, err)
	assert.EqualValues(t, 4096, limit)
}

func TestUpdateSubscriptionPriceBudgetIncludesOtherRatios(t *testing.T) {
	originalMultiplier := operation_setting.GetQuotaSetting().PreConsumeMultiplier
	operation_setting.GetQuotaSetting().PreConsumeMultiplier = 1
	t.Cleanup(func() {
		operation_setting.GetQuotaSetting().PreConsumeMultiplier = originalMultiplier
	})

	for _, tc := range []struct {
		name      string
		priceData hosttypes.PriceData
	}{
		{
			name: "fixed price",
			priceData: hosttypes.PriceData{
				UsePrice:       true,
				ModelPrice:     1,
				GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 1},
			},
		},
		{
			name: "token price",
			priceData: hosttypes.PriceData{
				ModelRatio:      1,
				CompletionRatio: 2,
				GroupRatioInfo:  hosttypes.GroupRatioInfo{GroupRatio: 1},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := &relaycommon.RelayInfo{
				SubscriptionInputBudget: 10,
				SubscriptionOutputLimit: 10,
				PriceData:               tc.priceData,
			}
			require.NoError(t, UpdateSubscriptionPriceBudget(base))

			discounted := &relaycommon.RelayInfo{
				SubscriptionInputBudget: 10,
				SubscriptionOutputLimit: 10,
				PriceData:               tc.priceData,
			}
			discounted.PriceData.AddOtherRatio("duration", 0.5)
			require.NoError(t, UpdateSubscriptionPriceBudget(discounted))
			assert.Equal(t, base.PriceData.QuotaToPreConsume, discounted.PriceData.QuotaToPreConsume)

			surcharged := &relaycommon.RelayInfo{
				SubscriptionInputBudget: 10,
				SubscriptionOutputLimit: 10,
				PriceData:               tc.priceData,
			}
			surcharged.PriceData.AddOtherRatio("duration", 2)
			require.NoError(t, UpdateSubscriptionPriceBudget(surcharged))
			assert.Equal(t, base.PriceData.QuotaToPreConsume*2, surcharged.PriceData.QuotaToPreConsume)
		})
	}
}

func TestFinalizeSubscriptionRequestBudgetPreservesProviderFields(t *testing.T) {
	originalMultiplier := operation_setting.GetQuotaSetting().PreConsumeMultiplier
	operation_setting.GetQuotaSetting().PreConsumeMultiplier = 1
	t.Cleanup(func() {
		operation_setting.GetQuotaSetting().PreConsumeMultiplier = originalMultiplier
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	settler := &subscriptionBudgetTestSettler{}
	info := &relaycommon.RelayInfo{
		SubscriptionOutputLimit: 2048,
		SubscriptionInputBudget: 10,
		BillingSource:           service.BillingSourceSubscription,
		Billing:                 settler,
		PriceData: hosttypes.PriceData{
			ModelRatio:      1,
			CompletionRatio: 2,
			GroupRatioInfo:  hosttypes.GroupRatioInfo{GroupRatio: 1},
		},
	}
	body := []byte(`{"model":"gpt-test","input":"hello","max_output_tokens":64000,"reasoning":{"effort":"high","context":"conversation","future_field":{"nested":true}},"future_top_level":{"keep":true}}`)

	got, err := FinalizeSubscriptionRequestBudget(c, info, body)
	require.NoError(t, err)
	assert.JSONEq(t, string(body), string(got))
	assert.Positive(t, settler.preConsumed)
	assert.Equal(t, settler.preConsumed, info.FinalPreConsumedQuota)
}

func TestPrepareSubscriptionRequestPinsZeroWalletAutoToFundedGroup(t *testing.T) {
	previousDB, previousType, previousCache := model.DB, common.MainDatabaseType(), common.MemoryCacheEnabled
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.UserSubscription{}, &model.UserSubscriptionRouteGroup{}))
	model.DB, common.MemoryCacheEnabled = database, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, common.MemoryCacheEnabled = previousDB, previousCache
		common.SetMainDatabaseType(previousType)
		require.NoError(t, sqlDB.Close())
	})

	originalMax := setting.GetMaxTokenAutoGroups()
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("16"))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","deepseek-a"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"deepseek-a":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprintf("%d", originalMax)))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})

	user := model.User{Username: "auto-subscription-user", Password: "unused", Status: common.UserStatusEnabled, Group: "default", Quota: 0}
	require.NoError(t, database.Create(&user).Error)
	now := common.GetTimestamp()
	subscription := model.UserSubscription{
		UserId: user.Id, Status: "active", StartTime: now - 10, EndTime: now + 3600,
		UpgradeGroup: "deepseek-day", MaxOutputTokens: 2048,
	}
	require.NoError(t, database.Create(&subscription).Error)
	require.NoError(t, database.Create(&model.UserSubscriptionRouteGroup{
		UserSubscriptionId: subscription.Id, GroupName: "deepseek-a",
	}).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set("id", user.Id)
	info := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "auto",
		Request:    &dto.OpenAIResponsesRequest{Model: "gpt-test"},
	}
	require.NoError(t, PrepareSubscriptionRequest(c, info))
	assert.Equal(t, "deepseek-a", info.UsingGroup)
	assert.Equal(t, subscription.Id, info.SubscriptionId)
	assert.Equal(t, []string{"deepseek-a"}, common.GetContextKeyStringSlice(c, constant.ContextKeyTokenAutoGroups))
	assert.Equal(t, "deepseek-a", common.GetContextKeyString(c, constant.ContextKeyAutoGroup))

	require.NoError(t, database.Model(&user).Update("quota", 10000).Error)
	fundedWallet, _ := gin.CreateTestContext(httptest.NewRecorder())
	fundedWallet.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	fundedWallet.Set("id", user.Id)
	fundedWalletInfo := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "auto",
		Request:    &dto.OpenAIResponsesRequest{Model: "gpt-test"},
	}
	require.NoError(t, PrepareSubscriptionRequest(fundedWallet, fundedWalletInfo))
	assert.Equal(t, "deepseek-a", fundedWalletInfo.UsingGroup)
	assert.Equal(t, subscription.Id, fundedWalletInfo.SubscriptionId)

	walletFallback, _ := gin.CreateTestContext(httptest.NewRecorder())
	walletFallback.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	walletFallback.Set("id", user.Id)
	walletFallbackInfo := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "auto",
		Request:    &dto.OpenAIResponsesRequest{Model: "gpt-test"},
		UserSetting: dto.UserSetting{
			BillingPreference: "wallet_first",
		},
	}
	bound, err := PrepareSubscriptionFallbackForAuto(walletFallback, walletFallbackInfo)
	require.NoError(t, err)
	assert.True(t, bound)
	assert.Equal(t, "deepseek-a", walletFallbackInfo.UsingGroup)
	assert.Equal(t, subscription.Id, walletFallbackInfo.SubscriptionId)

	explicit, _ := gin.CreateTestContext(httptest.NewRecorder())
	explicit.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	explicit.Set("id", user.Id)
	explicitInfo := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "default",
		Request:    &dto.OpenAIResponsesRequest{Model: "gpt-test"},
	}
	require.NoError(t, PrepareSubscriptionRequest(explicit, explicitInfo))
	assert.Equal(t, "default", explicitInfo.UsingGroup)
	_, overridden := common.GetContextKey(explicit, constant.ContextKeyTokenAutoGroups)
	assert.False(t, overridden)

	walletOnly, _ := gin.CreateTestContext(httptest.NewRecorder())
	walletOnly.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	walletOnly.Set("id", user.Id)
	walletOnlyInfo := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "deepseek-a",
		Request: &dto.OpenAIResponsesRequest{
			Model:           "gpt-test",
			MaxOutputTokens: common.GetPointer[uint](16384),
		},
		UserSetting: dto.UserSetting{BillingPreference: "wallet_only"},
	}
	require.NoError(t, PrepareSubscriptionRequest(walletOnly, walletOnlyInfo))
	assert.True(t, walletOnlyInfo.SubscriptionRouteCovered)
	assert.Zero(t, walletOnlyInfo.SubscriptionId)
	assert.Zero(t, walletOnlyInfo.SubscriptionOutputLimit)
	require.NotNil(t, walletOnlyInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens)
	assert.EqualValues(t, 16384, *walletOnlyInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens)

	walletFirst, _ := gin.CreateTestContext(httptest.NewRecorder())
	walletFirst.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	walletFirst.Set("id", user.Id)
	walletFirstInfo := &relaycommon.RelayInfo{
		UserId:     user.Id,
		UserGroup:  "default",
		UsingGroup: "deepseek-a",
		Request: &dto.OpenAIResponsesRequest{
			Model:           "gpt-test",
			MaxOutputTokens: common.GetPointer[uint](16384),
		},
		UserSetting: dto.UserSetting{BillingPreference: "wallet_first"},
	}
	require.NoError(t, PrepareSubscriptionRequest(walletFirst, walletFirstInfo))
	assert.Equal(t, subscription.Id, walletFirstInfo.SubscriptionId)
	assert.EqualValues(t, 2048, walletFirstInfo.SubscriptionOutputLimit)
	// The package snapshot must not rewrite the client's output limit.
	assert.EqualValues(t, 16384, *walletFirstInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens)
}
