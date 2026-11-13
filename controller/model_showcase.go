package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const showcasePromptSuffix = "\n\nReturn only a complete HTML document with a 1200x800 inline SVG. Use self-contained SVG, CSS or SMIL animation that starts automatically and loops indefinitely. Do not use JavaScript, event handlers, external resources, links, images, fonts, canvas, or embedded frames. Do not include Markdown fences or explanations."

func GetModelShowcase(c *gin.Context) {
	entries, err := model.ListModelShowcase(true)
	if err != nil {
		common.ApiErrorT(c, "Failed to load model showcase")
		return
	}
	common.ApiSuccess(c, entries)
}

func GetModelShowcaseRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var run model.ModelShowcaseRun
	if err := model.DB.First(&run, id).Error; err != nil {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Showcase result not found"))
		return
	}
	var plan model.ModelShowcasePlan
	if err := model.DB.Where("id = ? AND public = ?", run.PlanID, true).First(&plan).Error; err != nil {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Showcase result not found"))
		return
	}
	common.ApiSuccess(c, run)
}

func GetModelShowcasePlans(c *gin.Context) {
	entries, err := model.ListModelShowcase(false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, entries)
}

func GetModelShowcaseModels(c *gin.Context) {
	common.ApiSuccess(c, model.GetGroupEnabledModels(c.Query("group")))
}

func SaveModelShowcasePlan(c *gin.Context) {
	var plan model.ModelShowcasePlan
	if err := common.DecodeJson(c.Request.Body, &plan); err != nil {
		common.ApiErrorT(c, "Invalid showcase plan settings")
		return
	}
	if err := plan.Validate(); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, exists := ratio_setting.GetGroupRatioCopy()[plan.GroupName]; !exists {
		common.ApiErrorT(c, "Choose an existing group")
		return
	}
	if err := model.SaveModelShowcasePlan(&plan); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, plan)
}

func DeleteModelShowcasePlan(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DeleteModelShowcasePlan(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func RunModelShowcasePlan(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.RequestModelShowcaseRun(id); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeModelShowcase, nil); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type modelShowcaseHandler struct{}

func (modelShowcaseHandler) Type() string { return model.SystemTaskTypeModelShowcase }

func (modelShowcaseHandler) Enabled() bool {
	var count int64
	err := model.DB.Model(&model.ModelShowcasePlan{}).
		Where("(enabled = ? AND next_run_at <= ?) OR run_requested = ?", true, common.GetTimestamp(), true).
		Limit(1).Count(&count).Error
	if err != nil || count > 0 {
		return err == nil
	}
	err = model.DB.Model(&model.ModelShowcaseRun{}).Where("status = ?", "running").Limit(1).Count(&count).Error
	return err == nil && count > 0
}

func (modelShowcaseHandler) Interval() time.Duration { return 15 * time.Second }

func (modelShowcaseHandler) NewPayload() any { return nil }

func (modelShowcaseHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := runModelShowcasePlans(ctx)
	status := model.SystemTaskStatusSucceeded
	if err != nil {
		status = model.SystemTaskStatusFailed
	}
	finishSystemTaskHandler(task, runnerID, status, nil, err)
}

func runModelShowcasePlans(ctx context.Context) error {
	var interrupted []model.ModelShowcaseRun
	if err := model.DB.WithContext(ctx).Where("status = ?", "running").Find(&interrupted).Error; err != nil {
		return err
	}
	for _, run := range interrupted {
		run.Status = "failed"
		run.Error = "The previous showcase test was interrupted."
		run.CompletedAt = common.GetTimestamp()
		run.DurationMS = max(0, run.CompletedAt-run.StartedAt) * 1000
		if err := model.FinishModelShowcaseRun(&run); err != nil {
			return err
		}
	}
	var plans []model.ModelShowcasePlan
	if err := model.DB.WithContext(ctx).
		Where("(enabled = ? AND next_run_at <= ?) OR run_requested = ?", true, common.GetTimestamp(), true).
		Order("next_run_at, sort_order, id").Find(&plans).Error; err != nil {
		return err
	}
	if len(plans) == 0 {
		return nil
	}
	testUserID, err := resolveChannelTestUserID(nil)
	if err != nil {
		return err
	}
	work := make(chan int)
	var workers sync.WaitGroup
	var failures atomic.Int32
	for range min(2, len(plans)) {
		workers.Go(func() {
			for planID := range work {
				if err := runModelShowcasePlan(ctx, planID, testUserID); err != nil {
					failures.Add(1)
				}
			}
		})
	}
dispatch:
	for _, plan := range plans {
		select {
		case work <- plan.ID:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(work)
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	if failures.Load() > 0 {
		return errors.New("failed to persist model showcase results")
	}
	return nil
}

func runModelShowcasePlan(ctx context.Context, planID, testUserID int) (persistErr error) {
	plan, run, err := model.StartModelShowcaseRun(ctx, planID, showcasePromptSuffix)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if run == nil {
		return nil
	}
	started := time.Now()
	run.Status = "failed"
	run.Error = "The showcase request failed."
	defer func() {
		if recover() != nil {
			run.Error = "The showcase request failed."
		}
		run.CompletedAt = common.GetTimestamp()
		run.DurationMS = time.Since(started).Milliseconds()
		persistErr = model.FinishModelShowcaseRun(run)
	}()
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(plan.TimeoutSeconds)*time.Second)
	defer cancel()
	selection, _ := gin.CreateTestContext(httptest.NewRecorder())
	selection.Request = httptest.NewRequestWithContext(requestCtx, http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(selection, constant.ContextKeyUsingGroup, plan.GroupName)
	channel, _, selectErr := service.SelectChannelForRequest(selection, plan.Model, &service.RetryParam{
		Ctx: selection, TokenGroup: plan.GroupName, ModelName: plan.Model,
		RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0),
	})
	if selectErr != nil || channel == nil {
		run.Error = "No available channel for this showcase plan."
		return nil
	}
	run.ChannelID = channel.Id
	request := &dto.GeneralOpenAIRequest{
		Model:     plan.Model,
		Messages:  []dto.Message{{Role: "user", Content: run.Prompt}},
		MaxTokens: common.GetPointer(uint(plan.MaxOutputTokens)),
	}
	if dto.IsOpenAIReasoningOModel(plan.Model) {
		request.MaxTokens = nil
		request.MaxCompletionTokens = common.GetPointer(uint(plan.MaxOutputTokens))
	}
	result := testChannelWithRequest(requestCtx, channel, testUserID, plan.Model,
		string(constant.EndpointTypeOpenAI), false, request, plan.GroupName)
	if result.localErr != nil || result.newAPIError != nil {
		if requestCtx.Err() != nil {
			run.Error = "The showcase request timed out or was interrupted."
		}
		return nil
	}
	run.Quota = result.quota
	if result.usage != nil {
		run.PromptTokens = max(0, result.usage.PromptTokens)
		run.CompletionTokens = max(0, result.usage.CompletionTokens)
	}
	var response dto.TextResponse
	if err := common.Unmarshal(result.responseBody, &response); err != nil || len(response.Choices) == 0 {
		run.Error = "The model returned no showcase output."
		return nil
	}
	run.Output = strings.TrimSpace(response.Choices[0].StringContent())
	if len(run.Output) > 512*1024 {
		run.Output = ""
		run.Error = "The showcase output exceeded the size limit."
		return nil
	}
	lower := strings.ToLower(run.Output)
	if !strings.Contains(lower, "<html") || !strings.Contains(lower, "</html>") || !strings.Contains(lower, "<svg") {
		run.Error = "The model did not return a complete HTML and SVG document."
		return nil
	}
	run.Status = "succeeded"
	run.Error = ""
	return nil
}
