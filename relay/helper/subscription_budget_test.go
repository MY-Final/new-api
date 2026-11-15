package helper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
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

func TestSubscriptionInputReservationDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousConfig := config.GlobalConfig.ExportAllConfigs()
	previousRatios := ratio_setting.ModelRatio2JSONString()
	previousQuotaPerUnit := common.QuotaPerUnit
	previousDB, previousType := model.DB, common.MainDatabaseType()
	previousCache, previousRedis, previousBatch := common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previousConfig))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
		common.QuotaPerUnit = previousQuotaPerUnit
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled = previousCache, previousRedis, previousBatch
	})
	common.QuotaPerUnit = 500000
	common.MemoryCacheEnabled, common.RedisEnabled, common.BatchUpdateEnabled = false, false, false
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"quota_setting.pre_consume_multiplier": "1",
		"billing_setting.billing_mode":         `{"subscription-astra":"tiered_expr","subscription-fixed":"tiered_expr","subscription-priority":"tiered_expr"}`,
		"billing_setting.billing_expr":         `{"subscription-astra":"len <= 272000 ? tier(\"short\", p * 10 + c * 50 + cr) : tier(\"long\", p * 20 + c * 75 + cr * 2)","subscription-fixed":"tier(\"request\", fixed(0.01))","subscription-priority":"tier(\"base\", p * 10 + c * 50) * (header(\"x-priority\") == \"high\" ? 2 : 1)"}`,
	}))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"subscription-ratio":5}`))

	for _, dialect := range []common.DatabaseType{common.DatabaseTypeSQLite, common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(":memory:")
			switch dialect {
			case common.DatabaseTypeMySQL:
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case common.DatabaseTypePostgreSQL:
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			}
			database, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := database.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			model.DB = database
			common.SetMainDatabaseType(dialect)
			versionQuery := "SELECT VERSION()"
			if dialect == common.DatabaseTypeSQLite {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, database.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)
			require.NoError(t, database.AutoMigrate(
				&model.User{}, &model.SubscriptionPlan{}, &model.UserSubscription{},
				&model.UserSubscriptionRouteGroup{}, &model.UserSubscriptionQuotaWindow{},
				&model.SubscriptionPreConsumeRecord{}, &model.SubscriptionPlanQuotaWindow{},
				&model.SubscriptionPlanRouteGroup{}, &model.SystemTask{},
			))

			for _, tc := range []struct {
				name       string
				model      string
				input      int
				output     uint
				multiplier float64
				wantQuota  int
			}{
				{"astra-default-output", "subscription-astra", 32000, 0, 1, 160000},
				{"astra-explicit-output", "subscription-astra", 32000, 393216, 1, 160000},
				{"astra-long-context", "subscription-astra", 320000, 393216, 1, 3200000},
				{"astra-zero-estimate", "subscription-astra", 0, 393216, 1, 0},
				{"astra-input-multiplier", "subscription-astra", 32000, 393216, 2.5, 400000},
				{"ratio-output", "subscription-ratio", 32000, 393216, 1, 160000},
				{"fixed-request", "subscription-fixed", 32000, 393216, 2.5, 5000},
				{"request-rule", "subscription-priority", 32000, 393216, 1, 320000},
			} {
				t.Run(tc.name, func(t *testing.T) {
					operation_setting.GetQuotaSetting().PreConsumeMultiplier = tc.multiplier
					user := model.User{
						Username: tc.name, Password: "unused", Group: "subscription-budget",
						Status: common.UserStatusEnabled, AffCode: tc.name,
					}
					require.NoError(t, database.Create(&user).Error)
					t.Cleanup(func() {
						require.NoError(t, database.Where("user_id = ?", user.Id).Delete(&model.SubscriptionPreConsumeRecord{}).Error)
						require.NoError(t, database.Unscoped().Delete(&user).Error)
					})
					plan := model.SubscriptionPlan{Title: tc.name, Enabled: true}
					require.NoError(t, database.Create(&plan).Error)
					model.InvalidateSubscriptionPlanCache(plan.Id)
					now := common.GetTimestamp()
					subscription := model.UserSubscription{
						UserId: user.Id, PlanId: plan.Id, Status: "active",
						StartTime: now - 1, EndTime: now + 3600,
						MaxOutputTokens: 393216,
					}
					require.NoError(t, database.Create(&subscription).Error)
					t.Cleanup(func() {
						require.NoError(t, database.Where("user_subscription_id = ?", subscription.Id).Delete(&model.UserSubscriptionQuotaWindow{}).Error)
						require.NoError(t, database.Where("user_subscription_id = ?", subscription.Id).Delete(&model.UserSubscriptionRouteGroup{}).Error)
						require.NoError(t, database.Delete(&subscription).Error)
						require.NoError(t, database.Delete(&plan).Error)
					})
					require.NoError(t, model.SnapshotPlanRouteGroupsWithRatiosTx(database, subscription.Id,
						[]string{"subscription-budget"}, map[string]float64{"subscription-budget": 1}))
					require.NoError(t, model.SnapshotPlanQuotaWindowsTx(database, subscription.Id,
						[]model.SubscriptionQuotaWindow{{WindowSeconds: 86400, QuotaLimit: 5000000}}))

					ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
					ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
					ctx.Request.Header.Set("x-priority", "high")
					request := &dto.OpenAIResponsesRequest{Model: tc.model, Input: json.RawMessage(`"hello"`)}
					if tc.output > 0 {
						request.MaxOutputTokens = &tc.output
					}
					info := &relaycommon.RelayInfo{
						UserId: user.Id, UserGroup: user.Group, UsingGroup: user.Group,
						OriginModelName: tc.model, RequestId: tc.name, Request: request,
						IsPlayground: true, BillingSourceTarget: service.BillingSourceSubscription,
						UserSetting: dto.UserSetting{BillingPreference: "subscription_only"},
						BillingRequestInput: &billingexpr.RequestInput{
							Headers: map[string]string{"x-priority": "high"},
						},
					}
					info.SetEstimatePromptTokens(tc.input)
					require.NoError(t, PrepareSubscriptionRequest(ctx, info))
					price, err := ModelPriceHelper(ctx, info, tc.input, &types.TokenCountMeta{})
					require.NoError(t, err)
					assert.Equal(t, tc.wantQuota, price.QuotaToPreConsume)
					require.Nil(t, service.PreConsumeBilling(ctx, price.QuotaToPreConsume, info))
					raw, err := common.Marshal(request)
					require.NoError(t, err)
					finalBody, err := FinalizeSubscriptionRequestBudget(ctx, info, raw)
					require.NoError(t, err)
					assert.Equal(t, raw, finalBody)
					assert.Equal(t, max(tc.wantQuota, 1), info.Billing.GetPreConsumedQuota())

					if tc.name == "astra-default-output" {
						session, ok := info.Billing.(*service.BillingSession)
						require.True(t, ok)
						require.NoError(t, session.CancelReservation())
						require.NoError(t, model.PopulateUserSubscriptionUsageForResponse(&subscription, now))
						assert.Zero(t, subscription.AmountUsedWithReserved)
						info.RequestId += "-retry"
						info.SubscriptionUsageRequestId = ""
						info.Billing = nil
						require.Nil(t, service.PreConsumeBilling(ctx, price.QuotaToPreConsume, info))
					}
					require.NoError(t, info.Billing.Settle(5000001))
					require.NoError(t, model.FinalizeSubscriptionUsage(info.RequestId))
					require.NoError(t, database.First(&subscription, subscription.Id).Error)
					require.NoError(t, model.PopulateUserSubscriptionUsageForResponse(&subscription, now))
					require.Len(t, subscription.QuotaWindows, 1)
					assert.EqualValues(t, 5000001, subscription.AmountUsed)
					assert.EqualValues(t, 5000001, subscription.QuotaWindows[0].Used)
					assert.Zero(t, subscription.QuotaWindows[0].Reserved)
					assert.Zero(t, subscription.QuotaWindows[0].Remaining)
					next := *info
					next.RequestId += "-blocked"
					next.SubscriptionUsageRequestId = ""
					session, apiErr := service.NewBillingSession(ctx, &next, 1)
					require.Nil(t, session)
					require.NotNil(t, apiErr)
					assert.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
					var wallet model.User
					require.NoError(t, database.First(&wallet, user.Id).Error)
					assert.Zero(t, wallet.Quota)
				})
			}
		})
	}
}

func TestFinalizeSubscriptionRequestBudgetPreservesProviderFields(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	settler := &subscriptionBudgetTestSettler{preConsumed: 10}
	info := &relaycommon.RelayInfo{
		SubscriptionOutputLimit: 2048,
		BillingSource:           service.BillingSourceSubscription,
		Billing:                 settler,
	}
	body := []byte(`{"model":"gpt-test","input":"hello","max_output_tokens":64000,"reasoning":{"effort":"high","context":"conversation","future_field":{"nested":true}},"future_top_level":{"keep":true}}`)

	got, err := FinalizeSubscriptionRequestBudget(c, info, body)
	require.NoError(t, err)
	assert.JSONEq(t, string(body), string(got))
	assert.Equal(t, 10, settler.preConsumed)
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
