package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// maxUsageReportRangeSeconds bounds an administrator-triggered range so one
// request cannot scan an unbounded share of the log history.
const maxUsageReportRangeSeconds = 31 * 24 * 60 * 60

// UsageReportSendResult reports what an administrator-triggered send delivered.
type UsageReportSendResult struct {
	Recipients   []string `json:"recipients"`
	Sent         int      `json:"sent"`
	Failed       int      `json:"failed"`
	WindowStart  int64    `json:"window_start"`
	WindowEnd    int64    `json:"window_end"`
	RequestCount int64    `json:"request_count"`
	Quota        int64    `json:"quota"`
	TotalTokens  int64    `json:"total_tokens"`
}

// SendUsageReport builds and sends a one-off report for [start, end). It uses
// live logs instead of a snapshot because the administrator chooses the range
// at send time, and it never writes the scheduled snapshot table: a manual send
// is not retried automatically, so the administrator sees the result directly.
func SendUsageReport(user *model.User, start int64, end int64, now time.Time) (*UsageReportSendResult, error) {
	if user == nil || user.Id <= 0 {
		return nil, common.NewMessage("Invalid parameters")
	}
	if start <= 0 || end <= start {
		return nil, common.NewMessage("Invalid parameters")
	}
	if end > now.Unix() {
		end = now.Unix()
	}
	if end <= start {
		return nil, model.ErrUsageReportNoUsage
	}
	if end-start > maxUsageReportRangeSeconds {
		return nil, common.NewMessage("Date range cannot exceed {{days}} days", map[string]any{"days": 31})
	}
	stat, err := model.AggregateUsageReportForUser(user.Id, start, end)
	if err != nil {
		return nil, err
	}
	if stat == nil || stat.RequestCount == 0 {
		return nil, model.ErrUsageReportNoUsage
	}
	recipients, err := model.UsageReportRecipients(user)
	if err != nil {
		return nil, err
	}
	if len(recipients) == 0 {
		return nil, model.ErrUsageReportNoRecipient
	}
	report := &model.UsageReport{
		UserId:            user.Id,
		Date:              model.UsageReportDate(time.Unix(start, 0)),
		WindowStart:       start,
		WindowEnd:         end,
		RequestCount:      stat.RequestCount,
		Quota:             stat.Quota,
		WalletQuota:       stat.WalletQuota,
		SubscriptionQuota: stat.SubscriptionQuota,
		TotalTokens:       stat.TotalTokens,
		Groups:            stat.GroupsJSON(),
		StatsVersion:      model.UsageReportStatsVersion,
	}
	subject, body, err := renderUsageReportEmail(report, user.Username, user.GetSetting().Language, usageReportEmailWindow{
		DateRange: model.UsageReportRangeLabel(start, end),
		Manual:    true,
		Start:     model.UsageReportTimeLabel(start),
		End:       model.UsageReportTimeLabel(end),
	})
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("failed to render manual usage report for user %d: %s", user.Id, err.Error()))
		return nil, common.NewMessage("Failed to send usage email")
	}
	result := &UsageReportSendResult{
		Recipients:   recipients,
		WindowStart:  start,
		WindowEnd:    end,
		RequestCount: stat.RequestCount,
		Quota:        stat.Quota,
		TotalTokens:  stat.TotalTokens,
	}
	var firstErr error
	for _, recipient := range recipients {
		if err := usageReportSendEmail(common.EmailPurposeUsage, subject, recipient, body); err != nil {
			result.Failed++
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		result.Sent++
	}
	if result.Failed > 0 {
		logger.LogWarn(context.Background(), common.LogText(
			"manual usage report delivery: user=%d sent=%d failed=%d error=%v",
			user.Id, result.Sent, result.Failed, firstErr,
		))
	}
	if result.Sent == 0 {
		return result, common.NewMessage("Failed to send usage email")
	}
	return result, nil
}
