package model

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const (
	// CustomPagesOptionKey stores the administrator-defined embedded pages as a
	// JSON array of {name, url, adminOnly} entries. Array order is menu order.
	CustomPagesOptionKey = "CustomPages"
	// LegacyChannelDetectionOptionKey held the single channel detection URL
	// before custom pages existed. It is migrated into CustomPages on startup.
	LegacyChannelDetectionOptionKey = "KunCodeRelayPulseUrl"

	maxCustomPages       = 20
	maxCustomPageNameLen = 30
	maxCustomPageURLLen  = 500
)

// CustomPage is one administrator-configured embedded page: a sidebar entry
// whose target URL the console shows inside an iframe.
type CustomPage struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	AdminOnly bool   `json:"adminOnly"`
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
	if len(entries) > maxCustomPages {
		return nil, fmt.Errorf("at most %d custom pages are supported", maxCustomPages)
	}

	names := make(map[string]struct{}, len(entries))
	pages := make([]CustomPage, 0, len(entries))
	for _, entry := range entries {
		name, err := normalizeCustomPageName(entry.Name)
		if err != nil {
			return nil, err
		}
		target, err := normalizeCustomPageURL(entry.URL)
		if err != nil {
			return nil, fmt.Errorf("custom page %q: %w", name, err)
		}
		key := strings.ToLower(name)
		if _, duplicated := names[key]; duplicated {
			return nil, fmt.Errorf("custom page name %q is used more than once", name)
		}
		names[key] = struct{}{}
		pages = append(pages, CustomPage{Name: name, URL: target, AdminOnly: entry.AdminOnly})
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
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", errors.New("custom page name cannot be empty")
	}
	if utf8.RuneCountInString(trimmed) > maxCustomPageNameLen {
		return "", fmt.Errorf("custom page name cannot exceed %d characters", maxCustomPageNameLen)
	}
	if strings.ContainsAny(trimmed, "\r\n\t") {
		return "", errors.New("custom page name cannot contain line breaks")
	}
	return trimmed, nil
}

func normalizeCustomPageURL(target string) (string, error) {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		return "", errors.New("custom page URL cannot be empty")
	}
	if len(trimmed) > maxCustomPageURLLen {
		return "", fmt.Errorf("custom page URL cannot exceed %d characters", maxCustomPageURLLen)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("custom page URL is not a valid URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("custom page URL must start with http:// or https://")
	}
	if parsed.Host == "" {
		return "", errors.New("custom page URL must include a host")
	}
	return trimmed, nil
}
