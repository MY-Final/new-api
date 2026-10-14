package model

import (
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"
)

// normalizeNavLabel trims and validates an administrator-authored navigation
// label. `kind` names the configuration in error messages, for example
// "custom page" or "top navigation link".
func normalizeNavLabel(kind string, name string, maxLen int) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("%s name cannot be empty", kind)
	}
	if utf8.RuneCountInString(trimmed) > maxLen {
		return "", fmt.Errorf("%s name cannot exceed %d characters", kind, maxLen)
	}
	if strings.ContainsAny(trimmed, "\r\n\t") {
		return "", fmt.Errorf("%s name cannot contain line breaks", kind)
	}
	return trimmed, nil
}

// normalizeExternalNavURL trims and validates a URL the console will embed or
// send visitors to. Only absolute http(s) URLs with a host are accepted, so a
// stored configuration can never become a javascript:/data: navigation target.
func normalizeExternalNavURL(kind string, target string, maxLen int) (string, error) {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		return "", fmt.Errorf("%s URL cannot be empty", kind)
	}
	if len(trimmed) > maxLen {
		return "", fmt.Errorf("%s URL cannot exceed %d characters", kind, maxLen)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("%s URL is not a valid URL", kind)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%s URL must start with http:// or https://", kind)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("%s URL must include a host", kind)
	}
	return trimmed, nil
}
