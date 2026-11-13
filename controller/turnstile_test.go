package controller

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type turnstileTransport func(*http.Request) (*http.Response, error)

func (transport turnstileTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func setupTurnstileTest(t *testing.T) {
	t.Helper()
	settings := system_setting.GetTurnstileSettings()
	previous := *settings
	previousEnabled, previousSite, previousSecret := common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey
	previousOptions := common.OptionMap
	previousTransport := http.DefaultTransport
	t.Cleanup(func() {
		*settings = previous
		common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = previousEnabled, previousSite, previousSecret
		common.OptionMap = previousOptions
		http.DefaultTransport = previousTransport
	})
	*settings = system_setting.TurnstileSettings{
		Login: true, Register: true, EmailVerification: true, PasswordReset: true, Checkin: true,
	}
	common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "test-site", "test-secret"
	common.OptionMap = map[string]string{}
}

func TestTurnstileSceneEnforcement(t *testing.T) {
	setupTurnstileTest(t)
	settings := system_setting.GetTurnstileSettings()
	settings.Login, settings.Checkin = false, false
	http.DefaultTransport = turnstileTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("missing tokens and disabled scenes must not contact Cloudflare")
		return nil, errors.New("unexpected request")
	})
	for _, test := range []struct {
		scene   string
		allowed bool
	}{
		{"login", true}, {"register", false}, {"email_verification", false},
		{"password_reset", false}, {"checkin", true}, {"unknown", false},
	} {
		t.Run(test.scene, func(t *testing.T) {
			engine := gin.New()
			engine.POST("/protected", middleware.TurnstileCheck(test.scene), func(c *gin.Context) {
				common.ApiSuccess(c, "reached")
			})
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/protected?scene=login&turnstile_check=false", nil))
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, test.allowed, result.Success)
			assert.Empty(t, response.Header().Values("Set-Cookie"))
		})
	}
	common.TurnstileCheckEnabled = false
	engine := gin.New()
	engine.POST("/protected", middleware.TurnstileCheck("register"), func(c *gin.Context) {
		common.ApiSuccess(c, "reached")
	})
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/protected", nil))
	assert.Contains(t, response.Body.String(), `"success":true`)
}

func TestTurnstileEnableRequiresBothKeys(t *testing.T) {
	setupTurnstileTest(t)
	for _, missing := range []string{"site", "secret"} {
		t.Run(missing, func(t *testing.T) {
			common.TurnstileCheckEnabled = false
			common.TurnstileSiteKey, common.TurnstileSecretKey = "test-site", "test-secret"
			if missing == "site" {
				common.TurnstileSiteKey = ""
			} else {
				common.TurnstileSecretKey = ""
			}
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(`{"key":"TurnstileCheckEnabled","value":true}`))
			UpdateOption(context)
			assert.Contains(t, response.Body.String(), `"success":false`)
			assert.False(t, common.TurnstileCheckEnabled)
		})
	}
}

func TestTurnstileVerificationRejectsInvalidExpiredAndReplayedTokens(t *testing.T) {
	setupTurnstileTest(t)
	calls := 0
	http.DefaultTransport = turnstileTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		assert.Equal(t, "https://challenges.cloudflare.com/turnstile/v0/siteverify", request.URL.String())
		require.NoError(t, request.ParseForm())
		assert.Equal(t, "test-secret", request.Form.Get("secret"))
		token := request.Form.Get("response")
		body, status := `{"success":false,"error-codes":["timeout-or-duplicate"]}`, http.StatusOK
		if token == "valid" {
			body = `{"success":true}`
		}
		if token == "malformed" {
			body = "invalid JSON"
		}
		if token == "unavailable" {
			return nil, errors.New("test-secret must never appear in client errors")
		}
		if token == "non-200" {
			body, status = `{"success":true}`, http.StatusServiceUnavailable
		}
		if token == "single-use" && calls == 1 {
			body = `{"success":true}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})
	engine := gin.New()
	engine.POST("/protected", middleware.TurnstileCheck("login"), func(c *gin.Context) {
		common.ApiSuccess(c, "reached")
	})
	for _, token := range []string{"valid", "expired", "invalid", "malformed", "unavailable", "non-200", strings.Repeat("a", 2049)} {
		t.Run(token[:min(len(token), 12)], func(t *testing.T) {
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/protected?turnstile="+url.QueryEscape(token), nil))
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, token == "valid", result.Success)
			assert.NotContains(t, response.Body.String(), "test-secret")
		})
	}
	calls = 0
	for attempt := range 2 {
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/protected?turnstile=single-use", nil))
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, attempt == 0, result.Success)
	}
}

func TestTurnstileSceneOptionsDatabaseMatrix(t *testing.T) {
	for _, database := range []struct{ kind, env string }{
		{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"},
	} {
		t.Run(database.kind, func(t *testing.T) {
			if database.env != "" && os.Getenv(database.env) == "" {
				t.Skip(database.env + " is not configured")
			}
			setupTurnstileTest(t)
			db, _ := newAuditTestDatabase(t, database.kind, os.Getenv(database.env))
			previousDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = previousDB })
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.SystemTask{}))
			versionQuery := "SELECT version()"
			if database.kind == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.NoError(t, db.Create(&model.Option{Key: "TurnstileCheckEnabled", Value: "true"}).Error)
			model.InitOptionMap()
			for _, scene := range []string{"login", "register", "email_verification", "password_reset", "checkin"} {
				assert.True(t, system_setting.GetTurnstileSettings().EnabledFor(scene), "legacy settings keep every scene enabled")
				require.NoError(t, model.UpdateOption("turnstile."+scene, "false"))
			}
			settings := system_setting.GetTurnstileSettings()
			*settings = system_setting.TurnstileSettings{Login: true, Register: true, EmailVerification: true, PasswordReset: true, Checkin: true}
			for range 2 {
				require.NoError(t, model.LoadOptionsFromDatabase())
				assert.Equal(t, system_setting.TurnstileSettings{}, *settings)
			}
			for _, invalid := range []struct{ key, value string }{
				{"turnstile.login", "invalid"}, {"turnstile.checkin", "0"}, {"turnstile.unknown", "false"},
			} {
				require.Error(t, model.UpdateOption(invalid.key, invalid.value))
			}
			var options []model.Option
			require.NoError(t, db.Where("value = ?", "false").Find(&options).Error)
			assert.Len(t, options, 5)
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
			GetStatus(context)
			var result struct {
				Data struct {
					Scenes system_setting.TurnstileSettings `json:"turnstile_scenes"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, *settings, result.Data.Scenes)
			assert.NotContains(t, response.Body.String(), "test-secret")
		})
	}
}

func TestTurnstileSceneSettingsRequireRootSession(t *testing.T) {
	_, _ = setupAccessTokenAudit(t)
	setupTurnstileTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SystemTask{}))
	engine := gin.New()
	engine.PUT("/api/option/", middleware.RootAuth(), UpdateOption)
	for _, test := range []struct {
		name string
		role int
		code int
	}{
		{"anonymous", 0, http.StatusUnauthorized},
		{"ordinary", common.RoleCommonUser, http.StatusForbidden},
		{"admin", common.RoleAdminUser, http.StatusForbidden},
		{"root", common.RoleRootUser, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			token := ""
			if test.role != 0 {
				user := model.User{Username: "turnstile-" + test.name, Role: test.role, Status: common.UserStatusEnabled, Group: "default", AffCode: "turnstile-" + test.name}
				require.NoError(t, model.DB.Create(&user).Error)
				_, token = createAccessTokenTestSession(t, user.Id, "turnstile-"+test.name)
			}
			response := accessTokenRequest(engine, http.MethodPut, "/api/option/", token, "", `{"key":"turnstile.login","value":false}`)
			assert.Equal(t, test.code, response.Code, response.Body.String())
		})
	}
}
