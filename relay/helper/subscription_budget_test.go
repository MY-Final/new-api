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
	"github.com/QuantumNous/new-api/relaykit/types"
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

func TestValidateSubscriptionTextFieldsRejectsUnboundedProviderFeatures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		format types.RelayFormat
		body   string
		valid  bool
	}{
		{
			name:   "gemini client function",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"tools":[{"functionDeclarations":[{"name":"lookup"}]}]}`,
			valid:  true,
		},
		{
			name:   "gemini hosted search",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"tools":[{"googleSearch":{}}]}`,
			valid:  true,
		},
		{
			name:   "gemini hosted code execution",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"tools":[{"codeExecution":{}}]}`,
			valid:  true,
		},
		{
			name:   "gemini image modality",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"generationConfig":{"responseModalities":["IMAGE"]}}`,
		},
		{
			name:   "gemini image config",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"generationConfig":{"imageConfig":{"aspectRatio":"1:1"}}}`,
		},
		{
			name:   "gemini inline media",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"inlineData":{"mimeType":"image/png","data":"AA=="}}]}]}`,
		},
		{
			name:   "claude mcp server",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"mcp_servers":[{"url":"https://example.com"}]}`,
		},
		{
			name:   "claude container",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"container":"container-id"}`,
		},
		{
			name:   "claude service tier",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"service_tier":"priority"}`,
		},
		{
			name:   "claude inference region",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"inference_geo":"us"}`,
		},
		{
			name:   "claude speed",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"speed":{"mode":"fast"}}`,
		},
		{
			name:   "openai service tier",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"service_tier":"priority"}`,
		},
		{
			name:   "openai hosted search",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"web_search_options":{"search_context_size":"high"}}`,
			valid:  true,
		},
		{
			name:   "openai hosted search tool",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"tools":[{"type":"web_search_20250305","name":"web_search"}]}`,
			valid:  true,
		},
		{
			name:   "openai bounded reasoning budget",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"thinking_budget":1024}`,
			valid:  true,
		},
		{
			name:   "openai store false",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"store":false}`,
			valid:  true,
		},
		{
			name:   "openai store true",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"store":true}`,
		},
		{
			name:   "openai reasoning budget above request cap",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"thinking_budget":8192}`,
		},
		{
			name:   "openai template override",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[],"chat_template_kwargs":{"enable_thinking":true}}`,
		},
		{
			name:   "openai image content",
			format: types.RelayFormatOpenAI,
			body:   `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://example.com/image.png"}}]}]}`,
		},
		{
			name:   "openai top level text",
			format: types.RelayFormatOpenAI,
			body:   `{"prompt":["first","second"],"input":"third"}`,
			valid:  true,
		},
		{
			name:   "openai top level media",
			format: types.RelayFormatOpenAI,
			body:   `{"prompt":{"type":"image_url","image_url":{"url":"https://example.com/image.png"}}}`,
		},
		{
			name:   "responses stored prompt",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","prompt":{"id":"prompt_123"}}`,
		},
		{
			name:   "responses store false",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","store":false}`,
			valid:  true,
		},
		{
			name:   "responses store true",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","store":true}`,
		},
		{
			name:   "responses safe include",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","include":["reasoning.encrypted_content","message.output_text.logprobs"]}`,
			valid:  true,
		},
		{
			name:   "responses hosted include",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","include":["computer_call_output.output.image_url"]}`,
			valid:  true,
		},
		{
			name:   "responses background execution",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","background":true}`,
		},
		{
			name:   "responses hosted tool",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","tools":[{"type":"web_search_preview"}]}`,
			valid:  true,
		},
		{
			name:   "responses hosted search replay",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"message","role":"user","content":"weather?"},{"type":"web_search_call","id":"ws_1","status":"completed","action":{"type":"search","query":"weather"}}],"tools":[{"type":"web_search"}]}`,
			valid:  true,
		},
		{
			name:   "responses hosted code interpreter replay",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"message","role":"user","content":"run python"},{"type":"code_interpreter_call","id":"ci_1","status":"completed","code":"print(1)"}],"tools":[{"type":"code_interpreter","container":{"type":"auto"}}]}`,
			valid:  true,
		},
		{
			name:   "responses client function",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","tools":[{"type":"function","name":"lookup","parameters":{"type":"object"}}]}`,
			valid:  true,
		},
		{
			name:   "responses local shell tool",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","tools":[{"type":"local_shell"}]}`,
			valid:  true,
		},
		{
			name:   "responses local shell replay",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"message","role":"user","content":"run ls"},{"type":"local_shell_call","call_id":"call_1"},{"type":"local_shell_call_output","call_id":"call_1","output":"file.txt"}],"tools":[{"type":"local_shell"}]}`,
			valid:  true,
		},
		{
			name:   "responses apply patch replay",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"message","role":"user","content":"patch it"},{"type":"apply_patch_call","call_id":"call_2"},{"type":"apply_patch_call_output","call_id":"call_2","output":"done"}],"tools":[{"type":"apply_patch"}]}`,
			valid:  true,
		},
		{
			name:   "responses remote mcp replay",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"mcp_call","call_id":"call_3","name":"lookup","server_label":"example"}],"tools":[{"type":"function","name":"lookup","parameters":{"type":"object"}}]}`,
			valid:  true,
		},
		{
			name:   "responses text input and reasoning",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","reasoning":{"effort":"high","summary":"concise"}}`,
			valid:  true,
		},
		{
			name:   "responses input image",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":[{"type":"message","role":"user","content":[{"type":"input_image","image_url":"https://example.com/image.png"}]}]}`,
		},
		{
			name:   "responses unknown reasoning extension",
			format: types.RelayFormatOpenAIResponses,
			body:   `{"input":"hello","reasoning":{"effort":"high","future_budget":8192}}`,
		},
		{
			name:   "claude bounded thinking budget",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"thinking":{"type":"enabled","budget_tokens":1024}}`,
			valid:  true,
		},
		{
			name:   "claude thinking budget above request cap",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"thinking":{"type":"enabled","budget_tokens":8192}}`,
		},
		{
			name:   "claude unknown thinking extension",
			format: types.RelayFormatClaude,
			body:   `{"messages":[],"thinking":{"type":"adaptive","future_budget":8192}}`,
		},
		{
			name:   "claude prompt cache control",
			format: types.RelayFormatClaude,
			body:   `{"messages":[{"role":"user","content":[{"type":"text","text":"hello","cache_control":{"type":"ephemeral"}}]}]}`,
		},
		{
			name:   "claude hosted web search",
			format: types.RelayFormatClaude,
			body:   `{"messages":[{"role":"user","content":"weather?"}],"tools":[{"type":"web_search_20250305","name":"web_search","max_uses":5}]}`,
			valid:  true,
		},
		{
			name:   "claude hosted web search replay",
			format: types.RelayFormatClaude,
			body:   `{"messages":[{"role":"user","content":"weather?"},{"role":"assistant","content":[{"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{"query":"weather"}},{"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[{"type":"web_search_result","url":"https://example.com","title":"Weather"}]}]}]}`,
			valid:  true,
		},
		{
			name:   "gemini bounded thinking budget",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"generationConfig":{"thinkingConfig":{"thinkingBudget":2048}}}`,
			valid:  true,
		},
		{
			name:   "gemini thinking budget above request cap",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"generationConfig":{"thinkingConfig":{"thinkingBudget":8192}}}`,
		},
		{
			name:   "gemini unknown generation extension",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello"}]}],"generationConfig":{"futureBudget":8192}}`,
		},
		{
			name:   "gemini unknown content extension",
			format: types.RelayFormatGemini,
			body:   `{"contents":[{"parts":[{"text":"hello","futureMedia":{"url":"https://example.com/image.png"}}]}]}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var fields map[string]json.RawMessage
			require.NoError(t, common.Unmarshal([]byte(tc.body), &fields))
			err := validateSubscriptionTextFields(tc.format, fields, 4096)
			if tc.valid {
				require.NoError(t, err)
				return
			}
			assert.Error(t, err)
		})
	}
}

func TestSubscriptionRequestLimitAllowsHostedTools(t *testing.T) {
	limit, err := subscriptionRequestLimit(&dto.GeneralOpenAIRequest{
		Model:            "gpt-test",
		WebSearchOptions: &dto.WebSearchOptions{SearchContextSize: "medium"},
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
	assert.EqualValues(t, 16384, *walletFirstInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens)
	require.Error(t, ValidateSubscriptionRequestLimits(walletFirstInfo.Request, walletFirstInfo.SubscriptionOutputLimit))

	walletFirstInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens = nil
	require.NoError(t, ValidateSubscriptionRequestLimits(walletFirstInfo.Request, walletFirstInfo.SubscriptionOutputLimit))
	effectiveLimit, err := ApplySubscriptionRequestLimits(walletFirstInfo.Request, walletFirstInfo.SubscriptionOutputLimit)
	require.NoError(t, err)
	assert.Equal(t, 2048, effectiveLimit)
	assert.EqualValues(t, 2048, *walletFirstInfo.Request.(*dto.OpenAIResponsesRequest).MaxOutputTokens)
}
