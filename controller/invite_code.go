package controller

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var inviteCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,63}$`)

type inviteCodeInput struct {
	Name              *string `json:"name"`
	Code              *string `json:"code"`
	Enabled           *bool   `json:"enabled"`
	GroupName         *string `json:"group"`
	InviterId         *int    `json:"inviter_id"`
	RegistrationLimit *int64  `json:"registration_limit"`
	BonusQuota        *int64  `json:"bonus_quota"`
	ExpiresAt         *int64  `json:"expires_at"`
	Remark            *string `json:"remark"`
}

type inviteCodeView struct {
	*model.InviteCode
	RemainingRegistrations int64 `json:"remaining_registrations"`
}

type publicInviteCodeResponse struct {
	Name                   string `json:"name"`
	Code                   string `json:"code"`
	Available              bool   `json:"available"`
	Reason                 string `json:"reason,omitempty"`
	RegistrationLimit      int64  `json:"registration_limit"`
	RegisteredCount        int64  `json:"registered_count"`
	RemainingRegistrations int64  `json:"remaining_registrations"`
	BonusQuota             int    `json:"bonus_quota"`
	ExpiresAt              int64  `json:"expires_at"`
}

func (input *inviteCodeInput) apply(existing *model.InviteCode) (*model.InviteCode, error) {
	candidate := model.InviteCode{Enabled: true}
	if existing != nil {
		candidate = *existing
	}
	if input.Name != nil {
		candidate.Name = strings.TrimSpace(*input.Name)
	}
	if input.Code != nil {
		code := model.NormalizeInviteCode(*input.Code)
		if existing != nil && code != existing.Code {
			return nil, fmt.Errorf("invitation code cannot be changed")
		}
		candidate.Code = code
	}
	if input.Enabled != nil {
		candidate.Enabled = *input.Enabled
	}
	if input.GroupName != nil {
		candidate.GroupName = strings.TrimSpace(*input.GroupName)
	}
	if input.InviterId != nil {
		candidate.InviterId = *input.InviterId
	}
	if input.RegistrationLimit != nil {
		candidate.RegistrationLimit = *input.RegistrationLimit
	}
	if input.BonusQuota != nil {
		if *input.BonusQuota > common.MaxWalletQuota {
			return nil, fmt.Errorf("bonus quota exceeds the supported maximum")
		}
		candidate.BonusQuota = int(*input.BonusQuota)
	}
	if input.ExpiresAt != nil {
		candidate.ExpiresAt = *input.ExpiresAt
	}
	if input.Remark != nil {
		candidate.Remark = strings.TrimSpace(*input.Remark)
	}

	if candidate.Name == "" || utf8.RuneCountInString(candidate.Name) > 100 {
		return nil, fmt.Errorf("invitation code name is required and must be at most 100 characters")
	}
	if candidate.Code == "" {
		if existing != nil {
			return nil, fmt.Errorf("invitation code is required")
		}
		generatedCode, err := common.GenerateRandomCharsKey(24)
		if err != nil {
			return nil, fmt.Errorf("failed to generate invitation code")
		}
		candidate.Code = model.NormalizeInviteCode(generatedCode)
	}
	if !inviteCodePattern.MatchString(candidate.Code) {
		return nil, fmt.Errorf("invitation code must be 3-64 lowercase letters, numbers, hyphens, or underscores")
	}
	if candidate.GroupName == "" || candidate.GroupName == "auto" {
		return nil, fmt.Errorf("group does not exist")
	}
	if candidate.Enabled && !ratio_setting.ContainsGroupRatio(candidate.GroupName) {
		return nil, fmt.Errorf("group does not exist")
	}
	if candidate.InviterId < 0 {
		return nil, fmt.Errorf("inviter id cannot be negative")
	}
	if candidate.InviterId > 0 {
		if _, err := model.GetUserById(candidate.InviterId, false); err != nil {
			return nil, fmt.Errorf("inviter user does not exist")
		}
	}
	if candidate.RegistrationLimit < 0 || candidate.RegistrationLimit > 1_000_000_000 {
		return nil, fmt.Errorf("registration limit must be between 0 and 1000000000")
	}
	if candidate.BonusQuota < 0 {
		return nil, fmt.Errorf("bonus quota cannot be negative")
	}
	if candidate.ExpiresAt < 0 {
		return nil, fmt.Errorf("expiration time cannot be negative")
	}
	if utf8.RuneCountInString(candidate.Remark) > 255 {
		return nil, fmt.Errorf("remark must be at most 255 characters")
	}
	return &candidate, nil
}

func CreateInviteCode(c *gin.Context) {
	var input inviteCodeInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	code, err := input.apply(nil)
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters {{error}}", map[string]any{"error": err.Error()})
		return
	}
	if _, err := model.GetInviteCodeByCode(code.Code); err == nil {
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Invitation code already exists"), gin.H{"code": "INVITE_CODE_EXISTS"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		common.SysError("failed to check invitation code uniqueness: " + err.Error())
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Database error, please contact the administrator"))
		return
	}
	if err := model.DB.Create(code).Error; err != nil {
		if _, lookupErr := model.GetInviteCodeByCode(code.Code); lookupErr == nil {
			common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Invitation code already exists"), gin.H{"code": "INVITE_CODE_EXISTS"})
			return
		}
		common.SysError("failed to create invitation code: " + err.Error())
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Database error, please contact the administrator"))
		return
	}
	common.ApiSuccess(c, inviteCodeView{
		InviteCode:             code,
		RemainingRegistrations: code.RemainingRegistrations(),
	})
}

func ListInviteCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	var enabled *bool
	if raw := strings.TrimSpace(c.Query("enabled")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		enabled = &value
	}
	codes, total, err := model.ListInviteCodes(c.Query("keyword"), enabled, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]inviteCodeView, 0, len(codes))
	for _, code := range codes {
		views = append(views, inviteCodeView{
			InviteCode:             code,
			RemainingRegistrations: code.RemainingRegistrations(),
		})
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(views)
	common.ApiSuccess(c, pageInfo)
}

func GetInviteCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	code, err := model.GetInviteCodeById(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, inviteCodeView{
		InviteCode:             code,
		RemainingRegistrations: code.RemainingRegistrations(),
	})
}

func UpdateInviteCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	existing, err := model.GetInviteCodeById(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var input inviteCodeInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	updated, err := input.apply(existing)
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters {{error}}", map[string]any{"error": err.Error()})
		return
	}
	if err := model.DB.Model(&model.InviteCode{}).Where("id = ?", id).Updates(map[string]any{
		"name":               updated.Name,
		"enabled":            updated.Enabled,
		"group_name":         updated.GroupName,
		"inviter_id":         updated.InviterId,
		"registration_limit": updated.RegistrationLimit,
		"bonus_quota":        updated.BonusQuota,
		"expires_at":         updated.ExpiresAt,
		"remark":             updated.Remark,
	}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	updated, err = model.GetInviteCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, inviteCodeView{
		InviteCode:             updated,
		RemainingRegistrations: updated.RemainingRegistrations(),
	})
}

// DeleteInviteCode disables a code instead of deleting its history.
func DeleteInviteCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.GetInviteCodeById(id); errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
		return
	} else if err != nil {
		common.ApiError(c, err)
		return
	}
	result := model.DB.Model(&model.InviteCode{}).Where("id = ?", id).Update("enabled", false)
	if result.Error != nil {
		common.ApiError(c, result.Error)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id, "enabled": false})
}

func GetInviteCodeClaims(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.GetInviteCodeById(id); errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
		return
	} else if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo := common.GetPageQuery(c)
	claims, total, err := model.GetInviteCodeClaims(id, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(claims)
	common.ApiSuccess(c, pageInfo)
}

func GetPublicInviteCode(c *gin.Context) {
	code, err := model.GetInviteCodeByCode(c.Param("code"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	reason := ""
	switch {
	case !code.Enabled:
		reason = "disabled"
	case code.ExpiresAt > 0 && code.ExpiresAt <= time.Now().Unix():
		reason = "expired"
	case code.RegistrationLimit > 0 && code.RegisteredCount >= code.RegistrationLimit:
		reason = "registration_full"
	}
	common.ApiSuccess(c, publicInviteCodeResponse{
		Name:                   code.Name,
		Code:                   code.Code,
		Available:              reason == "",
		Reason:                 reason,
		RegistrationLimit:      code.RegistrationLimit,
		RegisteredCount:        code.RegisteredCount,
		RemainingRegistrations: code.RemainingRegistrations(),
		BonusQuota:             code.BonusQuota,
		ExpiresAt:              code.ExpiresAt,
	})
}

func writeInviteCodeRegistrationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrInviteCodeInvalid), errors.Is(err, model.ErrInviteCodeDisabled):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invitation code is invalid or disabled"), gin.H{"code": "INVITE_CODE_INVALID"})
	case errors.Is(err, model.ErrInviteCodeExpired):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invitation code has expired"), gin.H{"code": "INVITE_CODE_EXPIRED"})
	case errors.Is(err, model.ErrInviteCodeLimitReached):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("Invitation code registration limit has been reached"), gin.H{"code": "INVITE_CODE_LIMIT_REACHED"})
	case errors.Is(err, model.ErrInviteCodeAlreadyClaimed):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("You have already claimed an invitation code"), gin.H{"code": "INVITE_CODE_ALREADY_CLAIMED"})
	default:
		common.SysError("invitation code registration failed: " + err.Error())
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Database error, please contact the administrator"), gin.H{"code": "INVITE_CODE_REGISTRATION_FAILED"})
	}
}
