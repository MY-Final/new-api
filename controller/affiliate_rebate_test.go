package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateAffiliateRebateRateRequiresPaymentCompliance(t *testing.T) {
	settings := operation_setting.GetPaymentSetting()
	originalConfirmed := settings.ComplianceConfirmed
	originalTermsVersion := settings.ComplianceTermsVersion
	settings.ComplianceConfirmed = false
	settings.ComplianceTermsVersion = ""
	t.Cleanup(func() {
		settings.ComplianceConfirmed = originalConfirmed
		settings.ComplianceTermsVersion = originalTermsVersion
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		strings.NewReader(`{"key":"AffiliateTopupRebateRate","value":1000}`),
	)

	UpdateOption(context)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var payload struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
}
