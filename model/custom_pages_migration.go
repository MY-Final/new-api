package model

import (
	"github.com/QuantumNous/new-api/common"
)

// MigrateLegacyCustomPages moves the dedicated channel detection URL option
// into the CustomPages list so the page keeps working after the configurable
// embedded pages replaced it.
//
// It runs on the master node before the option map is loaded; migrateLegacyOption
// makes it idempotent (a missing legacy key is a no-op, and an already
// configured CustomPages list wins and the legacy key is dropped).
func MigrateLegacyCustomPages() error {
	return migrateLegacyOption(
		LegacyChannelDetectionOptionKey,
		CustomPagesOptionKey,
		transformLegacyChannelDetection,
	)
}

func transformLegacyChannelDetection(value string) (string, error) {
	target, err := normalizeCustomPageURL(value)
	if err != nil {
		return "", err
	}
	// The name is a frontend i18n key, so the migrated entry keeps the
	// translated sidebar label it had before the migration.
	payload, err := common.Marshal([]CustomPage{{Name: "Channel Detection", URL: target}})
	if err != nil {
		return "", err
	}
	return string(payload), nil
}
