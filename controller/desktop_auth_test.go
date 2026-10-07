package controller

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupDesktopAuth(t *testing.T, kind, dsn string, upgrade, fullStartup bool) (*model.User, *gin.Engine) {
	t.Helper()
	db, isolatedDSN := newAuditTestDatabase(t, kind, dsn)
	oldDB, oldLogDB, oldRedis, oldSecret, oldAddress := model.DB, model.LOG_DB, common.RedisEnabled, common.SessionSecret, system_setting.ServerAddress
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	common.SessionSecret = "desktop-tests-only-secret"
	system_setting.ServerAddress = "https://kuncode.example"
	dialect := common.DatabaseTypeSQLite
	if kind == "mysql" {
		dialect = common.DatabaseTypeMySQL
	}
	if kind == "postgres" {
		dialect = common.DatabaseTypePostgreSQL
	}
	common.SetDatabaseTypes(dialect, dialect)
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled, common.SessionSecret, system_setting.ServerAddress = oldDB, oldLogDB, oldRedis, oldSecret, oldAddress
		common.SetDatabaseTypes(oldMain, oldLog)
	})
	if fullStartup {
		runDesktopDatabaseStartup(t, kind, isolatedDSN)
		db = model.DB
		model.LOG_DB = db
	}
	require.NoError(t, i18n.Init())
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuthFlow{}, &model.Token{}, &model.Ability{}, &model.Log{}, &model.AuditLog{}, &model.Option{}, &model.TwoFA{}, &model.TwoFABackupCode{}, &model.PasskeyCredential{}, &model.UserOAuthBinding{}))
	user := &model.User{Username: "desktop-owner", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "desktop-owner", AuthVersion: 1}
	require.NoError(t, db.Create(user).Error)
	require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "coding-model", ChannelId: 1, Enabled: true}).Error)
	ordinary := &model.Token{UserId: user.Id, Name: "existing unrelated key", Key: "existing-key-must-remain", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
	require.NoError(t, db.Create(ordinary).Error)
	if upgrade {
		_, _ = createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, "profile:read")
		require.NoError(t, db.Migrator().DropColumn(&model.UserAccessToken{}, "DesktopInstallationId"))
		require.NoError(t, db.Migrator().DropTable(&model.DesktopToolKey{}, &model.DesktopInstallation{}))
	}
	if fullStartup {
		runDesktopDatabaseStartup(t, kind, isolatedDSN)
		db = model.DB
		model.LOG_DB = db
	} else {
		for range 2 {
			require.NoError(t, db.AutoMigrate(&model.UserAccessToken{}, &model.DesktopInstallation{}, &model.DesktopToolKey{}))
		}
	}
	assert.True(t, db.Migrator().HasIndex(&model.DesktopInstallation{}, "idx_desktop_owner_install"))
	assert.True(t, db.Migrator().HasIndex(&model.DesktopToolKey{}, "idx_desktop_install_agent"))
	var preserved model.Token
	require.NoError(t, db.First(&preserved, ordinary.Id).Error)
	assert.Equal(t, ordinary.Key, preserved.Key)
	if upgrade {
		var count int64
		require.NoError(t, db.Model(&model.UserAccessToken{}).Count(&count).Error)
		assert.EqualValues(t, 1, count)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/desktop/auth/start", DesktopAuthStart)
	router.POST("/api/desktop/auth/exchange", DesktopAuthExchange)
	router.GET("/api/desktop/auth/request", middleware.UserAuth(), DesktopAuthRequest)
	router.POST("/api/desktop/auth/authorize", middleware.UserAuth(), DesktopAuthAuthorize)
	router.GET("/api/desktop/profile", middleware.UserAuth(), DesktopProfile)
	router.POST("/api/desktop/auth/logout", middleware.UserAuth(), DesktopAuthLogout)
	router.PUT("/api/desktop/tools/:agent", middleware.UserAuth(), DesktopConfigureTool)
	router.GET("/api/user/self", middleware.UserAuth(), func(c *gin.Context) { common.ApiSuccess(c, gin.H{"id": c.GetInt("id")}) })
	router.GET("/api/token/", middleware.UserAuth(), func(c *gin.Context) { common.ApiSuccess(c, nil) })
	return user, router
}

// Use the production startup path on isolated databases, never the user's configured database.
func runDesktopDatabaseStartup(t *testing.T, kind, isolatedDSN string) {
	t.Helper()
	oldPath, oldMaster := common.SQLitePath, common.IsMasterNode
	t.Cleanup(func() { common.SQLitePath, common.IsMasterNode = oldPath, oldMaster })
	common.IsMasterNode = true
	if kind == "sqlite" {
		common.SQLitePath = isolatedDSN
		t.Setenv("SQL_DSN", "")
	} else {
		t.Setenv("SQL_DSN", isolatedDSN)
	}
	t.Setenv("LOG_SQL_DSN", "")
	for range 2 {
		require.NoError(t, model.InitDB())
		pool, err := model.DB.DB()
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, pool.Close()) })
	}
	var version string
	query := "SELECT version()"
	if kind == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, model.DB.Raw(query).Scan(&version).Error)
	t.Logf("%s startup/migration version: %s", kind, version)
}

func desktopResponseData(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	require.Equal(t, 200, response.Code, response.Body.String())
	var envelope struct {
		Success bool
		Data    map[string]any
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope))
	require.True(t, envelope.Success, response.Body.String())
	return envelope.Data
}

func desktopAuthorizationCode(t *testing.T, router *gin.Engine, user *model.User, installID string) (string, string) {
	t.Helper()
	identity, jwt := createAccessTokenTestSession(t, user.Id, uuid.NewString())
	verifier := strings.Repeat("v", 43)
	digest := sha256.Sum256([]byte(verifier))
	input := model.DesktopRequest{ClientId: model.DesktopClientID, InstallationId: installID, DeviceName: "test device", RedirectURI: "http://127.0.0.1:31415/callback", State: strings.Repeat("s", 43), CodeChallenge: base64.RawURLEncoding.EncodeToString(digest[:]), CodeChallengeMethod: "S256"}
	body, err := common.Marshal(input)
	require.NoError(t, err)
	start := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)))
	authorizeURL, err := url.Parse(start["authorization_url"].(string))
	require.NoError(t, err)
	flow := authorizeURL.Query().Get("flow")
	data := desktopResponseData(t, accessTokenRequest(router, "GET", "/api/desktop/auth/request?flow="+flow, jwt, "", ""))
	proofContext, err := common.Marshal(service.DesktopAuthorizeContext{RequestID: int64(data["request_id"].(float64))})
	require.NoError(t, err)
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeDesktopAuthorize, Context: proofContext}, service.VerificationMethodPassword)
	decision := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, proof, `{"flow":"`+flow+`","approve":true}`))
	callback, err := url.Parse(decision["callback_url"].(string))
	require.NoError(t, err)
	assert.Equal(t, input.State, callback.Query().Get("state"))
	assert.NotContains(t, callback.RawQuery, "nap_")
	return callback.Query().Get("code"), verifier
}

func desktopExchange(t *testing.T, router *gin.Engine, code, verifier string) string {
	t.Helper()
	body, err := common.Marshal(map[string]string{"code": code, "code_verifier": verifier, "redirect_uri": "http://127.0.0.1:31415/callback"})
	require.NoError(t, err)
	data := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", string(body)))
	return data["token"].(string)
}

func TestDesktopAuthorizationLifecycle(t *testing.T) {
	user, router := setupDesktopAuth(t, "sqlite", "", false, false)
	installID := uuid.NewString()
	code, verifier := desktopAuthorizationCode(t, router, user, installID)
	bad := accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", `{"code":"`+code+`","code_verifier":"`+strings.Repeat("x", 43)+`","redirect_uri":"http://127.0.0.1:31415/callback"}`)
	assert.Equal(t, 400, bad.Code)
	pat := desktopExchange(t, router, code, verifier)
	replay := accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", `{"code":"`+code+`","code_verifier":"`+verifier+`","redirect_uri":"http://127.0.0.1:31415/callback"}`)
	assert.Equal(t, 400, replay.Code)
	assert.Equal(t, 200, accessTokenRequest(router, "GET", "/api/user/self", pat, "", "").Code)
	profile := desktopResponseData(t, accessTokenRequest(router, "GET", "/api/desktop/profile", pat, "", ""))
	assert.Equal(t, "newapi", profile["provider"])
	profileUser := profile["user"].(map[string]any)
	assert.Equal(t, "desktop-owner", profileUser["username"])
	// The desktop contract is intentionally narrower than the dashboard DTO.
	for _, omitted := range []string{"permissions", "aff_code", "setting", "stripe_customer"} {
		assert.NotContains(t, profileUser, omitted)
	}
	quota := profile["quota"].(map[string]any)
	assert.Positive(t, quota["quota_per_unit"])
	assert.Contains(t, quota, "balance")
	assert.Contains(t, quota, "used")
	assert.Equal(t, 403, accessTokenRequest(router, "GET", "/api/token/", pat, "", "").Code)
	first := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat, "", `{"model":"coding-model"}`))
	second := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat, "", `{"model":"coding-model"}`))
	assert.Equal(t, first["id"], second["id"])
	assert.Equal(t, first["key"], second["key"])
	assert.Equal(t, 409, accessTokenRequest(router, "PUT", "/api/desktop/tools/unrelated", pat, "", `{"model":"coding-model"}`).Code)
	code2, verifier2 := desktopAuthorizationCode(t, router, user, installID)
	pat2 := desktopExchange(t, router, code2, verifier2)
	assert.Equal(t, 401, accessTokenRequest(router, "GET", "/api/user/self", pat, "", "").Code)
	third := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat2, "", `{"model":"coding-model"}`))
	assert.Equal(t, first["key"], third["key"])
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", int(first["id"].(float64))).Update("status", common.TokenStatusDisabled).Error)
	replacement := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat2, "", `{"model":"coding-model"}`))
	assert.NotEqual(t, first["id"], replacement["id"])
	assert.NotEqual(t, first["key"], replacement["key"])
	repeated := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat2, "", `{"model":"coding-model"}`))
	assert.Equal(t, replacement["key"], repeated["key"])
	assert.Equal(t, 200, accessTokenRequest(router, "POST", "/api/desktop/auth/logout", pat2, "", "").Code)
	var configured model.Token
	require.NoError(t, model.DB.First(&configured, int(replacement["id"].(float64))).Error)
	assert.Equal(t, common.TokenStatusEnabled, configured.Status)
	assert.Equal(t, 401, accessTokenRequest(router, "GET", "/api/user/self", pat2, "", "").Code)
}

func TestDesktopAuthorizationRejectsInvalidAuthority(t *testing.T) {
	user, router := setupDesktopAuth(t, "sqlite", "", false, false)
	code, verifier := desktopAuthorizationCode(t, router, user, uuid.NewString())
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.DesktopCodePurpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
	assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", `{"code":"`+code+`","code_verifier":"`+verifier+`","redirect_uri":"http://127.0.0.1:31415/callback"}`).Code)
	code, verifier = desktopAuthorizationCode(t, router, user, uuid.NewString())
	pat := desktopExchange(t, router, code, verifier)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("auth_version", 2).Error)
	assert.Equal(t, 401, accessTokenRequest(router, "GET", "/api/user/self", pat, "", "").Code)
	assert.Equal(t, 401, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat, "", `{"model":"coding-model"}`).Code)
	ordinary, _ := createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, model.DesktopConfigureScope)
	assert.Equal(t, 401, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", ordinary, "", `{"model":"coding-model"}`).Code)
}

func TestDesktopDatabaseMatrix(t *testing.T) {
	for _, database := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "DESKTOP_MYSQL_DSN"}, {"postgres", "DESKTOP_POSTGRES_DSN"}} {
		for _, upgrade := range []bool{false, true} {
			name := database.kind
			if upgrade {
				name += "-upgrade"
			} else {
				name += "-fresh"
			}
			t.Run(name, func(t *testing.T) {
				dsn := os.Getenv(database.env)
				if database.env != "" && dsn == "" {
					t.Skip("Set " + database.env + " to a loopback database for the real migration matrix.")
				}
				user, router := setupDesktopAuth(t, database.kind, dsn, upgrade, true)
				code, verifier := desktopAuthorizationCode(t, router, user, uuid.NewString())
				pat := desktopExchange(t, router, code, verifier)
				for _, agent := range []string{"codex", "claude", "opencode"} {
					desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/"+agent, pat, "", `{"model":"coding-model"}`))
				}
				var installation model.DesktopInstallation
				require.NoError(t, model.DB.Where("user_id = ?", user.Id).First(&installation).Error)
				duplicate := model.DesktopInstallation{UserId: user.Id, ClientInstallationId: installation.ClientInstallationId}
				assert.Error(t, model.DB.Create(&duplicate).Error, "account/installation uniqueness must survive migration")
				duplicateKey := model.DesktopToolKey{InstallationId: installation.Id, Agent: "codex"}
				assert.Error(t, model.DB.Create(&duplicateKey).Error, "installation/agent uniqueness must survive migration")
			})
		}
	}
}

func TestDesktopRejectsUnboundProofAndDenialConsumesRequest(t *testing.T) {
	user, router := setupDesktopAuth(t, "sqlite", "", false, false)
	identity, jwt := createAccessTokenTestSession(t, user.Id, uuid.NewString())
	verifier := strings.Repeat("v", 43)
	digest := sha256.Sum256([]byte(verifier))
	request := model.DesktopRequest{ClientId: model.DesktopClientID, InstallationId: uuid.NewString(), DeviceName: "Windows", RedirectURI: "http://127.0.0.1:31415/callback", State: strings.Repeat("s", 43), CodeChallenge: base64.RawURLEncoding.EncodeToString(digest[:]), CodeChallengeMethod: "S256"}
	body, err := common.Marshal(request)
	require.NoError(t, err)
	start := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)))
	authorizationURL, err := url.Parse(start["authorization_url"].(string))
	require.NoError(t, err)
	flow := authorizationURL.Query().Get("flow")
	data := desktopResponseData(t, accessTokenRequest(router, "GET", "/api/desktop/auth/request?flow="+flow, jwt, "", ""))
	decision := `{"flow":"` + flow + `","approve":true}`
	assert.Equal(t, 403, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, "", decision).Code)
	context, err := common.Marshal(service.DesktopAuthorizeContext{RequestID: int64(data["request_id"].(float64)) + 1})
	require.NoError(t, err)
	proof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeDesktopAuthorize, Context: context}, service.VerificationMethodPassword)
	assert.Equal(t, 403, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, proof, decision).Code)
	denied := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, "", `{"flow":"`+flow+`","approve":false}`))
	callback, err := url.Parse(denied["callback_url"].(string))
	require.NoError(t, err)
	assert.Equal(t, "access_denied", callback.Query().Get("error"))
	assert.Empty(t, callback.Query().Get("code"))
	assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, "", decision).Code)
	startedAgain := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)))
	expiredURL, err := url.Parse(startedAgain["authorization_url"].(string))
	require.NoError(t, err)
	expiredFlow := expiredURL.Query().Get("flow")
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ?", model.DesktopRequestPurpose).Update("expires_at", time.Now().Add(-time.Second)).Error)
	assert.Equal(t, 400, accessTokenRequest(router, "GET", "/api/desktop/auth/request?flow="+expiredFlow, jwt, "", "").Code)
	assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/authorize", jwt, "", `{"flow":"`+expiredFlow+`","approve":true}`).Code)
}

func TestDesktopCallbackValidationAndSessionRevocation(t *testing.T) {
	user, router := setupDesktopAuth(t, "sqlite", "", false, false)
	code, verifier := desktopAuthorizationCode(t, router, user, uuid.NewString())
	assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", `{"code":"`+code+`","code_verifier":"`+verifier+`","redirect_uri":"http://127.0.0.1:31416/callback"}`).Code)
	require.NoError(t, model.DB.Model(&model.UserSession{}).Where("user_id = ?", user.Id).Update("revoked_at", time.Now().Unix()).Error)
	assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/exchange", "", "", `{"code":"`+code+`","code_verifier":"`+verifier+`","redirect_uri":"http://127.0.0.1:31415/callback"}`).Code)
	for _, callback := range []string{"https://remote.example/callback", "http://localhost:31415/callback", "http://127.0.0.1:80/callback", "http://127.0.0.1:31415/wrong", "http://user@127.0.0.1:31415/callback", "http://127.0.0.1:31415/callback?token=secret", "http://127.0.0.1:31415/callback?", "http://127.0.0.1:31415/%63allback"} {
		digest := sha256.Sum256([]byte(verifier))
		body, err := common.Marshal(model.DesktopRequest{ClientId: model.DesktopClientID, InstallationId: uuid.NewString(), DeviceName: "Windows", RedirectURI: callback, State: strings.Repeat("s", 43), CodeChallenge: base64.RawURLEncoding.EncodeToString(digest[:]), CodeChallengeMethod: "S256"})
		require.NoError(t, err)
		assert.Equal(t, 400, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)).Code)
	}
}

func TestDesktopAuthorizationUsesConfiguredPublicAddress(t *testing.T) {
	_, router := setupDesktopAuth(t, "sqlite", "", false, false)
	digest := sha256.Sum256([]byte(strings.Repeat("v", 43)))
	body, err := common.Marshal(model.DesktopRequest{ClientId: model.DesktopClientID, InstallationId: uuid.NewString(), DeviceName: "Windows", RedirectURI: "http://127.0.0.1:31415/callback", State: strings.Repeat("s", 43), CodeChallenge: base64.RawURLEncoding.EncodeToString(digest[:]), CodeChallengeMethod: "S256"})
	require.NoError(t, err)
	for _, address := range []string{"http://127.0.0.1:3000", "http://localhost:3000", "https://kuncode.example"} {
		system_setting.ServerAddress = address
		data := desktopResponseData(t, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)))
		assert.True(t, strings.HasPrefix(data["authorization_url"].(string), address+"/desktop/authorize?"))
	}
	for _, address := range []string{"http://remote.example", "https://user:password@remote.example", "https://remote.example?token=secret"} {
		system_setting.ServerAddress = address
		assert.Equal(t, 503, accessTokenRequest(router, "POST", "/api/desktop/auth/start", "", "", string(body)).Code)
	}
}

func TestDesktopToolKeysAreIsolatedByAccountInstallationAndAgent(t *testing.T) {
	user, router := setupDesktopAuth(t, "sqlite", "", false, false)
	other := &model.User{Username: "desktop-other", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "desktop-other", AuthVersion: 1}
	require.NoError(t, model.DB.Create(other).Error)
	var keys []string
	var installations []model.DesktopInstallation
	for _, owner := range []*model.User{user, user, other} {
		code, verifier := desktopAuthorizationCode(t, router, owner, uuid.NewString())
		pat := desktopExchange(t, router, code, verifier)
		var installation model.DesktopInstallation
		require.NoError(t, model.DB.Where("user_id = ? AND access_token_id = (SELECT id FROM user_access_tokens WHERE token_hash = ?)", owner.Id, model.AccessTokenFingerprint(pat)).First(&installation).Error)
		installations = append(installations, installation)
		for _, agent := range []string{"codex", "claude", "opencode"} {
			data := desktopResponseData(t, accessTokenRequest(router, "PUT", "/api/desktop/tools/"+agent, pat, "", `{"model":"coding-model"}`))
			key := data["key"].(string)
			assert.NotContains(t, keys, key)
			keys = append(keys, key)
		}
		assert.Equal(t, 400, accessTokenRequest(router, "PUT", "/api/desktop/tools/codex", pat, "", `{"model":"unavailable-model"}`).Code)
	}
	for _, target := range installations[1:] {
		_, err := model.ConfigureDesktopTool(target.Id, installations[0].AccessTokenId, "codex", "coding-model", "default", []string{"coding-model"}, 100)
		assert.Error(t, err, "a desktop PAT cannot configure another account or installation")
	}
	var ordinary model.Token
	require.NoError(t, model.DB.Where("name = ?", "existing unrelated key").First(&ordinary).Error)
	assert.Equal(t, "existing-key-must-remain", ordinary.Key)
}
