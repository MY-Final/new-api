package service

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// ResolveEmailProvider picks the transport for one message. A purpose override
// wins over the global selector. The only automatic switch happens when a
// Resend quota is already exhausted: that decision is made before anything is
// sent, so it cannot duplicate a delivered message, unlike retrying after a
// transport error.
func ResolveEmailProvider(purpose string) (string, error) {
	provider := common.EmailProviderName()
	if routed := system_setting.EmailPurposeProviders()[purpose]; routed != "" {
		provider = routed
	}
	if provider != common.EmailProviderResend {
		return provider, nil
	}

	usedToday, usedMonth := resendDeliveredCounts()
	dailyReached := common.ResendDailyQuota > 0 && usedToday >= int64(common.ResendDailyQuota)
	monthlyReached := common.ResendMonthlyQuota > 0 && usedMonth >= int64(common.ResendMonthlyQuota)
	if !dailyReached && !monthlyReached {
		return provider, nil
	}
	if common.SMTPServer != "" || common.SMTPAccount != "" {
		common.SysLog(common.LogText("resend quota reached, sending %s email through SMTP", purpose))
		return common.EmailProviderSMTP, nil
	}
	if dailyReached {
		return provider, common.NewMessage("Resend daily sending quota reached")
	}
	return provider, common.NewMessage("Resend monthly sending quota reached")
}

// resendDeliveredCounts returns today's and this month's Resend deliveries.
// Quota enforcement fails open: a statistics read error must not stop mail.
func resendDeliveredCounts() (today int64, month int64) {
	now := time.Now()
	todayDate := now.Format("2006-01-02")
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
	rows, err := model.ListEmailSendStats(monthStart, todayDate)
	if err != nil {
		common.SysError(common.LogText("failed to read resend quota usage: %s", err.Error()))
		return 0, 0
	}
	for _, row := range rows {
		if row.Provider != common.EmailProviderResend {
			continue
		}
		month += row.Delivered
		if row.Date == todayDate {
			today += row.Delivered
		}
	}
	return today, month
}
