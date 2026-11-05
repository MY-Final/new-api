package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- Shared types ----

type SubscriptionPlanDTO struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

type BillingPreferenceRequest struct {
	BillingPreference string `json:"billing_preference"`
}

type SubscriptionBalancePayRequest struct {
	PlanId int `json:"plan_id"`
}

// ---- User APIs ----

func GetSubscriptionPlans(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, []SubscriptionPlanDTO{})
		return
	}

	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.HydrateSubscriptionPlansQuotaWindows(plans); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.HydrateSubscriptionPlansRouteGroups(plans); err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		if len(p.RouteGroups) == 0 {
			continue
		}
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionSelf(c *gin.Context) {
	userId := c.GetInt("id")
	settingMap, _ := model.GetUserSetting(userId, false)
	pref := common.NormalizeBillingPreference(settingMap.BillingPreference)

	// Get all subscriptions (including expired)
	allSubscriptions, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		allSubscriptions = []model.SubscriptionSummary{}
	}

	// Get active subscriptions for backward compatibility
	activeSubscriptions, err := model.GetAllActiveUserSubscriptions(userId)
	if err != nil {
		activeSubscriptions = []model.SubscriptionSummary{}
	}

	common.ApiSuccess(c, gin.H{
		"billing_preference": pref,
		"subscriptions":      activeSubscriptions, // all active subscriptions
		"all_subscriptions":  allSubscriptions,    // all subscriptions including expired
	})
}

func UpdateSubscriptionPreference(c *gin.Context) {
	userId := c.GetInt("id")
	var req BillingPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	pref := common.NormalizeBillingPreference(req.BillingPreference)

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	current := user.GetSetting()
	current.BillingPreference = pref
	if err := model.UpdateUserSetting(user.Id, current); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"billing_preference": pref})
}

func SubscriptionRequestBalancePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId := c.GetInt("id")
	var req SubscriptionBalancePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	mutation, err := model.PurchaseSubscriptionWithBalance(userId, req.PlanId)
	if err != nil {
		if errors.Is(err, model.ErrActiveSubscriptionConflict) {
			common.ApiErrorStatus(c, http.StatusConflict, err)
			return
		}
		common.ApiError(c, err)
		return
	}
	if mutation == nil || mutation.Subscription == nil {
		common.ApiErrorT(c, "Failed to load purchased subscription")
		return
	}
	subscription := mutation.Subscription
	common.ApiSuccess(c, gin.H{
		"renewed":           mutation.Renewed,
		"end_time":          subscription.EndTime,
		"upgrade_group":     subscription.UpgradeGroup,
		"route_groups":      subscription.RouteGroups,
		"max_concurrency":   subscription.MaxConcurrency,
		"max_output_tokens": subscription.MaxOutputTokens,
		"quota_windows":     subscription.QuotaWindows,
		"subscription":      subscription,
	})
}

// ---- Admin APIs ----

func AdminListSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	if err := model.DB.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.HydrateSubscriptionPlansQuotaWindows(plans); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.HydrateSubscriptionPlansRouteGroups(plans); err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type AdminUpsertSubscriptionPlanRequest struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

func normalizeSubscriptionPlanInput(c *gin.Context, plan *model.SubscriptionPlan) bool {
	if plan == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return false
	}
	plan.Title = strings.TrimSpace(plan.Title)
	if plan.Title == "" {
		common.ApiErrorT(c, "Subscription plan title cannot be empty")
		return false
	}
	if plan.PriceAmount < 0 {
		common.ApiErrorT(c, "Price cannot be negative")
		return false
	}
	if plan.PriceAmount > 9999 {
		common.ApiErrorT(c, "Price cannot exceed 9999")
		return false
	}
	plan.Currency = strings.ToUpper(strings.TrimSpace(plan.Currency))
	if plan.Currency == "" {
		plan.Currency = "CNY"
	}
	switch plan.Currency {
	case "CNY", "USD", "EUR":
	default:
		common.ApiErrorT(c, "Unsupported currency")
		return false
	}
	if plan.MaxConcurrency < 0 {
		common.ApiErrorT(c, "Concurrency limit cannot be negative")
		return false
	}
	if plan.MaxOutputTokens == 0 {
		plan.MaxOutputTokens = model.DefaultSubscriptionMaxOutputTokens
	}
	if plan.MaxOutputTokens < 1 || plan.MaxOutputTokens > model.MaxSubscriptionOutputTokens {
		common.ApiErrorT(c, "Output token limit must be between 1 and {{max}}", map[string]any{"max": model.MaxSubscriptionOutputTokens})
		return false
	}
	if plan.AllowBalancePay == nil {
		plan.AllowBalancePay = common.GetPointer(true)
	}
	if plan.AllowWalletOverflow == nil {
		plan.AllowWalletOverflow = common.GetPointer(true)
	}
	if plan.DurationUnit == "" {
		plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if plan.DurationValue <= 0 && plan.DurationUnit != model.SubscriptionDurationCustom {
		plan.DurationValue = 1
	}
	if plan.DurationUnit == model.SubscriptionDurationCustom && plan.CustomSeconds <= 0 {
		common.ApiErrorT(c, "Custom duration must be greater than 0 seconds")
		return false
	}
	if plan.MaxPurchasePerUser < 0 {
		common.ApiErrorT(c, "Purchase limit cannot be negative")
		return false
	}
	if plan.TotalAmount < 0 {
		common.ApiErrorT(c, "Total quota cannot be negative")
		return false
	}
	plan.UpgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
	if plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[plan.UpgradeGroup]; !ok {
			common.ApiErrorT(c, "Upgrade group does not exist")
			return false
		}
	}
	plan.DowngradeGroup = strings.TrimSpace(plan.DowngradeGroup)
	if plan.DowngradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[plan.DowngradeGroup]; !ok {
			common.ApiErrorT(c, "Downgrade group does not exist")
			return false
		}
	}
	routeGroups, err := model.NormalizeSubscriptionRouteGroups(plan.RouteGroups)
	if err != nil {
		common.ApiErrorT(c, err.Error())
		return false
	}
	if len(routeGroups) == 0 {
		common.ApiErrorT(c, "At least one subscription route group is required")
		return false
	}
	ratioGroups := ratio_setting.GetGroupRatioCopy()
	for _, routeGroup := range routeGroups {
		if _, ok := ratioGroups[routeGroup]; !ok {
			common.ApiErrorT(c, "Subscription route group {{group}} does not exist", map[string]any{"group": routeGroup})
			return false
		}
	}
	plan.RouteGroups = routeGroups
	windows, err := model.NormalizeSubscriptionQuotaWindows(plan.QuotaWindows)
	if err != nil {
		common.ApiErrorT(c, err.Error())
		return false
	}
	plan.QuotaWindows = windows
	if plan.PriceAmount > 0 && plan.TotalAmount == 0 && len(windows) == 0 {
		common.ApiErrorT(c, "Paid plans require a total quota or at least one rolling quota window")
		return false
	}
	if len(windows) > 0 {
		plan.TotalAmount = 0
		plan.QuotaResetPeriod = model.SubscriptionResetNever
		plan.QuotaResetCustomSeconds = 0
		plan.AllowWalletOverflow = common.GetPointer(false)
	} else {
		plan.QuotaResetPeriod = model.NormalizeResetPeriod(plan.QuotaResetPeriod)
		if plan.QuotaResetPeriod == model.SubscriptionResetCustom && plan.QuotaResetCustomSeconds <= 0 {
			common.ApiErrorT(c, "Custom reset cycle must be greater than 0 seconds")
			return false
		}
	}
	return true
}

func AdminCreateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Plan.Id = 0
	if !normalizeSubscriptionPlanInput(c, &req.Plan) {
		return
	}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&req.Plan).Error; err != nil {
			return err
		}
		if err := model.ReplaceSubscriptionPlanQuotaWindowsTx(tx, req.Plan.Id, req.Plan.QuotaWindows); err != nil {
			return err
		}
		return model.ReplaceSubscriptionPlanRouteGroupsTx(tx, req.Plan.Id, req.Plan.RouteGroups)
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(req.Plan.Id)
	common.ApiSuccess(c, req.Plan)
}

func AdminUpdateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Plan.Id = id
	if !normalizeSubscriptionPlanInput(c, &req.Plan) {
		return
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// update plan (allow zero values updates with map)
		updateMap := map[string]any{
			"title":                      req.Plan.Title,
			"subtitle":                   req.Plan.Subtitle,
			"price_amount":               req.Plan.PriceAmount,
			"currency":                   req.Plan.Currency,
			"duration_unit":              req.Plan.DurationUnit,
			"duration_value":             req.Plan.DurationValue,
			"custom_seconds":             req.Plan.CustomSeconds,
			"enabled":                    req.Plan.Enabled,
			"sort_order":                 req.Plan.SortOrder,
			"stripe_price_id":            req.Plan.StripePriceId,
			"creem_product_id":           req.Plan.CreemProductId,
			"waffo_pancake_product_id":   req.Plan.WaffoPancakeProductId,
			"max_purchase_per_user":      req.Plan.MaxPurchasePerUser,
			"max_concurrency":            req.Plan.MaxConcurrency,
			"max_output_tokens":          req.Plan.MaxOutputTokens,
			"total_amount":               req.Plan.TotalAmount,
			"upgrade_group":              req.Plan.UpgradeGroup,
			"downgrade_group":            req.Plan.DowngradeGroup,
			"quota_reset_period":         req.Plan.QuotaResetPeriod,
			"quota_reset_custom_seconds": req.Plan.QuotaResetCustomSeconds,
			"updated_at":                 common.GetTimestamp(),
		}
		if req.Plan.AllowBalancePay != nil {
			updateMap["allow_balance_pay"] = *req.Plan.AllowBalancePay
		}
		if req.Plan.AllowWalletOverflow != nil {
			updateMap["allow_wallet_overflow"] = *req.Plan.AllowWalletOverflow
		}
		if err := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Updates(updateMap).Error; err != nil {
			return err
		}
		if err := model.ReplaceSubscriptionPlanQuotaWindowsTx(tx, id, req.Plan.QuotaWindows); err != nil {
			return err
		}
		return model.ReplaceSubscriptionPlanRouteGroupsTx(tx, id, req.Plan.RouteGroups)
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminUpdateSubscriptionPlanStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func AdminUpdateSubscriptionPlanStatus(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminUpdateSubscriptionPlanStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DB.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Update("enabled", *req.Enabled).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

func AdminDeleteSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	err := model.DeleteSubscriptionPlan(id)
	switch {
	case err == nil:
		common.ApiSuccess(c, nil)
	case errors.Is(err, model.ErrSubscriptionPlanInUse):
		common.ApiErrorStatus(c, http.StatusConflict, err)
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Subscription plan not found"))
	default:
		common.ApiError(c, err)
	}
}

type AdminBindSubscriptionRequest struct {
	UserId int `json:"user_id"`
	PlanId int `json:"plan_id"`
}

func AdminBindSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminBindSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	msg, err := model.AdminBindSubscription(req.UserId, req.PlanId, "")
	if err != nil {
		if errors.Is(err, model.ErrActiveSubscriptionConflict) {
			common.ApiErrorStatus(c, http.StatusConflict, err)
			return
		}
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

// subscriptionChangeSuccess replies to an admin subscription change. notice
// tells the admin how the user's group changes, when it does.
func subscriptionChangeSuccess(c *gin.Context, notice *common.Message) {
	if notice == nil {
		common.ApiSuccess(c, nil)
		return
	}
	data := notice.Fields()
	data["message"] = notice.Error()
	common.ApiSuccess(c, data)
}

// ---- Admin: user subscription management ----

func AdminListUserSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	subs, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, subs)
}

type AdminCreateUserSubscriptionRequest struct {
	PlanId int `json:"plan_id"`
}

type AdminResetSubscriptionRequest struct {
	PlanId           int   `json:"plan_id"`
	AdvanceResetTime *bool `json:"advance_reset_time"`
}

func resolveAdvanceResetTime(value *bool) bool {
	if value == nil {
		return true
	}
	return *value
}

func recordSubscriptionResetUserLogs(c *gin.Context, result *model.SubscriptionResetResult, adminInfo *model.AuditAdminInfo) {
	if result == nil || result.ResetCount == 0 {
		return
	}
	const action = "subscription.user_quota_reset"
	params := map[string]any{"plan_id": result.PlanId, "plan_title": result.PlanTitle}
	operation := model.AuditOperation{Action: action, Params: params}
	content := auditContentEN(action, params)
	for _, userId := range result.AffectedUserIds {
		model.RecordLogWithAdminInfo(userId, model.LogTypeManage, content, adminInfo, &operation, c)
	}
}

// AdminCreateUserSubscription creates a new user subscription from a plan (no payment).
func AdminCreateUserSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	var req AdminCreateUserSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	msg, err := model.AdminBindSubscription(userId, req.PlanId, "")
	if err != nil {
		if errors.Is(err, model.ErrActiveSubscriptionConflict) {
			common.ApiErrorStatus(c, http.StatusConflict, err)
			return
		}
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

func AdminResetUserSubscriptionsByPlan(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetUserSubscriptionsByPlan(userId, req.PlanId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	recordManageAuditFor(c, userId, "subscription.user_plan_reset", map[string]any{
		"target_user_id":     userId,
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

func AdminResetPlanSubscriptions(c *gin.Context) {
	planId, _ := strconv.Atoi(c.Param("id"))
	if planId <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetPlanSubscriptions(planId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	common.SysLog(common.LogText("admin reset subscription plan %d quota: reset_count=%d user_count=%d advance_reset_time=%t",
		result.PlanId, result.ResetCount, result.UserCount, result.AdvanceResetTime))
	recordManageAudit(c, "subscription.plan_reset", map[string]any{
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

// AdminInvalidateUserSubscription cancels a user subscription immediately.
func AdminInvalidateUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorT(c, "Invalid subscription ID")
		return
	}
	msg, err := model.AdminInvalidateUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorT(c, "Invalid subscription ID")
		return
	}
	msg, err := model.AdminDeleteUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}
