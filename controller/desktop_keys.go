package controller

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

type desktopKeyRequest struct {
	Name        string   `json:"name"`
	Group       string   `json:"group"`
	ModelLimits []string `json:"model_limits"`
}

// desktopRequestContext loads the installation and owner for a desktop request
// and fails closed when the desktop authorization is missing or stale.
func desktopRequestContext(c *gin.Context) (*model.DesktopInstallation, *model.User, bool) {
	installation, err := model.GetDesktopInstallation(c.GetInt("access_token_id"), c.GetInt("id"))
	if err != nil {
		writeAccessTokenError(c, 401, "DESKTOP_AUTH_INVALID", "Desktop authorization is invalid.")
		return nil, nil, false
	}
	user, err := model.GetUserById(installation.UserId, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return nil, nil, false
	}
	return installation, user, true
}

// resolveDesktopGroup validates the requested group against the user's
// selectable groups and returns the group to persist plus the models it allows.
// An empty group falls back to the user's own group.
func resolveDesktopGroup(userGroup, requested string) (string, []string, bool) {
	group := strings.TrimSpace(requested)
	if group == "" {
		group = userGroup
	}
	if !service.IsUserSelectableGroup(userGroup, group) {
		return "", nil, false
	}
	var models []string
	if err := model.DB.Model(&model.Ability{}).Where(&model.Ability{Group: group, Enabled: true}).Distinct("model").Pluck("model", &models).Error; err != nil {
		return "", nil, false
	}
	if len(models) == 0 {
		return "", nil, false
	}
	return group, models, true
}

// desktopModelsAllowed returns the subset of requested models that the group
// actually enables, rejecting the request when any model is unavailable.
func desktopModelsAllowed(requested, allowed []string) ([]string, bool) {
	if len(requested) == 0 {
		return nil, true
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(requested))
	for _, name := range requested {
		name = strings.TrimSpace(name)
		if name == "" || strings.ContainsAny(name, ",\r\n") {
			return nil, false
		}
		if !slices.Contains(allowed, name) {
			return nil, false
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result, true
}

func DesktopListKeys(c *gin.Context) {
	setAuthNoStore(c)
	_, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	tokens, total, err := model.ListDesktopTokens(user.Id, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	items := make([]model.DesktopKeySummary, 0, len(tokens))
	for _, token := range tokens {
		summary := model.SummarizeDesktopKey(token)
		if agents, err := model.DesktopTokenBoundAgents(token.Id); err == nil {
			summary.BoundAgents = agents
		}
		items = append(items, summary)
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func DesktopGetKey(c *gin.Context) {
	setAuthNoStore(c)
	_, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key.")
		return
	}
	token, err := model.GetTokenByIds(id, user.Id)
	if err != nil {
		writeAccessTokenError(c, 404, "DESKTOP_KEY_NOT_FOUND", "This key does not exist.")
		return
	}
	summary := model.SummarizeDesktopKey(token)
	if agents, err := model.DesktopTokenBoundAgents(token.Id); err == nil {
		summary.BoundAgents = agents
	}
	common.ApiSuccess(c, summary)
}

func DesktopCreateKey(c *gin.Context) {
	setAuthNoStore(c)
	installation, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	var input desktopKeyRequest
	if common.DecodeJson(c.Request.Body, &input) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key request.")
		return
	}
	group, allowed, ok := resolveDesktopGroup(user.Group, input.Group)
	if !ok {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_GROUP_INVALID", "This group is not available for your account.")
		return
	}
	models, ok := desktopModelsAllowed(input.ModelLimits, allowed)
	if !ok {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_MODEL_INVALID", "One or more selected models are not available in this group.")
		return
	}
	token, err := model.CreateDesktopToken(user.Id, input.Name, group, models, operation_setting.GetMaxUserTokens())
	if errors.Is(err, model.ErrDesktopKeyLimit) {
		writeAccessTokenError(c, 409, "DESKTOP_KEY_LIMIT", "You have reached the maximum number of keys.")
		return
	}
	if errors.Is(err, model.ErrDesktopKeyInvalid) {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Enter a key name between 1 and 50 characters.")
		return
	}
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	recordUserSecurityAudit(c, user.Id, "desktop.key.create", map[string]any{"installation_id": installation.Id, "key_id": token.Id, "group": token.Group})
	// The raw key is returned exactly once, like the dashboard creator; the
	// audit log stores only non-secret identifiers.
	common.ApiSuccess(c, gin.H{
		"id":     token.Id,
		"name":   token.Name,
		"key":    token.GetFullKey(),
		"group":  token.Group,
		"models": token.GetModelLimits(),
	})
}

func DesktopUpdateKey(c *gin.Context) {
	setAuthNoStore(c)
	installation, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key.")
		return
	}
	var input desktopKeyRequest
	if common.DecodeJson(c.Request.Body, &input) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key request.")
		return
	}
	group, allowed, ok := resolveDesktopGroup(user.Group, input.Group)
	if !ok {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_GROUP_INVALID", "This group is not available for your account.")
		return
	}
	models, ok := desktopModelsAllowed(input.ModelLimits, allowed)
	if !ok {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_MODEL_INVALID", "One or more selected models are not available in this group.")
		return
	}
	token, err := model.UpdateDesktopToken(user.Id, id, input.Name, group, models)
	if errors.Is(err, model.ErrDesktopKeyInvalid) {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Enter a key name between 1 and 50 characters.")
		return
	}
	if err != nil {
		writeAccessTokenError(c, 404, "DESKTOP_KEY_NOT_FOUND", "This key does not exist.")
		return
	}
	recordUserSecurityAudit(c, user.Id, "desktop.key.update", map[string]any{"installation_id": installation.Id, "key_id": token.Id, "group": token.Group})
	summary := model.SummarizeDesktopKey(token)
	if agents, err := model.DesktopTokenBoundAgents(token.Id); err == nil {
		summary.BoundAgents = agents
	}
	common.ApiSuccess(c, summary)
}

func DesktopDeleteKey(c *gin.Context) {
	setAuthNoStore(c)
	installation, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key.")
		return
	}
	err = model.DeleteDesktopToken(user.Id, id)
	if errors.Is(err, model.ErrDesktopKeyInUse) {
		writeAccessTokenError(c, 409, "DESKTOP_KEY_IN_USE", "This key is still used by a coding tool. Unbind it first.")
		return
	}
	if err != nil {
		writeAccessTokenError(c, 404, "DESKTOP_KEY_NOT_FOUND", "This key does not exist.")
		return
	}
	recordUserSecurityAudit(c, user.Id, "desktop.key.delete", map[string]any{"installation_id": installation.Id, "key_id": id})
	common.ApiSuccess(c, nil)
}

func DesktopRevealKey(c *gin.Context) {
	setAuthNoStore(c)
	installation, user, ok := desktopRequestContext(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_KEY_INVALID", "Invalid key.")
		return
	}
	token, err := model.GetTokenByIds(id, user.Id)
	if err != nil {
		writeAccessTokenError(c, 404, "DESKTOP_KEY_NOT_FOUND", "This key does not exist.")
		return
	}
	recordUserSecurityAudit(c, user.Id, "desktop.key.reveal", map[string]any{"installation_id": installation.Id, "key_id": token.Id})
	common.ApiSuccess(c, gin.H{"id": token.Id, "key": token.GetFullKey()})
}
