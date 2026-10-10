package model

import (
	"strings"

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

// SeedShopCustomPage appends the embedded shop to CustomPages so the shop keeps
// its sidebar entry and its highlight after the configurable pages replaced the
// dedicated option.
//
// Unlike the channel detection migration this runs *after* the option map is
// loaded, because the legacy shop option also has a code-level default: the
// effective value, not just a persisted row, is what users see today. A marker
// option makes the migration one-time, so an administrator who later removes or
// renames the shop entry is not overruled on the next startup.
func SeedShopCustomPage() error {
	common.OptionMapRWMutex.RLock()
	alreadySeeded := strings.TrimSpace(common.OptionMap[shopPageMigrationMarkerKey]) == "true"
	legacyURL := strings.TrimSpace(common.OptionMap[LegacyShopOptionKey])
	rawPages := common.OptionMap[CustomPagesOptionKey]
	common.OptionMapRWMutex.RUnlock()

	if alreadySeeded {
		return nil
	}

	pages, err := ParseCustomPages(rawPages)
	if err != nil {
		return err
	}
	if legacyURL != "" && !customPagesContainURL(pages, legacyURL) {
		pages = append(pages, CustomPage{
			Name: "Shop",
			URL:  legacyURL,
			// The shop serves every user and always stood out in the sidebar.
			AdminOnly: false,
			Highlight: true,
		})
		payload, err := common.Marshal(pages)
		if err != nil {
			return err
		}
		if err := UpdateOption(CustomPagesOptionKey, string(payload)); err != nil {
			return err
		}
	}
	if err := UpdateOption(shopPageMigrationMarkerKey, "true"); err != nil {
		return err
	}

	// Retire the legacy option: drop the persisted row and the in-memory value
	// so nothing can read it again.
	if err := DB.Where("key = ?", LegacyShopOptionKey).Delete(&Option{}).Error; err != nil {
		return err
	}
	common.OptionMapRWMutex.Lock()
	delete(common.OptionMap, LegacyShopOptionKey)
	common.OptionMapRWMutex.Unlock()

	common.SysLog(common.LogText("migrated the embedded shop into custom pages"))
	return nil
}

func customPagesContainURL(pages []CustomPage, target string) bool {
	for _, page := range pages {
		if page.URL == target {
			return true
		}
	}
	return false
}
