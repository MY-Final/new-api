package system_setting

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"hash/crc32"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// MaxContactQRCodeBytes caps an uploaded contact QR image, matching the task
// plugin icon limit so one base64 payload stays storable on every supported
// database (options.value is longtext on MySQL, text elsewhere).
const MaxContactQRCodeBytes = 512 * 1024

const (
	maxContactTitleLength       = 200
	maxContactDescriptionLength = 2000
	maxContactGroupNumberLength = 64
	maxContactGroupURLLength    = 2048
)

var contactPNGSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
var contactJPEGSignature = []byte{0xff, 0xd8, 0xff}

// ContactSettings holds the public contact information rendered on the contact
// page, the top navigation dialog, and the footer. Empty values fall back to
// the built-in defaults on the frontend.
type ContactSettings struct {
	Title         string `json:"title"`
	Description   string `json:"description"`
	QQGroupNumber string `json:"qq_group_number"`
	QQGroupURL    string `json:"qq_group_url"`
	// QRCode is the uploaded image stored as a data URI, so one option carries
	// both the media type and the bytes. It is served through
	// GET /api/contact/qrcode instead of travelling inside /api/status.
	QRCode string `json:"qrcode"`
}

var defaultContactSettings = ContactSettings{}

func init() {
	config.GlobalConfig.Register("contact", &defaultContactSettings)
}

func GetContactSettings() *ContactSettings {
	return &defaultContactSettings
}

// QRCodeVersion returns a short cache-busting token for the stored image.
func (s *ContactSettings) QRCodeVersion() string {
	if s.QRCode == "" {
		return ""
	}
	return fmt.Sprintf("%08x", crc32.ChecksumIEEE([]byte(s.QRCode)))
}

// ValidateContactOption guards every contact option written through the option
// API. Unknown contact keys are left to the generic update path.
func ValidateContactOption(key, value string) error {
	switch key {
	case "contact.title":
		return validateContactText(value, maxContactTitleLength)
	case "contact.description":
		return validateContactText(value, maxContactDescriptionLength)
	case "contact.qq_group_number":
		return validateContactText(value, maxContactGroupNumberLength)
	case "contact.qq_group_url":
		if len(value) > maxContactGroupURLLength {
			return fmt.Errorf("contact QQ group link must not exceed %d characters", maxContactGroupURLLength)
		}
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return nil
		}
		if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
			return fmt.Errorf("contact QQ group link must start with http:// or https://")
		}
		return nil
	case "contact.qrcode":
		if strings.TrimSpace(value) == "" {
			return nil
		}
		_, _, err := DecodeContactQRCode(value)
		return err
	default:
		return nil
	}
}

func validateContactText(value string, limit int) error {
	if len([]rune(value)) > limit {
		return fmt.Errorf("contact setting must not exceed %d characters", limit)
	}
	return nil
}

// DecodeContactQRCode turns the stored data URI into raw image bytes. Only PNG
// and JPEG payloads whose magic bytes match the declared media type are
// accepted, so the public endpoint can never emit mislabeled content.
func DecodeContactQRCode(value string) (string, []byte, error) {
	if len(value) > MaxContactQRCodeBytes*4/3+128 {
		return "", nil, fmt.Errorf("contact QR code must not exceed %d bytes", MaxContactQRCodeBytes)
	}
	rest, ok := strings.CutPrefix(value, "data:")
	if !ok {
		return "", nil, fmt.Errorf("contact QR code must be a base64 data URI")
	}
	mediaType, payload, ok := strings.Cut(rest, ";base64,")
	if !ok {
		return "", nil, fmt.Errorf("contact QR code must be a base64 data URI")
	}
	if mediaType != "image/png" && mediaType != "image/jpeg" {
		return "", nil, fmt.Errorf("contact QR code must be a PNG or JPEG image")
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil {
		return "", nil, fmt.Errorf("contact QR code payload is not valid base64")
	}
	if len(decoded) > MaxContactQRCodeBytes {
		return "", nil, fmt.Errorf("contact QR code must not exceed %d bytes", MaxContactQRCodeBytes)
	}
	if mediaType == "image/png" && !bytes.HasPrefix(decoded, contactPNGSignature) {
		return "", nil, fmt.Errorf("contact QR code payload is not a PNG image")
	}
	if mediaType == "image/jpeg" && !bytes.HasPrefix(decoded, contactJPEGSignature) {
		return "", nil, fmt.Errorf("contact QR code payload is not a JPEG image")
	}
	return mediaType, decoded, nil
}
