package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetEmailReminder returns the persisted binding-prompt state. The decision is
// made on the server so every device and every reload sees the same answer.
func GetEmailReminder(c *gin.Context) {
	state, err := model.GetEmailReminderState(c.GetInt("id"), model.UsageReportNow())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, state)
}

type updateEmailReminderRequest struct {
	Action string `json:"action"`
}

// UpdateEmailReminder stores the user's reminder choice. It only controls the
// prompt: the usage report switch and other mail are untouched.
func UpdateEmailReminder(c *gin.Context) {
	var request updateEmailReminderRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")
	err := model.ApplyEmailReminderAction(userId, request.Action, model.UsageReportNow())
	if err != nil {
		if errors.Is(err, model.ErrEmailReminderActionInvalid) {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		common.ApiError(c, err)
		return
	}
	state, err := model.GetEmailReminderState(userId, model.UsageReportNow())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, state)
}
