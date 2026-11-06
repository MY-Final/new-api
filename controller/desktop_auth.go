package controller

import (
	"encoding/base64"
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func DesktopAuthStart(c *gin.Context) {
	setAuthNoStore(c)
	var request model.DesktopRequest
	if common.DecodeJson(c.Request.Body, &request) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_REQUEST_INVALID", "Invalid desktop authorization request.")
		return
	}
	callback, err := url.Parse(request.RedirectURI)
	if err != nil || callback.Scheme != "http" || callback.Hostname() != "127.0.0.1" || callback.Path != "/callback" || callback.RawPath != "" || callback.User != nil || callback.RawQuery != "" || callback.ForceQuery || callback.Fragment != "" {
		writeAccessTokenError(c, 400, "DESKTOP_CALLBACK_INVALID", "Only a loopback callback is allowed.")
		return
	}
	port, err := strconv.Atoi(callback.Port())
	if err != nil || port < 1024 || port > 65535 {
		writeAccessTokenError(c, 400, "DESKTOP_CALLBACK_INVALID", "Invalid callback port.")
		return
	}
	challenge, err := base64.RawURLEncoding.DecodeString(request.CodeChallenge)
	if !model.IsSupportedClientID(request.ClientId) || request.CodeChallengeMethod != "S256" || err != nil || len(challenge) != 32 ||
		len(request.State) < 32 || len(request.State) > 128 || strings.ContainsAny(request.State, "\r\n") ||
		utf8.RuneCountInString(request.DeviceName) == 0 || utf8.RuneCountInString(request.DeviceName) > 32 {
		writeAccessTokenError(c, 400, "DESKTOP_REQUEST_INVALID", "Invalid desktop authorization request.")
		return
	}
	if _, err := uuid.Parse(request.InstallationId); err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_REQUEST_INVALID", "Invalid installation ID.")
		return
	}
	// Build the public URL from trusted application configuration, not Host or
	// forwarded headers supplied by the caller.
	site, err := url.Parse(system_setting.ServerAddress)
	if err != nil || site.Host == "" || site.User != nil || site.RawQuery != "" || site.ForceQuery || site.Fragment != "" || (site.Scheme != "https" && !(site.Scheme == "http" && (site.Hostname() == "127.0.0.1" || site.Hostname() == "localhost"))) {
		writeAccessTokenError(c, 503, "DESKTOP_AUTH_UNAVAILABLE", "The site's public HTTPS address is not configured.")
		return
	}
	payload, err := common.Marshal(request)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	expires := time.Now().Add(5 * time.Minute)
	raw, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: model.DesktopRequestPurpose, Payload: string(payload), ExpiresAt: expires})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	site.Path = strings.TrimRight(site.Path, "/") + "/desktop/authorize"
	site.RawQuery = url.Values{"flow": {raw}}.Encode()
	common.ApiSuccess(c, gin.H{"authorization_url": site.String(), "expires_at": expires.Unix()})
}

func DesktopAuthRequest(c *gin.Context) {
	setAuthNoStore(c)
	if _, ok := requireBrowserSession(c); !ok {
		return
	}
	flow, err := model.GetAuthFlow(c.Query("flow"), model.AuthFlowMatch{Purpose: model.DesktopRequestPurpose})
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "This authorization request is invalid or expired.")
		return
	}
	var request model.DesktopRequest
	if common.UnmarshalJsonStr(flow.Payload, &request) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "Invalid authorization request.")
		return
	}
	scopes, ok := model.GrantedScopesForClient(request.ClientId)
	if !ok {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "Invalid authorization request.")
		return
	}
	common.ApiSuccess(c, gin.H{
		"client_id":   request.ClientId,
		"device_name": request.DeviceName,
		"expires_at":  flow.ExpiresAt.Unix(),
		"request_id":  flow.Id,
		"scopes":      scopes,
	})
}

func DesktopAuthAuthorize(c *gin.Context) {
	setAuthNoStore(c)
	identity, ok := requireBrowserSession(c)
	if !ok {
		return
	}
	var input struct {
		Flow    string `json:"flow"`
		Approve bool   `json:"approve"`
		Group   string `json:"group"`
	}
	if common.DecodeJson(c.Request.Body, &input) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_REQUEST_INVALID", "Invalid request.")
		return
	}
	flow, err := model.GetAuthFlow(input.Flow, model.AuthFlowMatch{Purpose: model.DesktopRequestPurpose})
	if err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "This authorization request is invalid or expired.")
		return
	}
	var request model.DesktopRequest
	if common.UnmarshalJsonStr(flow.Payload, &request) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "Invalid request.")
		return
	}
	group := ""
	proofGroup := ""
	if input.Approve && request.ClientId == model.MagpieClientID {
		proofGroup = strings.TrimSpace(input.Group)
		group = proofGroup
		user, err := model.GetUserById(identity.UserID, false)
		if err != nil {
			writeSecurityOperationError(c, err)
			return
		}
		if group == "" {
			group = user.Group
		}
		if len(group) > 128 || !service.IsUserSelectableGroupForUser(user.Group, user.Id, group) {
			writeAccessTokenError(c, 400, "DESKTOP_GROUP_INVALID", "This group is not available for your account.")
			return
		}
	}
	var code string
	if input.Approve {
		context, err := common.Marshal(service.DesktopAuthorizeContext{RequestID: flow.Id, Group: proofGroup})
		if err != nil {
			writeSecurityOperationError(c, err)
			return
		}
		if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeDesktopAuthorize, Context: context}) == nil {
			return
		}
		request, code, err = model.ApproveDesktopRequest(input.Flow, identity, group)
		if err != nil {
			writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "Authorization is invalid or expired.")
			return
		}
	} else if _, err := model.ConsumeAuthFlow(input.Flow, model.AuthFlowMatch{Purpose: model.DesktopRequestPurpose}); err != nil {
		writeAccessTokenError(c, 400, "DESKTOP_FLOW_INVALID", "Authorization is invalid or expired.")
		return
	}
	callback, _ := url.Parse(request.RedirectURI)
	query := url.Values{"state": {request.State}}
	if input.Approve {
		query.Set("code", code)
	} else {
		query.Set("error", "access_denied")
	}
	callback.RawQuery = query.Encode()
	audit := map[string]any{"request_id": flow.Id, "approved": input.Approve}
	if group != "" {
		audit["group"] = group
	}
	recordUserSecurityAudit(c, identity.UserID, "desktop.authorize", audit)
	common.ApiSuccess(c, gin.H{"callback_url": callback.String()})
}

func DesktopAuthExchange(c *gin.Context) {
	setAuthNoStore(c)
	var input struct {
		Code        string `json:"code"`
		Verifier    string `json:"code_verifier"`
		RedirectURI string `json:"redirect_uri"`
	}
	if common.DecodeJson(c.Request.Body, &input) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_REQUEST_INVALID", "Invalid request.")
		return
	}
	exchange, err := model.ExchangeDesktopCode(input.Code, input.Verifier, input.RedirectURI, service.IsUserSelectableGroupForUser)
	if err != nil {
		if errors.Is(err, model.ErrAccessTokenLimit) {
			writeAccessTokenError(c, 409, "ACCESS_TOKEN_LIMIT", "The account's access token limit has been reached.")
			return
		}
		if errors.Is(err, model.ErrDesktopKeyLimit) {
			writeAccessTokenError(c, 409, "PLUGIN_KEY_LIMIT", "The account's API key limit has been reached.")
			return
		}
		if errors.Is(err, model.ErrDesktopGroupUnavailable) {
			writeAccessTokenError(c, 400, "DESKTOP_GROUP_INVALID", "The selected group is no longer available for your account.")
			return
		}
		writeAccessTokenError(c, 400, "DESKTOP_CODE_INVALID", "This authorization code is invalid, expired, or already used.")
		return
	}
	token := exchange.Token
	installation := exchange.Installation
	// This endpoint is anonymous; derive the audit actor from the exchanged
	// authorization instead of a caller-controlled context or role.
	if user, err := model.GetUserById(installation.UserId, false); err == nil {
		c.Set("role", user.Role)
		c.Set("id", user.Id)
		c.Set("username", user.Username)
	}
	audit := map[string]any{
		"client_id":       model.DesktopInstallationClientID(installation),
		"installation_id": installation.Id,
		"token_id":        token.Id,
		"token_ref":       token.TokenHash,
	}
	if exchange.APIToken != nil {
		audit["api_token_id"] = exchange.APIToken.Id
	}
	if exchange.Group != "" {
		audit["group"] = exchange.Group
	}
	recordUserSecurityAudit(c, installation.UserId, "desktop.exchange", audit)
	response := gin.H{
		"access_token": exchange.AccessToken,
		"expires_at":   token.ExpiresAt,
		"token":        exchange.AccessToken,
	}
	if model.IsMagpieInstallation(installation) && exchange.APIToken != nil {
		response["api_key"] = "sk-" + exchange.APIToken.Key
		response["client_id"] = model.MagpieClientID
		response["group"] = exchange.Group
		if user, userErr := model.GetUserById(installation.UserId, false); userErr == nil {
			response["user"] = gin.H{
				"id":           user.Id,
				"username":     user.Username,
				"display_name": user.DisplayName,
				"email":        user.Email,
			}
		}
	}
	common.ApiSuccess(c, response)
}

func DesktopAuthLogout(c *gin.Context) {
	setAuthNoStore(c)
	installation, err := model.GetDesktopInstallation(c.GetInt("access_token_id"), c.GetInt("id"))
	if err != nil {
		writeAccessTokenError(c, 401, "DESKTOP_AUTH_INVALID", "Desktop authorization is invalid.")
		return
	}
	token, err := model.DeleteUserAccessToken(installation.UserId, installation.AccessTokenId)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	recordUserSecurityAudit(c, installation.UserId, "desktop.logout", map[string]any{"installation_id": installation.Id, "token_ref": token.TokenHash})
	common.ApiSuccess(c, nil)
}

func DesktopConfigureTool(c *gin.Context) {
	setAuthNoStore(c)
	installation, err := model.GetDesktopInstallation(c.GetInt("access_token_id"), c.GetInt("id"))
	if err != nil {
		writeAccessTokenError(c, 401, "DESKTOP_AUTH_INVALID", "Desktop authorization is invalid.")
		return
	}
	var input struct {
		Model   string   `json:"model"`
		TokenId int      `json:"token_id"`
		Group   string   `json:"group"`
		Models  []string `json:"models"`
	}
	if common.DecodeJson(c.Request.Body, &input) != nil {
		writeAccessTokenError(c, 400, "DESKTOP_MODEL_INVALID", "Select an available model.")
		return
	}
	user, err := model.GetUserById(installation.UserId, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	// Binding an existing key: the user already chose the key, group, and model
	// set in the key center, so the server validates them instead of issuing a
	// new key.
	if input.TokenId > 0 {
		group := strings.TrimSpace(input.Group)
		if group == "" {
			group = user.Group
		}
		if !service.IsUserSelectableGroupForUser(user.Group, user.Id, group) {
			writeAccessTokenError(c, 400, "DESKTOP_GROUP_INVALID", "This group is not available for your account.")
			return
		}
		var allowed []string
		if err := model.DB.Model(&model.Ability{}).Where(&model.Ability{Group: group, Enabled: true}).Distinct("model").Pluck("model", &allowed).Error; err != nil {
			writeSecurityOperationError(c, err)
			return
		}
		models, ok := normalizeDesktopModels(input.Models, allowed)
		if !ok {
			writeAccessTokenError(c, 400, "DESKTOP_MODEL_INVALID", "One or more selected models are not available in this group.")
			return
		}
		token, err := model.BindDesktopTool(model.DesktopToolBindingInput{
			InstallationID: installation.Id,
			AccessTokenID:  installation.AccessTokenId,
			Agent:          c.Param("agent"),
			TokenID:        input.TokenId,
			Group:          group,
			Models:         models,
			OwnerGroup:     user.Group,
			AllowedModels:  allowed,
		})
		if err != nil {
			writeAccessTokenError(c, 409, "DESKTOP_CONFIG_FAILED", "Unable to bind this key. Check the key, group, and model selection.")
			return
		}
		recordUserSecurityAudit(c, installation.UserId, "desktop.tool.bind", map[string]any{"installation_id": installation.Id, "agent": c.Param("agent"), "token_id": token.Id, "group": group})
		common.ApiSuccess(c, gin.H{"id": token.Id, "key": token.GetFullKey(), "group": group, "models": models})
		return
	}
	if len(input.Model) == 0 || len(input.Model) > 256 || strings.ContainsAny(input.Model, ",\r\n") {
		writeAccessTokenError(c, 400, "DESKTOP_MODEL_INVALID", "Select an available model.")
		return
	}
	// Legacy path: issue a dedicated key on the user's default group.
	var models []string
	if err := model.DB.Model(&model.Ability{}).Where(&model.Ability{Group: user.Group, Enabled: true}).Distinct("model").Pluck("model", &models).Error; err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if !slices.Contains(models, input.Model) {
		writeAccessTokenError(c, 400, "DESKTOP_MODEL_INVALID", "The selected model is unavailable in your default group.")
		return
	}
	token, err := model.ConfigureDesktopTool(installation.Id, installation.AccessTokenId, c.Param("agent"), input.Model, user.Group, models, operation_setting.GetMaxUserTokens())
	if err != nil {
		writeAccessTokenError(c, 409, "DESKTOP_CONFIG_FAILED", "Unable to configure this tool. Check authorization, model availability, and key limits.")
		return
	}
	recordUserSecurityAudit(c, installation.UserId, "desktop.tool.configure", map[string]any{"installation_id": installation.Id, "agent": c.Param("agent"), "token_id": token.Id, "model": input.Model})
	common.ApiSuccess(c, gin.H{"id": token.Id, "key": token.GetFullKey(), "model": input.Model})
}

// normalizeDesktopModels trims and de-duplicates a requested model set,
// rejecting anything the chosen group does not enable.
func normalizeDesktopModels(requested, allowed []string) ([]string, bool) {
	if len(requested) == 0 {
		return nil, true
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(requested))
	for _, name := range requested {
		name = strings.TrimSpace(name)
		if name == "" || strings.ContainsAny(name, ",\r\n") || !slices.Contains(allowed, name) {
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

// DesktopProfile is the stable account contract for the desktop app. It reuses
// the dashboard self DTO and returns display-ready quota values so Setup does
// not re-implement billing rules. Other compatible sites (for example a future
// sub2api implementation) may return the same shape; the desktop app depends
// only on these fields.
func DesktopProfile(c *gin.Context) {
	setAuthNoStore(c)
	installation, err := model.GetDesktopInstallation(c.GetInt("access_token_id"), c.GetInt("id"))
	if err != nil {
		writeAccessTokenError(c, 401, "DESKTOP_AUTH_INVALID", "Desktop authorization is invalid.")
		return
	}
	user, err := model.GetUserById(installation.UserId, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	// Deliberately narrower than the dashboard self DTO: the desktop app only
	// needs identity and display values, so billing/affiliate/permission fields
	// are not exposed through a long-lived desktop token.
	common.ApiSuccess(c, gin.H{
		"provider": "newapi",
		"user": gin.H{
			"id":            user.Id,
			"username":      user.Username,
			"display_name":  user.DisplayName,
			"email":         user.Email,
			"role":          user.Role,
			"status":        user.Status,
			"group":         user.Group,
			"request_count": user.RequestCount,
			"created_at":    user.CreatedAt,
			"last_login_at": user.LastLoginAt,
		},
		"quota": desktopQuotaDisplay(user.Quota, user.UsedQuota),
	})
}

// desktopQuotaDisplay converts internal quota to the value and unit the site
// would show in its own dashboard, so desktop and web stay consistent.
func desktopQuotaDisplay(balance, used int) map[string]any {
	perUnit := common.QuotaPerUnit
	if perUnit <= 0 {
		perUnit = 500000
	}
	displayType := operation_setting.GetQuotaDisplayType()
	symbol := operation_setting.GetCurrencySymbol()
	if !operation_setting.IsCurrencyDisplay() {
		return map[string]any{
			"display_type":   "TOKENS",
			"symbol":         "",
			"balance":        float64(balance),
			"used":           float64(used),
			"quota_per_unit": perUnit,
		}
	}
	rate := operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	convert := func(value int) float64 {
		return float64(value) / perUnit * rate
	}
	return map[string]any{
		"display_type":   displayType,
		"symbol":         symbol,
		"balance":        convert(balance),
		"used":           convert(used),
		"quota_per_unit": perUnit,
	}
}
