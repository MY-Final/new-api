package system_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// EmailPurposeProvidersOption stores per-purpose transport overrides, for
// example {"ticket":"resend","notification":"smtp"}. A purpose that is absent
// uses the global EmailProvider selector.
const EmailPurposeProvidersOption = "EmailPurposeProviders"

// EmailRoutingPurposes is the ordered catalog the admin console renders. It
// matches the send purposes in the common package; "other" is absent because it
// only collects mail whose purpose is unrecognized.
func EmailRoutingPurposes() []string {
	return []string{
		common.EmailPurposeVerify,
		common.EmailPurposeReset,
		common.EmailPurposeBinding,
		common.EmailPurposeSecurity,
		common.EmailPurposeQuota,
		common.EmailPurposeUsage,
		common.EmailPurposeTicket,
		common.EmailPurposeNotification,
	}
}

// EmailPurposeProviders reads the stored overrides. Invalid JSON never breaks
// sending: every purpose simply follows the global selector.
func EmailPurposeProviders() map[string]string {
	common.OptionMapRWMutex.RLock()
	raw := common.Interface2String(common.OptionMap[EmailPurposeProvidersOption])
	common.OptionMapRWMutex.RUnlock()
	return parseEmailPurposeProviders(raw)
}

func parseEmailPurposeProviders(raw string) map[string]string {
	if strings.TrimSpace(raw) == "" {
		return map[string]string{}
	}
	routes := map[string]string{}
	if err := common.UnmarshalJsonStr(raw, &routes); err != nil {
		return map[string]string{}
	}
	return routes
}

// ValidateEmailPurposeProviders rejects unknown purposes and transports so a
// saved routing table can always be resolved.
func ValidateEmailPurposeProviders(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var routes map[string]string
	if err := common.UnmarshalJsonStr(value, &routes); err != nil {
		return common.NewMessage("Email purpose routing must be a JSON object")
	}
	known := make(map[string]struct{}, len(EmailRoutingPurposes()))
	for _, purpose := range EmailRoutingPurposes() {
		known[purpose] = struct{}{}
	}
	for purpose, provider := range routes {
		if _, ok := known[purpose]; !ok {
			return common.NewMessage("Unknown email purpose: {{purpose}}", map[string]any{"purpose": purpose})
		}
		if provider != common.EmailProviderSMTP && provider != common.EmailProviderResend {
			return common.NewMessage("Email sending method must be SMTP or Resend")
		}
	}
	return nil
}
