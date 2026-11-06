package service

import (
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

// ValidateSubscriptionEndpoint keeps protocols without a bounded text budget
// out of subscription routing, including routes handled without PrepareRequestBilling.
func ValidateSubscriptionEndpoint(c *gin.Context, usingGroup string) *types.NewAPIError {
	userID := c.GetInt("id")
	if userID <= 0 {
		return nil
	}
	if userSetting, ok := common.GetContextKeyType[dto.UserSetting](c, constant.ContextKeyUserSetting); ok &&
		common.NormalizeBillingPreference(userSetting.BillingPreference) == "wallet_only" {
		return nil
	}
	if usingGroup == "auto" {
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyAutoGroup)
	}
	if IsFreeGroup(c, usingGroup) {
		return nil
	}
	covered, err := model.HasActiveSubscriptionForGroup(userID, usingGroup)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if !covered {
		return nil
	}
	if c.GetInt("channel_type") == constant.ChannelTypeTaskPlugin {
		return subscriptionEndpointUnsupported(c)
	}
	if c.Request != nil {
		path := c.Request.URL.Path
		textPath := path == "/v1/chat/completions" || path == "/v1/completions" ||
			path == "/pg/chat/completions" || path == "/v1/messages" ||
			path == "/v1/responses" ||
			strings.HasSuffix(path, ":generateContent") || strings.HasSuffix(path, ":streamGenerateContent")
		if textPath {
			return nil
		}
	}
	return subscriptionEndpointUnsupported(c)
}

func subscriptionEndpointUnsupported(c *gin.Context) *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		errors.New(i18n.T(c, i18n.MsgSubscriptionEndpointUnsupported)),
		types.ErrorCodeInvalidRequest, http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog(),
	)
}
