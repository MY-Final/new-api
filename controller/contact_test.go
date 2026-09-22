package controller

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func contactQRCodePNGImage(payload ...byte) []byte {
	return append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, payload...)
}

func contactQRCodePNGDataURI(image []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(image)
}

func TestGetContactQRCode(t *testing.T) {
	settings := system_setting.GetContactSettings()
	original := settings.QRCode
	t.Cleanup(func() { settings.QRCode = original })

	request := func() (*gin.Context, *httptest.ResponseRecorder) {
		response := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(response)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/contact/qrcode", nil)
		return context, response
	}

	t.Run("serves the stored image", func(t *testing.T) {
		image := contactQRCodePNGImage(0x01, 0x02, 0x03)
		settings.QRCode = contactQRCodePNGDataURI(image)

		context, response := request()
		GetContactQRCode(context)

		assert.Equal(t, http.StatusOK, response.Code)
		assert.Equal(t, "image/png", response.Header().Get("Content-Type"))
		assert.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
		assert.Equal(t, image, response.Body.Bytes())
	})

	t.Run("returns 404 when unset or invalid", func(t *testing.T) {
		for _, value := range []string{"", "data:image/gif;base64,R0lGODlh"} {
			settings.QRCode = value

			context, response := request()
			GetContactQRCode(context)

			assert.Equal(t, http.StatusNotFound, response.Code, value)
		}
	})
}
