package controller

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const consoleImageMaxBytes = 5 * 1024 * 1024
const consoleImageBodyLimit = 8 * 1024 * 1024

// decodeUploadedImage validates client-supplied base64 image bytes. The same
// rules gate ticket screenshots and console announcement images.
func decodeUploadedImage(data string) ([]byte, string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(decoded) == 0 || len(decoded) > consoleImageMaxBytes {
		return nil, "", false
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 40000000 {
		return nil, "", false
	}
	if _, _, err := image.Decode(bytes.NewReader(decoded)); err != nil {
		return nil, "", false
	}
	return decoded, "image/" + format, true
}

func UploadConsoleImage(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, consoleImageBodyLimit)
	defer c.Request.Body.Close()
	var request struct {
		Data string `json:"data"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid image upload request")
		return
	}
	data, contentType, ok := decodeUploadedImage(request.Data)
	if !ok {
		common.ApiErrorT(c, "Choose a PNG or JPEG image up to 5 MB")
		return
	}
	image, err := service.PersistConsoleImage(c.Request.Context(), data, contentType)
	if err != nil {
		if errors.Is(err, service.ErrConsoleImagesDisabled) {
			common.ApiErrorT(c, "Console image uploads are disabled")
			return
		}
		common.ApiErrorT(c, "Console image upload failed")
		return
	}
	common.ApiSuccess(c, gin.H{"id": image.ID})
}

func GetConsoleImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		c.Status(http.StatusNotFound)
		return
	}
	image, err := model.GetConsoleImage(id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	data, err := service.ReadConsoleImage(c.Request.Context(), image)
	if err != nil {
		if errors.Is(err, service.ErrConsoleImageNotFound) {
			c.Status(http.StatusNotFound)
			return
		}
		c.Status(http.StatusInternalServerError)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "public, max-age=86400")
	c.Data(http.StatusOK, image.ContentType, data)
}
