package controller

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const maxQuotaLedgerRangeDays = 366

type quotaLedgerQuery struct {
	StartDate string
	EndDate   string
	Username  string
}

type quotaLedgerRangeSummary struct {
	BonusQuota int64 `json:"bonus_quota"`
	PaidQuota  int64 `json:"paid_quota"`
	Quota      int64 `json:"quota"`
}

type quotaLedgerDailyPage struct {
	Items   []*model.QuotaUsageDailyItem `json:"items"`
	Total   int64                        `json:"total"`
	Summary quotaLedgerRangeSummary      `json:"summary"`
}

func parseQuotaLedgerQuery(c *gin.Context) (quotaLedgerQuery, error) {
	query := quotaLedgerQuery{
		StartDate: strings.TrimSpace(c.Query("start_date")),
		EndDate:   strings.TrimSpace(c.Query("end_date")),
		Username:  strings.TrimSpace(c.Query("username")),
	}
	today := time.Now().Format("2006-01-02")
	if query.StartDate == "" {
		query.StartDate = today
	}
	if query.EndDate == "" {
		query.EndDate = today
	}
	start, err := time.ParseInLocation("2006-01-02", query.StartDate, time.Local)
	if err != nil {
		return query, errors.New("start_date 格式应为 YYYY-MM-DD")
	}
	end, err := time.ParseInLocation("2006-01-02", query.EndDate, time.Local)
	if err != nil {
		return query, errors.New("end_date 格式应为 YYYY-MM-DD")
	}
	if end.Before(start) {
		return query, errors.New("end_date 不能早于 start_date")
	}
	if end.Sub(start) > maxQuotaLedgerRangeDays*24*time.Hour {
		return query, errors.New("查询时间范围不能超过 366 天")
	}
	return query, nil
}

// GetQuotaLedgerDaily 返回按用户/天聚合的付费与福利额度净消耗。
func GetQuotaLedgerDaily(c *gin.Context) {
	query, err := parseQuotaLedgerQuery(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListQuotaUsageDaily(query.StartDate, query.EndDate, query.Username, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	bonus, paid, err := model.SumQuotaUsageDaily(query.StartDate, query.EndDate, query.Username)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, quotaLedgerDailyPage{
		Items: items,
		Total: total,
		Summary: quotaLedgerRangeSummary{
			BonusQuota: bonus,
			PaidQuota:  paid,
			Quota:      bonus + paid,
		},
	})
}

// GetQuotaLedgerSummary 返回总账汇总卡片数据（全站口径）。
func GetQuotaLedgerSummary(c *gin.Context) {
	query, err := parseQuotaLedgerQuery(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.GetQuotaLedgerSummary(query.StartDate, query.EndDate)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}
