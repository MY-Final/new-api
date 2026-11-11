package model

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	DesktopClientID       = "kuncode-setup"
	MagpieClientID        = "magpie"
	DesktopRequestPurpose = "desktop_request"
	DesktopCodePurpose    = "desktop_code"
	DesktopConfigureScope = "coding_tools:configure"
	MagpieAPITokenAgent   = "magpie"

	magpieInstallationPrefix = "magpie:"
	clientCredentialLifetime = 30 * 24 * 60 * 60

	// Desktop key-management scopes. Reveal is deliberately separate from read
	// so the long-lived desktop token can list keys without being able to read
	// their plaintext unless that is explicitly granted.
	DesktopKeysReadScope   = "desktop_keys:read"
	DesktopKeysWriteScope  = "desktop_keys:write"
	DesktopKeysRevealScope = "desktop_keys:reveal"
)

// DesktopGrantedScopes is the fixed grant written into every desktop access
// token at exchange time and echoed on the authorization screen.
func DesktopGrantedScopes() []string {
	return []string{
		"profile:read",
		DesktopConfigureScope,
		DesktopKeysReadScope,
		DesktopKeysWriteScope,
		DesktopKeysRevealScope,
	}
}

// MagpieGrantedScopes is intentionally narrower than the desktop grant. The
// plugin only needs the account profile, wallet and subscription usage, and
// daily check-in.
func MagpieGrantedScopes() []string {
	return []string{
		"profile:read",
		"wallet:read",
		"wallet:write",
	}
}

// GrantedScopesForClient returns the fixed grant for a supported client.
func GrantedScopesForClient(clientID string) ([]string, bool) {
	switch clientID {
	case DesktopClientID:
		return DesktopGrantedScopes(), true
	case MagpieClientID:
		return MagpieGrantedScopes(), true
	default:
		return nil, false
	}
}

// IsSupportedClientID reports whether the authorization request may use the
// shared browser authorization flow.
func IsSupportedClientID(clientID string) bool {
	_, ok := GrantedScopesForClient(clientID)
	return ok
}

// IsMagpieInstallation distinguishes Magpie installations from KunCode Setup
// without adding a schema migration.
func IsMagpieInstallation(installation *DesktopInstallation) bool {
	return installation != nil && strings.HasPrefix(installation.ClientInstallationId, magpieInstallationPrefix)
}

// DesktopInstallationClientID returns the client that owns an installation.
func DesktopInstallationClientID(installation *DesktopInstallation) string {
	if IsMagpieInstallation(installation) {
		return MagpieClientID
	}
	return DesktopClientID
}

var ErrDesktopAuthorization = errors.New("desktop authorization is invalid or expired")
var ErrDesktopGroupUnavailable = errors.New("desktop authorization group is unavailable")

// DesktopInstallation owns the server-side relationship; neither device names
// nor API key names are used as authorization evidence.
type DesktopInstallation struct {
	Id                   int    `json:"id"`
	UserId               int    `json:"-" gorm:"uniqueIndex:idx_desktop_owner_install"`
	ClientInstallationId string `json:"-" gorm:"type:varchar(64);uniqueIndex:idx_desktop_owner_install"`
	Name                 string `json:"name" gorm:"type:varchar(64)"`
	AccessTokenId        int    `json:"-" gorm:"index"`
	AuthVersion          int64  `json:"-"`
	CreatedAt            int64  `json:"created_at"`
}

type DesktopToolKey struct {
	Id             int    `json:"id"`
	InstallationId int    `json:"-" gorm:"uniqueIndex:idx_desktop_install_agent"`
	Agent          string `json:"agent" gorm:"type:varchar(16);uniqueIndex:idx_desktop_install_agent"`
	TokenId        int    `json:"token_id" gorm:"index"`
}

type DesktopRequest struct {
	ClientId            string `json:"client_id"`
	InstallationId      string `json:"installation_id"`
	DeviceName          string `json:"device_name"`
	RedirectURI         string `json:"redirect_uri"`
	State               string `json:"state"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
}

type desktopCode struct {
	Request  DesktopRequest      `json:"request"`
	Identity AuthSessionIdentity `json:"identity"`
	Group    string              `json:"group,omitempty"`
}

// ClientAuthorizationExchange contains the credentials and server-owned
// records produced by one atomic authorization-code exchange.
type ClientAuthorizationExchange struct {
	AccessToken  string
	Token        *UserAccessToken
	Installation *DesktopInstallation
	APIToken     *Token
	Group        string
}

// ApproveDesktopRequest records the user's selected routing group in the
// one-time code. The original request remains untouched so older clients
// continue to work with the user's current group.
func ApproveDesktopRequest(raw string, identity AuthSessionIdentity, group string) (DesktopRequest, string, error) {
	var request DesktopRequest
	var code string
	_, err := ConsumeAuthFlowWithAction(raw, AuthFlowMatch{Purpose: DesktopRequestPurpose}, func(tx *gorm.DB, flow *AuthFlow) error {
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := common.UnmarshalJsonStr(flow.Payload, &request); err != nil {
			return ErrDesktopAuthorization
		}
		selectedGroup := ""
		if request.ClientId == MagpieClientID {
			selectedGroup = strings.TrimSpace(group)
		}
		payload, err := common.Marshal(desktopCode{Request: request, Identity: identity, Group: selectedGroup})
		if err != nil {
			return err
		}
		code, _, err = createAuthFlowWithTx(tx, AuthFlowCreate{Purpose: DesktopCodePurpose, UserId: identity.UserID, SessionId: identity.SessionID, Payload: string(payload), ExpiresAt: time.Now().Add(time.Minute)})
		return err
	})
	return request, code, err
}

// ExchangeDesktopCode consumes the code and rotates the installation's
// credentials in one transaction. Only the PAT digest is persisted; lost
// responses require a new authorization, never a replay of a credential-bearing
// response. Magpie also receives a dedicated, expiring API key for /v1.
func ExchangeDesktopCode(raw, verifier, redirectURI string, groupAllowed func(userGroup string, userID int, group string) bool) (*ClientAuthorizationExchange, error) {
	if len(verifier) < 43 || len(verifier) > 128 {
		return nil, ErrDesktopAuthorization
	}
	for _, char := range verifier {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '.' || char == '_' || char == '~') {
			return nil, ErrDesktopAuthorization
		}
	}
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])
	var credential string
	var token UserAccessToken
	var installation DesktopInstallation
	var apiToken Token
	// Recheck the selected group immediately before consuming the one-time
	// code. This query runs outside the transaction so callers can use their
	// normal permission service without nesting SQLite database connections.
	flow, err := GetAuthFlow(raw, AuthFlowMatch{Purpose: DesktopCodePurpose})
	if err != nil {
		return nil, ErrDesktopAuthorization
	}
	var checkedPayload desktopCode
	if common.UnmarshalJsonStr(flow.Payload, &checkedPayload) != nil ||
		subtle.ConstantTimeCompare([]byte(challenge), []byte(checkedPayload.Request.CodeChallenge)) != 1 ||
		redirectURI != checkedPayload.Request.RedirectURI {
		return nil, ErrDesktopAuthorization
	}
	if checkedPayload.Request.ClientId == MagpieClientID {
		var user User
		if err := DB.Select("id", "group").First(&user, checkedPayload.Identity.UserID).Error; err != nil {
			return nil, ErrDesktopAuthorization
		}
		if strings.TrimSpace(checkedPayload.Group) == "" ||
			groupAllowed == nil ||
			!groupAllowed(user.Group, user.Id, checkedPayload.Group) {
			return nil, ErrDesktopGroupUnavailable
		}
	}
	_, err = ConsumeAuthFlowWithAction(raw, AuthFlowMatch{Purpose: DesktopCodePurpose}, func(tx *gorm.DB, flow *AuthFlow) error {
		var payload desktopCode
		if common.UnmarshalJsonStr(flow.Payload, &payload) != nil ||
			subtle.ConstantTimeCompare([]byte(challenge), []byte(payload.Request.CodeChallenge)) != 1 ||
			redirectURI != payload.Request.RedirectURI {
			return ErrDesktopAuthorization
		}
		scopes, ok := GrantedScopesForClient(payload.Request.ClientId)
		if !ok {
			return ErrDesktopAuthorization
		}
		if err := ValidateAuthSessionWithTx(tx, payload.Identity); err != nil {
			return err
		}
		installationID := payload.Request.InstallationId
		if payload.Request.ClientId == MagpieClientID {
			installationID = magpieInstallationPrefix + installationID
		}
		err := lockForUpdate(tx).Where("user_id = ? AND client_installation_id = ?", payload.Identity.UserID, installationID).First(&installation).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if installation.AccessTokenId != 0 {
			if err := tx.Where("id = ? AND user_id = ?", installation.AccessTokenId, payload.Identity.UserID).Delete(&UserAccessToken{}).Error; err != nil {
				return err
			}
		}
		var count int64
		if err := tx.Model(&UserAccessToken{}).Where("user_id = ?", payload.Identity.UserID).Count(&count).Error; err != nil {
			return err
		}
		if count >= 20 {
			return ErrAccessTokenLimit
		}
		suffix, err := common.GenerateRandomCharsKey(43)
		if err != nil {
			return err
		}
		credential = AccessTokenPrefix + suffix
		now := time.Now().Unix()
		if installation.Id == 0 {
			installation = DesktopInstallation{UserId: payload.Identity.UserID, ClientInstallationId: installationID, CreatedAt: now}
			if err := tx.Create(&installation).Error; err != nil {
				return err
			}
		}
		tokenName := "KunCode Setup · " + payload.Request.DeviceName
		if payload.Request.ClientId == MagpieClientID {
			tokenName = "Magpie · " + payload.Request.DeviceName
		}
		token = UserAccessToken{UserId: payload.Identity.UserID, DesktopInstallationId: installation.Id, Name: tokenName, TokenHash: AccessTokenFingerprint(credential), TokenHint: AccessTokenHint(credential), CreatedAt: now, ExpiresAt: now + clientCredentialLifetime}
		if err := token.SetScopes(scopes); err != nil {
			return err
		}
		if err := tx.Create(&token).Error; err != nil {
			return err
		}
		installation.UserId = payload.Identity.UserID
		installation.ClientInstallationId = installationID
		installation.Name = payload.Request.DeviceName
		installation.AccessTokenId = token.Id
		installation.AuthVersion = payload.Identity.UserAuthVersion
		if installation.CreatedAt == 0 {
			installation.CreatedAt = now
		}
		if err := tx.Save(&installation).Error; err != nil {
			return err
		}
		if payload.Request.ClientId != MagpieClientID {
			return nil
		}
		var issueErr error
		apiToken, issueErr = issueMagpieAPIToken(tx, &installation, payload.Group, now)
		return issueErr
	})
	if err != nil {
		return nil, err
	}
	result := &ClientAuthorizationExchange{
		AccessToken:  credential,
		Token:        &token,
		Installation: &installation,
	}
	if payloadGroup := checkedPayload.Group; strings.TrimSpace(payloadGroup) != "" {
		result.Group = payloadGroup
	}
	if apiToken.Id != 0 {
		result.APIToken = &apiToken
	}
	return result, nil
}

// issueMagpieAPIToken rotates the installation's dedicated /v1 key in place.
// Reauthorization securely invalidates a copied old key without accumulating a
// new token row on every browser login.
func issueMagpieAPIToken(tx *gorm.DB, installation *DesktopInstallation, userGroup string, now int64) (Token, error) {
	// SQL errors must never print a newly generated API key.
	safeTx := tx.Session(&gorm.Session{Logger: tx.Logger.LogMode(logger.Silent)})
	var binding DesktopToolKey
	err := lockForUpdate(safeTx).Where("installation_id = ? AND agent = ?", installation.Id, MagpieAPITokenAgent).First(&binding).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return Token{}, err
	}
	var token Token
	if binding.TokenId != 0 {
		err = safeTx.Where("id = ? AND user_id = ?", binding.TokenId, installation.UserId).First(&token).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return Token{}, err
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			token = Token{}
		}
	}
	key, err := common.GenerateKey()
	if err != nil {
		return Token{}, err
	}
	if token.Id != 0 {
		if err := invalidateTokenCacheForMutation(token.Key); err != nil {
			return Token{}, err
		}
		token.Key = key
	} else {
		var count int64
		if err := safeTx.Model(&Token{}).Where("user_id = ?", installation.UserId).Count(&count).Error; err != nil {
			return Token{}, err
		}
		if count >= int64(operation_setting.GetMaxUserTokens()) {
			return Token{}, ErrDesktopKeyLimit
		}
		token = Token{
			UserId:              installation.UserId,
			Key:                 key,
			Name:                "Magpie · " + installation.Name,
			Status:              common.TokenStatusEnabled,
			CreatedTime:         now,
			AccessedTime:        now,
			ExpiredTime:         now + clientCredentialLifetime,
			UnlimitedQuota:      true,
			AllowUserQuotaQuery: true,
			Group:               userGroup,
		}
	}
	token.Status = common.TokenStatusEnabled
	token.ExpiredTime = now + clientCredentialLifetime
	token.UnlimitedQuota = true
	token.ModelLimitsEnabled = false
	token.ModelLimits = ""
	token.AllowUserQuotaQuery = true
	token.Group = userGroup
	if err := safeTx.Save(&token).Error; err != nil {
		return Token{}, err
	}
	binding.InstallationId = installation.Id
	binding.Agent = MagpieAPITokenAgent
	binding.TokenId = token.Id
	if err := safeTx.Save(&binding).Error; err != nil {
		return Token{}, err
	}
	return token, nil
}

func loadDesktopInstallation(tokenID, userID int) (*DesktopInstallation, error) {
	var installation DesktopInstallation
	if tokenID <= 0 {
		return nil, ErrDesktopAuthorization
	}
	err := DB.Where("access_token_id = ? AND user_id = ?", tokenID, userID).First(&installation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrDesktopAuthorization
	}
	if err != nil {
		return nil, err
	}
	var user User
	if err := DB.Select("id", "status", "auth_version").First(&user, userID).Error; err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != installation.AuthVersion {
		return nil, ErrDesktopAuthorization
	}
	return &installation, nil
}

// ValidateDesktopAccessToken also guards the existing profile/model endpoints.
// Ordinary PATs retain their existing lifetime semantics.
func ValidateDesktopAccessToken(tokenID, userID int) error {
	_, err := loadDesktopInstallation(tokenID, userID)
	return err
}

func GetDesktopInstallation(tokenID, userID int) (*DesktopInstallation, error) {
	return loadDesktopInstallation(tokenID, userID)
}

// ConfigureDesktopTool never accepts a caller-supplied token ID. Locking the
// owner serializes creates across devices and respects the normal key limit.
func ConfigureDesktopTool(installationID, accessTokenID int, agent, modelName, ownerGroup string, allowedModels []string, maxTokens int) (*Token, error) {
	if !slices.Contains([]string{"codex", "claude", "opencode"}, agent) || !slices.Contains(allowedModels, modelName) {
		return nil, ErrDesktopAuthorization
	}
	var token Token
	// GORM error SQL must never include a newly generated or existing tool key.
	err := DB.Session(&gorm.Session{Logger: DB.Logger.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		var installation DesktopInstallation
		if err := tx.First(&installation, installationID).Error; err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).First(&user, installation.UserId).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.AuthVersion != installation.AuthVersion || installation.AccessTokenId != accessTokenID || user.Group != ownerGroup {
			return ErrDesktopAuthorization
		}
		var pat UserAccessToken
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", accessTokenID, user.Id).First(&pat).Error; err != nil {
			return ErrDesktopAuthorization
		}
		if pat.Expired(time.Now().Unix()) || !slices.Contains(pat.GetScopes(), DesktopConfigureScope) {
			return ErrDesktopAuthorization
		}
		// Re-read after obtaining the user's lock: reauthorization must not race
		// a configuration by an obsolete PAT.
		if err := lockForUpdate(tx).First(&installation, installationID).Error; err != nil {
			return err
		}
		if installation.AccessTokenId != accessTokenID {
			return ErrDesktopAuthorization
		}
		var binding DesktopToolKey
		err := tx.Where("installation_id = ? AND agent = ?", installationID, agent).First(&binding).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if binding.TokenId != 0 {
			err = lockForUpdate(tx).Where("id = ? AND user_id = ?", binding.TokenId, user.Id).First(&token).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err != nil || token.Status != common.TokenStatusEnabled || (token.ExpiredTime != -1 && token.ExpiredTime <= time.Now().Unix()) {
				token = Token{}
			}
		}
		if token.Id == 0 {
			var count int64
			if err := tx.Model(&Token{}).Where("user_id = ?", user.Id).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(maxTokens) {
				return ErrAccessTokenLimit
			}
			key, err := common.GenerateKey()
			if err != nil {
				return err
			}
			token = Token{UserId: user.Id, Key: key, Name: fmt.Sprintf("KunCode Setup-%s-%d", agent, installationID), Status: common.TokenStatusEnabled, CreatedTime: time.Now().Unix(), ExpiredTime: -1, UnlimitedQuota: true}
		} else if err := invalidateTokenCacheForMutation(token.Key); err != nil {
			return err
		}
		token.ModelLimitsEnabled = true
		token.ModelLimits = modelName
		token.Group = user.Group
		if err := tx.Save(&token).Error; err != nil {
			return err
		}
		binding.InstallationId, binding.Agent, binding.TokenId = installationID, agent, token.Id
		return tx.Save(&binding).Error
	})
	return &token, err
}
