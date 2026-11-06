package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestInviteCodeRegistrationCreatesClaimAndAppliesAward(t *testing.T) {
	require.NoError(t, i18n.Init())
	forEachInviteCodeTestDatabase(t, func(t *testing.T, dialect string, db *gorm.DB) {
		originalGroupRatios := ratio_setting.GroupRatio2JSONString()
		t.Cleanup(func() {
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatios))
		})
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"campaign":1}`))
		require.NoError(t, db.AutoMigrate(&model.InviteCode{}, &model.InviteCodeClaim{}, &model.Token{}, &model.Log{}))

		inviter := model.User{
			Username: "campaign-inviter",
			Password: "password123",
			Email:    "campaign-inviter@example.test",
			Role:     common.RoleCommonUser,
			Status:   common.UserStatusEnabled,
			Group:    "default",
			AffCode:  "campaign-inviter-aff",
		}
		require.NoError(t, db.Create(&inviter).Error)
		code := model.InviteCode{
			Name:              "Magpie",
			Code:              "magpie",
			Enabled:           true,
			GroupName:         "campaign",
			InviterId:         inviter.Id,
			RegistrationLimit: 10,
			BonusQuota:        250,
		}
		require.NoError(t, db.Create(&code).Error)

		previousRegisterEnabled := common.RegisterEnabled
		previousPasswordRegisterEnabled := common.PasswordRegisterEnabled
		previousEmailVerificationEnabled := common.EmailVerificationEnabled
		previousNewUserQuota := common.QuotaForNewUser
		previousInviteeQuota := common.QuotaForInvitee
		previousInviterQuota := common.QuotaForInviter
		previousGenerateDefaultToken := constant.GenerateDefaultToken
		t.Cleanup(func() {
			common.RegisterEnabled = previousRegisterEnabled
			common.PasswordRegisterEnabled = previousPasswordRegisterEnabled
			common.EmailVerificationEnabled = previousEmailVerificationEnabled
			common.QuotaForNewUser = previousNewUserQuota
			common.QuotaForInvitee = previousInviteeQuota
			common.QuotaForInviter = previousInviterQuota
			constant.GenerateDefaultToken = previousGenerateDefaultToken
		})
		common.RegisterEnabled = true
		common.PasswordRegisterEnabled = true
		common.EmailVerificationEnabled = false
		common.QuotaForNewUser = 0
		common.QuotaForInvitee = 0
		common.QuotaForInviter = 0
		constant.GenerateDefaultToken = true

		body := `{"username":"magpie-user","password":"password123","invite_code":"MAGPIE"}`
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/user/register", strings.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")

		Register(context)

		var response struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success, "%s: %s", dialect, response.Message)

		var user model.User
		require.NoError(t, db.Where("username = ?", "magpie-user").First(&user).Error)
		assert.Equal(t, "campaign", user.Group)
		assert.Equal(t, inviter.Id, user.InviterId)
		assert.Equal(t, 250, user.BonusQuota)
		assert.Equal(t, 250, user.Quota)
		var token model.Token
		require.NoError(t, db.Where("user_id = ?", user.Id).First(&token).Error)
		assert.Equal(t, "campaign", token.Group)

		var storedCode model.InviteCode
		require.NoError(t, db.First(&storedCode, code.Id).Error)
		assert.EqualValues(t, 1, storedCode.RegisteredCount)

		claims, total, err := model.GetInviteCodeClaims(code.Id, 0, 20)
		require.NoError(t, err)
		require.Len(t, claims, 1)
		assert.EqualValues(t, 1, total)
		assert.Equal(t, user.Id, claims[0].UserId)
		assert.Equal(t, "magpie-user", claims[0].Username)
		assert.Equal(t, "campaign", claims[0].GroupName)
		assert.Equal(t, 250, claims[0].BonusQuota)
		assert.Equal(t, inviter.Id, claims[0].InviterId)
	})
}

func TestInviteCodeRegistrationLimitIsAtomic(t *testing.T) {
	forEachInviteCodeTestDatabase(t, func(t *testing.T, dialect string, db *gorm.DB) {
		connection, err := db.DB()
		require.NoError(t, err)
		if dialect == "sqlite" {
			connection.SetMaxOpenConns(1)
		}
		require.NoError(t, db.AutoMigrate(&model.InviteCode{}, &model.InviteCodeClaim{}, &model.Log{}))

		code := model.InviteCode{
			Name:              "LinuxSB",
			Code:              "linuxsb",
			Enabled:           true,
			GroupName:         "default",
			RegistrationLimit: 2,
		}
		require.NoError(t, db.Create(&code).Error)

		previousNewUserQuota := common.QuotaForNewUser
		previousInviteeQuota := common.QuotaForInvitee
		previousInviterQuota := common.QuotaForInviter
		t.Cleanup(func() {
			common.QuotaForNewUser = previousNewUserQuota
			common.QuotaForInvitee = previousInviteeQuota
			common.QuotaForInviter = previousInviterQuota
		})
		common.QuotaForNewUser = 0
		common.QuotaForInvitee = 0
		common.QuotaForInviter = 0

		const attempts = 8
		results := make(chan error, attempts)
		var waitGroup sync.WaitGroup
		for index := range attempts {
			waitGroup.Go(func() {
				user := model.User{
					Username: fmt.Sprintf("linuxsb-user-%d", index),
					Password: "password123",
					Role:     common.RoleCommonUser,
					Status:   common.UserStatusEnabled,
				}
				_, err := user.InsertWithInviteCode(code.Code)
				results <- err
			})
		}
		waitGroup.Wait()
		close(results)

		successes := 0
		limitRejections := 0
		for err := range results {
			if err == nil {
				successes++
				continue
			}
			if assert.ErrorIs(t, err, model.ErrInviteCodeLimitReached) {
				limitRejections++
			}
		}
		assert.Equal(t, 2, successes)
		assert.Equal(t, attempts-2, limitRejections)

		var storedCode model.InviteCode
		require.NoError(t, db.First(&storedCode, code.Id).Error)
		assert.EqualValues(t, 2, storedCode.RegisteredCount)
		var claimCount int64
		require.NoError(t, db.Model(&model.InviteCodeClaim{}).Where("invite_code_id = ?", code.Id).Count(&claimCount).Error)
		assert.EqualValues(t, 2, claimCount)
	})
}

func TestInviteCodeRegistrationRollsBackCapacityWhenUserCreationFails(t *testing.T) {
	forEachInviteCodeTestDatabase(t, func(t *testing.T, dialect string, db *gorm.DB) {
		require.NoError(t, db.AutoMigrate(&model.User{}, &model.InviteCode{}, &model.InviteCodeClaim{}))

		existing := model.User{
			Username: "existing-user",
			Password: "password123",
			Role:     common.RoleCommonUser,
			Status:   common.UserStatusEnabled,
			AffCode:  "existing-user-aff",
		}
		require.NoError(t, db.Create(&existing).Error)
		code := model.InviteCode{
			Name:              "Rollback",
			Code:              "rollback",
			Enabled:           true,
			GroupName:         "default",
			RegistrationLimit: 2,
		}
		require.NoError(t, db.Create(&code).Error)

		user := model.User{Username: existing.Username, Password: "password123"}
		_, err := user.InsertWithInviteCode(code.Code)
		require.Error(t, err, dialect)

		var storedCode model.InviteCode
		require.NoError(t, db.First(&storedCode, code.Id).Error)
		assert.Zero(t, storedCode.RegisteredCount)
		var claimCount int64
		require.NoError(t, db.Model(&model.InviteCodeClaim{}).Where("invite_code_id = ?", code.Id).Count(&claimCount).Error)
		assert.Zero(t, claimCount)
	})
}

func TestInviteCodeRegistrationRejectsUnavailableCodes(t *testing.T) {
	forEachInviteCodeTestDatabase(t, func(t *testing.T, _ string, db *gorm.DB) {
		require.NoError(t, db.AutoMigrate(&model.User{}, &model.InviteCode{}, &model.InviteCodeClaim{}))
		now := time.Now()
		tests := []struct {
			name          string
			code          model.InviteCode
			wantError     error
			expectedCount int64
		}{
			{
				name:      "missing",
				code:      model.InviteCode{Code: "missing"},
				wantError: model.ErrInviteCodeInvalid,
			},
			{
				name: "disabled",
				code: model.InviteCode{
					Name: "Disabled", Code: "disabled", GroupName: "default", RegistrationLimit: 10,
				},
				wantError: model.ErrInviteCodeDisabled,
			},
			{
				name: "expired",
				code: model.InviteCode{
					Name: "Expired", Code: "expired", Enabled: true, GroupName: "default",
					RegistrationLimit: 10, ExpiresAt: now.Add(-time.Minute).Unix(),
				},
				wantError: model.ErrInviteCodeExpired,
			},
			{
				name: "full",
				code: model.InviteCode{
					Name: "Full", Code: "full", Enabled: true, GroupName: "default",
					RegistrationLimit: 1, RegisteredCount: 1,
				},
				wantError:     model.ErrInviteCodeLimitReached,
				expectedCount: 1,
			},
		}

		for index, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				if test.name != "missing" {
					require.NoError(t, db.Create(&test.code).Error)
				}
				user := model.User{
					Username: fmt.Sprintf("unavailable-%s-%d", test.name, index),
					Password: "password123",
				}
				_, err := user.InsertWithInviteCode(test.code.Code)
				assert.ErrorIs(t, err, test.wantError)
				if test.code.Id > 0 {
					var stored model.InviteCode
					require.NoError(t, db.First(&stored, test.code.Id).Error)
					assert.Equal(t, test.expectedCount, stored.RegisteredCount)
				}
			})
		}
	})
}

func TestOAuthRegistrationAppliesInviteCode(t *testing.T) {
	setupAuthFlowControllerTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.InviteCode{}, &model.InviteCodeClaim{}, &model.Log{}))

	inviter := model.User{
		Username: "oauth-campaign-inviter",
		Password: "password123",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
		AffCode:  "oauth-campaign-aff",
	}
	require.NoError(t, model.DB.Create(&inviter).Error)
	code := model.InviteCode{
		Name:              "Magpie OAuth",
		Code:              "magpie-oauth",
		Enabled:           true,
		GroupName:         "campaign",
		InviterId:         inviter.Id,
		RegistrationLimit: 1,
		BonusQuota:        80,
	}
	require.NoError(t, model.DB.Create(&code).Error)

	previousRegisterEnabled := common.RegisterEnabled
	previousNewUserQuota := common.QuotaForNewUser
	previousInviteeQuota := common.QuotaForInvitee
	previousInviterQuota := common.QuotaForInviter
	t.Cleanup(func() {
		common.RegisterEnabled = previousRegisterEnabled
		common.QuotaForNewUser = previousNewUserQuota
		common.QuotaForInvitee = previousInviteeQuota
		common.QuotaForInviter = previousInviterQuota
	})
	common.RegisterEnabled = true
	common.QuotaForNewUser = 0
	common.QuotaForInvitee = 0
	common.QuotaForInviter = 0

	provider := &authFlowTestOAuthProvider{}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/oauth/auth-flow-test?state=test", nil)
	user, _, err := findOrCreateOAuthUser(context, provider, &oauth.OAuthUser{
		ProviderUserID: "oauth-campaign-user",
		Username:       "oauth-campaign-user",
		DisplayName:    "OAuth Campaign User",
	}, &oauth.OAuthToken{}, "", code.Code)
	require.NoError(t, err)

	assert.Equal(t, "campaign", user.Group)
	assert.Equal(t, inviter.Id, user.InviterId)
	assert.Equal(t, 80, user.BonusQuota)
	assert.Equal(t, 80, user.Quota)

	var storedCode model.InviteCode
	require.NoError(t, model.DB.First(&storedCode, code.Id).Error)
	assert.EqualValues(t, 1, storedCode.RegisteredCount)
	var claim model.InviteCodeClaim
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).First(&claim).Error)
	assert.Equal(t, code.Id, claim.InviteCodeId)
	assert.Equal(t, inviter.Id, claim.InviterId)
}

func TestInviteCodeRegistrationErrorsExposeStableContracts(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid", err: model.ErrInviteCodeInvalid, wantStatus: http.StatusBadRequest, wantCode: "INVITE_CODE_INVALID"},
		{name: "disabled", err: model.ErrInviteCodeDisabled, wantStatus: http.StatusBadRequest, wantCode: "INVITE_CODE_INVALID"},
		{name: "expired", err: model.ErrInviteCodeExpired, wantStatus: http.StatusBadRequest, wantCode: "INVITE_CODE_EXPIRED"},
		{name: "limit reached", err: model.ErrInviteCodeLimitReached, wantStatus: http.StatusConflict, wantCode: "INVITE_CODE_LIMIT_REACHED"},
		{name: "already claimed", err: model.ErrInviteCodeAlreadyClaimed, wantStatus: http.StatusConflict, wantCode: "INVITE_CODE_ALREADY_CLAIMED"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			writeInviteCodeRegistrationError(context, test.err)

			var response struct {
				Success bool   `json:"success"`
				Code    string `json:"code"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
			assert.Equal(t, test.wantStatus, recorder.Code)
			assert.Equal(t, test.wantCode, response.Code)
		})
	}
}

func TestInviteCodeAdminEndpointManagesCapacity(t *testing.T) {
	forEachInviteCodeTestDatabase(t, func(t *testing.T, _ string, db *gorm.DB) {
		originalGroupRatios := ratio_setting.GroupRatio2JSONString()
		t.Cleanup(func() {
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatios))
		})
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"campaign":1}`))
		require.NoError(t, db.AutoMigrate(&model.InviteCode{}, &model.InviteCodeClaim{}))

		requestBody := `{"name":"Magpie launch","code":"magpie-launch","enabled":true,"group":"campaign","registration_limit":500,"bonus_quota":100}`
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/invite_codes", strings.NewReader(requestBody))
		context.Request.Header.Set("Content-Type", "application/json")

		CreateInviteCode(context)

		var createResponse struct {
			Success bool             `json:"success"`
			Message string           `json:"message"`
			Data    model.InviteCode `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &createResponse))
		require.True(t, createResponse.Success, createResponse.Message)
		assert.Equal(t, "magpie-launch", createResponse.Data.Code)
		assert.EqualValues(t, 500, createResponse.Data.RegistrationLimit)

		recorder = httptest.NewRecorder()
		context, _ = gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/invite_codes/public/magpie-launch", nil)
		context.Params = gin.Params{{Key: "code", Value: "MAGPIE-LAUNCH"}}

		GetPublicInviteCode(context)

		var publicResponse struct {
			Success bool `json:"success"`
			Data    struct {
				Available              bool  `json:"available"`
				RemainingRegistrations int64 `json:"remaining_registrations"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &publicResponse))
		require.True(t, publicResponse.Success)
		assert.True(t, publicResponse.Data.Available)
		assert.EqualValues(t, 500, publicResponse.Data.RemainingRegistrations)

		recorder = httptest.NewRecorder()
		context, _ = gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/invite_codes", strings.NewReader(requestBody))
		context.Request.Header.Set("Content-Type", "application/json")

		CreateInviteCode(context)

		var duplicateResponse struct {
			Success bool   `json:"success"`
			Code    string `json:"code"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &duplicateResponse))
		assert.False(t, duplicateResponse.Success)
		assert.Equal(t, http.StatusConflict, recorder.Code)
		assert.Equal(t, "INVITE_CODE_EXISTS", duplicateResponse.Code)

		updateBody := `{"enabled":false,"registration_limit":1000}`
		recorder = httptest.NewRecorder()
		context, _ = gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/invite_codes/%d", createResponse.Data.Id), strings.NewReader(updateBody))
		context.Request.Header.Set("Content-Type", "application/json")
		context.Params = gin.Params{{Key: "id", Value: fmt.Sprint(createResponse.Data.Id)}}

		UpdateInviteCode(context)

		var updateResponse struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
			Data    struct {
				Enabled                bool  `json:"enabled"`
				RegistrationLimit      int64 `json:"registration_limit"`
				RemainingRegistrations int64 `json:"remaining_registrations"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &updateResponse))
		require.True(t, updateResponse.Success, updateResponse.Message)
		assert.False(t, updateResponse.Data.Enabled)
		assert.EqualValues(t, 1000, updateResponse.Data.RegistrationLimit)
		assert.EqualValues(t, 1000, updateResponse.Data.RemainingRegistrations)

		for range 2 {
			recorder = httptest.NewRecorder()
			context, _ = gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/invite_codes/%d", createResponse.Data.Id), nil)
			context.Params = gin.Params{{Key: "id", Value: fmt.Sprint(createResponse.Data.Id)}}

			DeleteInviteCode(context)

			var deleteResponse struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &deleteResponse))
			assert.True(t, deleteResponse.Success)
			assert.Equal(t, http.StatusOK, recorder.Code)
		}
	})
}

func TestInviteCodeSchemaMigrationPreservesExistingUsers(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := ""
			switch dialect {
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
			}
			db, _ := newAuditTestDatabase(t, dialect, dsn)
			previousDB := model.DB
			previousMainDatabaseType := common.MainDatabaseType()
			previousLogDatabaseType := common.LogDatabaseType()
			model.DB = db
			switch dialect {
			case "mysql":
				common.SetDatabaseTypes(common.DatabaseTypeMySQL, common.DatabaseTypeMySQL)
			case "postgres":
				common.SetDatabaseTypes(common.DatabaseTypePostgreSQL, common.DatabaseTypePostgreSQL)
			default:
				common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
			}
			t.Cleanup(func() {
				model.DB = previousDB
				common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
			})
			var databaseVersion string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&databaseVersion).Error)
			t.Logf("database version: %s", databaseVersion)

			require.NoError(t, db.AutoMigrate(&model.User{}))
			existing := model.User{
				Username: "pre-invite-code-user",
				Password: "password123",
				Role:     common.RoleCommonUser,
				Status:   common.UserStatusEnabled,
				Group:    "default",
				AffCode:  "pre-invite-code-aff",
				Quota:    123,
			}
			require.NoError(t, db.Create(&existing).Error)

			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.InviteCode{}, &model.InviteCodeClaim{}, &model.User{}))
			}

			var stored model.User
			require.NoError(t, db.First(&stored, existing.Id).Error)
			assert.Equal(t, existing.Username, stored.Username)
			assert.Equal(t, existing.AffCode, stored.AffCode)
			assert.Equal(t, existing.Quota, stored.Quota)
			assert.True(t, db.Migrator().HasTable(&model.InviteCode{}))
			assert.True(t, db.Migrator().HasTable(&model.InviteCodeClaim{}))
		})
	}
}

func forEachInviteCodeTestDatabase(t *testing.T, run func(*testing.T, string, *gorm.DB)) {
	t.Helper()
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := ""
			switch dialect {
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
			}
			run(t, dialect, modelManagementDB(t, dialect, dsn))
		})
	}
}
