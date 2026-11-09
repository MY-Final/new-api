package helper

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// PrepareSubscriptionRequest binds one request to the subscription that covers
// its final routing group. It records the snapshotted limits without changing
// the client's request, because the funding source is chosen later.
func PrepareSubscriptionRequest(c *gin.Context, info *relaycommon.RelayInfo) error {
	if info == nil || info.UserId <= 0 {
		return nil
	}
	preference := common.NormalizeBillingPreference(info.UserSetting.BillingPreference)
	group := info.UsingGroup
	if group == "auto" {
		group = common.GetContextKeyString(c, constant.ContextKeyAutoGroup)
		if group == "" && preference != "wallet_only" {
			// Auto must start from a subscription-backed group when the user asked
			// for subscription funding, or when a zero-balance account can only be
			// funded by a subscription. A later channel selection is reconciled by
			// PrepareSelectedGroupBilling.
			walletQuota, err := model.GetUserQuota(info.UserId, true)
			if err != nil {
				return err
			}
			if walletQuota <= 0 || preference == "subscription_first" || preference == "subscription_only" {
				selectedGroup, err := bindAutoSubscriptionGroup(c, info)
				if err != nil {
					return err
				}
				if selectedGroup != "" {
					group = selectedGroup
				}
			}
		}
	}
	info.SubscriptionId = 0
	info.SubscriptionOutputLimit = 0
	info.SubscriptionGroupRatio = 0
	info.SubscriptionAllowWalletOverflow = false
	info.SubscriptionRouteCovered = false
	if group == "" {
		return nil
	}
	if service.IsFreeGroup(c, group) {
		info.UsingGroup = group
		return nil
	}
	subscription, err := model.GetActiveSubscriptionForRoute(info.UserId, group)
	if err != nil {
		return err
	}
	info.UsingGroup = group
	if subscription == nil {
		return nil
	}
	info.SubscriptionRouteCovered = true
	if preference == "wallet_only" {
		return nil
	}

	outputLimit := subscription.MaxOutputTokens
	if outputLimit <= 0 {
		outputLimit = model.DefaultSubscriptionMaxOutputTokens
	}
	if outputLimit < 1 || outputLimit > model.MaxSubscriptionOutputTokens {
		return errors.New("subscription output token limit is invalid")
	}
	info.SubscriptionId = subscription.Id
	info.SubscriptionOutputLimit = outputLimit
	info.SubscriptionGroupRatio = subscription.RouteGroupRatios[group]
	info.SubscriptionAllowWalletOverflow = subscription.AllowWalletOverflow
	return nil
}

// PrepareSubscriptionFallbackForAuto resolves an unresolved Auto route to the
// first subscription-backed group. The proxy calls this after a Wallet First
// reservation fails, because that preference permits subscription fallback.
func PrepareSubscriptionFallbackForAuto(c *gin.Context, info *relaycommon.RelayInfo) (bool, error) {
	if info == nil || info.UserId <= 0 || info.UsingGroup != "auto" {
		return false, nil
	}
	group, err := bindAutoSubscriptionGroup(c, info)
	if err != nil {
		return false, err
	}
	if group == "" {
		return false, nil
	}
	if err := PrepareSubscriptionRequest(c, info); err != nil {
		return false, err
	}
	return true, nil
}

func bindAutoSubscriptionGroup(c *gin.Context, info *relaycommon.RelayInfo) (string, error) {
	autoGroups := service.GetRequestAutoGroups(c, info.UserGroup)
	subscriptionGroups := make([]string, 0, len(autoGroups))
	for _, candidate := range autoGroups {
		subscription, err := model.GetActiveSubscriptionForRoute(info.UserId, candidate)
		if err != nil {
			return "", err
		}
		if subscription != nil {
			subscriptionGroups = append(subscriptionGroups, candidate)
		}
	}
	if len(subscriptionGroups) == 0 {
		return "", nil
	}
	group := subscriptionGroups[0]
	// Pin this request's Auto candidates to package-backed groups. This prevents
	// channel affinity to an earlier wallet group from turning a valid package
	// fallback into a hard insufficient-balance failure.
	common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, subscriptionGroups)
	common.SetContextKey(c, constant.ContextKeyAutoGroup, group)
	common.SetContextKey(c, constant.ContextKeyAutoGroupIndex, 0)
	return group, nil
}

// ValidateSubscriptionRequestLimits checks whether a request can be funded by
// a subscription without changing its output limit.
func ValidateSubscriptionRequestLimits(request dto.Request, limit int) error {
	_, err := subscriptionRequestLimit(request, limit)
	return err
}

func subscriptionRequestLimit(request dto.Request, limit int) (uint, error) {
	if request == nil || limit <= 0 {
		return 0, errors.New("subscription text request is required")
	}
	cap := uint(limit)
	var limits []*uint
	switch value := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if value.N != nil && *value.N != 1 || value.WebSearchOptions != nil {
			return 0, errors.New("subscription requests require one text completion and no hosted tools")
		}
		limits = []*uint{value.MaxTokens, value.MaxCompletionTokens}
	case *dto.ClaudeRequest:
		limits = []*uint{value.MaxTokens, value.MaxTokensToSample}
	case *dto.OpenAIResponsesRequest:
		limits = []*uint{value.MaxOutputTokens}
	case *dto.GeminiChatRequest:
		if len(value.Requests) > 0 || value.CachedContent != "" || len(value.ContinuationToken) > 0 {
			return 0, errors.New("subscription requests do not support batches or stored context")
		}
		if value.GenerationConfig.CandidateCount != nil && *value.GenerationConfig.CandidateCount != 1 {
			return 0, errors.New("subscription requests require one text completion")
		}
		limits = []*uint{value.GenerationConfig.MaxOutputTokens}
	default:
		return 0, errors.New("subscriptions support OpenAI, Claude, Responses and Gemini text requests only")
	}
	for _, value := range limits {
		if value == nil {
			continue
		}
		if *value == 0 || *value > uint(limit) {
			return 0, fmt.Errorf("output token limit must be between 1 and the subscription limit of %d", limit)
		}
		cap = min(cap, *value)
	}
	if len(request.GetTokenCountMeta().Files) > 0 {
		return 0, errors.New("subscription requests support text inputs only")
	}
	return cap, nil
}

// ApplySubscriptionRequestLimits sets the actual output limit on supported
// text DTOs. Unknown-cost modalities and hosted tools are deliberately rejected.
func ApplySubscriptionRequestLimits(request dto.Request, limit int) (int, error) {
	cap, err := subscriptionRequestLimit(request, limit)
	if err != nil {
		return 0, err
	}
	switch value := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if value.MaxCompletionTokens != nil {
			value.MaxCompletionTokens = common.GetPointer(cap)
		}
		if value.MaxTokens != nil || value.MaxCompletionTokens == nil {
			value.MaxTokens = common.GetPointer(cap)
		}
	case *dto.ClaudeRequest:
		value.MaxTokens = common.GetPointer(cap)
		if value.MaxTokensToSample != nil {
			value.MaxTokensToSample = common.GetPointer(cap)
		}
	case *dto.OpenAIResponsesRequest:
		value.MaxOutputTokens = common.GetPointer(cap)
	case *dto.GeminiChatRequest:
		value.GenerationConfig.MaxOutputTokens = common.GetPointer(cap)
	}
	return int(cap), nil
}

// UpdateSubscriptionPriceBudget computes a conservative reservation while
// leaving actual settlement based on measured provider usage.
func UpdateSubscriptionPriceBudget(info *relaycommon.RelayInfo) error {
	if info.SubscriptionOutputLimit <= 0 {
		return nil
	}
	// Reserve against the output bound the client actually asked for, never
	// more than the plan cap. Reserving the full plan cap for a request that
	// only allows a few hundred output tokens would exhaust a small quota
	// window before any real usage is measured, so a client max_tokens below
	// the cap must shrink the reservation. With no client bound, the plan cap
	// stays the worst-case reservation.
	output := info.SubscriptionOutputLimit
	if info.Request != nil {
		if limit, err := subscriptionRequestLimit(info.Request, info.SubscriptionOutputLimit); err == nil {
			output = int(limit)
		}
	}
	input := max(info.SubscriptionInputBudget, info.GetEstimatePromptTokens())
	groupRatio := info.PriceData.GroupRatioInfo.GroupRatio
	var beforeGroup float64
	if snapshot := info.TieredBillingSnapshot; snapshot != nil {
		bound, err := billingexpr.SubscriptionCostUpperBound(snapshot.ExprString, input, output)
		if err != nil {
			return err
		}
		beforeGroup = bound / 1_000_000 * snapshot.QuotaPerUnit
		snapshot.EstimatedPromptTokens = input
		snapshot.EstimatedCompletionTokens = output
		snapshot.EstimatedQuotaBeforeGroup = beforeGroup
	} else if info.PriceData.UsePrice {
		beforeGroup = info.PriceData.ModelPrice * common.QuotaPerUnit
	} else {
		inputRatio := max(1.0, info.PriceData.CacheRatio, info.PriceData.CacheCreationRatio,
			info.PriceData.CacheCreation5mRatio, info.PriceData.CacheCreation1hRatio, info.PriceData.CacheCreation12hRatio)
		beforeGroup = (float64(input)*inputRatio + float64(output)*info.PriceData.CompletionRatio) * info.PriceData.ModelRatio
	}
	// OtherRatios are applied again during settlement. Reserve their upward
	// multiplier as well, but never let a discount make the reservation smaller.
	beforeGroup *= max(info.PriceData.OtherRatioMultiplier(), 1)
	multiplier, err := operation_setting.InputPreConsumeMultiplier()
	if err != nil {
		return err
	}
	beforeGroup *= max(multiplier, 1)
	quota, err := common.QuotaRoundStrict(beforeGroup * groupRatio)
	if err != nil {
		return err
	}
	if quota <= 0 || math.IsNaN(beforeGroup) || math.IsInf(beforeGroup, 0) {
		return errors.New("subscription model price must have a finite positive budget")
	}
	info.PriceData.FreeModel = false
	info.PriceData.QuotaToPreConsume = quota
	if snapshot := info.TieredBillingSnapshot; snapshot != nil {
		snapshot.EstimatedQuotaAfterGroup = quota
	}
	return nil
}

// FinalizeSubscriptionRequestBudget validates the final JSON after conversion
// and overrides, then raises the reservation before any upstream traffic. It
// preserves a smaller client output limit and rejects one above the plan cap.
func FinalizeSubscriptionRequestBudget(c *gin.Context, info *relaycommon.RelayInfo, raw []byte) ([]byte, error) {
	if info.SubscriptionOutputLimit <= 0 || info.BillingSource != service.BillingSourceSubscription {
		return raw, nil
	}
	if len(raw) == 0 || info.Billing == nil {
		return nil, errors.New("subscription request has no reserved budget")
	}
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(raw, &fields); err != nil {
		return nil, errors.New("subscription requests require a JSON text body")
	}
	if err := validateSubscriptionTextFields(info.GetFinalRequestRelayFormat(), fields, info.SubscriptionOutputLimit); err != nil {
		return nil, err
	}
	var request dto.Request
	var effectiveOutput int
	var err error
	switch info.GetFinalRequestRelayFormat() {
	case types.RelayFormatOpenAI:
		value := &dto.GeneralOpenAIRequest{}
		if err := common.Unmarshal(raw, value); err != nil {
			return nil, err
		}
		effectiveOutput, err = ApplySubscriptionRequestLimits(value, info.SubscriptionOutputLimit)
		if err != nil {
			return nil, err
		}
		maxTokensPresent := hasSubscriptionJSONField(fields, "max_tokens")
		maxCompletionPresent := hasSubscriptionJSONField(fields, "max_completion_tokens")
		if maxTokensPresent || maxCompletionPresent {
			if maxTokensPresent {
				fields["max_tokens"], err = common.Marshal(effectiveOutput)
				if err != nil {
					return nil, err
				}
			}
			if maxCompletionPresent {
				fields["max_completion_tokens"], err = common.Marshal(effectiveOutput)
				if err != nil {
					return nil, err
				}
			}
		} else if dto.GetOpenAIChatCapabilities(info.UpstreamModelName, info.ReasoningEffort).UseMaxCompletionTokens {
			fields["max_completion_tokens"], err = common.Marshal(effectiveOutput)
			if err != nil {
				return nil, err
			}
		} else {
			fields["max_tokens"], err = common.Marshal(effectiveOutput)
			if err != nil {
				return nil, err
			}
		}
		request = value
	case types.RelayFormatClaude:
		value := &dto.ClaudeRequest{}
		if err := common.Unmarshal(raw, value); err != nil {
			return nil, err
		}
		effectiveOutput, err = ApplySubscriptionRequestLimits(value, info.SubscriptionOutputLimit)
		if err != nil {
			return nil, err
		}
		if hasSubscriptionJSONField(fields, "max_tokens") || !hasSubscriptionJSONField(fields, "max_tokens_to_sample") {
			fields["max_tokens"], err = common.Marshal(effectiveOutput)
			if err != nil {
				return nil, err
			}
		}
		if hasSubscriptionJSONField(fields, "max_tokens_to_sample") {
			fields["max_tokens_to_sample"], err = common.Marshal(effectiveOutput)
			if err != nil {
				return nil, err
			}
		}
		request = value
	case types.RelayFormatOpenAIResponses:
		value := &dto.OpenAIResponsesRequest{}
		if err := common.Unmarshal(raw, value); err != nil {
			return nil, err
		}
		effectiveOutput, err = ApplySubscriptionRequestLimits(value, info.SubscriptionOutputLimit)
		if err != nil {
			return nil, err
		}
		fields["max_output_tokens"], err = common.Marshal(effectiveOutput)
		if err != nil {
			return nil, err
		}
		request = value
	case types.RelayFormatGemini:
		value := &dto.GeminiChatRequest{}
		if err := common.Unmarshal(raw, value); err != nil {
			return nil, err
		}
		config := make(map[string]json.RawMessage)
		configRaw := fields["generationConfig"]
		if len(configRaw) == 0 {
			configRaw = fields["generation_config"]
		}
		if len(configRaw) > 0 {
			if err := common.Unmarshal(configRaw, &config); err != nil {
				return nil, err
			}
		}
		effectiveOutput, err = ApplySubscriptionRequestLimits(value, info.SubscriptionOutputLimit)
		if err != nil {
			return nil, err
		}
		config["maxOutputTokens"], err = common.Marshal(effectiveOutput)
		if err != nil {
			return nil, err
		}
		delete(config, "max_output_tokens")
		fields["generationConfig"], err = common.Marshal(config)
		if err != nil {
			return nil, err
		}
		delete(fields, "generation_config")
		request = value
	default:
		return nil, errors.New("upstream format cannot enforce the subscription output budget")
	}
	if _, err := ApplySubscriptionRequestLimits(request, info.SubscriptionOutputLimit); err != nil {
		return nil, err
	}
	encoded, err := common.Marshal(fields)
	if err != nil {
		return nil, err
	}
	// UTF-8 bytes conservatively bound the tokens in supported text payloads,
	// including system prompts and function schemas inserted by converters.
	info.SubscriptionInputBudget = max(info.SubscriptionInputBudget, len(encoded))
	if err := UpdateSubscriptionPriceBudget(info); err != nil {
		return nil, err
	}
	if err := info.Billing.ReserveBeforeSubmit(info.PriceData.QuotaToPreConsume); err != nil {
		return nil, err
	}
	info.FinalPreConsumedQuota = info.Billing.GetPreConsumedQuota()
	return encoded, nil
}

func hasSubscriptionJSONField(fields map[string]json.RawMessage, key string) bool {
	raw, ok := fields[key]
	return ok && len(raw) > 0 && string(raw) != "null"
}

func validateSubscriptionTextFields(format types.RelayFormat, fields map[string]json.RawMessage, outputLimit int) error {
	switch format {
	case types.RelayFormatOpenAI:
		if err := validateSubscriptionFieldNames(fields, subscriptionOpenAIFields); err != nil {
			return err
		}
		if err := validateOpenAIStore(fields); err != nil {
			return err
		}
		if err := validateOpenAIReasoningControls(fields, outputLimit); err != nil {
			return err
		}
		if err := validateOpenAIChatContent(fields); err != nil {
			return err
		}
	case types.RelayFormatClaude:
		if err := validateSubscriptionFieldNames(fields, subscriptionClaudeFields); err != nil {
			return err
		}
		if err := validateClaudeSubscriptionFields(fields, outputLimit); err != nil {
			return err
		}
	case types.RelayFormatOpenAIResponses:
		if err := validateSubscriptionFieldNames(fields, subscriptionResponsesFields); err != nil {
			return err
		}
		if err := validateOpenAIStore(fields); err != nil {
			return err
		}
		if err := validateOpenAIReasoningControls(fields, outputLimit); err != nil {
			return err
		}
		if err := validateOpenAIResponsesInclude(fields); err != nil {
			return err
		}
		if err := validateOpenAIResponsesInput(fields); err != nil {
			return err
		}
	case types.RelayFormatGemini:
		if err := validateSubscriptionFieldNames(fields, subscriptionGeminiFields); err != nil {
			return err
		}
	default:
		return errors.New("upstream format cannot enforce the subscription text budget")
	}
	for _, key := range []string{
		"previous_response_id",
		"conversation",
		"cachedContent",
		"cached_content",
		"continuationToken",
		"continuation_token",
		"parameters",
		"sampling_params",
		"extra_body",
		"audio",
		"modalities",
		"service_tier",
		"mcp_servers",
		"mcpServers",
		"container",
		"inference_geo",
		"inferenceGeo",
		"speed",
		"imageConfig",
		"image_config",
		"web_search_options",
		"web_search",
		"search_parameters",
		"search_options",
		"enable_search",
		"return_images",
		"return_related_questions",
	} {
		if subscriptionJSONFieldHasValue(fields[key]) {
			return fmt.Errorf("subscription text budget does not support %q", key)
		}
	}
	if format == types.RelayFormatOpenAIResponses {
		for _, key := range []string{"background", "moderation", "prompt"} {
			if subscriptionJSONFieldHasValue(fields[key]) {
				return fmt.Errorf("subscription text budget does not support %q", key)
			}
		}
	}
	for _, key := range []string{"n", "best_of"} {
		if raw := fields[key]; len(raw) > 0 && string(raw) != "null" {
			var count int
			if err := common.Unmarshal(raw, &count); err != nil || count != 1 {
				return fmt.Errorf("subscription requests require %s=1", key)
			}
		}
	}
	if raw := fields["tools"]; len(raw) > 0 && string(raw) != "null" {
		var tools []map[string]json.RawMessage
		if err := common.Unmarshal(raw, &tools); err != nil {
			return errors.New("subscription tool declarations cannot be budgeted")
		}
		for _, tool := range tools {
			if format == types.RelayFormatGemini {
				continue
			}
			var kind string
			if raw := tool["type"]; len(raw) > 0 {
				if err := common.Unmarshal(raw, &kind); err != nil {
					return err
				}
			}
			kind = strings.ToLower(strings.TrimSpace(kind))
			clientExecuted := format == types.RelayFormatOpenAIResponses &&
				(kind == "local_shell" || kind == "apply_patch")
			if kind != "function" && kind != "custom" && !clientExecuted &&
				!(format == types.RelayFormatClaude && kind == "") {
				return errors.New("subscription requests do not support hosted tools")
			}
		}
	}
	if format == types.RelayFormatGemini {
		return validateGeminiSubscriptionFields(fields, outputLimit)
	}
	return nil
}

var subscriptionOpenAIFields = map[string]struct{}{
	"model": {}, "messages": {}, "prompt": {}, "prefix": {}, "suffix": {},
	"stream": {}, "stream_options": {}, "max_tokens": {}, "max_completion_tokens": {},
	"reasoning_effort": {}, "reasoning": {}, "verbosity": {}, "temperature": {},
	"top_p": {}, "top_k": {}, "stop": {}, "n": {}, "input": {}, "instruction": {},
	"functions": {}, "frequency_penalty": {}, "presence_penalty": {}, "response_format": {},
	"seed": {}, "parallel_tool_calls": {}, "tools": {}, "tool_choice": {},
	"function_call": {}, "user": {}, "logprobs": {}, "top_logprobs": {},
	"logit_bias": {}, "metadata": {}, "prediction": {}, "usage": {},
	"min_tokens": {}, "min_p": {}, "repetition_penalty": {},
	"structured_outputs": {}, "return_token_ids": {}, "regex": {}, "ebnf": {},
	"stop_token_ids": {}, "stop_regex": {}, "no_stop_trim": {}, "ignore_eos": {},
	"skip_special_tokens": {}, "continue_final_message": {}, "cache_salt": {},
	"enable_thinking": {}, "thinking_budget": {}, "thinking_token_budget": {},
	"include_reasoning": {}, "separate_reasoning": {}, "stream_reasoning": {},
	"safety_identifier": {}, "prompt_cache_key": {}, "store": {},
}

var subscriptionResponsesFields = map[string]struct{}{
	"model": {}, "input": {}, "instructions": {}, "max_output_tokens": {},
	"metadata": {}, "parallel_tool_calls": {}, "frequency_penalty": {},
	"presence_penalty": {}, "reasoning": {}, "reasoning_effort": {},
	"stream": {}, "stream_options": {}, "temperature": {}, "text": {},
	"tool_choice": {}, "tools": {}, "top_p": {}, "truncation": {}, "user": {},
	"max_tool_calls": {}, "client_metadata": {}, "top_k": {}, "min_p": {},
	"repetition_penalty": {}, "stop": {}, "safety_identifier": {},
	"prompt_cache_key": {}, "enable_thinking": {}, "thinking_budget": {},
	"thinking_token_budget": {}, "include_reasoning": {},
	"separate_reasoning": {}, "stream_reasoning": {}, "store": {}, "include": {},
}

var subscriptionClaudeFields = map[string]struct{}{
	"model": {}, "prompt": {}, "system": {}, "messages": {},
	"max_tokens": {}, "max_tokens_to_sample": {}, "stop_sequences": {},
	"temperature": {}, "top_p": {}, "top_k": {}, "stream": {}, "tools": {},
	"tool_choice": {}, "thinking": {}, "metadata": {},
}

var subscriptionGeminiFields = map[string]struct{}{
	"contents": {}, "safetySettings": {}, "generationConfig": {}, "generation_config": {},
	"tools": {}, "toolConfig": {}, "systemInstruction": {},
	"system_instruction": {}, "cachedContent": {}, "continuationToken": {},
	"continuation_token": {}, "requests": {},
}

func validateSubscriptionFieldNames(fields map[string]json.RawMessage, allowed map[string]struct{}) error {
	for key, raw := range fields {
		if !subscriptionJSONFieldHasValue(raw) {
			continue
		}
		if _, ok := allowed[key]; !ok {
			return fmt.Errorf("subscription requests do not support provider extension %q", key)
		}
	}
	return nil
}

func subscriptionJSONFieldHasValue(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return value != "" && value != "null" && value != `""`
}

func validateOpenAIReasoningControls(fields map[string]json.RawMessage, outputLimit int) error {
	if raw := fields["reasoning_effort"]; subscriptionJSONFieldHasValue(raw) {
		if err := validateReasoningEffortValue(raw); err != nil {
			return err
		}
	}
	if raw := fields["reasoning"]; subscriptionJSONFieldHasValue(raw) {
		var reasoning map[string]json.RawMessage
		if err := common.Unmarshal(raw, &reasoning); err != nil {
			return errors.New("subscription reasoning configuration must be an object")
		}
		for key := range reasoning {
			if key != "effort" && key != "summary" {
				return fmt.Errorf("subscription reasoning does not support %q", key)
			}
		}
		if rawEffort := reasoning["effort"]; subscriptionJSONFieldHasValue(rawEffort) {
			if err := validateReasoningEffortValue(rawEffort); err != nil {
				return err
			}
		}
		if rawSummary := reasoning["summary"]; subscriptionJSONFieldHasValue(rawSummary) {
			var summary string
			if err := common.Unmarshal(rawSummary, &summary); err != nil {
				return errors.New("subscription reasoning summary is invalid")
			}
			switch strings.ToLower(strings.TrimSpace(summary)) {
			case "auto", "concise", "detailed":
			default:
				return errors.New("subscription reasoning summary is unsupported")
			}
		}
	}
	for _, key := range []string{"thinking_budget", "thinking_token_budget"} {
		if raw := fields[key]; subscriptionJSONFieldHasValue(raw) {
			if err := validatePositiveSubscriptionBudget(raw, outputLimit, key); err != nil {
				return err
			}
		}
	}
	for _, key := range []string{"enable_thinking", "include_reasoning", "separate_reasoning", "stream_reasoning"} {
		if raw := fields[key]; subscriptionJSONFieldHasValue(raw) {
			var value bool
			if err := common.Unmarshal(raw, &value); err != nil {
				return fmt.Errorf("subscription %s must be a boolean", key)
			}
		}
	}
	if raw := fields["verbosity"]; subscriptionJSONFieldHasValue(raw) {
		var value string
		if err := common.Unmarshal(raw, &value); err != nil {
			return errors.New("subscription verbosity is invalid")
		}
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "low", "medium", "high":
		default:
			return errors.New("subscription verbosity is unsupported")
		}
	}
	if raw := fields["top_logprobs"]; subscriptionJSONFieldHasValue(raw) {
		var value int
		if err := common.Unmarshal(raw, &value); err != nil || value != 0 {
			return errors.New("subscription requests do not support output log probabilities")
		}
	}
	if raw := fields["prompt_cache_key"]; subscriptionJSONFieldHasValue(raw) {
		var value string
		if err := common.Unmarshal(raw, &value); err != nil {
			return errors.New("subscription prompt cache key is invalid")
		}
	}
	return validateOpenAIStreamOptions(fields["stream_options"])
}

func validateReasoningEffortValue(raw json.RawMessage) error {
	var effort string
	if err := common.Unmarshal(raw, &effort); err != nil {
		return errors.New("subscription reasoning effort is invalid")
	}
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "", "none", "minimal", "low", "medium", "high", "xhigh", "max":
		return nil
	default:
		return errors.New("subscription reasoning effort is unsupported")
	}
}

func validatePositiveSubscriptionBudget(raw json.RawMessage, outputLimit int, field string) error {
	var budget int64
	if err := common.Unmarshal(raw, &budget); err != nil || budget <= 0 {
		return fmt.Errorf("subscription %s must be a positive integer", field)
	}
	if budget > int64(outputLimit) {
		return fmt.Errorf("subscription %s exceeds the request output limit", field)
	}
	return nil
}

func validateOpenAIStreamOptions(raw json.RawMessage) error {
	if !subscriptionJSONFieldHasValue(raw) {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(raw, &fields); err != nil {
		return errors.New("subscription stream options must be an object")
	}
	for key := range fields {
		if key != "include_usage" && key != "include_obfuscation" {
			return fmt.Errorf("subscription stream options do not support %q", key)
		}
	}
	return nil
}

func validateOpenAIStore(fields map[string]json.RawMessage) error {
	raw, ok := fields["store"]
	if !ok || strings.TrimSpace(string(raw)) == "null" {
		return nil
	}
	var store bool
	if err := common.Unmarshal(raw, &store); err != nil {
		return errors.New("subscription store setting must be a boolean")
	}
	if store {
		return errors.New("subscription requests do not support stored responses")
	}
	return nil
}

func validateOpenAIResponsesInclude(fields map[string]json.RawMessage) error {
	raw, ok := fields["include"]
	if !ok || strings.TrimSpace(string(raw)) == "null" {
		return nil
	}
	var included []string
	if err := common.Unmarshal(raw, &included); err != nil {
		return errors.New("subscription Responses include must be an array of strings")
	}
	for _, value := range included {
		switch strings.TrimSpace(value) {
		case "reasoning.encrypted_content", "message.output_text.logprobs":
		default:
			return fmt.Errorf("subscription Responses do not support include %q", value)
		}
	}
	return nil
}

func validateOpenAIChatContent(fields map[string]json.RawMessage) error {
	if err := validateOpenAITopLevelText(fields, "prompt", "prefix", "suffix", "input", "instruction"); err != nil {
		return err
	}
	rawMessages := fields["messages"]
	if subscriptionJSONFieldHasValue(rawMessages) {
		var messages []map[string]json.RawMessage
		if err := common.Unmarshal(rawMessages, &messages); err != nil {
			return errors.New("subscription chat messages cannot be budgeted")
		}
		for _, message := range messages {
			for key, raw := range message {
				if !subscriptionJSONFieldHasValue(raw) {
					continue
				}
				switch key {
				case "role", "content", "name", "prefix", "reasoning_content", "reasoning",
					"tool_calls", "tool_call_id", "tools", "annotations":
				default:
					return fmt.Errorf("subscription chat messages do not support %q", key)
				}
			}
			if err := validateOpenAIChatMessageContent(message["content"]); err != nil {
				return err
			}
			if raw := message["tools"]; subscriptionJSONFieldHasValue(raw) {
				if err := validateOpenAISubscriptionTools(raw); err != nil {
					return err
				}
			}
		}
	}
	if raw := fields["text"]; subscriptionJSONFieldHasValue(raw) {
		var text map[string]json.RawMessage
		if err := common.Unmarshal(raw, &text); err != nil {
			return errors.New("subscription text configuration must be an object")
		}
		for key := range text {
			if key != "format" && key != "verbosity" {
				return fmt.Errorf("subscription text configuration does not support %q", key)
			}
		}
	}
	return nil
}

func validateOpenAIChatMessageContent(raw json.RawMessage) error {
	if !subscriptionJSONFieldHasValue(raw) {
		return nil
	}
	var kind string
	if err := common.Unmarshal(raw, &kind); err == nil {
		return nil
	}
	var parts []map[string]json.RawMessage
	if err := common.Unmarshal(raw, &parts); err != nil {
		return errors.New("subscription chat message content cannot be budgeted")
	}
	for _, part := range parts {
		var partType string
		if rawType := part["type"]; subscriptionJSONFieldHasValue(rawType) {
			if err := common.Unmarshal(rawType, &partType); err != nil {
				return errors.New("subscription chat content type is invalid")
			}
		}
		switch strings.ToLower(strings.TrimSpace(partType)) {
		case "text", "input_text", "output_text", "refusal":
			for key, value := range part {
				if key == "type" || key == "text" || key == "refusal" || !subscriptionJSONFieldHasValue(value) {
					continue
				}
				return fmt.Errorf("subscription chat content does not support %q", key)
			}
		default:
			return errors.New("subscription requests support text-only chat content")
		}
	}
	return nil
}

func validateOpenAITopLevelText(fields map[string]json.RawMessage, names ...string) error {
	for _, name := range names {
		raw := fields[name]
		if !subscriptionJSONFieldHasValue(raw) {
			continue
		}
		var text string
		if err := common.Unmarshal(raw, &text); err == nil {
			continue
		}
		var texts []string
		if err := common.Unmarshal(raw, &texts); err == nil {
			continue
		}
		return fmt.Errorf("subscription %s must be a string or string array", name)
	}
	return nil
}

func validateOpenAISubscriptionTools(raw json.RawMessage) error {
	var tools []map[string]json.RawMessage
	if err := common.Unmarshal(raw, &tools); err != nil {
		return errors.New("subscription tool declarations cannot be budgeted")
	}
	for _, tool := range tools {
		var kind string
		if err := common.Unmarshal(tool["type"], &kind); err != nil {
			return errors.New("subscription tool type is invalid")
		}
		switch strings.ToLower(strings.TrimSpace(kind)) {
		case "function", "custom":
		default:
			return errors.New("subscription requests do not support hosted tools")
		}
	}
	return nil
}

func validateOpenAIResponsesInput(fields map[string]json.RawMessage) error {
	rawInput := fields["input"]
	if !subscriptionJSONFieldHasValue(rawInput) {
		return nil
	}
	var text string
	if err := common.Unmarshal(rawInput, &text); err == nil {
		return nil
	}
	var items []map[string]json.RawMessage
	if err := common.Unmarshal(rawInput, &items); err != nil {
		return errors.New("subscription Responses input cannot be budgeted")
	}
	for _, item := range items {
		var itemType string
		if raw := item["type"]; subscriptionJSONFieldHasValue(raw) {
			if err := common.Unmarshal(raw, &itemType); err != nil {
				return errors.New("subscription Responses input type is invalid")
			}
		}
		switch strings.ToLower(strings.TrimSpace(itemType)) {
		case "message":
			if err := validateOpenAIChatMessageContent(item["content"]); err != nil {
				return err
			}
		case "function_call":
			if err := validateOpenAIResponsesTextField(item["arguments"]); err != nil {
				return err
			}
		case "custom_tool_call":
			if err := validateOpenAIResponsesTextField(item["input"]); err != nil {
				return err
			}
		case "function_call_output", "custom_tool_call_output":
			if err := validateOpenAIResponsesTextField(item["output"]); err != nil {
				return err
			}
		case "local_shell_call", "local_shell_call_output", "apply_patch_call", "apply_patch_call_output":
		case "reasoning":
			for key, raw := range item {
				if key == "type" || key == "id" || key == "summary" || key == "content" ||
					key == "encrypted_content" || !subscriptionJSONFieldHasValue(raw) {
					continue
				}
				return fmt.Errorf("subscription Responses reasoning does not support %q", key)
			}
		default:
			return errors.New("subscription Responses requests support text messages and client tool replay only")
		}
	}
	return nil
}

func validateOpenAIResponsesTextField(raw json.RawMessage) error {
	if !subscriptionJSONFieldHasValue(raw) {
		return nil
	}
	var text string
	if err := common.Unmarshal(raw, &text); err == nil {
		return nil
	}
	return validateOpenAIChatMessageContent(raw)
}

func validateClaudeSubscriptionFields(fields map[string]json.RawMessage, outputLimit int) error {
	if raw := fields["thinking"]; subscriptionJSONFieldHasValue(raw) {
		var thinking map[string]json.RawMessage
		if err := common.Unmarshal(raw, &thinking); err != nil {
			return errors.New("subscription Claude thinking configuration must be an object")
		}
		for key := range thinking {
			switch key {
			case "type", "budget_tokens", "display", "block_binding":
			default:
				return fmt.Errorf("subscription Claude thinking does not support %q", key)
			}
		}
		if rawType := thinking["type"]; subscriptionJSONFieldHasValue(rawType) {
			var value string
			if err := common.Unmarshal(rawType, &value); err != nil {
				return errors.New("subscription Claude thinking type is invalid")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "", "enabled", "adaptive", "disabled":
			default:
				return errors.New("subscription Claude thinking type is unsupported")
			}
		}
		if rawBudget := thinking["budget_tokens"]; subscriptionJSONFieldHasValue(rawBudget) {
			if err := validatePositiveSubscriptionBudget(rawBudget, outputLimit, "budget_tokens"); err != nil {
				return err
			}
		}
		if rawDisplay := thinking["display"]; subscriptionJSONFieldHasValue(rawDisplay) {
			var value string
			if err := common.Unmarshal(rawDisplay, &value); err != nil {
				return errors.New("subscription Claude thinking display is invalid")
			}
			switch strings.ToLower(strings.TrimSpace(value)) {
			case "", "summarized", "omitted":
			default:
				return errors.New("subscription Claude thinking display is unsupported")
			}
		}
		if rawBinding := thinking["block_binding"]; subscriptionJSONFieldHasValue(rawBinding) {
			if err := validateClaudeThinkingBinding(rawBinding); err != nil {
				return err
			}
		}
	}
	if raw := fields["system"]; subscriptionJSONFieldHasValue(raw) {
		if err := validateClaudeTextContent(raw); err != nil {
			return err
		}
	}
	if raw := fields["messages"]; subscriptionJSONFieldHasValue(raw) {
		var messages []map[string]json.RawMessage
		if err := common.Unmarshal(raw, &messages); err != nil {
			return errors.New("subscription Claude messages cannot be budgeted")
		}
		for _, message := range messages {
			for key, raw := range message {
				if !subscriptionJSONFieldHasValue(raw) {
					continue
				}
				if key != "role" && key != "content" {
					return fmt.Errorf("subscription Claude messages do not support %q", key)
				}
			}
			if err := validateClaudeTextContent(message["content"]); err != nil {
				return err
			}
		}
	}
	if raw := fields["tools"]; subscriptionJSONFieldHasValue(raw) {
		if err := validateClaudeSubscriptionTools(raw); err != nil {
			return err
		}
	}
	return nil
}

func validateClaudeThinkingBinding(raw json.RawMessage) error {
	var binding map[string]json.RawMessage
	if err := common.Unmarshal(raw, &binding); err != nil {
		return errors.New("subscription Claude thinking binding must be an object")
	}
	for key, value := range binding {
		if key != "prefix_mismatch_behavior" || !subscriptionJSONFieldHasValue(value) {
			return fmt.Errorf("subscription Claude thinking binding does not support %q", key)
		}
		var behavior string
		if err := common.Unmarshal(value, &behavior); err != nil || behavior != "drop_block" {
			return errors.New("subscription Claude thinking binding is unsupported")
		}
	}
	return nil
}

func validateClaudeTextContent(raw json.RawMessage) error {
	if !subscriptionJSONFieldHasValue(raw) {
		return nil
	}
	var text string
	if err := common.Unmarshal(raw, &text); err == nil {
		return nil
	}
	var blocks []map[string]json.RawMessage
	if err := common.Unmarshal(raw, &blocks); err != nil {
		return errors.New("subscription Claude content cannot be budgeted")
	}
	for _, block := range blocks {
		var blockType string
		if err := common.Unmarshal(block["type"], &blockType); err != nil {
			return errors.New("subscription Claude content block type is invalid")
		}
		switch strings.ToLower(strings.TrimSpace(blockType)) {
		case "text", "thinking", "redacted_thinking", "tool_use":
			if _, ok := block["cache_control"]; ok {
				return errors.New("subscription requests do not support Claude prompt caching controls")
			}
		case "tool_result":
			if _, ok := block["cache_control"]; ok {
				return errors.New("subscription requests do not support Claude prompt caching controls")
			}
			if err := validateClaudeTextContent(block["content"]); err != nil {
				return err
			}
		default:
			return errors.New("subscription Claude requests support text and client tool replay only")
		}
	}
	return nil
}

func validateClaudeSubscriptionTools(raw json.RawMessage) error {
	var tools []map[string]json.RawMessage
	if err := common.Unmarshal(raw, &tools); err != nil {
		return errors.New("subscription Claude tool declarations cannot be budgeted")
	}
	for _, tool := range tools {
		for key, value := range tool {
			if key == "name" || key == "description" || key == "input_schema" ||
				key == "strict" || !subscriptionJSONFieldHasValue(value) {
				continue
			}
			return fmt.Errorf("subscription Claude tools do not support %q", key)
		}
	}
	return nil
}

func validateGeminiSubscriptionFields(fields map[string]json.RawMessage, outputLimit int) error {
	for _, key := range []string{"contents", "systemInstruction", "system_instruction"} {
		if subscriptionJSONFieldHasValue(fields[key]) {
			if err := validateGeminiSubscriptionContent(fields[key]); err != nil {
				return err
			}
		}
	}
	if subscriptionJSONFieldHasValue(fields["tools"]) {
		var tools []map[string]json.RawMessage
		if err := common.Unmarshal(fields["tools"], &tools); err != nil {
			var single map[string]json.RawMessage
			if err := common.Unmarshal(fields["tools"], &single); err != nil {
				return errors.New("subscription Gemini tools cannot be budgeted")
			}
			tools = []map[string]json.RawMessage{single}
		}
		for _, tool := range tools {
			if !subscriptionJSONFieldHasValue(tool["functionDeclarations"]) && !subscriptionJSONFieldHasValue(tool["function_declarations"]) {
				return errors.New("subscription requests only support client-side Gemini function declarations")
			}
			for key, raw := range tool {
				if key == "functionDeclarations" || key == "function_declarations" || !subscriptionJSONFieldHasValue(raw) {
					continue
				}
				return errors.New("subscription requests do not support hosted Gemini tools")
			}
		}
	}
	if subscriptionJSONFieldHasValue(fields["toolConfig"]) || subscriptionJSONFieldHasValue(fields["tool_config"]) {
		raw := fields["toolConfig"]
		if !subscriptionJSONFieldHasValue(raw) {
			raw = fields["tool_config"]
		}
		var config map[string]json.RawMessage
		if err := common.Unmarshal(raw, &config); err != nil {
			return errors.New("subscription Gemini tool configuration cannot be budgeted")
		}
		for key, value := range config {
			if key == "functionCallingConfig" || key == "function_calling_config" || !subscriptionJSONFieldHasValue(value) {
				continue
			}
			return errors.New("subscription requests do not support server-side Gemini tool configuration")
		}
	}

	var config map[string]json.RawMessage
	configRaw := fields["generationConfig"]
	if !subscriptionJSONFieldHasValue(configRaw) {
		configRaw = fields["generation_config"]
	}
	if subscriptionJSONFieldHasValue(configRaw) {
		if err := common.Unmarshal(configRaw, &config); err != nil {
			return errors.New("subscription Gemini generation configuration cannot be budgeted")
		}
	}
	for key, raw := range config {
		switch key {
		case "temperature", "topP", "top_p", "topK", "top_k",
			"maxOutputTokens", "max_output_tokens", "candidateCount", "candidate_count",
			"stopSequences", "stop_sequences", "responseMimeType", "response_mime_type",
			"responseSchema", "response_schema", "responseJsonSchema", "response_json_schema",
			"presencePenalty", "presence_penalty", "frequencyPenalty", "frequency_penalty",
			"responseLogprobs", "response_logprobs", "logprobs",
			"enableEnhancedCivicAnswers", "enable_enhanced_civic_answers",
			"mediaResolution", "media_resolution", "seed",
			"responseModalities", "response_modalities", "thinkingConfig", "thinking_config":
			if !subscriptionJSONFieldHasValue(raw) {
				continue
			}
		default:
			return fmt.Errorf("subscription Gemini generation configuration does not support %q", key)
		}
	}
	for _, key := range []string{
		"speechConfig",
		"speech_config",
		"imageConfig",
		"image_config",
		"mediaProcessing",
		"media_processing",
	} {
		if subscriptionJSONFieldHasValue(config[key]) {
			return fmt.Errorf("subscription Gemini text requests do not support %q", key)
		}
	}
	if raw := config["responseModalities"]; subscriptionJSONFieldHasValue(raw) {
		if err := validateGeminiTextModalities(raw); err != nil {
			return err
		}
	} else if raw := config["response_modalities"]; subscriptionJSONFieldHasValue(raw) {
		if err := validateGeminiTextModalities(raw); err != nil {
			return err
		}
	}
	for _, key := range []string{"responseMimeType", "response_mime_type"} {
		raw := config[key]
		if !subscriptionJSONFieldHasValue(raw) {
			continue
		}
		var mimeType string
		if err := common.Unmarshal(raw, &mimeType); err != nil {
			return errors.New("subscription Gemini response MIME type is invalid")
		}
		mimeType = strings.ToLower(strings.TrimSpace(mimeType))
		if mimeType != "text/plain" && mimeType != "application/json" {
			return errors.New("subscription Gemini requests only support text or JSON output")
		}
	}
	thinkingRaw := config["thinkingConfig"]
	if !subscriptionJSONFieldHasValue(thinkingRaw) {
		thinkingRaw = config["thinking_config"]
	}
	if subscriptionJSONFieldHasValue(thinkingRaw) {
		if err := validateGeminiThinkingConfig(thinkingRaw, outputLimit); err != nil {
			return err
		}
	}
	return nil
}

func validateGeminiSubscriptionContent(raw json.RawMessage) error {
	var contents []json.RawMessage
	if err := common.Unmarshal(raw, &contents); err != nil {
		var single map[string]json.RawMessage
		if err := common.Unmarshal(raw, &single); err != nil {
			return errors.New("subscription Gemini content cannot be budgeted")
		}
		for key, value := range single {
			if key == "role" || key == "parts" || !subscriptionJSONFieldHasValue(value) {
				continue
			}
			return fmt.Errorf("subscription Gemini content does not support %q", key)
		}
		var parts []map[string]json.RawMessage
		if subscriptionJSONFieldHasValue(single["parts"]) {
			if err := common.Unmarshal(single["parts"], &parts); err != nil {
				return errors.New("subscription Gemini content parts cannot be budgeted")
			}
		}
		return validateGeminiSubscriptionParts(parts)
	}
	for _, contentRaw := range contents {
		var content map[string]json.RawMessage
		if err := common.Unmarshal(contentRaw, &content); err != nil {
			return errors.New("subscription Gemini content cannot be budgeted")
		}
		for key, value := range content {
			if key == "role" || key == "parts" || !subscriptionJSONFieldHasValue(value) {
				continue
			}
			return fmt.Errorf("subscription Gemini content does not support %q", key)
		}
		var parts []map[string]json.RawMessage
		if subscriptionJSONFieldHasValue(content["parts"]) {
			if err := common.Unmarshal(content["parts"], &parts); err != nil {
				return errors.New("subscription Gemini content parts cannot be budgeted")
			}
		}
		if err := validateGeminiSubscriptionParts(parts); err != nil {
			return err
		}
	}
	return nil
}

func validateGeminiSubscriptionParts(parts []map[string]json.RawMessage) error {
	for _, part := range parts {
		for key, value := range part {
			switch key {
			case "text", "thought", "thoughtSignature", "thought_signature",
				"functionCall", "function_call", "functionResponse", "function_response",
				"mediaResolution", "media_resolution":
				continue
			default:
				if !subscriptionJSONFieldHasValue(value) {
					continue
				}
				return fmt.Errorf("subscription Gemini requests do not support content part %q", key)
			}
		}
		for _, key := range []string{"functionCall", "function_call"} {
			raw := part[key]
			if !subscriptionJSONFieldHasValue(raw) {
				continue
			}
			var call map[string]json.RawMessage
			if err := common.Unmarshal(raw, &call); err != nil {
				return errors.New("subscription Gemini function call cannot be budgeted")
			}
			for field, value := range call {
				switch field {
				case "id", "name", "args", "partialArgs", "willContinue":
					continue
				default:
					if !subscriptionJSONFieldHasValue(value) {
						continue
					}
					return fmt.Errorf("subscription Gemini function call does not support %q", field)
				}
			}
		}
		for _, key := range []string{"functionResponse", "function_response"} {
			if !subscriptionJSONFieldHasValue(part[key]) {
				continue
			}
			var response map[string]json.RawMessage
			if err := common.Unmarshal(part[key], &response); err != nil {
				return errors.New("subscription Gemini function response cannot be budgeted")
			}
			for field, value := range response {
				switch field {
				case "name", "response", "willContinue", "scheduling", "parts", "id":
					continue
				default:
					if !subscriptionJSONFieldHasValue(value) {
						continue
					}
					return fmt.Errorf("subscription Gemini function response does not support %q", field)
				}
			}
			var nestedParts []map[string]json.RawMessage
			if subscriptionJSONFieldHasValue(response["parts"]) {
				if err := common.Unmarshal(response["parts"], &nestedParts); err != nil {
					return errors.New("subscription Gemini function response parts cannot be budgeted")
				}
			}
			if err := validateGeminiSubscriptionParts(nestedParts); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateGeminiThinkingConfig(raw json.RawMessage, outputLimit int) error {
	var config map[string]json.RawMessage
	if err := common.Unmarshal(raw, &config); err != nil {
		return errors.New("subscription Gemini thinking configuration must be an object")
	}
	for key := range config {
		switch key {
		case "includeThoughts", "include_thoughts", "thinkingBudget",
			"thinking_budget", "thinkingLevel", "thinking_level":
		default:
			return fmt.Errorf("subscription Gemini thinking configuration does not support %q", key)
		}
	}
	for _, key := range []string{"thinkingBudget", "thinking_budget"} {
		if rawBudget := config[key]; subscriptionJSONFieldHasValue(rawBudget) {
			if err := validatePositiveSubscriptionBudget(rawBudget, outputLimit, key); err != nil {
				return err
			}
		}
	}
	for _, key := range []string{"thinkingLevel", "thinking_level"} {
		rawLevel := config[key]
		if !subscriptionJSONFieldHasValue(rawLevel) {
			continue
		}
		if err := validateReasoningEffortValue(rawLevel); err != nil {
			return err
		}
	}
	for _, key := range []string{"includeThoughts", "include_thoughts"} {
		rawInclude := config[key]
		if !subscriptionJSONFieldHasValue(rawInclude) {
			continue
		}
		var value bool
		if err := common.Unmarshal(rawInclude, &value); err != nil {
			return fmt.Errorf("subscription Gemini %s must be a boolean", key)
		}
	}
	return nil
}

func validateGeminiTextModalities(raw json.RawMessage) error {
	var modalities []string
	if err := common.Unmarshal(raw, &modalities); err != nil || len(modalities) != 1 {
		return errors.New("subscription Gemini requests require one text output modality")
	}
	if !strings.EqualFold(strings.TrimSpace(modalities[0]), "TEXT") {
		return errors.New("subscription Gemini requests only support text output")
	}
	return nil
}
