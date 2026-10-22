package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubEmailRouting installs a routing table and the Resend limits for one test.
// The shared test database gains the statistics table on demand so these tests
// do not depend on the global migration list.
func stubEmailRouting(t *testing.T, globalProvider string, routes map[string]string, dailyLimit int, monthlyLimit int) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.EmailSendStat{}))
	require.NoError(t, model.DB.Exec("DELETE FROM email_send_stats").Error)

	encoded, err := common.Marshal(routes)
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{
		"EmailProvider": globalProvider,
		system_setting.EmailPurposeProvidersOption: string(encoded),
	}
	common.OptionMapRWMutex.Unlock()

	previousDaily, previousMonthly := common.ResendDailyQuota, common.ResendMonthlyQuota
	previousServer, previousAccount := common.SMTPServer, common.SMTPAccount
	common.ResendDailyQuota, common.ResendMonthlyQuota = dailyLimit, monthlyLimit
	common.SMTPServer, common.SMTPAccount = "smtp.example.com", "sender@example.com"
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		common.ResendDailyQuota, common.ResendMonthlyQuota = previousDaily, previousMonthly
		common.SMTPServer, common.SMTPAccount = previousServer, previousAccount
	})
}

func TestResolveEmailProviderAppliesPurposeOverrides(t *testing.T) {
	stubEmailRouting(t, common.EmailProviderSMTP, map[string]string{
		common.EmailPurposeTicket:       common.EmailProviderResend,
		common.EmailPurposeNotification: common.EmailProviderSMTP,
	}, 0, 0)

	ticket, err := ResolveEmailProvider(common.EmailPurposeTicket)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderResend, ticket)

	// An unlisted purpose keeps following the global selector.
	verify, err := ResolveEmailProvider(common.EmailPurposeVerify)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderSMTP, verify)

	// An explicit SMTP route wins over a global Resend selector.
	stubEmailRouting(t, common.EmailProviderResend, map[string]string{
		common.EmailPurposeNotification: common.EmailProviderSMTP,
	}, 0, 0)
	notification, err := ResolveEmailProvider(common.EmailPurposeNotification)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderSMTP, notification)
}

func TestResolveEmailProviderKeepsResendBelowTheDailyLimit(t *testing.T) {
	stubEmailRouting(t, common.EmailProviderResend, nil, 2, 0)
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, true)

	provider, err := ResolveEmailProvider(common.EmailPurposeVerify)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderResend, provider)
}

func TestResolveEmailProviderFallsBackToSMTPWhenTheQuotaIsSpent(t *testing.T) {
	stubEmailRouting(t, common.EmailProviderResend, nil, 2, 0)
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, true)
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, true)

	provider, err := ResolveEmailProvider(common.EmailPurposeVerify)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderSMTP, provider, "mail still leaves through the other transport")

	// Undelivered attempts never consume quota.
	stubEmailRouting(t, common.EmailProviderResend, nil, 2, 0)
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, false)
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, false)
	provider, err = ResolveEmailProvider(common.EmailPurposeVerify)
	require.NoError(t, err)
	assert.Equal(t, common.EmailProviderResend, provider)
}

func TestResolveEmailProviderRefusesWhenTheQuotaIsSpentWithoutFallback(t *testing.T) {
	stubEmailRouting(t, common.EmailProviderResend, nil, 0, 1)
	common.SMTPServer, common.SMTPAccount = "", ""
	model.RecordEmailDelivery(common.EmailPurposeVerify, common.EmailProviderResend, true)

	provider, err := ResolveEmailProvider(common.EmailPurposeVerify)
	require.Error(t, err)
	assert.Equal(t, common.EmailProviderResend, provider, "the attempt is attributed to the blocked transport")
	assert.Contains(t, err.Error(), "monthly sending quota reached")
}
