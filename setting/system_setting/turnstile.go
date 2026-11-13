package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type TurnstileSettings struct {
	Login             bool `json:"login"`
	Register          bool `json:"register"`
	EmailVerification bool `json:"email_verification"`
	PasswordReset     bool `json:"password_reset"`
	Checkin           bool `json:"checkin"`
}

var turnstileSettings = TurnstileSettings{
	Login: true, Register: true, EmailVerification: true, PasswordReset: true, Checkin: true,
}

func init() {
	config.GlobalConfig.Register("turnstile", &turnstileSettings)
}

func GetTurnstileSettings() *TurnstileSettings {
	return &turnstileSettings
}

func (settings TurnstileSettings) EnabledFor(scene string) bool {
	switch scene {
	case "login":
		return settings.Login
	case "register":
		return settings.Register
	case "email_verification":
		return settings.EmailVerification
	case "password_reset":
		return settings.PasswordReset
	case "checkin":
		return settings.Checkin
	default:
		return true
	}
}
