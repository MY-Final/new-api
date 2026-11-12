package helper

import (
	"errors"
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
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

func subscriptionRequestLimit(request dto.Request, limit int) (uint, error) {
	if request == nil || limit <= 0 {
		return 0, errors.New("subscription text request is required")
	}
	cap := uint(limit)
	var limits []*uint
	switch value := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if value.N != nil && *value.N != 1 {
			return 0, errors.New("subscription requests require one text completion")
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
	return cap, nil
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

// FinalizeSubscriptionRequestBudget raises the reservation before any upstream
// traffic. It leaves the request body untouched so subscription requests relay
// the same provider fields as wallet-funded requests.
func FinalizeSubscriptionRequestBudget(c *gin.Context, info *relaycommon.RelayInfo, raw []byte) ([]byte, error) {
	if info.SubscriptionOutputLimit <= 0 || info.BillingSource != service.BillingSourceSubscription {
		return raw, nil
	}
	if len(raw) == 0 || info.Billing == nil {
		return nil, errors.New("subscription request has no reserved budget")
	}
	// UTF-8 bytes conservatively bound text tokens, but base64 media makes the
	// encoded byte length far larger than its prompt-token cost. Count media
	// requests from their token metadata so a small image does not exhaust a
	// rolling quota window during the initial reservation.
	mediaRequest := false
	mediaBudget := 0
	if info.Request != nil {
		if meta := info.Request.GetTokenCountMeta(); len(meta.Files) > 0 {
			mediaRequest = true
			tokens, err := service.EstimateRequestToken(c, meta, info)
			if err != nil {
				return nil, err
			}
			mediaBudget = tokens
		}
	}
	if mediaRequest {
		info.SubscriptionInputBudget = max(info.GetEstimatePromptTokens(), mediaBudget)
	} else {
		info.SubscriptionInputBudget = max(info.SubscriptionInputBudget, len(raw))
	}
	if err := UpdateSubscriptionPriceBudget(info); err != nil {
		return nil, err
	}
	if err := info.Billing.ReserveBeforeSubmit(info.PriceData.QuotaToPreConsume); err != nil {
		return nil, err
	}
	info.FinalPreConsumedQuota = info.Billing.GetPreConsumedQuota()
	return raw, nil
}
