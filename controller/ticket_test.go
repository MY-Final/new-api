package controller_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/router"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func ticketDatabase(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	var kind common.DatabaseType
	switch dialect {
	case "mysql":
		dsn := os.Getenv("TEST_TICKET_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_TICKET_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(dsn)
		kind = common.DatabaseTypeMySQL
	case "postgres":
		dsn := os.Getenv("TEST_TICKET_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_TICKET_POSTGRES_DSN is not configured")
		}
		driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		kind = common.DatabaseTypePostgreSQL
	default:
		driver = sqlite.Open(":memory:")
		kind = common.DatabaseTypeSQLite
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldLog, mainKind, logKind := model.DB, model.LOG_DB, common.MainDatabaseType(), common.LogDatabaseType()
	oldMaster, oldRedis := common.IsMasterNode, common.RedisEnabled
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(kind, kind)
	common.IsMasterNode = true
	common.RedisEnabled = false
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{"SupportTicketsEnabled": "true"}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetDatabaseTypes(mainKind, logKind)
		common.IsMasterNode = oldMaster
		common.RedisEnabled = oldRedis
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
		_ = sqlDB.Close()
	})
	for _, entity := range []any{&model.TicketStoredObject{}, &model.TicketRead{}, &model.TicketAttachment{}, &model.TicketEvent{}, &model.TicketMessage{}, &model.Ticket{}, &model.UserSession{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.UserAccessToken{}, &model.Option{}, &model.AuditLog{}, &model.Log{}, &model.User{}} {
		require.NoError(t, db.Migrator().DropTable(entity))
	}
	var version string
	switch dialect {
	case "mysql":
		require.NoError(t, db.Raw("SELECT VERSION()").Scan(&version).Error)
	case "postgres":
		require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
	default:
		require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
	}
	t.Log("database version:", version)
	return db
}

func ticketSession(t *testing.T, user *model.User) string {
	t.Helper()
	now := time.Now().Unix()
	sid := common.GetUUID()
	require.NoError(t, model.CreateUserSession(&model.UserSession{SID: sid, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "test-" + sid, LoginMethod: "password", LastActiveAt: now, ExpiresAt: now + 3600}))
	jwt, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: sid, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	return jwt
}

// Only the external Cloudflare HTTP boundary is replaced. Requests still use
// the production signer and storage implementation against an HTTP server.
type ticketStorageTransport struct {
	target    *url.URL
	transport http.RoundTripper
}

func (transport ticketStorageTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if !strings.HasSuffix(request.URL.Host, ".r2.cloudflarestorage.com") {
		return transport.transport.RoundTrip(request)
	}
	copy := request.Clone(request.Context())
	copy.URL.Scheme, copy.URL.Host = transport.target.Scheme, transport.target.Host
	copy.Host = request.URL.Host
	return transport.transport.RoundTrip(copy)
}

type ticketR2Fixture struct {
	mutex                           sync.Mutex
	objects                         map[string][]byte
	failPut, failDelete, corruptGet bool
}

func ticketObjectStorage(t *testing.T) *ticketR2Fixture {
	t.Helper()
	fixture := &ticketR2Fixture{objects: make(map[string][]byte)}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		fixture.mutex.Lock()
		defer fixture.mutex.Unlock()
		assert.Contains(t, request.Header.Get("Authorization"), "Credential=test-access/")
		assert.Contains(t, request.Header.Get("Authorization"), "/auto/s3/aws4_request")
		assert.NotEmpty(t, request.Header.Get("X-Amz-Content-Sha256"))
		assert.True(t, strings.HasPrefix(request.URL.Path, "/ticket-images/tickets/"))
		switch request.Method {
		case "PUT":
			if fixture.failPut {
				writer.WriteHeader(503)
				return
			}
			data, err := io.ReadAll(request.Body)
			require.NoError(t, err)
			fixture.objects[request.URL.Path] = data
		case "GET":
			data, ok := fixture.objects[request.URL.Path]
			if !ok {
				writer.WriteHeader(404)
				return
			}
			if fixture.corruptGet {
				_, _ = writer.Write([]byte("corrupt"))
				return
			}
			_, _ = writer.Write(data)
		case "DELETE":
			if fixture.failDelete {
				writer.WriteHeader(503)
				return
			}
			delete(fixture.objects, request.URL.Path)
			writer.WriteHeader(204)
		default:
			writer.WriteHeader(405)
		}
	}))
	target, err := url.Parse(server.URL)
	require.NoError(t, err)
	old := http.DefaultTransport
	http.DefaultTransport = ticketStorageTransport{target: target, transport: old}
	t.Cleanup(func() { http.DefaultTransport = old; server.Close() })
	encoded, err := common.Marshal(system_setting.TicketStorageConfig{Enabled: true, RetentionDays: 30, Endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", Bucket: "ticket-images", AccessKey: "test-access", SecretKey: "test-secret"})
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	common.OptionMap[system_setting.TicketStorageOption] = string(encoded)
	common.OptionMapRWMutex.Unlock()
	return fixture
}

func ticketRequest(t *testing.T, engine http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := common.Marshal(body)
	require.NoError(t, err)
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func TestTicketsConfiguredDatabases(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			ticketObjectStorage(t)
			require.NoError(t, i18n.Init())
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.Log{}, &model.AuditLog{}))
			require.NoError(t, model.MigrateTickets(db))
			require.NoError(t, model.MigrateTickets(db))
			require.NoError(t, authz.Init(db))
			owner := &model.User{Username: "ticket-owner", Password: "placeholder", Email: "ticket-owner@example.com", AffCode: "owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			other := &model.User{Username: "ticket-other", Password: "placeholder", AffCode: "other", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			staff := &model.User{Username: "ticket-staff", Password: "placeholder", AffCode: "staff", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			for _, user := range []*model.User{owner, other, staff} {
				require.NoError(t, db.Create(user).Error)
			}
			ownerToken, otherToken, staffToken := ticketSession(t, owner), ticketSession(t, other), ticketSession(t, staff)
			engine := gin.New()
			router.SetApiRouter(engine)
			assert.Equal(t, http.StatusUnauthorized, ticketRequest(t, engine, "GET", "/api/tickets", "", nil).Code)
			assert.Equal(t, http.StatusForbidden, ticketRequest(t, engine, "GET", "/api/admin/tickets", otherToken, nil).Code)
			var screenshot bytes.Buffer
			require.NoError(t, png.Encode(&screenshot, image.NewRGBA(image.Rect(0, 0, 2, 2))))
			body := map[string]any{"title": "API 请求失败", "category": "api", "content": "private customer details", "request_key": "create-1", "screenshots": []any{map[string]any{"name": "screenshot.png", "data": base64.StdEncoding.EncodeToString(screenshot.Bytes())}}}
			response := ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body)
			require.Equal(t, 200, response.Code, response.Body.String())
			var created struct {
				Data struct {
					ID int `json:"id"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &created))
			require.Positive(t, created.Data.ID)
			id := created.Data.ID
			path := fmt.Sprintf("/api/tickets/%d", id)
			adminPath := fmt.Sprintf("/api/admin/tickets/%d", id)
			response = ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body)
			assert.Equal(t, 200, response.Code)
			var total int64
			require.NoError(t, db.Model(&model.Ticket{}).Count(&total).Error)
			assert.EqualValues(t, 1, total)
			body["content"] = "different payload"
			assert.Equal(t, 409, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body).Code)
			for _, tc := range []struct {
				method, suffix string
				payload        any
			}{{"GET", "", nil}, {"POST", "/messages", map[string]any{"content": "foreign", "request_key": "foreign"}}, {"POST", "/read", map[string]any{"version": 1}}, {"PATCH", "", map[string]any{"status": "closed", "version": 1}}} {
				assert.Equal(t, 404, ticketRequest(t, engine, tc.method, path+tc.suffix, otherToken, tc.payload).Code)
			}
			response = ticketRequest(t, engine, "GET", path, ownerToken, nil)
			require.Equal(t, 200, response.Code)
			var detail struct {
				Data model.TicketDetail `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &detail))
			require.Len(t, detail.Data.Messages, 1)
			require.Len(t, detail.Data.Messages[0].Attachments, 1)
			assert.Nil(t, detail.Data.Requester, "owners must not receive account lookup data")
			assert.Empty(t, detail.Data.Messages[0].SenderName)
			response = ticketRequest(t, engine, "GET", adminPath, staffToken, nil)
			require.Equal(t, 200, response.Code)
			var staffDetail struct {
				Data model.TicketDetail `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &staffDetail))
			require.NotNil(t, staffDetail.Data.Requester)
			assert.Equal(t, "ticket-owner", staffDetail.Data.Requester.Username)
			assert.Equal(t, "ticket-owner@example.com", staffDetail.Data.Requester.Email)
			require.Len(t, staffDetail.Data.Messages, 1)
			assert.Equal(t, "ticket-owner", staffDetail.Data.Messages[0].SenderName)
			response = ticketRequest(t, engine, "GET", "/api/admin/tickets", staffToken, nil)
			assert.Equal(t, 200, response.Code)
			assert.Contains(t, response.Body.String(), "ticket-owner")
			assert.Contains(t, response.Body.String(), "private customer details", "the inbox list carries the last message preview")
			response = ticketRequest(t, engine, "GET", "/api/admin/tickets?unread=true", staffToken, nil)
			assert.Equal(t, 200, response.Code)
			assert.Contains(t, response.Body.String(), "private customer details")
			stats := ticketRequest(t, engine, "GET", "/api/admin/tickets/stats", staffToken, nil)
			assert.Equal(t, 200, stats.Code)
			assert.Contains(t, stats.Body.String(), `"pending":1`)
			assert.Contains(t, stats.Body.String(), `"all":1`)
			assert.Contains(t, stats.Body.String(), `"unread":1`)
			assert.Equal(t, 403, ticketRequest(t, engine, "GET", "/api/admin/tickets/stats", ownerToken, nil).Code)
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", adminPath+"/read", staffToken, map[string]any{"version": staffDetail.Data.Ticket.Version}).Code)
			stats = ticketRequest(t, engine, "GET", "/api/admin/tickets/stats", staffToken, nil)
			assert.Contains(t, stats.Body.String(), `"unread":0`)
			response = ticketRequest(t, engine, "GET", "/api/admin/tickets?unread=true", staffToken, nil)
			assert.NotContains(t, response.Body.String(), "private customer details")
			attachment := detail.Data.Messages[0].Attachments[0].ID
			screenshotPath := fmt.Sprintf("%s/attachments/%d", path, attachment)
			response = ticketRequest(t, engine, "GET", screenshotPath, ownerToken, nil)
			assert.Equal(t, 200, response.Code)
			assert.Equal(t, screenshot.Bytes(), response.Body.Bytes())
			var stored model.TicketAttachment
			require.NoError(t, db.First(&stored, attachment).Error)
			assert.Empty(t, stored.Data)
			assert.EqualValues(t, screenshot.Len(), stored.Size)
			assert.Greater(t, stored.ExpiresAt, time.Now().Unix())
			assert.True(t, strings.HasPrefix(stored.ObjectKey, "tickets/"+time.Unix(stored.CreatedAt, 0).UTC().Format("2006/01/02")+"/"))
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Count(&total).Error)
			assert.EqualValues(t, 1, total, "duplicate/conflicting requests must discard their uploads")
			assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
			assert.Equal(t, 404, ticketRequest(t, engine, "GET", screenshotPath, otherToken, nil).Code)
			response = ticketRequest(t, engine, "POST", adminPath+"/notes", staffToken, map[string]any{"content": "internal secret", "request_key": "note-1", "screenshots": []any{map[string]any{"name": "internal.png", "data": base64.StdEncoding.EncodeToString(screenshot.Bytes())}}})
			require.Equal(t, 200, response.Code, response.Body.String())
			response = ticketRequest(t, engine, "GET", path, ownerToken, nil)
			assert.NotContains(t, response.Body.String(), "internal secret")
			assert.Equal(t, 409, ticketRequest(t, engine, "POST", adminPath+"/messages", staffToken, map[string]any{"content": "internal secret", "request_key": "note-1", "screenshots": []any{map[string]any{"name": "internal.png", "data": base64.StdEncoding.EncodeToString(screenshot.Bytes())}}}).Code)
			var noteAttachment model.TicketAttachment
			require.NoError(t, db.Where("name = ?", "internal.png").First(&noteAttachment).Error)
			assert.Equal(t, 404, ticketRequest(t, engine, "GET", fmt.Sprintf("%s/attachments/%d", path, noteAttachment.ID), ownerToken, nil).Code)
			response = ticketRequest(t, engine, "POST", adminPath+"/messages", staffToken, map[string]any{"content": "Please provide a request id", "request_key": "reply-1", "resolve": true})
			require.Equal(t, 200, response.Code, response.Body.String())
			response = ticketRequest(t, engine, "GET", path, ownerToken, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &detail))
			assert.Equal(t, "resolved", detail.Data.Ticket.Status)
			require.Len(t, detail.Data.Events, 1)
			assert.Equal(t, "pending", detail.Data.Events[0].FromStatus)
			count, err := model.TicketUnreadCount(model.TicketActor{UserID: owner.Id})
			require.NoError(t, err)
			assert.EqualValues(t, 1, count)
			assert.Equal(t, 400, ticketRequest(t, engine, "POST", path+"/read", ownerToken, map[string]any{"version": 999}).Code)
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", path+"/read", ownerToken, map[string]any{"version": detail.Data.Ticket.Version}).Code)
			count, err = model.TicketUnreadCount(model.TicketActor{UserID: owner.Id})
			require.NoError(t, err)
			assert.Zero(t, count)
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", path+"/messages", ownerToken, map[string]any{"content": "Still failing", "request_key": "reply-2"}).Code)
			response = ticketRequest(t, engine, "GET", path, ownerToken, nil)
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &detail))
			assert.Equal(t, "pending", detail.Data.Ticket.Status)
			assert.Equal(t, 409, ticketRequest(t, engine, "PATCH", adminPath, staffToken, map[string]any{"status": "waiting", "version": 1}).Code)
			assert.Equal(t, 400, ticketRequest(t, engine, "PATCH", path, ownerToken, map[string]any{"status": "processing", "version": detail.Data.Ticket.Version}).Code)
			assert.Equal(t, 200, ticketRequest(t, engine, "PATCH", adminPath, staffToken, map[string]any{"status": "waiting", "version": detail.Data.Ticket.Version, "assignee_id": staff.Id}).Code)
			response = ticketRequest(t, engine, "POST", path+"/messages", ownerToken, map[string]any{"content": "request-123", "request_key": "reply-3"})
			assert.Equal(t, 200, response.Code)
			tickets, _, err := model.ListTickets(model.TicketActor{UserID: owner.Id}, model.TicketFilter{Limit: 20})
			require.NoError(t, err)
			require.Len(t, tickets, 1)
			assert.Equal(t, "pending", tickets[0].Status)
			assert.True(t, tickets[0].Unread)
			assert.Equal(t, 200, ticketRequest(t, engine, "PATCH", path, ownerToken, map[string]any{"status": "closed", "version": tickets[0].Version}).Code)
			require.NoError(t, db.Model(&model.Ticket{}).Where("id = ?", id).Update("closed_at", time.Now().Add(-200*24*time.Hour).Unix()).Error)
			deleted, err := model.DeleteClosedTickets(time.Now().Add(-180 * 24 * time.Hour).Unix())
			require.NoError(t, err)
			assert.Equal(t, 1, deleted)
			for _, entity := range []any{&model.Ticket{}, &model.TicketMessage{}, &model.TicketAttachment{}, &model.TicketEvent{}, &model.TicketRead{}} {
				require.NoError(t, db.Model(entity).Count(&total).Error)
				assert.Zero(t, total)
			}
			var audits []model.AuditLog
			require.NoError(t, db.Find(&audits).Error)
			require.NotEmpty(t, audits)
			for _, audit := range audits {
				encoded, err := common.Marshal(audit)
				require.NoError(t, err)
				assert.NotContains(t, string(encoded), "internal secret")
				assert.NotContains(t, string(encoded), "private customer details")
				assert.NotContains(t, string(encoded), "Please provide")
			}
			common.OptionMapRWMutex.Lock()
			common.OptionMap["SupportTicketsEnabled"] = "false"
			common.OptionMapRWMutex.Unlock()
			assert.Equal(t, 403, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body).Code)
			common.OptionMapRWMutex.Lock()
			common.OptionMap["SupportTicketsEnabled"] = "true"
			common.OptionMapRWMutex.Unlock()
			closed := &model.Ticket{UserID: owner.Id, Title: "Closed ticket", Category: "other", CreateKey: "closed", CreateHash: "hash"}
			require.NoError(t, model.CreateTicket(closed, &model.TicketMessage{Content: "Closed", RequestKey: "closed", RequestHash: "hash"}))
			require.NoError(t, model.ChangeTicket(model.TicketActor{UserID: owner.Id}, closed.ID, 1, "closed", nil))
			for i := range 10 {
				require.NoError(t, model.CreateTicket(&model.Ticket{UserID: owner.Id, Title: "Open ticket", Category: "other", CreateKey: fmt.Sprintf("open-%d", i), CreateHash: "hash"}, &model.TicketMessage{Content: "Open", RequestKey: "open", RequestHash: "hash"}))
			}
			closedPath := fmt.Sprintf("/api/tickets/%d", closed.ID)
			assert.Equal(t, 400, ticketRequest(t, engine, "PATCH", closedPath, ownerToken, map[string]any{"status": "pending", "version": 2}).Code)
			assert.Equal(t, 400, ticketRequest(t, engine, "POST", closedPath+"/messages", ownerToken, map[string]any{"content": "Reopen", "request_key": "reopen"}).Code)
			assert.Equal(t, 400, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, map[string]any{"title": "Too many", "category": "other", "content": "New", "request_key": "too-many"}).Code)
			var unchanged model.Ticket
			require.NoError(t, db.First(&unchanged, closed.ID).Error)
			assert.Equal(t, "closed", unchanged.Status)
			var closedMessages int64
			require.NoError(t, db.Model(&model.TicketMessage{}).Where("ticket_id = ?", closed.ID).Count(&closedMessages).Error)
			assert.EqualValues(t, 1, closedMessages)
			var active model.Ticket
			require.NoError(t, db.Where("user_id = ? AND status = ?", owner.Id, "pending").First(&active).Error)
			require.NoError(t, model.ChangeTicket(model.TicketActor{UserID: staff.Id, Staff: true}, active.ID, active.Version, "resolved", nil))
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", closedPath+"/messages", ownerToken, map[string]any{"content": "Reopen", "request_key": "reopen"}).Code)

			require.NoError(t, authz.SetUserPermissions(staff.Id, authz.PermissionsMap{"ticket": {"read": true, "write": false, "operate": false}}))
			assert.Equal(t, 200, ticketRequest(t, engine, "GET", "/api/admin/tickets", staffToken, nil).Code)
			staffPath := fmt.Sprintf("/api/admin/tickets/%d", closed.ID)
			for _, suffix := range []string{"/messages", "/notes"} {
				assert.Equal(t, 403, ticketRequest(t, engine, "POST", staffPath+suffix, staffToken, map[string]any{"content": "Denied", "request_key": "denied"}).Code)
			}
			assert.Equal(t, 403, ticketRequest(t, engine, "PATCH", staffPath, staffToken, map[string]any{"status": "closed", "version": 3}).Code)
			assert.Equal(t, 403, ticketRequest(t, engine, "POST", "/api/admin/tickets/cleanup", staffToken, map[string]any{"days": 180}).Code)
			require.NoError(t, authz.SetUserPermissions(staff.Id, authz.PermissionsMap{"ticket": {"read": true, "write": true, "operate": false}}))
			assert.Equal(t, 400, ticketRequest(t, engine, "POST", staffPath+"/messages", staffToken, map[string]any{"content": "Cannot resolve", "request_key": "cannot-resolve", "resolve": true}).Code)
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", staffPath+"/messages", staffToken, map[string]any{"content": "Can reply", "request_key": "can-reply"}).Code)

			suffix, err := common.GenerateRandomCharsKey(43)
			require.NoError(t, err)
			patRaw := model.AccessTokenPrefix + suffix
			pat := &model.UserAccessToken{Name: "Ticket isolation", TokenHash: model.AccessTokenFingerprint(patRaw), TokenHint: model.AccessTokenHint(patRaw), ExpiresAt: time.Now().Add(time.Hour).Unix()}
			require.NoError(t, pat.SetScopes([]string{"profile:read"}))
			require.NoError(t, model.CreateUserAccessToken(staff.Id, pat, service.AccessTokenMaxPerUser))
			assert.Equal(t, 403, ticketRequest(t, engine, "GET", "/api/tickets", patRaw, nil).Code)
			assert.Equal(t, 403, ticketRequest(t, engine, "GET", "/api/admin/tickets", patRaw, nil).Code)
			identity, err := service.ParseAccessToken(ownerToken)
			require.NoError(t, err)
			_, err = model.RevokeUserSession(owner.Id, identity.SessionID, "ticket regression")
			require.NoError(t, err)
			assert.Equal(t, 401, ticketRequest(t, engine, "GET", closedPath, ownerToken, nil).Code)
			expiredSID := common.GetUUID()
			require.NoError(t, db.Create(&model.UserSession{SID: expiredSID, UserID: owner.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "expired-" + expiredSID, LoginMethod: "password", ExpiresAt: time.Now().Add(-time.Minute).Unix()}).Error)
			expiredJWT, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: owner.Id, SessionID: expiredSID, UserAuthVersion: 1, SessionVersion: 1})
			require.NoError(t, err)
			assert.Equal(t, 401, ticketRequest(t, engine, "GET", "/api/tickets", expiredJWT, nil).Code)
		})
	}
}

func TestTicketValidationRejectsOversizeAndInvalidScreenshots(t *testing.T) {
	db := ticketDatabase(t, "sqlite")
	ticketObjectStorage(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.Log{}, &model.AuditLog{}))
	require.NoError(t, model.MigrateTickets(db))
	require.NoError(t, authz.Init(db))
	owner := &model.User{Username: "validation", Password: "placeholder", AffCode: "validation", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, db.Create(owner).Error)
	token := ticketSession(t, owner)
	engine := gin.New()
	router.SetApiRouter(engine)
	for _, body := range []map[string]any{
		{"title": strings.Repeat("界", 161), "category": "api", "content": "valid", "request_key": "length"},
		{"title": "valid", "category": "invalid", "content": "valid", "request_key": "category"},
		{"title": "valid", "category": "api", "content": "valid", "request_key": "image", "screenshots": []any{map[string]any{"name": "image.png", "data": base64.StdEncoding.EncodeToString([]byte("not an image"))}}},
	} {
		assert.Equal(t, 400, ticketRequest(t, engine, "POST", "/api/tickets", token, body).Code)
	}
}

func TestTicketR2ExpiryFailuresAndSettings(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			storage := ticketObjectStorage(t)
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.CasbinRule{}, &model.AuthzRole{}, &model.Log{}, &model.AuditLog{}))
			require.NoError(t, model.MigrateTickets(db))
			require.NoError(t, authz.Init(db))
			owner := &model.User{Username: "r2-owner", Password: "placeholder", AffCode: "r2-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			root := &model.User{Username: "r2-root", Password: "placeholder", AffCode: "r2-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			admin := &model.User{Username: "r2-admin", Password: "placeholder", AffCode: "r2-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			for _, user := range []*model.User{owner, root, admin} {
				require.NoError(t, db.Create(user).Error)
			}
			ownerToken, rootToken, adminToken := ticketSession(t, owner), ticketSession(t, root), ticketSession(t, admin)
			engine := gin.New()
			router.SetApiRouter(engine)
			config := model.TicketStorageConfig()
			settingsPath := "/api/admin/tickets/storage"
			for _, token := range []string{ownerToken, adminToken} {
				assert.Equal(t, 403, ticketRequest(t, engine, "GET", settingsPath, token, nil).Code)
				assert.Equal(t, 403, ticketRequest(t, engine, "PUT", settingsPath, token, config).Code)
			}
			response := ticketRequest(t, engine, "GET", settingsPath, rootToken, nil)
			assert.NotContains(t, response.Body.String(), "test-access")
			assert.NotContains(t, response.Body.String(), "test-secret")
			assert.NotContains(t, ticketRequest(t, engine, "GET", "/api/option/", rootToken, nil).Body.String(), system_setting.TicketStorageOption)
			preview := ticketRequest(t, engine, "POST", "/api/option/email_templates/preview", rootToken, map[string]any{"key": "ticket", "subject": "Preview {{.TicketID}}", "body": "<p>{{.User}}</p>"})
			assert.Equal(t, 200, preview.Code)
			assert.Contains(t, preview.Body.String(), "Preview 12")
			assert.Contains(t, preview.Body.String(), "alice")
			assert.Equal(t, 403, ticketRequest(t, engine, "POST", "/api/option/email_templates/preview", ownerToken, map[string]any{"key": "ticket", "subject": "", "body": ""}).Code)
			assert.NotContains(t, ticketRequest(t, engine, "GET", "/api/status", "", nil).Body.String(), "test-secret")
			for _, bad := range []system_setting.TicketStorageConfig{
				{Enabled: true, RetentionDays: 30},
				{RetentionDays: 0},
				{RetentionDays: 366},
				{RetentionDays: 30, Endpoint: "https://attacker.invalid"},
				{RetentionDays: 30, Endpoint: "http://127.0.0.1"},
				{RetentionDays: 30, NotifyEmail: "not-an-email"},
				{RetentionDays: 30, NotifyEmail: " owner@example.com"},
			} {
				assert.Equal(t, 400, ticketRequest(t, engine, "PUT", settingsPath, rootToken, bad).Code)
			}
			config.Enabled = false
			config.AccessKey, config.SecretKey = "", ""
			config.NotifyEmail = "owner@example.com;second@example.com"
			assert.Equal(t, 200, ticketRequest(t, engine, "PUT", settingsPath, rootToken, config).Code)
			assert.Equal(t, "test-secret", model.TicketStorageConfig().SecretKey, "blank credentials retain the configured pair")
			assert.Equal(t, "owner@example.com;second@example.com", model.TicketStorageConfig().NotifyEmail)
			assert.Contains(t, ticketRequest(t, engine, "GET", settingsPath, rootToken, nil).Body.String(), "owner@example.com")
			var imageData bytes.Buffer
			require.NoError(t, png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 2, 2))))
			body := map[string]any{"title": "R2", "category": "api", "content": "keep text", "request_key": "r2-create", "screenshots": []any{map[string]any{"name": "r2.png", "data": base64.StdEncoding.EncodeToString(imageData.Bytes())}}}
			assert.Equal(t, 403, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body).Code)
			config.Enabled = true
			assert.Equal(t, 200, ticketRequest(t, engine, "PUT", settingsPath, rootToken, config).Code)
			storage.failPut = true
			assert.Equal(t, 500, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body).Code)
			var count int64
			require.NoError(t, db.Model(&model.Ticket{}).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Count(&count).Error)
			assert.Zero(t, count)
			storage.failPut = false
			assert.Equal(t, 200, ticketRequest(t, engine, "POST", "/api/tickets", ownerToken, body).Code)
			var attachment model.TicketAttachment
			require.NoError(t, db.First(&attachment).Error)
			assert.Empty(t, attachment.Data)
			path := fmt.Sprintf("/api/tickets/%d/attachments/%d", attachment.TicketID, attachment.ID)
			config.RetentionDays = 1
			assert.Equal(t, 200, ticketRequest(t, engine, "PUT", settingsPath, rootToken, config).Code)
			require.NoError(t, db.First(&attachment, attachment.ID).Error)
			assert.Greater(t, attachment.ExpiresAt, time.Now().Add(29*24*time.Hour).Unix())
			changed := config
			changed.Bucket = "another-bucket"
			assert.Equal(t, 400, ticketRequest(t, engine, "PUT", settingsPath, rootToken, changed).Code)
			config.Enabled = false
			assert.Equal(t, 200, ticketRequest(t, engine, "PUT", settingsPath, rootToken, config).Code)
			assert.Equal(t, 200, ticketRequest(t, engine, "GET", path, ownerToken, nil).Code, "disabling uploads must not hide valid existing images")
			now := time.Now().Unix()
			require.NoError(t, db.Model(&attachment).Update("expires_at", now).Error)
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Where("object_key = ?", attachment.ObjectKey).Update("expires_at", now).Error)
			assert.Equal(t, 410, ticketRequest(t, engine, "GET", path, ownerToken, nil).Code)
			storage.failDelete = true
			assert.Error(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			storage.failDelete = false
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Count(&count).Error)
			assert.Zero(t, count)
			assert.Empty(t, storage.objects)
			assert.Equal(t, 410, ticketRequest(t, engine, "GET", path, ownerToken, nil).Code)
			assert.Contains(t, ticketRequest(t, engine, "GET", fmt.Sprintf("/api/tickets/%d", attachment.TicketID), ownerToken, nil).Body.String(), "keep text")
			// A crash after PUT but before ticket creation remains tracked and is
			// removed as an orphan once the one-hour grace period has passed.
			config.Enabled = true
			assert.Equal(t, 200, ticketRequest(t, engine, "PUT", settingsPath, rootToken, config).Code)
			message := &model.TicketMessage{Attachments: []model.TicketAttachment{{Name: "orphan.png", ContentType: "image/png", Data: imageData.Bytes()}}}
			objects, err := service.PersistTicketImages(t.Context(), message)
			require.NoError(t, err)
			require.Len(t, objects, 1)
			require.NoError(t, db.Model(&objects[0]).Update("created_at", now-3601).Error)
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			assert.Empty(t, storage.objects)
			var audits []model.AuditLog
			require.NoError(t, db.Find(&audits).Error)
			encoded, err := common.Marshal(audits)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "test-secret")
			assert.NotContains(t, string(encoded), "test-access")
		})
	}
}

type ticketLegacyAttachment struct {
	ID          int    `gorm:"primaryKey"`
	TicketID    int    `gorm:"not null;index"`
	MessageID   int    `gorm:"not null;index"`
	Name        string `gorm:"type:varchar(160);not null"`
	ContentType string `gorm:"type:varchar(32);not null"`
	Data        []byte
}

func (ticketLegacyAttachment) TableName() string { return "ticket_attachments" }

func TestTicketLegacyImageMigration(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			storage := ticketObjectStorage(t)
			require.NoError(t, db.AutoMigrate(&ticketLegacyAttachment{}))
			legacy := ticketLegacyAttachment{TicketID: 1, MessageID: 1, Name: "legacy.png", ContentType: "image/png", Data: []byte("legacy-private-image")}
			require.NoError(t, db.Create(&legacy).Error)
			require.NoError(t, model.MigrateTickets(db))
			var attachment model.TicketAttachment
			require.NoError(t, db.First(&attachment, legacy.ID).Error)
			expiresAt := attachment.ExpiresAt
			assert.Greater(t, expiresAt, time.Now().Unix())
			assert.Equal(t, legacy.Data, attachment.Data)
			require.NoError(t, model.MigrateTickets(db))
			require.NoError(t, db.First(&attachment, legacy.ID).Error)
			assert.Equal(t, expiresAt, attachment.ExpiresAt, "restart must not extend image lifetime")
			storage.corruptGet = true
			assert.Error(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, db.First(&attachment, legacy.ID).Error)
			assert.Equal(t, legacy.Data, attachment.Data, "failed verification must preserve old bytes")
			storage.corruptGet = false
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, db.First(&attachment, legacy.ID).Error)
			assert.Empty(t, attachment.Data)
			data, err := service.ReadTicketImage(t.Context(), &attachment)
			require.NoError(t, err)
			assert.Equal(t, legacy.Data, data)
			assert.Equal(t, expiresAt, attachment.ExpiresAt)
			require.NoError(t, db.Model(&model.TicketStoredObject{}).Where("id > ?", 0).Update("created_at", time.Now().Unix()-3601).Error)
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			assert.Len(t, storage.objects, 1, "failed migration upload is cleaned up, verified object stays")
			attachment.Data = []byte("expired-legacy")
			attachment.ExpiresAt = time.Now().Unix()
			require.NoError(t, db.Save(&attachment).Error)
			require.NoError(t, service.CleanupTicketImages(t.Context()))
			require.NoError(t, db.First(&attachment, legacy.ID).Error)
			assert.Empty(t, attachment.Data)
			_, err = service.ReadTicketImage(t.Context(), &attachment)
			assert.ErrorIs(t, err, service.ErrTicketImageExpired)
		})
	}
}

// Representative user schema copied from the latest release v1.0.0-rc.44.
type ticketReleasedUser struct {
	Id                   int                        `json:"id"`
	Username             string                     `json:"username" gorm:"unique;index" validate:"max=20"`
	Password             string                     `json:"password" gorm:"not null;" validate:"min=8,max=128"`
	HasPassword          bool                       `json:"-" gorm:"-:all"`
	OriginalPassword     string                     `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName          string                     `json:"display_name" gorm:"index" validate:"max=20"`
	Role                 int                        `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status               int                        `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email                string                     `json:"email" gorm:"index" validate:"max=50"`
	GitHubId             string                     `json:"github_id" gorm:"column:github_id;index"`
	DiscordId            string                     `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId               string                     `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId             string                     `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId           string                     `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode     string                     `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken          *string                    `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // Deprecated: 旧版面板访问令牌，仅在升级后的过渡期内使用；删除 users.access_token 列时一并移除。
	AccessTokenCreatedAt *int64                     `json:"-" gorm:"type:bigint;column:access_token_created_at"`    // Deprecated: 旧版面板访问令牌，仅在升级后的过渡期内使用；删除 users.access_token 列时一并移除。
	Quota                int                        `json:"quota" gorm:"type:int;default:0"`
	UsedQuota            int                        `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount         int                        `json:"request_count" gorm:"type:int;default:0;"`               // request number
	Group                string                     `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode              string                     `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount             int                        `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota             int                        `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota      int                        `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId            int                        `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	DeletedAt            gorm.DeletedAt             `gorm:"index"`
	LinuxDOId            string                     `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	Setting              string                     `json:"setting" gorm:"type:text;column:setting"`
	Remark               string                     `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer       string                     `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	CreatedAt            int64                      `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	LastLoginAt          int64                      `json:"last_login_at" gorm:"default:0;column:last_login_at"`
	AuthVersion          int64                      `json:"-" gorm:"type:bigint;not null;default:1;column:auth_version"`
	AdminPermissions     map[string]map[string]bool `json:"admin_permissions,omitempty" gorm:"-:all"`
}

func (ticketReleasedUser) TableName() string { return "users" }

func TestTicketUpgradeFromLatestRelease(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			require.NoError(t, db.AutoMigrate(&ticketReleasedUser{}, &model.Option{}))
			user := ticketReleasedUser{Username: "released-owner", Password: "unchanged-hash", Email: "owner@example.test", AffCode: "released", Role: 1, Status: 1, Quota: 12345}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, db.Create(&model.Option{Key: "SystemName", Value: "New API"}).Error)
			indexes, err := db.Migrator().GetIndexes(&ticketReleasedUser{})
			require.NoError(t, err)
			require.NoError(t, model.MigrateTickets(db))
			require.NoError(t, model.MigrateTickets(db))
			after, err := db.Migrator().GetIndexes(&ticketReleasedUser{})
			require.NoError(t, err)
			assert.Len(t, after, len(indexes))
			var stored ticketReleasedUser
			require.NoError(t, db.First(&stored, user.Id).Error)
			assert.Equal(t, user, stored)
			duplicate := ticketReleasedUser{Username: user.Username, Password: "placeholder", AffCode: "different"}
			assert.Error(t, db.Create(&duplicate).Error)
			ticket := &model.Ticket{UserID: user.Id, CreateKey: "upgrade", CreateHash: "hash", Title: "Upgrade", Category: "other"}
			message := &model.TicketMessage{Content: "Existing account can submit", RequestKey: "upgrade", RequestHash: "hash"}
			require.NoError(t, model.CreateTicket(ticket, message))
			require.NoError(t, model.MigrateTickets(db))
			detail, err := model.GetTicketDetail(ticket.ID, model.TicketActor{UserID: user.Id}, 0)
			require.NoError(t, err)
			assert.Equal(t, message.Content, detail.Messages[0].Content)
			var option model.Option
			require.NoError(t, db.Where(&model.Option{Key: "SystemName"}).First(&option).Error)
			assert.Equal(t, "New API", option.Value)
		})
	}
}

func TestTicketConcurrentReopenCapacity(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := ticketDatabase(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.User{}))
			require.NoError(t, model.MigrateTickets(db))
			owner := &model.User{Username: "capacity", Password: "placeholder", AffCode: "capacity"}
			require.NoError(t, db.Create(owner).Error)
			actor := model.TicketActor{UserID: owner.Id}
			closed := make([]*model.Ticket, 2)
			for i := range 11 {
				ticket := &model.Ticket{UserID: owner.Id, Title: "Capacity", Category: "other", CreateKey: fmt.Sprintf("capacity-%d", i), CreateHash: "hash"}
				require.NoError(t, model.CreateTicket(ticket, &model.TicketMessage{Content: "Capacity", RequestKey: "initial", RequestHash: "hash"}))
				if i < 2 {
					require.NoError(t, model.ChangeTicket(actor, ticket.ID, 1, "closed", nil))
					closed[i] = ticket
				}
			}
			if dialect != "sqlite" {
				sqlDB, err := db.DB()
				require.NoError(t, err)
				sqlDB.SetMaxOpenConns(4)
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			var workers sync.WaitGroup
			for _, ticket := range closed {
				workers.Go(func() {
					<-start
					results <- model.ReplyTicket(actor, &model.TicketMessage{TicketID: ticket.ID, Content: "Reopen", SenderType: "user", RequestKey: "reopen", RequestHash: "hash"}, false)
				})
			}
			close(start)
			workers.Wait()
			close(results)
			succeeded, rejected := 0, 0
			for err := range results {
				if err == nil {
					succeeded++
				} else {
					require.ErrorIs(t, err, model.ErrTicketLimit)
					rejected++
				}
			}
			assert.Equal(t, 1, succeeded)
			assert.Equal(t, 1, rejected)
			var open int64
			require.NoError(t, db.Model(&model.Ticket{}).Where("user_id = ? AND status = ?", owner.Id, "pending").Count(&open).Error)
			assert.EqualValues(t, 10, open)
		})
	}
}
