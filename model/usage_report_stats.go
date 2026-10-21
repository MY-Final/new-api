package model

import (
	"sort"

	"github.com/QuantumNous/new-api/common"
)

// UsageReportUserUsage is one user's usage inside a report window. Totals are
// derived from the same log rows as the group breakdown, so they always agree.
type UsageReportUserUsage struct {
	UserId            int
	RequestCount      int64
	Quota             int64
	WalletQuota       int64
	SubscriptionQuota int64
	TotalTokens       int64
	Groups            []UsageReportGroup

	groupIndex map[string]*UsageReportGroup
}

func (usage *UsageReportUserUsage) group(name string) *UsageReportGroup {
	if usage.groupIndex == nil {
		usage.groupIndex = make(map[string]*UsageReportGroup)
	}
	group := usage.groupIndex[name]
	if group == nil {
		group = &UsageReportGroup{Group: name}
		usage.groupIndex[name] = group
	}
	return group
}

func (usage *UsageReportUserUsage) finish() {
	usage.Groups = make([]UsageReportGroup, 0, len(usage.groupIndex))
	for _, group := range usage.groupIndex {
		usage.Groups = append(usage.Groups, *group)
	}
	sort.Slice(usage.Groups, func(i, j int) bool {
		if usage.Groups[i].Quota != usage.Groups[j].Quota {
			return usage.Groups[i].Quota > usage.Groups[j].Quota
		}
		if usage.Groups[i].Tokens != usage.Groups[j].Tokens {
			return usage.Groups[i].Tokens > usage.Groups[j].Tokens
		}
		return usage.Groups[i].Group < usage.Groups[j].Group
	})
	usage.groupIndex = nil
}

type usageReportLogRow struct {
	UserId           int    `gorm:"column:user_id"`
	Type             int    `gorm:"column:type"`
	Group            string `gorm:"column:log_group"`
	Quota            int    `gorm:"column:quota"`
	PromptTokens     int    `gorm:"column:prompt_tokens"`
	CompletionTokens int    `gorm:"column:completion_tokens"`
	Other            string `gorm:"column:other"`
}

type usageReportLogMeta struct {
	BillingSource string `json:"billing_source"`
}

// logGroupColumn returns the quoted group column of the log database. The
// package-level value is initialized with the database connection; deriving it
// here as a fallback keeps the aggregation usable before that initialization
// (for example in focused tests).
func logGroupColumn() string {
	if logGroupCol != "" {
		return logGroupCol
	}
	if common.UsingLogDatabase(common.DatabaseTypePostgreSQL) {
		return `"group"`
	}
	return "`group`"
}

// GroupsJSON encodes the group rows for a snapshot row or an on-demand email.
func (usage *UsageReportUserUsage) GroupsJSON() string {
	if usage == nil {
		return "[]"
	}
	return usageReportGroupsJSON(usage.Groups)
}

// AggregateUsageReports scans one time window of usage logs and returns usage
// per user and group. The token rules come from usageLogMetrics, the same
// function the console usage statistics use, so the report and the platform
// cannot disagree about cache or reasoning tokens.
func AggregateUsageReports(start int64, end int64) (map[int]*UsageReportUserUsage, error) {
	return aggregateUsageReports(start, end, 0)
}

// AggregateUsageReportForUser is the single-user form used by an
// administrator-triggered email, so it never scans other users' rows.
func AggregateUsageReportForUser(userId int, start int64, end int64) (*UsageReportUserUsage, error) {
	if userId <= 0 {
		return nil, nil
	}
	usage, err := aggregateUsageReports(start, end, userId)
	if err != nil {
		return nil, err
	}
	return usage[userId], nil
}

func aggregateUsageReports(start int64, end int64, userId int) (map[int]*UsageReportUserUsage, error) {
	usage := make(map[int]*UsageReportUserUsage)
	query := LOG_DB.Table("logs").
		Select("user_id, type, "+logGroupColumn()+" AS log_group, quota, prompt_tokens, completion_tokens, other").
		Where("type IN ?", []int{LogTypeConsume, LogTypeRefund}).
		Where("user_id > ?", 0).
		Where("created_at >= ? AND created_at < ?", start, end)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	rows, err := query.Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row usageReportLogRow
		if err := LOG_DB.ScanRows(rows, &row); err != nil {
			return nil, err
		}
		user := usage[row.UserId]
		if user == nil {
			user = &UsageReportUserUsage{UserId: row.UserId}
			usage[row.UserId] = user
		}
		source := ""
		if row.Other != "" {
			var meta usageReportLogMeta
			if err := common.UnmarshalJsonStr(row.Other, &meta); err == nil {
				source = meta.BillingSource
			}
		}
		group := user.group(row.Group)
		if row.Type == LogTypeRefund {
			refund := int64(row.Quota)
			if refund <= 0 {
				continue
			}
			user.Quota -= refund
			group.Quota -= refund
			if source == "subscription" {
				user.SubscriptionQuota -= refund
			} else {
				user.WalletQuota -= refund
			}
			continue
		}
		log := Log{
			UserId:           row.UserId,
			Type:             row.Type,
			Group:            row.Group,
			Quota:            row.Quota,
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			Other:            row.Other,
		}
		metrics := usageLogMetrics(&log)
		user.RequestCount++
		user.Quota += metrics.ConsumedQuota
		user.TotalTokens += metrics.TotalTokens
		if source == "subscription" {
			user.SubscriptionQuota += metrics.ConsumedQuota
		} else {
			user.WalletQuota += metrics.ConsumedQuota
		}
		group.RequestCount++
		group.Quota += metrics.ConsumedQuota
		group.Tokens += metrics.TotalTokens
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, user := range usage {
		user.finish()
	}
	return usage, nil
}
