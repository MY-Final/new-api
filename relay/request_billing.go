package relay

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// PrepareRequestBilling estimates and reserves one request's charge. Transports
// provide the current request body through BodyStorage or BillingRequestInput;
// channel retries retain the resulting billing session and pricing snapshot.
func PrepareRequestBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if err := helper.PrepareSubscriptionRequest(c, info); err != nil {
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if apiErr := service.ValidateSubscriptionEndpoint(c, info.UsingGroup); apiErr != nil {
		return apiErr
	}
	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	meta := &types.TokenCountMeta{TokenType: types.TokenTypeTokenizer}
	if info.Request != nil && (needSensitiveCheck || constant.CountToken) {
		meta = info.Request.GetTokenCountMeta()
	} else {
		// Avoid building CombineText when only the pricing quantities are needed.
		switch request := info.Request.(type) {
		case *dto.GeneralOpenAIRequest:
			meta.MaxTokens = int(max(lo.FromPtr(request.MaxTokens), lo.FromPtr(request.MaxCompletionTokens)))
		case *dto.OpenAIResponsesRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxOutputTokens))
		case *dto.ClaudeRequest:
			meta.MaxTokens = int(lo.FromPtr(request.MaxTokens))
		case *dto.ImageRequest:
			meta = request.GetTokenCountMeta()
		}
	}

	if needSensitiveCheck && meta != nil {
		if contains, words := service.CheckSensitiveText(meta.CombineText); contains {
			service.RequestPolicy(c).AddEvent(service.PolicyEvent{ErrorCode: string(types.ErrorCodeSensitiveWordsDetected), ErrorSource: "local", Decision: service.PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
			message := fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", "))
			logger.LogWarn(c, message)
			return types.NewError(errors.New(message), types.ErrorCodeSensitiveWordsDetected)
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, info)
	if err != nil {
		return types.NewError(err, types.ErrorCodeCountTokenFailed)
	}
	info.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if priceData.FreeModel {
		logger.LogInfo(c, common.LogText("model %s is free, skipping pre-consume", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// PrepareSelectedGroupBilling reconciles the package/wallet funding source
// after an Auto-group retry. The previous reservation is refunded before the
// selected group is repriced and its new source is reserved.
func PrepareSelectedGroupBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	currentSource := info.BillingSource
	currentSubscriptionID := 0
	if session, ok := info.Billing.(*service.BillingSession); ok {
		currentSubscriptionID = session.SubscriptionID()
	}
	if err := helper.PrepareSubscriptionRequest(c, info); err != nil {
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	desiredSubscriptionID := info.SubscriptionId
	sourceChanged := desiredSubscriptionID > 0 && currentSource != service.BillingSourceSubscription ||
		desiredSubscriptionID == 0 && currentSource == service.BillingSourceSubscription
	subscriptionChanged := desiredSubscriptionID > 0 &&
		currentSource == service.BillingSourceSubscription &&
		currentSubscriptionID != desiredSubscriptionID
	if !sourceChanged && !subscriptionChanged {
		return nil
	}
	hadSubscriptionUsage := currentSource == service.BillingSourceSubscription ||
		info.SubscriptionUsageRequestId != ""

	if info.Billing != nil {
		session, ok := info.Billing.(*service.BillingSession)
		if !ok {
			return types.NewError(
				errors.New("cannot switch an unsupported billing session between routing groups"),
				types.ErrorCodeUpdateDataError,
				types.ErrOptionWithSkipRetry(),
			)
		}
		if err := session.CancelReservation(); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		info.Billing = nil
	}
	info.BillingSource = ""
	if hadSubscriptionUsage && desiredSubscriptionID > 0 {
		info.SubscriptionUsageRequestId = fmt.Sprintf("%s:subscription:%s", info.RequestId, common.NewRequestId())
	}
	info.SubscriptionPreConsumed = 0
	info.SubscriptionPostDelta = 0
	info.SubscriptionAmountTotal = 0
	info.SubscriptionAmountUsedAfterPreConsume = 0
	info.SubscriptionPlanId = 0
	info.SubscriptionPlanTitle = ""
	info.FinalPreConsumedQuota = 0
	info.SubscriptionInputBudget = 0
	info.TieredBillingSnapshot = nil
	info.BillingRequestInput = nil
	info.QuotaClamp = nil

	var meta *types.TokenCountMeta
	if info.Request != nil {
		meta = info.Request.GetTokenCountMeta()
	} else {
		meta = &types.TokenCountMeta{}
	}
	priceData, err := helper.ModelPriceHelper(c, info, info.GetEstimatePromptTokens(), meta)
	if err != nil {
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if priceData.FreeModel {
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// FinalizeSubscriptionRequestBilling validates and reserves the final
// protocol body immediately before it is sent to an upstream provider.
func FinalizeSubscriptionRequestBilling(c *gin.Context, info *relaycommon.RelayInfo, body []byte) ([]byte, *types.NewAPIError) {
	body, err := helper.FinalizeSubscriptionRequestBudget(c, info, body)
	if err != nil {
		return nil, types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	return body, nil
}

// RefundFailedRequestBilling applies the common final-failure policy after all
// eligible attempts have ended. A settled BillingSession never refunds again.
func RefundFailedRequestBilling(c *gin.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) *types.NewAPIError {
	if apiErr == nil {
		return nil
	}
	apiErr = service.NormalizeViolationFeeError(apiErr)
	if info.Billing != nil {
		info.Billing.Refund(c)
	}
	service.ChargeViolationFeeIfNeeded(c, info, apiErr)
	return apiErr
}
