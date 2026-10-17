package controller_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/router"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Every dialect uses its own client IP because the upload limiter is keyed by
// address and shared for the whole test binary.
func consoleImageRequest(t *testing.T, engine http.Handler, ip, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := common.Marshal(body)
	require.NoError(t, err)
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.RemoteAddr = ip + ":1234"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func uploadConsoleImage(t *testing.T, engine http.Handler, ip, token, data string) *httptest.ResponseRecorder {
	t.Helper()
	return consoleImageRequest(t, engine, ip, "POST", "/api/console-images", token, map[string]any{"data": data})
}

func consoleImageID(t *testing.T, response *httptest.ResponseRecorder) int {
	t.Helper()
	var uploaded struct {
		Success bool `json:"success"`
		Data    struct {
			ID int `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &uploaded))
	require.True(t, uploaded.Success, response.Body.String())
	require.Greater(t, uploaded.Data.ID, 0)
	return uploaded.Data.ID
}

func TestConsoleImagesUploadServeAndCleanup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for index, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			fixture := ticketObjectStorage(t)
			require.NoError(t, i18n.Init())
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.Log{}, &model.AuditLog{}))
			legacyOption := model.Option{Key: "console_setting.announcements", Value: "existing announcement configuration"}
			require.NoError(t, db.Create(&legacyOption).Error)
			require.NoError(t, model.MigrateConsoleImages(db))
			require.NoError(t, model.MigrateConsoleImages(db))
			var preserved model.Option
			require.NoError(t, db.Where(&model.Option{Key: legacyOption.Key}).First(&preserved).Error)
			assert.Equal(t, legacyOption, preserved)
			assert.True(t, db.Migrator().HasIndex(&model.ConsoleImage{}, "idx_console_images_object_key"))
			assert.True(t, db.Migrator().HasIndex(&model.ConsoleImage{}, "idx_console_images_created_at"))
			require.NoError(t, authz.Init(db))
			root := &model.User{Username: "console-root", Password: "placeholder", Email: "console-root@example.com", AffCode: "console", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			require.NoError(t, db.Create(root).Error)
			rootToken := ticketSession(t, root)
			engine := gin.New()
			router.SetApiRouter(engine)
			ip := fmt.Sprintf("10.77.0.%d", index+1)

			var screenshot bytes.Buffer
			require.NoError(t, png.Encode(&screenshot, image.NewRGBA(image.Rect(0, 0, 2, 2))))
			encoded := base64.StdEncoding.EncodeToString(screenshot.Bytes())

			// Uploads require a root session; serving stays public.
			assert.Equal(t, http.StatusUnauthorized, uploadConsoleImage(t, engine, ip, "", encoded).Code)
			uploadedID := consoleImageID(t, uploadConsoleImage(t, engine, ip, rootToken, encoded))
			assert.Len(t, fixture.objects, 1)
			var stored model.ConsoleImage
			require.NoError(t, db.First(&stored, uploadedID).Error)
			require.NoError(t, model.MigrateConsoleImages(db))
			var migrated model.ConsoleImage
			require.NoError(t, db.First(&migrated, uploadedID).Error)
			assert.Equal(t, stored, migrated)
			duplicate := stored
			duplicate.ID = 0
			assert.Error(t, db.Create(&duplicate).Error, "object keys remain unique after migration")

			served := consoleImageRequest(t, engine, ip, "GET", fmt.Sprintf("/api/console-images/%d", uploadedID), "", nil)
			require.Equal(t, http.StatusOK, served.Code)
			assert.Equal(t, "image/png", served.Header().Get("Content-Type"))
			assert.Equal(t, "nosniff", served.Header().Get("X-Content-Type-Options"))
			assert.Equal(t, screenshot.Bytes(), served.Body.Bytes())
			assert.Equal(t, http.StatusNotFound, consoleImageRequest(t, engine, ip, "GET", "/api/console-images/999999", "", nil).Code)

			// Invalid payloads are rejected without creating rows or objects.
			notImage := uploadConsoleImage(t, engine, ip, rootToken, base64.StdEncoding.EncodeToString([]byte("plain text")))
			assert.Contains(t, notImage.Body.String(), "Choose a PNG or JPEG image up to 5 MB")
			oversize := uploadConsoleImage(t, engine, ip, rootToken, base64.StdEncoding.EncodeToString(bytes.Repeat([]byte("x"), 5*1024*1024+1)))
			assert.Contains(t, oversize.Body.String(), "Choose a PNG or JPEG image up to 5 MB")

			var count int64
			require.NoError(t, db.Model(&model.ConsoleImage{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			assert.Len(t, fixture.objects, 1)

			// Clearing the storage configuration disables new uploads.
			common.OptionMapRWMutex.RLock()
			storageOption := common.OptionMap[system_setting.TicketStorageOption]
			common.OptionMapRWMutex.RUnlock()
			common.OptionMapRWMutex.Lock()
			common.OptionMap[system_setting.TicketStorageOption] = ""
			common.OptionMapRWMutex.Unlock()
			disabled := uploadConsoleImage(t, engine, ip, rootToken, encoded)
			assert.Contains(t, disabled.Body.String(), "Console image uploads are disabled")
			common.OptionMapRWMutex.Lock()
			common.OptionMap[system_setting.TicketStorageOption] = storageOption
			common.OptionMapRWMutex.Unlock()

			// Referenced images and fresh uploads survive cleanup; unreferenced
			// images older than the grace window are removed from R2 and the DB.
			oldAnnouncements := console_setting.GetConsoleSetting().Announcements
			t.Cleanup(func() { console_setting.GetConsoleSetting().Announcements = oldAnnouncements })
			orphanID := consoleImageID(t, uploadConsoleImage(t, engine, ip, rootToken, encoded))
			freshID := consoleImageID(t, uploadConsoleImage(t, engine, ip, rootToken, encoded))
			console_setting.GetConsoleSetting().Announcements = fmt.Sprintf(`[{"content":"keep","publishDate":"2025-01-01T00:00:00Z","images":[%d]}]`, uploadedID)
			require.NoError(t, db.Model(&model.ConsoleImage{}).Where("id IN ?", []int{uploadedID, orphanID}).Update("created_at", time.Now().Unix()-7200).Error)
			require.NoError(t, service.CleanupConsoleImages(t.Context()))
			assert.Len(t, fixture.objects, 2)

			var remaining []model.ConsoleImage
			require.NoError(t, db.Order("id ASC").Find(&remaining).Error)
			require.Len(t, remaining, 2)
			assert.Equal(t, uploadedID, remaining[0].ID)
			assert.Equal(t, freshID, remaining[1].ID)
			assert.Equal(t, http.StatusNotFound, consoleImageRequest(t, engine, ip, "GET", fmt.Sprintf("/api/console-images/%d", orphanID), "", nil).Code)
			assert.Equal(t, http.StatusOK, consoleImageRequest(t, engine, ip, "GET", fmt.Sprintf("/api/console-images/%d", uploadedID), "", nil).Code)
		})
	}
}

func TestConsoleImageAnnouncementValidation(t *testing.T) {
	assert.NoError(t, console_setting.ValidateConsoleSettings(`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z"}]`, "Announcements"))
	assert.NoError(t, console_setting.ValidateConsoleSettings(`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":[]}]`, "Announcements"))
	assert.NoError(t, console_setting.ValidateConsoleSettings(`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":[1,2]}]`, "Announcements"))
	for _, invalid := range []string{
		`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":"1"}]`,
		`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":[0]}]`,
		`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":[1.5]}]`,
		`[{"content":"hello","publishDate":"2025-01-01T00:00:00Z","images":[1,2,3,4,5,6,7,8,9,10]}]`,
	} {
		assert.Error(t, console_setting.ValidateConsoleSettings(invalid, "Announcements"))
	}
}
