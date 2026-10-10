package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	// MaxHeaderNavLinks caps the administrator-defined external links in the top
	// navigation.
	MaxHeaderNavLinks       = 10
	maxHeaderNavLinkNameLen = 20
	maxHeaderNavURLLen      = 500

	headerNavLinksField = "links"
	// headerNavSetupDownloadURLField overrides where the setup download entry
	// points. Empty means "use the client's built-in release page".
	headerNavSetupDownloadURLField = "setupDownloadUrl"
)

// HeaderNavLink is one administrator-defined external link in the top
// navigation.
//
// It is stored inside the HeaderNavModules option and published through the
// unauthenticated status payload, so both the label and the URL are public by
// design; the console opens it in a new tab instead of embedding it.
type HeaderNavLink struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ParseHeaderNavLinks normalizes the `links` array carried by
// HeaderNavModules: order is menu order, names must be unique.
func ParseHeaderNavLinks(raw string) ([]HeaderNavLink, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []HeaderNavLink{}, nil
	}

	var entries []HeaderNavLink
	if err := common.UnmarshalJsonStr(trimmed, &entries); err != nil {
		return nil, fmt.Errorf("top navigation links must be a JSON array of {name, url}: %w", err)
	}
	if len(entries) > MaxHeaderNavLinks {
		return nil, fmt.Errorf("at most %d top navigation links are supported", MaxHeaderNavLinks)
	}

	names := make(map[string]struct{}, len(entries))
	links := make([]HeaderNavLink, 0, len(entries))
	for _, entry := range entries {
		name, err := normalizeNavLabel("top navigation link", entry.Name, maxHeaderNavLinkNameLen)
		if err != nil {
			return nil, err
		}
		target, err := normalizeExternalNavURL("top navigation link", entry.URL, maxHeaderNavURLLen)
		if err != nil {
			return nil, fmt.Errorf("top navigation link %q: %w", name, err)
		}
		key := strings.ToLower(name)
		if _, duplicated := names[key]; duplicated {
			return nil, fmt.Errorf("top navigation link name %q is used more than once", name)
		}
		names[key] = struct{}{}
		links = append(links, HeaderNavLink{Name: name, URL: target})
	}
	return links, nil
}

// ValidateHeaderNavModulesOption validates the parts of HeaderNavModules that
// the console renders for visitors: the optional `links` array and the optional
// `setupDownloadUrl` override.
//
// The other keys keep their historical shapes (a boolean or
// {enabled, requireAuth}) and are read by the navigation middleware, so unknown
// keys are ignored instead of rejected — an older stored value must stay
// editable.
func ValidateHeaderNavModulesOption(value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}

	var parsed map[string]any
	if err := common.UnmarshalJsonStr(trimmed, &parsed); err != nil {
		return fmt.Errorf("HeaderNavModules must be a JSON object: %w", err)
	}
	if raw, exists := parsed[headerNavLinksField]; exists && raw != nil {
		encoded, err := common.Marshal(raw)
		if err != nil {
			return fmt.Errorf("HeaderNavModules links cannot be encoded: %w", err)
		}
		if _, err := ParseHeaderNavLinks(string(encoded)); err != nil {
			return err
		}
	}

	if raw, exists := parsed[headerNavSetupDownloadURLField]; exists && raw != nil {
		target, ok := raw.(string)
		if !ok {
			return fmt.Errorf("HeaderNavModules %s must be a string", headerNavSetupDownloadURLField)
		}
		if strings.TrimSpace(target) != "" {
			if _, err := normalizeExternalNavURL("setup download", target, maxHeaderNavURLLen); err != nil {
				return err
			}
		}
	}

	return nil
}
