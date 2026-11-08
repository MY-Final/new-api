package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// A request whose output limit exceeds the package cap is invalid for the
// subscription itself. Even with automatic wallet fallback enabled, it must be
// rejected instead of being silently shifted to the wallet: only an exhausted
// quota window (insufficient quota) may fall back.
func TestReserveRequestBillingRejectsOverLimitSubscriptionRequest(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		UserId:                          1,
		UserGroup:                       "sub",
		UsingGroup:                      "sub",
		SubscriptionId:                  1,
		SubscriptionOutputLimit:         2048,
		SubscriptionAllowWalletOverflow: true,
		UserSetting:                     dto.UserSetting{BillingPreference: ""},
		Request:                         &dto.GeneralOpenAIRequest{Model: "gpt-test", MaxTokens: common.GetPointer[uint](16384)},
	}

	apiErr := reserveRequestBilling(c, info, 0, &types.TokenCountMeta{})
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCodeInvalidRequest, apiErr.GetErrorCode())
	require.Contains(t, apiErr.Error(), "subscription limit")
}
