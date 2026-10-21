package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// usageReportSettingsResponse is the state of the daily usage report switch,
// including where the next report can actually be delivered.
type usageReportSettingsResponse struct {
	Enabled                   bool     `json:"enabled"`
	AccountEmail              string   `json:"account_email"`
	AccountEmailVerified      bool     `json:"account_email_verified"`
	VerifiedEmails            []string `json:"verified_emails"`
	Recipients                []string `json:"recipients"`
	NotificationEmail         string   `json:"notification_email"`
	NotificationEmailVerified bool     `json:"notification_email_verified"`
	DeliveryReady             bool     `json:"delivery_ready"`
	SendHour                  int      `json:"send_hour"`
	Timezone                  string   `json:"timezone"`
}

func buildUsageReportSettingsResponse(userId int) (*usageReportSettingsResponse, error) {
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	allVerified, err := model.VerifiedEmails(userId)
	if err != nil {
		return nil, err
	}
	recipients, err := model.UsageReportRecipients(user)
	if err != nil {
		return nil, err
	}
	accountEmail := model.NormalizeEmail(user.Email)
	notificationEmail := model.NormalizeEmail(user.GetSetting().NotificationEmail)
	accountVerified := false
	notificationVerified := false
	for _, email := range allVerified {
		if accountEmail != "" && email == accountEmail {
			accountVerified = true
		}
		if notificationEmail != "" && email == notificationEmail {
			notificationVerified = true
		}
	}
	preference, err := model.GetUserNotificationPreference(userId)
	if err != nil {
		return nil, err
	}
	return &usageReportSettingsResponse{
		Enabled:                   preference.UsageReportEnabled(),
		AccountEmail:              accountEmail,
		AccountEmailVerified:      accountVerified,
		VerifiedEmails:            recipients,
		Recipients:                recipients,
		NotificationEmail:         notificationEmail,
		NotificationEmailVerified: notificationVerified,
		DeliveryReady:             len(recipients) > 0,
		SendHour:                  model.UsageReportWindowEndHour,
		Timezone:                  "Asia/Shanghai",
	}, nil
}

// GetUsageReportSettings returns the daily usage report state for the console.
func GetUsageReportSettings(c *gin.Context) {
	settings, err := buildUsageReportSettingsResponse(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, settings)
}

type updateUsageReportSettingsRequest struct {
	Enabled *bool `json:"enabled"`
}

// UpdateUsageReportSettings stores the switch on its own, so it never collides
// with the general notification settings. Closing it also cancels snapshots
// that are waiting to be delivered.
func UpdateUsageReportSettings(c *gin.Context) {
	var request updateUsageReportSettingsRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Enabled == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")
	if err := model.SetUsageReportDisabled(userId, !*request.Enabled); err != nil {
		common.ApiError(c, err)
		return
	}
	if !*request.Enabled {
		if err := model.CancelUnscheduledUsageReports(userId, common.GetTimestamp()); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	settings, err := buildUsageReportSettingsResponse(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, settings)
}
