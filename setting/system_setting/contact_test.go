package system_setting

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func contactDataURI(mediaType string, payload []byte) string {
	return "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(payload)
}

func contactPNG(payload ...byte) []byte {
	return append(append([]byte{}, contactPNGSignature...), payload...)
}

func TestDecodeContactQRCode(t *testing.T) {
	pngURI := contactDataURI("image/png", contactPNG(0x01, 0x02))
	jpegURI := contactDataURI("image/jpeg", []byte{0xff, 0xd8, 0xff, 0xe0})

	for _, tc := range []struct {
		name      string
		value     string
		mediaType string
		wantErr   string
	}{
		{name: "png", value: pngURI, mediaType: "image/png"},
		{name: "jpeg", value: jpegURI, mediaType: "image/jpeg"},
		{name: "plain url", value: "https://example.com/qr.png", wantErr: "base64 data URI"},
		{name: "unsupported type", value: contactDataURI("image/gif", []byte("GIF89a")), wantErr: "PNG or JPEG"},
		{name: "missing base64 marker", value: "data:image/png,abc", wantErr: "base64 data URI"},
		{name: "invalid base64", value: "data:image/png;base64,!!!", wantErr: "valid base64"},
		{name: "png bytes behind jpeg type", value: contactDataURI("image/jpeg", contactPNG()), wantErr: "not a JPEG"},
		{name: "jpeg bytes behind png type", value: contactDataURI("image/png", []byte{0xff, 0xd8, 0xff}), wantErr: "not a PNG"},
		{
			name:    "oversized payload",
			value:   contactDataURI("image/png", contactPNG(bytes.Repeat([]byte{0}, MaxContactQRCodeBytes)...)),
			wantErr: "must not exceed",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mediaType, data, err := DecodeContactQRCode(tc.value)
			if tc.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.mediaType, mediaType)
			assert.NotEmpty(t, data)
		})
	}
}

func TestValidateContactOption(t *testing.T) {
	require.NoError(t, ValidateContactOption("contact.qrcode", ""))
	require.NoError(t, ValidateContactOption("contact.qrcode", "  "))
	require.NoError(t, ValidateContactOption("contact.qrcode", contactDataURI("image/png", contactPNG(0x01))))
	require.Error(t, ValidateContactOption("contact.qrcode", "data:image/svg+xml;base64,PHN2Zy8+"))

	for _, value := range []string{"", "https://example.com/group", "http://example.com/group"} {
		require.NoError(t, ValidateContactOption("contact.qq_group_url", value))
	}
	for _, value := range []string{"example.com/group", "javascript:alert(1)"} {
		require.Error(t, ValidateContactOption("contact.qq_group_url", value))
	}

	require.NoError(t, ValidateContactOption("contact.title", "Contact"))
	require.Error(t, ValidateContactOption("contact.title", strings.Repeat("长", maxContactTitleLength+1)))
	require.NoError(t, ValidateContactOption("contact.qq_group_number", strings.Repeat("1", maxContactGroupNumberLength)))
	require.Error(
		t,
		ValidateContactOption("contact.qq_group_number", strings.Repeat("1", maxContactGroupNumberLength+1)),
	)
	require.NoError(t, ValidateContactOption("Notice", strings.Repeat("x", maxContactTitleLength+1)))
}

func TestContactQRCodeVersion(t *testing.T) {
	settings := ContactSettings{}
	assert.Empty(t, settings.QRCodeVersion())

	settings.QRCode = contactDataURI("image/png", contactPNG(0x01))
	first := settings.QRCodeVersion()
	assert.NotEmpty(t, first)

	settings.QRCode = contactDataURI("image/png", contactPNG(0x02))
	assert.NotEqual(t, first, settings.QRCodeVersion())
}
