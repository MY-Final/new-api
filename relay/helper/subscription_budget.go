package helper

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
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
	info.SubscriptionCostRatio = 0
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
	info.SubscriptionCostRatio = subscription.RouteGroupCostRatios[group]
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

// FinalizeSubscriptionRequestBudget verifies the input-cost reservation before
// upstream traffic, preserving the provider body and the client's output limit.
func FinalizeSubscriptionRequestBudget(_ *gin.Context, info *relaycommon.RelayInfo, raw []byte) ([]byte, error) {
	if info.SubscriptionOutputLimit <= 0 || info.BillingSource != service.BillingSourceSubscription {
		return raw, nil
	}
	if len(raw) == 0 || info.Billing == nil {
		return nil, errors.New("subscription request has no reserved budget")
	}
	info.FinalPreConsumedQuota = info.Billing.GetPreConsumedQuota()
	return raw, nil
}
