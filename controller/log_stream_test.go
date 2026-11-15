package controller

import (
	"bufio"
	"context"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func isolateLogRefreshSettings(t *testing.T) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	settings := operation_setting.GetLogSetting()
	previous := *settings
	previousOptions := maps.Clone(common.OptionMap)
	settings.UserRefreshSeconds, settings.AdminRefreshSeconds = 0, 0
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	delete(common.OptionMap, operation_setting.LogUserRefreshSecondsOptionKey)
	delete(common.OptionMap, operation_setting.LogAdminRefreshSecondsOptionKey)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		*settings = previous
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
}

func TestLogStreamRefreshEnvironmentFallback(t *testing.T) {
	isolateLogRefreshSettings(t)
	for _, test := range []struct {
		name, userEnv, adminEnv   string
		userSeconds, adminSeconds int
	}{
		{"defaults", "", "", 3, 5},
		{"environment", "7", "11", 7, 11},
		{"bounded environment", "0", "300", 1, 60},
		{"invalid environment", "invalid", "invalid", 3, 5},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("LOG_SSE_USER_REFRESH_SECONDS", test.userEnv)
			t.Setenv("LOG_SSE_ADMIN_REFRESH_SECONDS", test.adminEnv)
			assert.Equal(t, time.Duration(test.userSeconds)*time.Second, operation_setting.GetLogRefreshInterval(false))
			assert.Equal(t, time.Duration(test.adminSeconds)*time.Second, operation_setting.GetLogRefreshInterval(true))
		})
	}
}

func TestLogStreamRefreshOptionsDatabaseMatrix(t *testing.T) {
	isolateLogRefreshSettings(t)
	t.Setenv("LOG_SSE_USER_REFRESH_SECONDS", "7")
	t.Setenv("LOG_SSE_ADMIN_REFRESH_SECONDS", "11")
	for _, database := range []struct {
		name, env string
		kind      common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	} {
		t.Run(database.name, func(t *testing.T) {
			dsn := os.Getenv(database.env)
			if database.env != "" && dsn == "" {
				t.Skip(database.env + " is not configured")
			}
			db, _ := newAuditTestDatabase(t, database.name, dsn)
			useLogExportDatabases(t, db, db, database.kind, database.kind)
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.SystemTask{}, &model.User{}, &model.AuditLog{}, &model.FreeGroupDailyUsage{}))
			admin := model.User{Username: "sse-settings-admin", AffCode: "sse-settings-admin", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&admin).Error)
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set("id", admin.Id)
				c.Set("role", admin.Role)
				c.Next()
			})
			engine.PUT("/api/option/", UpdateOption)
			engine.GET("/api/option/", GetOptions)
			for key, value := range map[string]int{
				operation_setting.LogUserRefreshSecondsOptionKey:  2,
				operation_setting.LogAdminRefreshSecondsOptionKey: 9,
			} {
				body, err := common.Marshal(map[string]any{"key": key, "value": value})
				require.NoError(t, err)
				response := accessTokenRequest(engine, http.MethodPut, "/api/option/", "", "", string(body))
				require.Equal(t, http.StatusOK, response.Code)
				var result struct {
					Success bool `json:"success"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				require.True(t, result.Success, response.Body.String())
				for _, invalid := range []string{"-1", "61", "1.5", "", "invalid"} {
					assert.Error(t, model.UpdateOption(key, invalid), "invalid interval %q must not be persisted", invalid)
				}
				var stored model.Option
				require.NoError(t, db.Where(&model.Option{Key: key}).First(&stored).Error)
				assert.Equal(t, common.Interface2String(value), stored.Value)
			}
			for range 2 {
				common.OptionMapRWMutex.Lock()
				settings := operation_setting.GetLogSetting()
				settings.UserRefreshSeconds, settings.AdminRefreshSeconds = 0, 0
				common.OptionMapRWMutex.Unlock()
				require.NoError(t, model.LoadOptionsFromDatabase())
				assert.Equal(t, 2*time.Second, operation_setting.GetLogRefreshInterval(false))
				assert.Equal(t, 9*time.Second, operation_setting.GetLogRefreshInterval(true))
			}
			response := accessTokenRequest(engine, http.MethodGet, "/api/option/", "", "", "")
			var options struct {
				Success bool           `json:"success"`
				Data    []model.Option `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &options))
			require.True(t, options.Success, response.Body.String())
			values := make(map[string]string)
			for _, option := range options.Data {
				values[option.Key] = option.Value
			}
			assert.Equal(t, "2", values[operation_setting.LogUserRefreshSecondsOptionKey])
			assert.Equal(t, "9", values[operation_setting.LogAdminRefreshSecondsOptionKey])
			require.NoError(t, model.UpdateOption(operation_setting.LogUserRefreshSecondsOptionKey, "0"))
			assert.Equal(t, 7*time.Second, operation_setting.GetLogRefreshInterval(false))
			assert.Equal(t, 9*time.Second, operation_setting.GetLogRefreshInterval(true))
			require.NoError(t, model.UpdateOption(operation_setting.LogAdminRefreshSecondsOptionKey, "0"))
			require.NoError(t, model.LoadOptionsFromDatabase())
			assert.Equal(t, 11*time.Second, operation_setting.GetLogRefreshInterval(true))
		})
	}
}

func TestLogStreamRefreshSettingsUpdateOpenStream(t *testing.T) {
	isolateLogRefreshSettings(t)
	user, _ := setupAccessTokenAudit(t)
	identity, _ := createAccessTokenTestSession(t, user.Id, "sse-settings-session")
	require.NoError(t, model.DB.AutoMigrate(&model.SystemTask{}))
	t.Setenv("LOG_SSE_USER_REFRESH_SECONDS", "7")
	synctest.Test(t, func(t *testing.T) {
		credential, _, err := service.IssueAccessToken(identity)
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		requestContext, cancel := context.WithCancel(context.Background())
		defer cancel()
		ctx.Request = httptest.NewRequestWithContext(requestContext, http.MethodGet, "/api/log/self/stream", nil)
		ctx.Request.Header.Set("Authorization", "Bearer "+credential)
		ctx.Set("id", user.Id)
		ctx.Set("session_id", identity.SessionID)
		ctx.Set("auth_version", identity.UserAuthVersion)
		ctx.Set("session_version", identity.SessionVersion)
		done := make(chan struct{})
		go func() {
			defer close(done)
			StreamUserLogs(ctx)
		}()
		synctest.Wait()
		assert.Contains(t, recorder.Body.String(), "event: ready\ndata: {\"refresh_interval_ms\":7000}")
		require.NoError(t, model.UpdateOption(operation_setting.LogUserRefreshSecondsOptionKey, "1"))
		time.Sleep(15 * time.Second)
		synctest.Wait()
		assert.Contains(t, recorder.Body.String(), "event: settings\ndata: {\"refresh_interval_ms\":1000}")
		common.UsageLogNotifications.Publish(user.Id)
		synctest.Wait()
		time.Sleep(time.Second)
		synctest.Wait()
		assert.Contains(t, recorder.Body.String(), "event: changed\ndata: {}")
		require.NoError(t, model.UpdateOption(operation_setting.LogUserRefreshSecondsOptionKey, "0"))
		time.Sleep(14 * time.Second)
		synctest.Wait()
		assert.Contains(t, recorder.Body.String(), "event: settings\ndata: {\"refresh_interval_ms\":7000}")
		cancel()
		<-done
	})
}

func TestLogNotificationScopeAndLimits(t *testing.T) {
	broker := common.NewLogNotificationBroker()
	own, cancelOwn := broker.Subscribe(12, false)
	defer cancelOwn()
	foreign, cancelForeign := broker.Subscribe(13, false)
	defer cancelForeign()
	all, cancelAll := broker.Subscribe(99, true)
	defer cancelAll()
	broker.Publish(12)
	broker.Publish(12)
	broker.Publish(12)
	for _, changes := range []<-chan struct{}{own, all} {
		select {
		case <-changes:
		default:
			t.Fatal("a permitted subscriber did not receive the change")
		}
		select {
		case <-changes:
			t.Fatal("repeated changes must be coalesced")
		default:
		}
	}
	select {
	case <-foreign:
		t.Fatal("another user's activity reached the subscriber")
	default:
	}
	_, cancelSecond := broker.Subscribe(12, true)
	defer cancelSecond()
	_, cancelThird := broker.Subscribe(12, false)
	defer cancelThird()
	rejected, rejectedCancel := broker.Subscribe(12, false)
	assert.Nil(t, rejected)
	assert.Nil(t, rejectedCancel)
	cancelOwn()
	cancelOwn()
	replacement, cancelReplacement := broker.Subscribe(12, false)
	require.NotNil(t, replacement)
	defer cancelReplacement()
	broker.Publish(12)
	select {
	case <-replacement:
	default:
		t.Fatal("a replacement subscription did not receive the change")
	}
	select {
	case <-own:
		t.Fatal("a cancelled subscription received a change")
	default:
	}
}

func TestLogNotificationsAcrossNodes(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx, cancel := context.WithCancel(context.Background())
	first, second := common.NewLogNotificationBroker(), common.NewLogNotificationBroker()
	doneFirst, doneSecond := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(doneFirst)
		first.Run(ctx, client)
	}()
	go func() {
		defer close(doneSecond)
		second.Run(ctx, client)
	}()
	t.Cleanup(func() {
		cancel()
		<-doneFirst
		<-doneSecond
	})
	require.Eventually(t, func() bool {
		return server.PubSubNumSub("new-api:usage-log-changes:v1:0")["new-api:usage-log-changes:v1:0"] == 2
	}, 5*time.Second, time.Millisecond)
	own, cancelOwn := second.Subscribe(12, false)
	defer cancelOwn()
	foreign, cancelForeign := second.Subscribe(13, false)
	defer cancelForeign()
	first.Publish(12)
	select {
	case <-own:
	case <-time.After(5 * time.Second):
		t.Fatal("a committed log change did not reach another node")
	}
	select {
	case <-foreign:
		t.Fatal("a remote notification crossed user boundaries")
	default:
	}
}

func TestLogNotificationsDatabaseMatrix(t *testing.T) {
	for _, database := range []struct {
		name string
		env  string
		kind common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	} {
		t.Run(database.name, func(t *testing.T) {
			dsn := os.Getenv(database.env)
			if database.env != "" && dsn == "" {
				t.Skip(database.env + " is not configured")
			}
			db, _ := newAuditTestDatabase(t, database.name, dsn)
			logDB, _ := newAuditTestDatabase(t, database.name, dsn)
			useLogExportDatabases(t, db, logDB, database.kind, database.kind)
			require.NoError(t, db.AutoMigrate(&model.User{}))
			require.NoError(t, logDB.AutoMigrate(&model.Log{}))
			versionSQL := "SELECT version()"
			if database.name == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, logDB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database: %s %s", database.name, version)
			user := &model.User{Username: "sse-owner", AffCode: "sse-owner", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", AuthVersion: 1}
			require.NoError(t, db.Create(user).Error)
			changes, cancel := common.UsageLogNotifications.Subscribe(user.Id, false)
			defer cancel()
			model.RecordLog(user.Id, model.LogTypeSystem, common.NewMessage("Log notification test"))
			select {
			case <-changes:
			default:
				t.Fatal("a successful insert did not publish a notification")
			}
			var count int64
			require.NoError(t, logDB.Model(&model.Log{}).Where("user_id = ?", user.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			ctx, cancelWrite := context.WithCancel(context.Background())
			cancelWrite()
			model.LOG_DB = logDB.WithContext(ctx)
			model.RecordLog(user.Id, model.LogTypeSystem, common.NewMessage("Failed notification test"))
			select {
			case <-changes:
				t.Fatal("a failed insert published a notification")
			default:
			}
			require.NoError(t, logDB.Model(&model.Log{}).Where("user_id = ?", user.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		})
	}
}

func TestLogStreamAuthorizationAndRevocation(t *testing.T) {
	user, legacy := setupAccessTokenAudit(t)
	_, credential := createAccessTokenTestSession(t, user.Id, "sse-browser-session")
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{"/api/log/stream", "/api/log/self/stream"})))
	engine.GET("/api/log/stream", middleware.AdminAuth(), StreamLogs)
	engine.GET("/api/log/self/stream", middleware.UserAuth(), StreamUserLogs)
	for _, request := range []struct {
		name, url, bearer string
		status            int
	}{
		{"anonymous", "/api/log/self/stream", "", http.StatusUnauthorized},
		{"query credential", "/api/log/self/stream?access_token=" + credential, "", http.StatusUnauthorized},
		{"legacy token", "/api/log/self/stream", legacy, http.StatusForbidden},
	} {
		t.Run(request.name, func(t *testing.T) {
			response := accessTokenRequest(engine, http.MethodGet, request.url, request.bearer, "", "")
			assert.Equal(t, request.status, response.Code)
			assert.NotContains(t, response.Header().Get("Content-Type"), "text/event-stream")
		})
	}
	scoped, _ := createScopedAccessToken(t, user.Id, time.Now().Unix()+3600, "usage:read", "log:read")
	response := accessTokenRequest(engine, http.MethodGet, "/api/log/self/stream", scoped, "", "")
	assert.Equal(t, http.StatusForbidden, response.Code)

	t.Setenv("LOG_SSE_USER_REFRESH_SECONDS", "1")
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/log/self/stream?user_id=999", nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer "+credential)
	request.Header.Set("Accept-Encoding", "gzip")
	stream, err := server.Client().Do(request)
	require.NoError(t, err)
	t.Cleanup(func() { stream.Body.Close() })
	require.Equal(t, http.StatusOK, stream.StatusCode)
	assert.Equal(t, "text/event-stream", stream.Header.Get("Content-Type"))
	assert.Empty(t, stream.Header.Get("Content-Encoding"))
	assert.Equal(t, "no", stream.Header.Get("X-Accel-Buffering"))
	assert.Contains(t, stream.Header.Get("Cache-Control"), "no-store")
	scanner := bufio.NewScanner(stream.Body)
	require.True(t, scanner.Scan())
	assert.Equal(t, "event: ready", scanner.Text())
	require.True(t, scanner.Scan())
	assert.Equal(t, `data: {"refresh_interval_ms":1000}`, scanner.Text())
	require.True(t, scanner.Scan())
	assert.Empty(t, scanner.Text())
	common.UsageLogNotifications.Publish(user.Id)
	require.True(t, scanner.Scan())
	assert.Equal(t, "event: changed", scanner.Text())
	require.True(t, scanner.Scan())
	assert.Equal(t, "data: {}", scanner.Text())
	require.True(t, scanner.Scan())
	revoked, err := model.RevokeUserSession(user.Id, "sse-browser-session", "sse regression")
	require.NoError(t, err)
	require.True(t, revoked)
	common.UsageLogNotifications.Publish(user.Id)
	assert.False(t, scanner.Scan(), "a revoked session must stop receiving activity")
	require.NoError(t, scanner.Err())
	rejected := accessTokenRequest(engine, http.MethodGet, "/api/log/self/stream", credential, "", "")
	assert.Equal(t, http.StatusUnauthorized, rejected.Code)
}

func TestLogStreamRejectsDowngradedAndExpiredSessions(t *testing.T) {
	user, _ := setupAccessTokenAudit(t)
	identity, credential := createAccessTokenTestSession(t, user.Id, "sse-revalidation-session")
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log/stream", nil)
	ctx.Request.Header.Set("Authorization", "Bearer "+credential)
	ctx.Set("id", user.Id)
	ctx.Set("session_id", identity.SessionID)
	ctx.Set("auth_version", identity.UserAuthVersion)
	ctx.Set("session_version", identity.SessionVersion)
	require.True(t, logStreamAuthorized(ctx, true))
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("role", common.RoleCommonUser).Error)
	assert.False(t, logStreamAuthorized(ctx, true))
	assert.True(t, logStreamAuthorized(ctx, false))
	for _, role := range []int{0, 99} {
		require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("role", role).Error)
		assert.False(t, logStreamAuthorized(ctx, false))
	}
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("role", common.RoleCommonUser).Error)
	synctest.Test(t, func(t *testing.T) {
		expiring, _, err := service.IssueAccessToken(identity)
		require.NoError(t, err)
		ctx.Request.Header.Set("Authorization", "Bearer "+expiring)
		timer := time.NewTimer(16 * time.Minute)
		<-timer.C
		assert.False(t, logStreamAuthorized(ctx, false), "an expired JWT cannot keep an existing stream authorized")
	})
	ctx.Request.Header.Set("Authorization", "Bearer "+credential)
	require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("expires_at", time.Now().Unix()-1).Error)
	assert.False(t, logStreamAuthorized(ctx, false))
	ctx.Request.Header.Del("Authorization")
	ctx.Request.URL.RawQuery = "access_token=" + credential
	assert.False(t, logStreamAuthorized(ctx, false))
	assert.NotContains(t, strings.TrimSpace(recorder.Body.String()), credential)
}
