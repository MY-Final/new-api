package system_setting

import (
	"errors"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const APIBaseURLsOptionKey = "ApiBaseURLs"
const DefaultAPIBaseURLs = `[{"name":"默认","url":"https://kuncode.120403.xyz"},{"name":"直连","url":"https://wcnmb.fun"}]`

const maxAPIBaseURLs = 20
const maxAPIBaseURLLength = 2048
const maxAPIBaseEndpointNameLength = 50

// APIBaseEndpoint is one labeled relay endpoint shown to API key users.
type APIBaseEndpoint struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url"`
}

// ParseAPIBaseEndpoints reads both the labeled JSON format and the legacy
// newline-separated URL format. Invalid structured values produce no entries;
// ValidateAPIBaseURLs reports the reason when a value is saved.
func ParseAPIBaseEndpoints(value string) []APIBaseEndpoint {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return []APIBaseEndpoint{}
	}

	if strings.HasPrefix(trimmed, "[") {
		var endpoints []APIBaseEndpoint
		if err := common.UnmarshalJsonStr(trimmed, &endpoints); err != nil {
			return []APIBaseEndpoint{}
		}
		return normalizeAPIBaseEndpoints(endpoints)
	}

	endpoints := make([]APIBaseEndpoint, 0)
	for line := range strings.SplitSeq(value, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			endpoints = append(endpoints, APIBaseEndpoint{URL: trimmed})
		}
	}
	return endpoints
}

func ParseAPIBaseURLs(value string) []string {
	endpoints := ParseAPIBaseEndpoints(value)
	urls := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		urls = append(urls, endpoint.URL)
	}
	return urls
}

func ValidateAPIBaseURLs(value string) error {
	endpoints, err := parseAPIBaseEndpointsForValidation(value)
	if err != nil {
		return err
	}
	if len(endpoints) > maxAPIBaseURLs {
		return errors.New("too many API endpoints; at most 20 are allowed")
	}

	for _, endpoint := range endpoints {
		if utf8.RuneCountInString(strings.TrimSpace(endpoint.Name)) > maxAPIBaseEndpointNameLength {
			return errors.New("API endpoint name cannot exceed 50 characters")
		}
		rawURL := strings.TrimSpace(endpoint.URL)
		if rawURL == "" {
			return errors.New("API endpoint URL is required")
		}
		if len(rawURL) > maxAPIBaseURLLength {
			return errors.New("API endpoint is too long")
		}
		parsed, parseErr := url.Parse(rawURL)
		if parseErr != nil || parsed == nil || parsed.Host == "" || parsed.Opaque != "" {
			return errors.New("API endpoint must be an absolute URL")
		}
		if !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
			return errors.New("API endpoint must use http or https")
		}
		if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.Contains(rawURL, "#") {
			return errors.New("API endpoint must not contain credentials, query parameters, or fragments")
		}
	}

	return nil
}

func parseAPIBaseEndpointsForValidation(value string) ([]APIBaseEndpoint, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return []APIBaseEndpoint{}, nil
	}
	if !strings.HasPrefix(trimmed, "[") {
		return ParseAPIBaseEndpoints(value), nil
	}

	var endpoints []APIBaseEndpoint
	if err := common.UnmarshalJsonStr(trimmed, &endpoints); err != nil {
		return nil, errors.New("API endpoints must be a JSON array of {name, url}")
	}
	return endpoints, nil
}

func normalizeAPIBaseEndpoints(endpoints []APIBaseEndpoint) []APIBaseEndpoint {
	normalized := make([]APIBaseEndpoint, 0, len(endpoints))
	for _, endpoint := range endpoints {
		name := strings.TrimSpace(endpoint.Name)
		rawURL := strings.TrimSpace(endpoint.URL)
		if rawURL == "" {
			continue
		}
		normalized = append(normalized, APIBaseEndpoint{Name: name, URL: rawURL})
	}
	return normalized
}
