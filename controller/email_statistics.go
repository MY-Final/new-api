package controller

import (
	"cmp"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

const (
	emailStatisticsDefaultDays = 14
	emailStatisticsMaxDays     = 90
)

// EmailStatTotals is a delivered/failed pair for one period or bucket.
type EmailStatTotals struct {
	Delivered int64 `json:"delivered"`
	Failed    int64 `json:"failed"`
}

// EmailStatRow is one purpose-in-a-day bucket. Daily rows carry a date;
// monthly purpose rows leave it empty.
type EmailStatRow struct {
	Date      string `json:"date,omitempty"`
	Purpose   string `json:"purpose"`
	Provider  string `json:"provider"`
	Delivered int64  `json:"delivered"`
	Failed    int64  `json:"failed"`
}

// EmailStatistics reports delivery volume per day and purpose so an
// administrator can watch a monthly sending quota being consumed.
type EmailStatistics struct {
	Provider string `json:"provider"`
	// ResendInUse reports whether the global selector or a purpose route sends
	// through Resend, so the console only shows the quota cards when that quota
	// can actually be spent.
	ResendInUse bool `json:"resend_in_use"`
	// StartDate..EndDate is the daily window; Month and Purposes always cover
	// the current calendar month, which may reach further back.
	StartDate   string          `json:"start_date"`
	EndDate     string          `json:"end_date"`
	Month       EmailStatTotals `json:"month"`
	Today       EmailStatTotals `json:"today"`
	ResendMonth EmailStatTotals `json:"resend_month"`
	ResendToday EmailStatTotals `json:"resend_today"`
	Purposes    []EmailStatRow  `json:"purposes"`
	Daily       []EmailStatRow  `json:"daily"`
}

func GetEmailStatistics(c *gin.Context) {
	days := emailStatisticsDefaultDays
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		days = min(parsed, emailStatisticsMaxDays)
	}

	now := time.Now()
	endDate := now.Format("2006-01-02")
	windowStart := now.AddDate(0, 0, 1-days).Format("2006-01-02")
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Format("2006-01-02")
	// ISO dates order lexicographically, so the query can start at whichever
	// boundary reaches further back.
	startDate := min(windowStart, monthStart)

	rows, err := model.ListEmailSendStats(startDate, endDate)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	resendInUse := common.EmailProviderName() == common.EmailProviderResend
	for _, provider := range system_setting.EmailPurposeProviders() {
		if provider == common.EmailProviderResend {
			resendInUse = true
		}
	}

	stats := EmailStatistics{
		Provider:    common.EmailProviderName(),
		ResendInUse: resendInUse,
		StartDate:   windowStart,
		EndDate:     endDate,
		Purposes:    make([]EmailStatRow, 0, len(rows)),
		Daily:       make([]EmailStatRow, 0, len(rows)),
	}
	purposeIndex := make(map[[2]string]int, len(rows))
	for _, row := range rows {
		if row.Date >= monthStart {
			stats.Month.Delivered += row.Delivered
			stats.Month.Failed += row.Failed
			if row.Provider == common.EmailProviderResend {
				stats.ResendMonth.Delivered += row.Delivered
				stats.ResendMonth.Failed += row.Failed
			}
			key := [2]string{row.Purpose, row.Provider}
			index, ok := purposeIndex[key]
			if !ok {
				index = len(stats.Purposes)
				purposeIndex[key] = index
				stats.Purposes = append(stats.Purposes, EmailStatRow{Purpose: row.Purpose, Provider: row.Provider})
			}
			stats.Purposes[index].Delivered += row.Delivered
			stats.Purposes[index].Failed += row.Failed
		}
		if row.Date == endDate {
			stats.Today.Delivered += row.Delivered
			stats.Today.Failed += row.Failed
			if row.Provider == common.EmailProviderResend {
				stats.ResendToday.Delivered += row.Delivered
				stats.ResendToday.Failed += row.Failed
			}
		}
		if row.Date >= windowStart {
			stats.Daily = append(stats.Daily, EmailStatRow{
				Date:      row.Date,
				Purpose:   row.Purpose,
				Provider:  row.Provider,
				Delivered: row.Delivered,
				Failed:    row.Failed,
			})
		}
	}
	// Heaviest consumers first, so the purpose table shows where the quota goes.
	slices.SortStableFunc(stats.Purposes, func(a, b EmailStatRow) int {
		if a.Delivered != b.Delivered {
			return cmp.Compare(b.Delivered, a.Delivered)
		}
		return cmp.Compare(a.Purpose, b.Purpose)
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    stats,
	})
}
