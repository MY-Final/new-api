package service

import (
	"fmt"
	"html"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const usageReportEmailTemplateKey = "usage"

// usageReportEmailData holds the values shared by the built-in localized
// template and an administrator's custom template.
type usageReportEmailData struct {
	Date              string
	DateRange         string
	RequestCount      int64
	Quota             int64
	WalletQuota       int64
	SubscriptionQuota int64
	TotalTokens       int64
	Groups            []model.UsageReportGroup
}

func usageReportEmailDataFrom(report *model.UsageReport) usageReportEmailData {
	date := report.Date
	return usageReportEmailData{
		Date:              date,
		DateRange:         date + " 00:00–22:00",
		RequestCount:      report.RequestCount,
		Quota:             report.Quota,
		WalletQuota:       report.WalletQuota,
		SubscriptionQuota: report.SubscriptionQuota,
		TotalTokens:       report.TotalTokens,
		Groups:            report.DecodeUsageReportGroups(),
	}
}

// renderUsageReportEmail builds the message from the stored snapshot. Nothing
// here reads live usage data, so a retry always renders identical content.
func renderUsageReportEmail(report *model.UsageReport, username string, lang string) (string, string, error) {
	data := usageReportEmailDataFrom(report)
	groupTable := usageReportGroupTable(data, lang)
	quotaNote := fmt.Sprintf("%s · %s · %s",
		usageReportLabel(lang, i18n.MsgEmailUsageReportWallet, map[string]any{"Amount": formatUsageReportQuota(data.WalletQuota)}),
		usageReportLabel(lang, i18n.MsgEmailUsageReportSubscription, map[string]any{"Amount": formatUsageReportQuota(data.SubscriptionQuota)}),
		usageReportLabel(lang, i18n.MsgEmailUsageReportTotal, map[string]any{"Amount": formatUsageReportQuota(data.Quota)}),
	)
	if system_setting.HasEmailTemplateOverride(usageReportEmailTemplateKey) {
		vars := map[string]string{
			"Greeting":     usageReportLabel(lang, i18n.MsgEmailUsageReportGreeting, map[string]any{"Username": username, "Date": data.Date}),
			"DateRange":    usageReportLabel(lang, i18n.MsgEmailUsageReportRange, map[string]any{"DateRange": data.DateRange}),
			"RequestCount": formatUsageReportCount(data.RequestCount),
			"Quota":        formatUsageReportQuota(data.Quota),
			"TotalTokens":  formatUsageReportCount(data.TotalTokens),
			"QuotaNote":    quotaNote,
			"GroupTitle":   usageReportLabel(lang, i18n.MsgEmailUsageReportGroupTitle),
			"Footer":       usageReportLabel(lang, i18n.MsgEmailUsageReportFooter),
		}
		return RenderEmailTemplateHTML(usageReportEmailTemplateKey, vars, map[string]string{"GroupTable": groupTable})
	}

	subject := usageReportLabel(lang, i18n.MsgEmailUsageReportSubject, map[string]any{"SystemName": common.SystemName})
	var content strings.Builder
	content.WriteString(`<p style="margin:0 0 4px;font-size:15px;font-weight:600;">`)
	content.WriteString(html.EscapeString(usageReportLabel(lang, i18n.MsgEmailUsageReportGreeting, map[string]any{"Username": username, "Date": data.Date})))
	content.WriteString(`</p><p style="margin:0 0 16px;color:#6b7280;font-size:13px;">`)
	content.WriteString(html.EscapeString(usageReportLabel(lang, i18n.MsgEmailUsageReportRange, map[string]any{"DateRange": data.DateRange})))
	content.WriteString(`</p>`)
	content.WriteString(usageReportSummaryCards(data, lang))
	content.WriteString(`<p style="margin:12px 0 0;color:#4b5563;font-size:13px;">`)
	content.WriteString(html.EscapeString(quotaNote))
	content.WriteString(`</p><p style="margin:20px 0 8px;font-size:14px;font-weight:600;">`)
	content.WriteString(html.EscapeString(usageReportLabel(lang, i18n.MsgEmailUsageReportGroupTitle)))
	content.WriteString(`</p>`)
	content.WriteString(groupTable)
	content.WriteString(`<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">`)
	content.WriteString(html.EscapeString(usageReportLabel(lang, i18n.MsgEmailUsageReportFooter)))
	content.WriteString(`</p>`)
	return subject, RenderEmailLayout(content.String()), nil
}

func usageReportSummaryCards(data usageReportEmailData, lang string) string {
	cards := []struct {
		label string
		value string
	}{
		{usageReportLabel(lang, i18n.MsgEmailUsageReportRequests), formatUsageReportCount(data.RequestCount)},
		{usageReportLabel(lang, i18n.MsgEmailUsageReportQuota), formatUsageReportQuota(data.Quota)},
		{usageReportLabel(lang, i18n.MsgEmailUsageReportTokens), formatUsageReportCount(data.TotalTokens)},
	}
	var builder strings.Builder
	builder.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;"><tr>`)
	for _, card := range cards {
		builder.WriteString(`<td width="33%" style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">`)
		builder.WriteString(`<div style="color:#6b7280;font-size:12px;">`)
		builder.WriteString(html.EscapeString(card.label))
		builder.WriteString(`</div><div style="font-size:18px;font-weight:600;margin-top:2px;">`)
		builder.WriteString(html.EscapeString(card.value))
		builder.WriteString(`</div></td>`)
	}
	builder.WriteString(`</tr></table>`)
	return builder.String()
}

func usageReportGroupTable(data usageReportEmailData, lang string) string {
	var builder strings.Builder
	builder.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">`)
	builder.WriteString(`<tr style="color:#6b7280;font-size:12px;text-align:left;">`)
	for _, header := range []string{
		usageReportLabel(lang, i18n.MsgEmailUsageReportGroup),
		usageReportLabel(lang, i18n.MsgEmailUsageReportRequests),
		usageReportLabel(lang, i18n.MsgEmailUsageReportQuota),
		usageReportLabel(lang, i18n.MsgEmailUsageReportTokens),
	} {
		builder.WriteString(`<th style="padding:6px 4px;border-bottom:1px solid #e5e7eb;font-weight:500;">`)
		builder.WriteString(html.EscapeString(header))
		builder.WriteString(`</th>`)
	}
	builder.WriteString(`</tr>`)
	if len(data.Groups) == 0 {
		builder.WriteString(`<tr><td colspan="4" style="padding:12px 4px;color:#9ca3af;">`)
		builder.WriteString(html.EscapeString(usageReportLabel(lang, i18n.MsgEmailUsageReportNoGroups)))
		builder.WriteString(`</td></tr>`)
	}
	for _, group := range data.Groups {
		builder.WriteString(`<tr style="border-bottom:1px solid #f3f4f6;">`)
		builder.WriteString(`<td style="padding:8px 4px;">`)
		builder.WriteString(html.EscapeString(groupName(group.Group)))
		builder.WriteString(`<div style="margin-top:4px;height:4px;background:#f3f4f6;border-radius:2px;overflow:hidden;"><div style="height:4px;width:`)
		builder.WriteString(strconv.FormatFloat(usageReportShare(group.Quota, data.Quota), 'f', 1, 64))
		builder.WriteString(`%;background:#2563eb;"></div></div></td>`)
		builder.WriteString(`<td style="padding:8px 4px;">`)
		builder.WriteString(html.EscapeString(formatUsageReportCount(group.RequestCount)))
		builder.WriteString(`</td><td style="padding:8px 4px;">`)
		builder.WriteString(html.EscapeString(formatUsageReportQuota(group.Quota)))
		builder.WriteString(`</td><td style="padding:8px 4px;">`)
		builder.WriteString(html.EscapeString(formatUsageReportCount(group.Tokens)))
		builder.WriteString(`</td></tr>`)
	}
	builder.WriteString(`</table>`)
	return builder.String()
}

func usageReportLabel(lang string, key string, args ...map[string]any) string {
	return i18n.Translate(lang, key, args...)
}

func groupName(group string) string {
	if strings.TrimSpace(group) == "" {
		return "-"
	}
	return group
}

func usageReportShare(part int64, total int64) float64 {
	if total <= 0 || part <= 0 {
		return 0
	}
	share := float64(part) / float64(total) * 100
	if share > 100 {
		return 100
	}
	return share
}

// formatUsageReportQuota renders a quota the way the console does according to
// the site's display setting, without the six-decimal noise of log output.
func formatUsageReportQuota(quota int64) string {
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		return formatUsageReportCount(quota)
	}
	if common.QuotaPerUnit <= 0 {
		return formatUsageReportCount(quota)
	}
	rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	amount := float64(quota) / common.QuotaPerUnit * rate
	decimals := 2
	if amount != 0 && amount < 0.01 {
		decimals = 6
	}
	return operation_setting.GetCurrencySymbol() + strconv.FormatFloat(amount, 'f', decimals, 64)
}

// formatUsageReportCount renders a count with thousands separators.
func formatUsageReportCount(value int64) string {
	negative := value < 0
	if negative {
		value = -value
	}
	digits := strconv.FormatInt(value, 10)
	var builder strings.Builder
	for index, digit := range digits {
		if index > 0 && (len(digits)-index)%3 == 0 {
			builder.WriteByte(',')
		}
		builder.WriteRune(digit)
	}
	if negative {
		return "-" + builder.String()
	}
	return builder.String()
}
