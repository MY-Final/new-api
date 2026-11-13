package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelShowcaseDatabaseMatrix(t *testing.T) {
	for _, database := range []struct{ kind, env string }{
		{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"},
	} {
		t.Run(database.kind, func(t *testing.T) {
			if database.env != "" && os.Getenv(database.env) == "" {
				t.Skip(database.env + " is not configured")
			}
			if database.kind == "sqlite" {
				t.Setenv("SQL_MAX_OPEN_CONNS", "1")
			}
			db := modelManagementDB(t, database.kind, os.Getenv(database.env))
			groups := ratio_setting.GroupRatio2JSONString()
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"showcase":1}`))
			t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groups)) })
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"showcase-model":1}`))
			require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"showcase-model":1}`))
			require.NoError(t, db.AutoMigrate(&model.ModelShowcasePlan{}, &model.ModelShowcaseRun{}, &model.Log{}))
			logDB, _ := newAuditTestDatabase(t, database.kind, os.Getenv(database.env))
			require.NoError(t, logDB.AutoMigrate(&model.Log{}))
			model.LOG_DB = logDB
			root := model.User{Username: "showcase-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 500, PaidQuota: 500, AffCode: "showcase-root"}
			viewer := model.User{Username: "showcase-viewer", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 99, PaidQuota: 99, AffCode: "showcase-viewer"}
			require.NoError(t, db.Create(&root).Error)
			require.NoError(t, db.Create(&viewer).Error)
			require.NoError(t, db.Create(&model.Option{Key: "showcase-upgrade-sentinel", Value: "preserved"}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.ModelShowcasePlan{}, &model.ModelShowcaseRun{}))
			}
			var option model.Option
			require.NoError(t, db.Where(&model.Option{Key: "showcase-upgrade-sentinel"}).First(&option).Error)
			assert.Equal(t, "preserved", option.Value)
			var calls atomic.Int32
			output := `<!doctype html><html><head></head><body><svg width="1200" height="800"><animate attributeName="opacity" repeatCount="indefinite"/><!--` + strings.Repeat("SVG output ", 7000) + `--></svg></body></html>`
			upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				calls.Add(1)
				var payload dto.GeneralOpenAIRequest
				require.NoError(t, common.DecodeJson(request.Body, &payload))
				assert.Equal(t, "showcase-model", payload.Model)
				require.NotNil(t, payload.MaxTokens)
				assert.EqualValues(t, 2048, *payload.MaxTokens)
				assert.Contains(t, payload.Messages[0].StringContent(), showcasePromptSuffix)
				assert.Equal(t, "Bearer showcase-upstream-secret", request.Header.Get("Authorization"))
				writer.Header().Set("Content-Type", "application/json")
				encoded, err := common.Marshal(map[string]any{
					"id": "showcase-result", "object": "chat.completion", "model": payload.Model,
					"choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": output}, "finish_reason": "stop"}},
					"usage":   map[string]int{"prompt_tokens": 20, "completion_tokens": 40, "total_tokens": 60},
				})
				require.NoError(t, err)
				_, err = writer.Write(encoded)
				require.NoError(t, err)
			}))
			t.Cleanup(upstream.Close)
			channel := model.Channel{
				Type: constant.ChannelTypeOpenAI, Name: "showcase-channel", Key: "showcase-upstream-secret",
				BaseURL: common.GetPointer(upstream.URL), Models: "showcase-model", Group: "showcase", Status: common.ChannelStatusEnabled,
			}
			require.NoError(t, db.Create(&channel).Error)
			require.NoError(t, db.Create(&model.Ability{Group: "showcase", Model: "showcase-model", ChannelId: channel.Id, Enabled: true, Priority: common.GetPointer(int64(1)), Weight: 1}).Error)
			plan := model.ModelShowcasePlan{
				Name: "Public pelican", GroupName: "showcase", Model: "showcase-model", Prompt: "Draw a pelican",
				IntervalMinutes: 60, KeepCount: 2, MaxOutputTokens: 2048, TimeoutSeconds: 30, Public: true,
			}
			require.NoError(t, model.SaveModelShowcasePlan(&plan))
			assert.False(t, modelShowcaseHandler{}.Enabled())
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.Zero(t, calls.Load(), "paused plans never invoke the upstream")

			require.NoError(t, model.RequestModelShowcaseRun(plan.ID))
			assert.True(t, modelShowcaseHandler{}.Enabled())
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.EqualValues(t, 1, calls.Load())
			var first model.ModelShowcaseRun
			require.NoError(t, db.Where("plan_id = ?", plan.ID).First(&first).Error)
			assert.Equal(t, "succeeded", first.Status)
			assert.Equal(t, "showcase", first.GroupName)
			assert.EqualValues(t, 20, first.PromptTokens)
			assert.EqualValues(t, 40, first.CompletionTokens)
			assert.Greater(t, first.Quota, 0)
			assert.Contains(t, first.Prompt, "Draw a pelican")
			assert.Equal(t, output, first.Output, "HTML larger than the MySQL TEXT limit is preserved")
			var costLog model.Log
			require.NoError(t, logDB.Where("token_name = ?", "Model showcase").First(&costLog).Error)
			assert.Contains(t, costLog.Other, `"cost_bearer":"platform"`)
			assert.Equal(t, root.Id, costLog.UserId)

			entries, err := model.ListModelShowcase(true)
			require.NoError(t, err)
			require.Len(t, entries, 1)
			require.Len(t, entries[0].Runs, 1)
			assert.Empty(t, entries[0].Runs[0].Output, "list responses do not download every HTML document")
			assert.Empty(t, entries[0].Runs[0].Prompt)
			engine := gin.New()
			engine.GET("/showcase", GetModelShowcase)
			engine.GET("/runs/:id", GetModelShowcaseRun)
			for range 2 {
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/showcase", nil))
				assert.Equal(t, http.StatusOK, response.Code)
				assert.NotContains(t, response.Body.String(), "showcase-upstream-secret")
			}
			assert.EqualValues(t, 1, calls.Load(), "viewing results never starts a model request")
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/runs/%d", first.ID), nil))
			assert.Equal(t, http.StatusOK, response.Code)
			assert.Contains(t, response.Body.String(), "Draw a pelican")
			assert.NotContains(t, response.Body.String(), "showcase-upstream-secret")

			plan.Public = false
			plan.Prompt = "New prompt"
			plan.KeepCount = 1
			require.NoError(t, model.SaveModelShowcasePlan(&plan))
			require.NoError(t, db.First(&first, first.ID).Error)
			assert.Contains(t, first.Prompt, "Draw a pelican", "editing a plan preserves historical prompt snapshots")
			response = httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/runs/%d", first.ID), nil))
			assert.Equal(t, http.StatusNotFound, response.Code)
			entries, err = model.ListModelShowcase(true)
			require.NoError(t, err)
			assert.Empty(t, entries)

			plan.Model = "unavailable-model"
			plan.Enabled = true
			require.NoError(t, model.SaveModelShowcasePlan(&plan))
			require.NoError(t, model.RequestModelShowcaseRun(plan.ID))
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.EqualValues(t, 1, calls.Load())
			var kept []model.ModelShowcaseRun
			require.NoError(t, db.Where("plan_id = ?", plan.ID).Find(&kept).Error)
			require.Len(t, kept, 1)
			assert.Equal(t, "failed", kept[0].Status, "failures are retained and count toward retention")
			assert.Equal(t, "No available channel for this showcase plan.", kept[0].Error)
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.EqualValues(t, 1, calls.Load(), "a plan cannot run again before its next scheduled time")
			require.NoError(t, db.First(&root, root.Id).Error)
			require.NoError(t, db.First(&viewer, viewer.Id).Error)
			assert.Equal(t, 500, root.Quota)
			assert.Equal(t, 500, root.PaidQuota)
			assert.Equal(t, 99, viewer.Quota)
			assert.Equal(t, 99, viewer.PaidQuota)
			assert.Zero(t, viewer.UsedQuota)
			require.NoError(t, model.DeleteModelShowcasePlan(plan.ID))
			var count int64
			require.NoError(t, db.Model(&model.ModelShowcaseRun{}).Where("plan_id = ?", plan.ID).Count(&count).Error)
			assert.Zero(t, count)
			for _, name := range []string{"Parallel first", "Parallel second"} {
				parallelPlan := model.ModelShowcasePlan{
					Name: name, GroupName: "showcase", Model: "showcase-model", Prompt: "Draw",
					IntervalMinutes: 60, KeepCount: 2, MaxOutputTokens: 2048, TimeoutSeconds: 30, Enabled: true,
				}
				require.NoError(t, model.SaveModelShowcasePlan(&parallelPlan))
			}
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.EqualValues(t, 3, calls.Load(), "independent plans execute with bounded concurrency")
			require.NoError(t, db.Model(&model.ModelShowcaseRun{}).Where("status = ?", "succeeded").Count(&count).Error)
			assert.EqualValues(t, 2, count)
		})
	}
}

func TestModelShowcasePlanValidation(t *testing.T) {
	base := model.ModelShowcasePlan{
		Name: "Example", GroupName: "default", Model: "model", Prompt: "Draw",
		IntervalMinutes: 60, KeepCount: 24, MaxOutputTokens: 9216, TimeoutSeconds: 1800,
	}
	for _, testCase := range []struct {
		name   string
		change func(*model.ModelShowcasePlan)
	}{
		{"empty prompt", func(plan *model.ModelShowcasePlan) { plan.Prompt = " " }},
		{"oversized prompt", func(plan *model.ModelShowcasePlan) { plan.Prompt = strings.Repeat("字", 6000) }},
		{"automatic group", func(plan *model.ModelShowcasePlan) { plan.GroupName = "auto" }},
		{"zero interval", func(plan *model.ModelShowcasePlan) { plan.IntervalMinutes = 0 }},
		{"negative retention", func(plan *model.ModelShowcasePlan) { plan.KeepCount = -1 }},
		{"oversized retention", func(plan *model.ModelShowcasePlan) { plan.KeepCount = 101 }},
		{"negative token budget", func(plan *model.ModelShowcasePlan) { plan.MaxOutputTokens = -1 }},
		{"oversized token budget", func(plan *model.ModelShowcasePlan) { plan.MaxOutputTokens = 32769 }},
		{"unbounded timeout", func(plan *model.ModelShowcasePlan) { plan.TimeoutSeconds = 1801 }},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			plan := base
			testCase.change(&plan)
			require.Error(t, plan.Validate())
		})
	}
	require.NoError(t, base.Validate())
}

func TestModelShowcaseResponsesChannels(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		channelType int
		stream      bool
	}{
		{"responses JSON policy", constant.ChannelTypeOpenAI, false},
		{"responses SSE policy", constant.ChannelTypeOpenAI, true},
		{"native Codex SSE", constant.ChannelTypeCodex, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := modelManagementDB(t, "sqlite", "")
			require.NoError(t, db.AutoMigrate(&model.ModelShowcasePlan{}, &model.ModelShowcaseRun{}, &model.Log{}))
			require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"showcase-response-model":1}`))
			require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"showcase-response-model":1}`))
			settings := model_setting.GetGlobalSettings()
			previousPolicy := settings.ChatCompletionsToResponsesPolicy
			t.Cleanup(func() { settings.ChatCompletionsToResponsesPolicy = previousPolicy })
			settings.ChatCompletionsToResponsesPolicy = model_setting.ChatCompletionsToResponsesPolicy{
				Enabled: testCase.channelType != constant.ChannelTypeCodex, AllChannels: true,
				ModelPatterns: []string{"^showcase-response-model$"},
			}
			root := model.User{Username: "showcase-response-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 500, PaidQuota: 500, AffCode: "showcase-response-root"}
			require.NoError(t, db.Create(&root).Error)
			output := `<!doctype html><html><head></head><body><svg width="1200" height="800"></svg></body></html>`
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				calls.Add(1)
				var payload dto.OpenAIResponsesRequest
				require.NoError(t, common.DecodeJson(request.Body, &payload))
				assert.Equal(t, "showcase-response-model", payload.Model)
				assert.Contains(t, string(payload.Input), "Draw a pelican")
				assert.Contains(t, string(payload.Input), "Return only a complete HTML document")
				if testCase.channelType == constant.ChannelTypeCodex {
					assert.Equal(t, "/backend-api/codex/responses", request.URL.Path)
					assert.Equal(t, "showcase-account", request.Header.Get("chatgpt-account-id"))
					require.NotNil(t, payload.Stream)
					assert.True(t, *payload.Stream)
				} else {
					assert.Equal(t, "/v1/responses", request.URL.Path)
					require.NotNil(t, payload.MaxOutputTokens)
					assert.EqualValues(t, 2048, *payload.MaxOutputTokens)
				}
				response := map[string]any{
					"id": "resp_showcase", "object": "response", "model": payload.Model, "status": "completed",
					"output": []any{map[string]any{
						"type": "message", "id": "msg_showcase", "role": "assistant", "status": "completed",
						"content": []any{map[string]any{"type": "output_text", "text": output}},
					}},
					"usage": map[string]int{"input_tokens": 20, "output_tokens": 40, "total_tokens": 60},
				}
				if testCase.stream {
					encoded, err := common.Marshal(map[string]any{"type": "response.completed", "response": response})
					require.NoError(t, err)
					writer.Header().Set("Content-Type", "text/event-stream")
					_, err = fmt.Fprintf(writer, "data: %s\n\ndata: [DONE]\n\n", encoded)
					require.NoError(t, err)
					return
				}
				encoded, err := common.Marshal(response)
				require.NoError(t, err)
				writer.Header().Set("Content-Type", "application/json")
				_, err = writer.Write(encoded)
				require.NoError(t, err)
			}))
			t.Cleanup(upstream.Close)
			key := "showcase-secret"
			if testCase.channelType == constant.ChannelTypeCodex {
				key = `{"access_token":"showcase-secret","account_id":"showcase-account"}`
			}
			channel := model.Channel{
				Type: testCase.channelType, Name: testCase.name, Key: key,
				BaseURL: common.GetPointer(upstream.URL), Models: "showcase-response-model", Group: "default", Status: common.ChannelStatusEnabled,
			}
			require.NoError(t, db.Create(&channel).Error)
			require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "showcase-response-model", ChannelId: channel.Id, Enabled: true, Priority: common.GetPointer(int64(1)), Weight: 1}).Error)
			plan := model.ModelShowcasePlan{
				Name: "Responses pelican", GroupName: "default", Model: "showcase-response-model", Prompt: "Draw a pelican",
				IntervalMinutes: 60, KeepCount: 2, MaxOutputTokens: 2048, TimeoutSeconds: 30,
			}
			require.NoError(t, model.SaveModelShowcasePlan(&plan))
			require.NoError(t, model.RequestModelShowcaseRun(plan.ID))
			require.NoError(t, runModelShowcasePlans(context.Background()))
			assert.EqualValues(t, 1, calls.Load())
			var run model.ModelShowcaseRun
			require.NoError(t, db.Where("plan_id = ?", plan.ID).First(&run).Error)
			assert.Equal(t, "succeeded", run.Status, run.Error)
			assert.Equal(t, output, run.Output)
			assert.Equal(t, 20, run.PromptTokens)
			assert.Equal(t, 40, run.CompletionTokens)
			assert.Greater(t, run.Quota, 0)
			require.NoError(t, db.First(&root, root.Id).Error)
			assert.Equal(t, 500, root.Quota)
			assert.Equal(t, 500, root.PaidQuota)
		})
	}
}

func TestModelShowcaseCancellationAndInterruptedHistory(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.ModelShowcasePlan{}, &model.ModelShowcaseRun{}))
	root := model.User{Username: "showcase-root", Role: common.RoleRootUser, Group: "default", AffCode: "showcase-interrupted"}
	require.NoError(t, db.Create(&root).Error)
	plan := model.ModelShowcasePlan{
		Name: "Interrupted", GroupName: "default", Model: "unknown", Prompt: "Draw",
		IntervalMinutes: 60, KeepCount: 2, MaxOutputTokens: 1024, TimeoutSeconds: 30,
	}
	require.NoError(t, model.SaveModelShowcasePlan(&plan))
	require.NoError(t, model.RequestModelShowcaseRun(plan.ID))
	_, interrupted, err := model.StartModelShowcaseRun(context.Background(), plan.ID, showcasePromptSuffix)
	require.NoError(t, err)
	require.NotNil(t, interrupted)
	assert.True(t, modelShowcaseHandler{}.Enabled(), "interrupted manual tests are recovered even when the plan is paused")
	require.NoError(t, runModelShowcasePlans(context.Background()))
	require.NoError(t, db.First(interrupted, interrupted.ID).Error)
	assert.Equal(t, "failed", interrupted.Status)
	assert.Equal(t, "The previous showcase test was interrupted.", interrupted.Error)
	assert.GreaterOrEqual(t, interrupted.CompletedAt, time.Now().Unix()-1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, runModelShowcasePlans(ctx), context.Canceled)
	var count int64
	require.NoError(t, db.Model(&model.ModelShowcaseRun{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	response := httptest.NewRecorder()
	engine := gin.New()
	engine.POST("/plans/:id/run", RunModelShowcasePlan)
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/plans/"+strconv.Itoa(-1)+"/run", nil))
	assert.Contains(t, response.Body.String(), `"success":false`)
}
