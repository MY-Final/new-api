package model

import (
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type SubscriptionUsageFilter struct {
	ModelName      string
	SubscriptionId int
	TokenId        int
	ChannelId      int
}

type SubscriptionUsageSubscriptionOption struct {
	Id        int    `json:"id"`
	PlanTitle string `json:"plan_title"`
}

type SubscriptionUsageTokenOption struct {
	Id   int    `json:"id"`
	Name string `json:"name"`
}

type SubscriptionUsageChannelOption struct {
	Id   int    `json:"id"`
	Name string `json:"name"`
}

type SubscriptionUsageFilterOptions struct {
	Models        []string                              `json:"models"`
	Subscriptions []SubscriptionUsageSubscriptionOption `json:"subscriptions"`
	Tokens        []SubscriptionUsageTokenOption        `json:"tokens"`
	Channels      []SubscriptionUsageChannelOption      `json:"channels"`
}

type UserUsagePeriodStat struct {
	StartTime                int64 `json:"start_time"`
	EndTime                  int64 `json:"end_time"`
	Quota                    int64 `json:"quota"`
	WalletQuota              int64 `json:"wallet_quota"`
	SubscriptionQuota        int64 `json:"subscription_quota"`
	RequestCount             int64 `json:"request_count"`
	WalletRequestCount       int64 `json:"wallet_request_count"`
	SubscriptionRequestCount int64 `json:"subscription_request_count"`
	RefundedQuota            int64 `json:"refunded_quota"`
	RefundedRequestCount     int64 `json:"refunded_request_count"`
}

type UserUsageDailyStat struct {
	Date                     string `json:"date"`
	Quota                    int64  `json:"quota"`
	WalletQuota              int64  `json:"wallet_quota"`
	SubscriptionQuota        int64  `json:"subscription_quota"`
	RequestCount             int64  `json:"request_count"`
	WalletRequestCount       int64  `json:"wallet_request_count"`
	SubscriptionRequestCount int64  `json:"subscription_request_count"`
	RefundedQuota            int64  `json:"refunded_quota"`
}

type SubscriptionPurchaseSpend struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
	Count    int64   `json:"count"`
}

type UserUsageStatistics struct {
	UsedQuota                 int64                          `json:"used_quota"`
	WalletUsedQuota           int64                          `json:"wallet_used_quota"`
	SubscriptionUsedQuota     int64                          `json:"subscription_used_quota"`
	RequestCount              int64                          `json:"request_count"`
	WalletRequestCount        int64                          `json:"wallet_request_count"`
	SubscriptionRequestCount  int64                          `json:"subscription_request_count"`
	Today                     UserUsagePeriodStat            `json:"today"`
	Last7Days                 UserUsagePeriodStat            `json:"last_7_days"`
	Last30Days                UserUsagePeriodStat            `json:"last_30_days"`
	Daily                     []UserUsageDailyStat           `json:"daily"`
	RefundedQuota             int64                          `json:"refunded_quota"`
	RefundedRequestCount      int64                          `json:"refunded_request_count"`
	PendingRequestCount       int64                          `json:"pending_request_count"`
	PendingQuota              int64                          `json:"pending_quota"`
	SubscriptionPurchaseCount int64                          `json:"subscription_purchase_count"`
	SubscriptionPurchaseSpend []SubscriptionPurchaseSpend    `json:"subscription_purchase_spend"`
	FilterOptions             SubscriptionUsageFilterOptions `json:"filter_options"`
}

func subscriptionUsageQuery(userId int) *gorm.DB {
	return consumedRequestBillingQuery(DB.Model(&RequestBilling{})).
		Where("user_id = ? AND funding_source = ?", userId, "subscription")
}

func requestBillingNetQuota(record RequestBilling) int64 {
	return int64(max(record.Quota-record.RefundedQuota, 0))
}

func applyRequestBillingUsage(period *UserUsagePeriodStat, record RequestBilling) {
	quota := requestBillingNetQuota(record)
	period.Quota += quota
	period.RequestCount++
	if record.FundingSource == "subscription" {
		period.SubscriptionQuota += quota
		period.SubscriptionRequestCount++
	} else {
		period.WalletQuota += quota
		period.WalletRequestCount++
	}
	if record.RefundedQuota > 0 {
		period.RefundedQuota += int64(record.RefundedQuota)
		period.RefundedRequestCount++
	}
}

func applyRequestBillingDaily(daily *UserUsageDailyStat, record RequestBilling) {
	quota := requestBillingNetQuota(record)
	daily.Quota += quota
	daily.RequestCount++
	if record.FundingSource == "subscription" {
		daily.SubscriptionQuota += quota
		daily.SubscriptionRequestCount++
	} else {
		daily.WalletQuota += quota
		daily.WalletRequestCount++
	}
	daily.RefundedQuota += int64(max(record.RefundedQuota, 0))
}

func GetUserUsageStatistics(userId int, now time.Time) (*UserUsageStatistics, error) {
	if userId <= 0 {
		return nil, ErrRequestBillingNotFound
	}

	var user User
	if err := DB.Select("id", "used_quota", "request_count").First(&user, userId).Error; err != nil {
		return nil, err
	}
	breakdown, err := GetUserUsageBreakdown(user.Id, user.UsedQuota, user.RequestCount)
	if err != nil {
		return nil, err
	}

	location := now.Location()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	last7Start := todayStart.AddDate(0, 0, -6)
	last30Start := todayStart.AddDate(0, 0, -29)
	endTime := now.Unix()
	statistics := &UserUsageStatistics{
		UsedQuota:                 int64(max(user.UsedQuota, 0)),
		WalletUsedQuota:           int64(breakdown.WalletUsedQuota),
		SubscriptionUsedQuota:     int64(breakdown.SubscriptionUsedQuota),
		RequestCount:              int64(max(user.RequestCount, 0)),
		WalletRequestCount:        int64(breakdown.WalletRequestCount),
		SubscriptionRequestCount:  int64(breakdown.SubscriptionRequestCount),
		Today:                     UserUsagePeriodStat{StartTime: todayStart.Unix(), EndTime: endTime},
		Last7Days:                 UserUsagePeriodStat{StartTime: last7Start.Unix(), EndTime: endTime},
		Last30Days:                UserUsagePeriodStat{StartTime: last30Start.Unix(), EndTime: endTime},
		Daily:                     make([]UserUsageDailyStat, 0, 30),
		SubscriptionPurchaseSpend: []SubscriptionPurchaseSpend{},
		FilterOptions: SubscriptionUsageFilterOptions{
			Models:        []string{},
			Subscriptions: []SubscriptionUsageSubscriptionOption{},
			Tokens:        []SubscriptionUsageTokenOption{},
			Channels:      []SubscriptionUsageChannelOption{},
		},
	}
	dailyIndexes := make(map[string]int, 30)
	for offset := range 30 {
		date := last30Start.AddDate(0, 0, offset).Format("2006-01-02")
		dailyIndexes[date] = len(statistics.Daily)
		statistics.Daily = append(statistics.Daily, UserUsageDailyStat{Date: date})
	}

	var records []RequestBilling
	if err := consumedRequestBillingQuery(DB.Model(&RequestBilling{})).
		Select("funding_source", "quota", "refunded_quota", "created_at").
		Where("user_id = ? AND created_at >= ? AND created_at <= ?", userId, last30Start.Unix(), endTime).
		Find(&records).Error; err != nil {
		return nil, err
	}
	for _, record := range records {
		if record.CreatedAt >= todayStart.Unix() {
			applyRequestBillingUsage(&statistics.Today, record)
		}
		if record.CreatedAt >= last7Start.Unix() {
			applyRequestBillingUsage(&statistics.Last7Days, record)
		}
		applyRequestBillingUsage(&statistics.Last30Days, record)
		date := time.Unix(record.CreatedAt, 0).In(location).Format("2006-01-02")
		if index, ok := dailyIndexes[date]; ok {
			applyRequestBillingDaily(&statistics.Daily[index], record)
		}
	}
	statistics.RefundedQuota = statistics.Last30Days.RefundedQuota
	statistics.RefundedRequestCount = statistics.Last30Days.RefundedRequestCount

	var pending struct {
		Count int64
		Quota int64
	}
	if err := DB.Model(&RequestBilling{}).
		Select("COUNT(*) AS count, COALESCE(SUM(quota), 0) AS quota").
		Where("user_id = ? AND settled = ? AND usage_recorded = ?", userId, false, false).
		Scan(&pending).Error; err != nil {
		return nil, err
	}
	statistics.PendingRequestCount = pending.Count
	statistics.PendingQuota = pending.Quota

	statistics.SubscriptionPurchaseCount, statistics.SubscriptionPurchaseSpend, err = loadSubscriptionPurchaseSpend(userId)
	if err != nil {
		return nil, err
	}
	statistics.FilterOptions, err = loadSubscriptionUsageFilterOptions(userId)
	if err != nil {
		return nil, err
	}
	return statistics, nil
}

func loadSubscriptionPurchaseSpend(userId int) (int64, []SubscriptionPurchaseSpend, error) {
	var orders []SubscriptionOrder
	if err := DB.Select("plan_id", "money").
		Where("user_id = ? AND status = ?", userId, common.TopUpStatusSuccess).
		Find(&orders).Error; err != nil {
		return 0, nil, err
	}
	if len(orders) == 0 {
		return 0, []SubscriptionPurchaseSpend{}, nil
	}

	planIds := make([]int, 0, len(orders))
	for _, order := range orders {
		planIds = append(planIds, order.PlanId)
	}
	var plans []SubscriptionPlan
	if err := DB.Select("id", "currency").Where("id IN ?", planIds).Find(&plans).Error; err != nil {
		return 0, nil, err
	}
	currencies := make(map[int]string, len(plans))
	for _, plan := range plans {
		currencies[plan.Id] = plan.Currency
	}

	spendByCurrency := make(map[string]*SubscriptionPurchaseSpend)
	for _, order := range orders {
		currency := currencies[order.PlanId]
		if currency == "" {
			currency = "CNY"
		}
		spend := spendByCurrency[currency]
		if spend == nil {
			spend = &SubscriptionPurchaseSpend{Currency: currency}
			spendByCurrency[currency] = spend
		}
		spend.Amount += order.Money
		spend.Count++
	}
	spending := make([]SubscriptionPurchaseSpend, 0, len(spendByCurrency))
	for _, spend := range spendByCurrency {
		spending = append(spending, *spend)
	}
	slices.SortFunc(spending, func(a, b SubscriptionPurchaseSpend) int {
		return strings.Compare(a.Currency, b.Currency)
	})
	return int64(len(orders)), spending, nil
}

func loadSubscriptionUsageFilterOptions(userId int) (SubscriptionUsageFilterOptions, error) {
	options := SubscriptionUsageFilterOptions{
		Models:        []string{},
		Subscriptions: []SubscriptionUsageSubscriptionOption{},
		Tokens:        []SubscriptionUsageTokenOption{},
		Channels:      []SubscriptionUsageChannelOption{},
	}

	if err := subscriptionUsageQuery(userId).
		Where("model_name <> ''").
		Distinct("model_name").
		Order("model_name ASC").
		Pluck("model_name", &options.Models).Error; err != nil {
		return options, err
	}

	var subscriptionIds []int
	if err := subscriptionUsageQuery(userId).
		Where("subscription_id > 0").
		Distinct("subscription_id").
		Order("subscription_id ASC").
		Pluck("subscription_id", &subscriptionIds).Error; err != nil {
		return options, err
	}
	subscriptionLabels, err := loadSubscriptionUsageLabels(userId, subscriptionIds)
	if err != nil {
		return options, err
	}
	for _, subscriptionId := range subscriptionIds {
		label := subscriptionLabels[subscriptionId]
		options.Subscriptions = append(options.Subscriptions, SubscriptionUsageSubscriptionOption{
			Id: subscriptionId, PlanTitle: label.PlanTitle,
		})
	}

	type tokenRow struct {
		TokenId   int    `gorm:"column:token_id"`
		TokenName string `gorm:"column:token_name"`
	}
	var tokenRows []tokenRow
	if err := subscriptionUsageQuery(userId).
		Select("token_id", "token_name").
		Where("token_id > 0").
		Group("token_id, token_name").
		Order("token_name ASC, token_id ASC").
		Scan(&tokenRows).Error; err != nil {
		return options, err
	}
	for _, row := range tokenRows {
		options.Tokens = append(options.Tokens, SubscriptionUsageTokenOption{Id: row.TokenId, Name: row.TokenName})
	}

	var channelIds []int
	if err := subscriptionUsageQuery(userId).
		Where("channel_id > 0").
		Distinct("channel_id").
		Order("channel_id ASC").
		Pluck("channel_id", &channelIds).Error; err != nil {
		return options, err
	}
	if len(channelIds) > 0 {
		var channels []Channel
		if err := DB.Select("id", "name").Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
			return options, err
		}
		channelNames := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelNames[channel.Id] = channel.Name
		}
		for _, channelId := range channelIds {
			options.Channels = append(options.Channels, SubscriptionUsageChannelOption{
				Id: channelId, Name: channelNames[channelId],
			})
		}
	}
	return options, nil
}
