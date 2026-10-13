package system_setting

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

// The entire option is sensitive, so the generic options API never returns it.
const TicketStorageOption = "SupportTicketR2Secret"

type TicketStorageConfig struct {
	Enabled       bool   `json:"enabled"`
	RetentionDays int    `json:"retention_days"`
	Endpoint      string `json:"endpoint"`
	Bucket        string `json:"bucket"`
	AccessKey     string `json:"access_key"`
	SecretKey     string `json:"secret_key"`
}

func (config TicketStorageConfig) Ready() bool {
	return config.Endpoint != "" && config.Bucket != "" && config.AccessKey != "" && config.SecretKey != "" && config.Validate() == nil
}

func (config TicketStorageConfig) Validate() error {
	if config.RetentionDays < 1 || config.RetentionDays > 365 {
		return errors.New("Image retention must be between 1 and 365 days")
	}
	if config.Endpoint != "" {
		endpoint, err := url.Parse(config.Endpoint)
		if err != nil || endpoint.Scheme != "https" || endpoint.User != nil || endpoint.Port() != "" || (endpoint.Path != "" && endpoint.Path != "/") || endpoint.RawQuery != "" || endpoint.ForceQuery || endpoint.Fragment != "" || !ticketR2Host.MatchString(endpoint.Host) {
			return errors.New("Use the Cloudflare R2 S3 API endpoint")
		}
	}
	if config.Bucket != "" && (!taskArtifactStoreBucketPattern.MatchString(config.Bucket) || strings.Contains(config.Bucket, "..")) {
		return errors.New("Invalid R2 bucket name")
	}
	if err := validateTaskArtifactStoreCredential("access key", config.AccessKey, 256, config.Enabled); err != nil {
		return err
	}
	if err := validateTaskArtifactStoreCredential("secret key", config.SecretKey, 1024, config.Enabled); err != nil {
		return err
	}
	if config.Enabled && (config.Endpoint == "" || config.Bucket == "") {
		return errors.New("Configure R2 before enabling image uploads")
	}
	return nil
}

var ticketR2Host = regexp.MustCompile(`^[a-f0-9]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$`)
