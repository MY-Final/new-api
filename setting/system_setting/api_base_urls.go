package system_setting

import (
	"errors"
	"net/url"
	"strings"
)

const APIBaseURLsOptionKey = "ApiBaseURLs"
const DefaultAPIBaseURLs = "https://kuncode.120403.xyz\nhttps://wcnmb.fun"

const maxAPIBaseURLs = 20
const maxAPIBaseURLLength = 2048

func ParseAPIBaseURLs(value string) []string {
	urls := make([]string, 0)
	for line := range strings.SplitSeq(value, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			urls = append(urls, trimmed)
		}
	}
	return urls
}

func ValidateAPIBaseURLs(value string) error {
	urls := ParseAPIBaseURLs(value)
	if len(urls) > maxAPIBaseURLs {
		return errors.New("too many API endpoints; at most 20 are allowed")
	}

	for _, rawURL := range urls {
		if len(rawURL) > maxAPIBaseURLLength {
			return errors.New("API endpoint is too long")
		}
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed == nil || parsed.Host == "" || parsed.Opaque != "" {
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
