package model

import (
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	ErrDesktopKeyInvalid     = errors.New("desktop key request is invalid")
	ErrDesktopKeyInUse       = errors.New("desktop key is still bound to a coding tool")
	ErrDesktopKeyLimit       = errors.New("desktop key limit reached")
	ErrDesktopKeyModelDenied = errors.New("selected model is not available in the group")
)

// DesktopToolBindingInput carries the already-validated values for binding an
// existing key to a coding tool. The controller resolves group selectability
// and the allowed model set before calling in, because those helpers live in
// the service layer which must not be imported here.
type DesktopToolBindingInput struct {
	InstallationID int
	AccessTokenID  int
	Agent          string
	TokenID        int
	Group          string
	Models         []string
	OwnerGroup     string
	AllowedModels  []string
}

// ListDesktopTokens returns the caller's keys, newest first.
func ListDesktopTokens(userID, startIdx, num int) ([]*Token, int64, error) {
	tokens, err := GetAllUserTokens(userID, startIdx, num)
	if err != nil {
		return nil, 0, err
	}
	total, err := CountUserTokens(userID)
	if err != nil {
		return nil, 0, err
	}
	return tokens, total, nil
}

// CreateDesktopToken creates a never-expiring, unlimited-quota key owned by the
// user. Locking the owner row serializes creates across devices so the normal
// per-user key limit cannot be exceeded by concurrent requests.
func CreateDesktopToken(userID int, name, group string, modelLimits []string, maxTokens int) (*Token, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 50 {
		return nil, ErrDesktopKeyInvalid
	}
	var token Token
	err := DB.Session(&gorm.Session{Logger: DB.Logger.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&Token{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(maxTokens) {
			return ErrDesktopKeyLimit
		}
		key, err := common.GenerateKey()
		if err != nil {
			return err
		}
		token = Token{
			UserId:             userID,
			Key:                key,
			Name:               name,
			Status:             common.TokenStatusEnabled,
			CreatedTime:        time.Now().Unix(),
			AccessedTime:       time.Now().Unix(),
			ExpiredTime:        -1,
			UnlimitedQuota:     true,
			ModelLimitsEnabled: len(modelLimits) > 0,
			ModelLimits:        strings.Join(modelLimits, ","),
			Group:              group,
		}
		return tx.Create(&token).Error
	})
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// UpdateDesktopToken changes the mutable display fields of one key. Callers
// validate the group and model set before calling in.
func UpdateDesktopToken(userID, tokenID int, name, group string, modelLimits []string) (*Token, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 50 {
		return nil, ErrDesktopKeyInvalid
	}
	token, err := GetTokenByIds(tokenID, userID)
	if err != nil {
		return nil, err
	}
	token.Name = name
	token.Group = group
	token.ModelLimitsEnabled = len(modelLimits) > 0
	token.ModelLimits = strings.Join(modelLimits, ",")
	if err := token.Update(); err != nil {
		return nil, err
	}
	return token, nil
}

// DeleteDesktopToken removes one key. It refuses while any coding-tool binding
// still references the key so an agent cannot be left pointing at a dead key.
func DeleteDesktopToken(userID, tokenID int) error {
	token, err := GetTokenByIds(tokenID, userID)
	if err != nil {
		return err
	}
	var bound int64
	if err := DB.Model(&DesktopToolKey{}).Where("token_id = ?", tokenID).Count(&bound).Error; err != nil {
		return err
	}
	if bound > 0 {
		return ErrDesktopKeyInUse
	}
	return token.Delete()
}

// BindDesktopTool points an existing key at one coding tool for this
// installation. A key may be shared by several agents; each agent keeps a
// single primary binding.
func BindDesktopTool(input DesktopToolBindingInput) (*Token, error) {
	if !slices.Contains([]string{"codex", "claude", "opencode"}, input.Agent) || input.TokenID <= 0 {
		return nil, ErrDesktopAuthorization
	}
	for _, model := range input.Models {
		if !slices.Contains(input.AllowedModels, model) {
			return nil, ErrDesktopKeyModelDenied
		}
	}
	var token Token
	err := DB.Session(&gorm.Session{Logger: DB.Logger.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		var installation DesktopInstallation
		if err := tx.First(&installation, input.InstallationID).Error; err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).First(&user, installation.UserId).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.AuthVersion != installation.AuthVersion || installation.AccessTokenId != input.AccessTokenID || user.Group != input.OwnerGroup {
			return ErrDesktopAuthorization
		}
		var pat UserAccessToken
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", input.AccessTokenID, user.Id).First(&pat).Error; err != nil {
			return ErrDesktopAuthorization
		}
		if pat.Expired(time.Now().Unix()) || !slices.Contains(pat.GetScopes(), DesktopConfigureScope) {
			return ErrDesktopAuthorization
		}
		if err := lockForUpdate(tx).First(&installation, input.InstallationID).Error; err != nil {
			return err
		}
		if installation.AccessTokenId != input.AccessTokenID {
			return ErrDesktopAuthorization
		}
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", input.TokenID, user.Id).First(&token).Error; err != nil {
			return ErrDesktopAuthorization
		}
		if token.Status != common.TokenStatusEnabled || (token.ExpiredTime != -1 && token.ExpiredTime <= time.Now().Unix()) {
			return ErrDesktopAuthorization
		}
		if err := invalidateTokenCacheForMutation(token.Key); err != nil {
			return err
		}
		token.Group = input.Group
		token.ModelLimitsEnabled = len(input.Models) > 0
		token.ModelLimits = strings.Join(input.Models, ",")
		if err := tx.Save(&token).Error; err != nil {
			return err
		}
		var binding DesktopToolKey
		if err := tx.Where("installation_id = ? AND agent = ?", input.InstallationID, input.Agent).First(&binding).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		binding.InstallationId, binding.Agent, binding.TokenId = input.InstallationID, input.Agent, token.Id
		return tx.Save(&binding).Error
	})
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// DesktopTokenBoundAgents lists the coding tools currently pointing at a key,
// so the UI can warn before deletion.
func DesktopTokenBoundAgents(tokenID int) ([]string, error) {
	var bindings []DesktopToolKey
	if err := DB.Where("token_id = ?", tokenID).Find(&bindings).Error; err != nil {
		return nil, err
	}
	agents := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		agents = append(agents, binding.Agent)
	}
	return agents, nil
}

// DesktopKeySummary is the non-secret projection returned to the desktop app.
type DesktopKeySummary struct {
	Id                 int      `json:"id"`
	Name               string   `json:"name"`
	MaskedKey          string   `json:"masked_key"`
	Group              string   `json:"group"`
	Status             int      `json:"status"`
	RemainQuota        int      `json:"remain_quota"`
	UnlimitedQuota     bool     `json:"unlimited_quota"`
	UsedQuota          int      `json:"used_quota"`
	ExpiredTime        int64    `json:"expired_time"`
	AccessedTime       int64    `json:"accessed_time"`
	CreatedTime        int64    `json:"created_time"`
	ModelLimitsEnabled bool     `json:"model_limits_enabled"`
	ModelLimits        []string `json:"model_limits"`
	BoundAgents        []string `json:"bound_agents"`
}

// SummarizeDesktopKey builds the display projection without ever exposing the
// full key. Binding information is attached by the caller.
func SummarizeDesktopKey(token *Token) DesktopKeySummary {
	return DesktopKeySummary{
		Id:                 token.Id,
		Name:               token.Name,
		MaskedKey:          token.GetMaskedKey(),
		Group:              token.Group,
		Status:             token.Status,
		RemainQuota:        token.RemainQuota,
		UnlimitedQuota:     token.UnlimitedQuota,
		UsedQuota:          token.UsedQuota,
		ExpiredTime:        token.ExpiredTime,
		AccessedTime:       token.AccessedTime,
		CreatedTime:        token.CreatedTime,
		ModelLimitsEnabled: token.ModelLimitsEnabled,
		ModelLimits:        token.GetModelLimits(),
	}
}
