package model

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	DesktopClientID       = "kuncode-setup"
	DesktopRequestPurpose = "desktop_request"
	DesktopCodePurpose    = "desktop_code"
	DesktopConfigureScope = "coding_tools:configure"
)

var ErrDesktopAuthorization = errors.New("desktop authorization is invalid or expired")

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
}

func ApproveDesktopRequest(raw string, identity AuthSessionIdentity) (DesktopRequest, string, error) {
	var request DesktopRequest
	var code string
	_, err := ConsumeAuthFlowWithAction(raw, AuthFlowMatch{Purpose: DesktopRequestPurpose}, func(tx *gorm.DB, flow *AuthFlow) error {
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		if err := common.UnmarshalJsonStr(flow.Payload, &request); err != nil {
			return ErrDesktopAuthorization
		}
		payload, err := common.Marshal(desktopCode{Request: request, Identity: identity})
		if err != nil {
			return err
		}
		code, _, err = createAuthFlowWithTx(tx, AuthFlowCreate{Purpose: DesktopCodePurpose, UserId: identity.UserID, SessionId: identity.SessionID, Payload: string(payload), ExpiresAt: time.Now().Add(time.Minute)})
		return err
	})
	return request, code, err
}

// ExchangeDesktopCode consumes the code and rotates the installation's PAT in
// one transaction. Only the digest is persisted; lost responses require a new
// authorization, never a replay of a credential-bearing response.
func ExchangeDesktopCode(raw, verifier, redirectURI string) (string, *UserAccessToken, *DesktopInstallation, error) {
	if len(verifier) < 43 || len(verifier) > 128 {
		return "", nil, nil, ErrDesktopAuthorization
	}
	for _, char := range verifier {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '.' || char == '_' || char == '~') {
			return "", nil, nil, ErrDesktopAuthorization
		}
	}
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])
	var credential string
	var token UserAccessToken
	var installation DesktopInstallation
	_, err := ConsumeAuthFlowWithAction(raw, AuthFlowMatch{Purpose: DesktopCodePurpose}, func(tx *gorm.DB, flow *AuthFlow) error {
		var payload desktopCode
		if common.UnmarshalJsonStr(flow.Payload, &payload) != nil ||
			subtle.ConstantTimeCompare([]byte(challenge), []byte(payload.Request.CodeChallenge)) != 1 ||
			redirectURI != payload.Request.RedirectURI {
			return ErrDesktopAuthorization
		}
		if err := ValidateAuthSessionWithTx(tx, payload.Identity); err != nil {
			return err
		}
		err := lockForUpdate(tx).Where("user_id = ? AND client_installation_id = ?", payload.Identity.UserID, payload.Request.InstallationId).First(&installation).Error
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
			installation = DesktopInstallation{UserId: payload.Identity.UserID, ClientInstallationId: payload.Request.InstallationId, CreatedAt: now}
			if err := tx.Create(&installation).Error; err != nil {
				return err
			}
		}
		token = UserAccessToken{UserId: payload.Identity.UserID, DesktopInstallationId: installation.Id, Name: "KunCode Setup · " + payload.Request.DeviceName, TokenHash: AccessTokenFingerprint(credential), TokenHint: AccessTokenHint(credential), CreatedAt: now, ExpiresAt: now + 30*24*60*60}
		if err := token.SetScopes([]string{"profile:read", DesktopConfigureScope}); err != nil {
			return err
		}
		if err := tx.Create(&token).Error; err != nil {
			return err
		}
		installation.UserId = payload.Identity.UserID
		installation.ClientInstallationId = payload.Request.InstallationId
		installation.Name = payload.Request.DeviceName
		installation.AccessTokenId = token.Id
		installation.AuthVersion = payload.Identity.UserAuthVersion
		if installation.CreatedAt == 0 {
			installation.CreatedAt = now
		}
		return tx.Save(&installation).Error
	})
	return credential, &token, &installation, err
}

// ValidateDesktopAccessToken also guards the existing profile/model endpoints.
// Ordinary PATs retain their existing lifetime semantics.
func ValidateDesktopAccessToken(tokenID, userID int) error {
	var installation DesktopInstallation
	err := DB.Where("access_token_id = ? AND user_id = ?", tokenID, userID).First(&installation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrDesktopAuthorization
	}
	if err != nil {
		return err
	}
	var user User
	if err := DB.Select("id", "status", "auth_version").First(&user, userID).Error; err != nil {
		return err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != installation.AuthVersion {
		return ErrDesktopAuthorization
	}
	return nil
}

func GetDesktopInstallation(tokenID, userID int) (*DesktopInstallation, error) {
	var installation DesktopInstallation
	if tokenID <= 0 {
		return nil, ErrDesktopAuthorization
	}
	if err := DB.Where("access_token_id = ? AND user_id = ?", tokenID, userID).First(&installation).Error; err != nil {
		return nil, ErrDesktopAuthorization
	}
	if err := ValidateDesktopAccessToken(tokenID, userID); err != nil {
		return nil, err
	}
	return &installation, nil
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
