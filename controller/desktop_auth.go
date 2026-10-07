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
	if request.ClientId != model.DesktopClientID || request.CodeChallengeMethod != "S256" || err != nil || len(challenge) != 32 ||
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
	common.ApiSuccess(c, gin.H{"device_name": request.DeviceName, "expires_at": flow.ExpiresAt.Unix(), "request_id": flow.Id, "scopes": []string{"profile:read", model.DesktopConfigureScope}})
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
	var code string
	if input.Approve {
		context, err := common.Marshal(service.DesktopAuthorizeContext{RequestID: flow.Id})
		if err != nil {
			writeSecurityOperationError(c, err)
			return
		}
		if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeDesktopAuthorize, Context: context}) == nil {
			return
		}
		request, code, err = model.ApproveDesktopRequest(input.Flow, identity)
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
	recordUserSecurityAudit(c, identity.UserID, "desktop.authorize", map[string]any{"request_id": flow.Id, "approved": input.Approve})
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
	raw, token, installation, err := model.ExchangeDesktopCode(input.Code, input.Verifier, input.RedirectURI)
	if err != nil {
		if errors.Is(err, model.ErrAccessTokenLimit) {
			writeAccessTokenError(c, 409, "ACCESS_TOKEN_LIMIT", "The account's access token limit has been reached.")
			return
		}
		writeAccessTokenError(c, 400, "DESKTOP_CODE_INVALID", "This authorization code is invalid, expired, or already used.")
		return
	}
	// This endpoint is anonymous; derive the audit actor from the exchanged
	// authorization instead of a caller-controlled context or role.
	if user, err := model.GetUserById(installation.UserId, false); err == nil {
		c.Set("role", user.Role)
		c.Set("id", user.Id)
		c.Set("username", user.Username)
	}
	recordUserSecurityAudit(c, installation.UserId, "desktop.exchange", map[string]any{"installation_id": installation.Id, "token_id": token.Id, "token_ref": token.TokenHash})
	common.ApiSuccess(c, gin.H{"token": raw, "expires_at": token.ExpiresAt})
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
		Model string `json:"model"`
	}
	if common.DecodeJson(c.Request.Body, &input) != nil || len(input.Model) == 0 || len(input.Model) > 256 || strings.ContainsAny(input.Model, ",\r\n") {
		writeAccessTokenError(c, 400, "DESKTOP_MODEL_INVALID", "Select an available model.")
		return
	}
	user, err := model.GetUserById(installation.UserId, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	// Use the default group consistently for model selection and issuance.
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
