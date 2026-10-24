package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	// CustomPagesOptionKey stores the administrator-defined embedded pages as a
	// JSON array of {name, url, adminOnly, highlight, highlightColor, inWallet}
	// entries. Array order is menu order.
	CustomPagesOptionKey = "CustomPages"
	// LegacyChannelDetectionOptionKey held the single channel detection URL
	// before custom pages existed. It is migrated into CustomPages on startup.
	LegacyChannelDetectionOptionKey = "KunCodeRelayPulseUrl"
	// LegacyShopOptionKey held the single embedded shop URL. SeedShopCustomPage
	// folds its effective value into CustomPages and retires it.
	LegacyShopOptionKey = "LiandongShopUrl"
	// shopPageMigrationMarkerKey records that the shop was folded into
	// CustomPages, so the admin's later edits are never overwritten.
	shopPageMigrationMarkerKey = "migration.shop_page_seeded"

	maxCustomPageNameLen = 30
	maxCustomPageURLLen  = 500
)

// customPageHighlightColors are the sidebar accents an administrator can pick.
// The empty string keeps the console's default highlight style.
var customPageHighlightColors = map[string]struct{}{
	"":       {},
	"blue":   {},
	"green":  {},
	"purple": {},
	"orange": {},
	"red":    {},
}

// CustomPage is one administrator-configured embedded page: a sidebar entry
// whose target URL the console shows inside an iframe. Highlight marks the
// entry as emphasized in the sidebar (the shop uses it) and HighlightColor
// picks its accent. InWallet moves the entry into the wallet page instead: it
// is embedded beside the wallet and no longer needs a sidebar link of its own.
type CustomPage struct {
	Name           string `json:"name"`
	URL            string `json:"url"`
	AdminOnly      bool   `json:"adminOnly"`
	Highlight      bool   `json:"highlight"`
	HighlightColor string `json:"highlightColor,omitempty"`
	InWallet       bool   `json:"inWallet"`
}

// ParseCustomPages normalizes the stored option value. The database may hold a
// value written by an older or hand-edited configuration, so every read
// normalizes instead of trusting the stored JSON.
func ParseCustomPages(raw string) ([]CustomPage, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []CustomPage{}, nil
	}

	var entries []CustomPage
	if err := common.UnmarshalJsonStr(trimmed, &entries); err != nil {
		return nil, fmt.Errorf("custom pages must be a JSON array of {name, url}: %w", err)
	}

	names := make(map[string]struct{}, len(entries))
	pages := make([]CustomPage, 0, len(entries))
	walletPages := 0
	for _, entry := range entries {
		name, err := normalizeCustomPageName(entry.Name)
		if err != nil {
			return nil, err
		}
		target, err := normalizeCustomPageURL(entry.URL)
		if err != nil {
			return nil, fmt.Errorf("custom page %q: %w", name, err)
		}
		if _, supported := customPageHighlightColors[entry.HighlightColor]; !supported {
			return nil, fmt.Errorf("custom page %q: unsupported highlight color", name)
		}
		key := strings.ToLower(name)
		if _, duplicated := names[key]; duplicated {
			return nil, fmt.Errorf("custom page name %q is used more than once", name)
		}
		names[key] = struct{}{}
		if entry.InWallet {
			walletPages++
			if walletPages > 1 {
				return nil, fmt.Errorf("at most one custom page can be shown in the wallet")
			}
		}
		pages = append(pages, CustomPage{
			Name:           name,
			URL:            target,
			AdminOnly:      entry.AdminOnly,
			Highlight:      entry.Highlight,
			HighlightColor: entry.HighlightColor,
			InWallet:       entry.InWallet,
		})
	}
	return pages, nil
}

// ValidateCustomPagesOption is the option-write guard for CustomPages.
func ValidateCustomPagesOption(value string) error {
	_, err := ParseCustomPages(value)
	return err
}

// GetCustomPagesForRole returns the pages a viewer of the given role may see.
// The URL of an admin-only page never leaves the server for other viewers.
func GetCustomPagesForRole(role int) ([]CustomPage, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[CustomPagesOptionKey]
	common.OptionMapRWMutex.RUnlock()

	pages, err := ParseCustomPages(raw)
	if err != nil {
		return nil, err
	}
	if role >= common.RoleAdminUser {
		return pages, nil
	}

	visible := make([]CustomPage, 0, len(pages))
	for _, page := range pages {
		if !page.AdminOnly {
			visible = append(visible, page)
		}
	}
	return visible, nil
}

func normalizeCustomPageName(name string) (string, error) {
	return normalizeNavLabel("custom page", name, maxCustomPageNameLen)
}

func normalizeCustomPageURL(target string) (string, error) {
	return normalizeExternalNavURL("custom page", target, maxCustomPageURLLen)
}
