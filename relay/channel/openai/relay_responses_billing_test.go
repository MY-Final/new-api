package openai

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type responsesDisconnectWriter struct {
	gin.ResponseWriter
	firstEvent chan struct{}
	fail       bool
	writes     atomic.Int64
	once       sync.Once
}

func (w *responsesDisconnectWriter) Write(p []byte) (int, error) {
	w.writes.Add(1)
	if w.fail {
		w.once.Do(func() { close(w.firstEvent) })
		return 0, io.ErrClosedPipe
	}
	return w.ResponseWriter.Write(p)
}

func (w *responsesDisconnectWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func (w *responsesDisconnectWriter) Flush() {
	w.ResponseWriter.Flush()
	w.once.Do(func() { close(w.firstEvent) })
}

type responsesTrackedBody struct {
	io.ReadCloser
	closed atomic.Bool
}

func (b *responsesTrackedBody) Close() error {
	b.closed.Store(true)
	return b.ReadCloser.Close()
}

func awaitResponsesStreamSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("Responses stream did not reach the expected lifecycle state")
	}
}

func TestResponsesDisconnectGracePreservesRequestDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		clientCtx, cancelClient := context.WithDeadline(context.Background(), time.Now().Add(2*time.Second))
		defer cancelClient()
		lifetime := relaycommon.NewResponsesStreamLifetime(clientCtx, time.Minute)
		defer lifetime.Close()

		cancelClient()
		<-lifetime.ClientDone()
		require.NoError(t, lifetime.Context().Err(), "client cancellation allows usage collection")
		<-lifetime.Context().Done()
		assert.ErrorIs(t, lifetime.Context().Err(), context.DeadlineExceeded, "the original request deadline still bounds grace")
	})
}

func TestResponsesDisconnectCollectsUsageBeforeSettlement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldGrace, oldTimeout := constant.ResponsesDisconnectGraceSeconds, constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.ResponsesDisconnectGraceSeconds = oldGrace
		constant.StreamingTimeout = oldTimeout
	})

	for _, tc := range []struct {
		name      string
		failWrite bool
		timeout   bool
	}{
		{name: "client cancels after first event"},
		{name: "write fails while client context is active", failWrite: true},
		{name: "heartbeats do not extend disconnect grace", timeout: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			constant.ResponsesDisconnectGraceSeconds = 60
			if tc.timeout {
				constant.ResponsesDisconnectGraceSeconds = 1
			}
			releaseTerminal, upstreamDone := make(chan struct{}), make(chan struct{})
			var upstreamContinued atomic.Bool
			var heartbeats atomic.Int64
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(upstreamDone)
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_test\",\"status\":\"in_progress\"}}\n\n")
				w.(http.Flusher).Flush()
				if tc.timeout {
					ticker := time.NewTicker(100 * time.Millisecond)
					defer ticker.Stop()
					for {
						select {
						case <-r.Context().Done():
							return
						case <-ticker.C:
							_, _ = io.WriteString(w, ": keepalive\n\n")
							w.(http.Flusher).Flush()
							heartbeats.Add(1)
						}
					}
				}
				select {
				case <-r.Context().Done():
					return
				case <-releaseTerminal:
				}
				upstreamContinued.Store(r.Context().Err() == nil)
				_, _ = io.WriteString(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\",\"status\":\"completed\",\"usage\":{\"input_tokens\":1000,\"input_tokens_details\":{\"cached_tokens\":900},\"output_tokens\":10,\"output_tokens_details\":{\"reasoning_tokens\":5},\"total_tokens\":1010}}}\n\n")
				w.(http.Flusher).Flush()
				// A protocol terminal must finish the relay without [DONE] or EOF.
				<-r.Context().Done()
			}))
			t.Cleanup(upstream.Close)

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			clientCtx, cancelClient := context.WithCancel(context.Background())
			t.Cleanup(cancelClient)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(clientCtx)
			writer := &responsesDisconnectWriter{ResponseWriter: c.Writer, firstEvent: make(chan struct{}), fail: tc.failWrite}
			c.Writer = writer
			const expression = `tier("base", p * 2 + cr * 0.2 + c * 10)`
			info := &relaycommon.RelayInfo{
				RelayMode: relayconstant.RelayModeResponses, RelayFormat: types.RelayFormatOpenAIResponses,
				RequestURLPath: "/v1/responses", OriginModelName: "gpt-5.1", IsStream: true, DisablePing: true,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, ChannelBaseUrl: upstream.URL, UpstreamModelName: "gpt-5.1"},
				TieredBillingSnapshot: &billingexpr.BillingSnapshot{
					BillingMode: "tiered_expr", ExprString: expression, ExprHash: billingexpr.ExprHashString(expression),
					GroupRatio: 0.25, QuotaPerUnit: 500_000, EstimatedPromptTokens: 1000,
				},
			}
			info.SetEstimatePromptTokens(1000)
			adaptor := &Adaptor{}
			adaptor.Init(info)
			resp, err := channel.DoApiRequest(adaptor, c, info, strings.NewReader(`{"model":"gpt-5.1","stream":true}`))
			require.NoError(t, err)
			t.Cleanup(func() { _ = resp.Body.Close() })
			require.NotNil(t, info.ResponsesStreamLifetime)
			body := &responsesTrackedBody{ReadCloser: resp.Body}
			resp.Body = body

			var usage *dto.Usage
			var apiErr *types.NewAPIError
			handlerDone := make(chan struct{})
			go func() {
				usage, apiErr = OaiResponsesStreamHandler(c, info, resp)
				close(handlerDone)
			}()
			t.Cleanup(func() {
				_ = body.Close()
				awaitResponsesStreamSignal(t, handlerDone)
			})
			awaitResponsesStreamSignal(t, writer.firstEvent)
			if !tc.failWrite {
				cancelClient()
			}
			awaitResponsesStreamSignal(t, info.ResponsesStreamLifetime.ClientDone())
			require.NoError(t, info.ResponsesStreamLifetime.Context().Err())
			writesBeforeDrain := writer.writes.Load()
			if !tc.timeout {
				close(releaseTerminal)
			}
			awaitResponsesStreamSignal(t, handlerDone)
			awaitResponsesStreamSignal(t, upstreamDone)

			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			require.NotNil(t, info.UsageSources)
			assert.True(t, body.closed.Load())
			assert.Equal(t, writesBeforeDrain, writer.writes.Load(), "draining must not write to the disconnected client")
			assert.NotContains(t, recorder.Body.String(), "response.completed")
			assert.Equal(t, relaycommon.StreamEndReasonClientGone, info.StreamStatus.EndReason)
			if tc.failWrite {
				assert.NoError(t, clientCtx.Err(), "a failed write must start grace independently of request cancellation")
				assert.ErrorIs(t, info.StreamStatus.EndError, io.ErrClosedPipe)
			} else {
				assert.ErrorIs(t, info.StreamStatus.EndError, context.Canceled)
			}
			params := service.BuildTieredTokenParams(usage, false, billingexpr.UsedVars(expression))
			applies, quota, settlement := service.TryTieredSettle(info, params)
			require.True(t, applies)
			require.NotNil(t, settlement)
			if tc.timeout {
				assert.Positive(t, heartbeats.Load())
				assert.Equal(t, 1000, usage.PromptTokens)
				assert.Zero(t, usage.CompletionTokens)
				assert.Zero(t, usage.PromptTokensDetails.CachedTokens)
				assert.Equal(t, &relaycommon.UsageSources{InputTokens: "estimated", OutputTokens: "unavailable", CacheTokens: "unavailable", ReasoningTokens: "unavailable"}, info.UsageSources)
				assert.Equal(t, 250, quota, "missing usage retains existing input estimation")
				return
			}
			assert.True(t, upstreamContinued.Load())
			assert.Equal(t, 1000, usage.PromptTokens)
			assert.Equal(t, 900, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, 10, usage.CompletionTokens)
			assert.Equal(t, 5, usage.CompletionTokenDetails.ReasoningTokens)
			assert.Equal(t, &relaycommon.UsageSources{InputTokens: "upstream", OutputTokens: "upstream", CacheTokens: "upstream", ReasoningTokens: "upstream", Final: true}, info.UsageSources)
			assert.Equal(t, "completed", info.StreamStatus.ResponseOutcome())
			assert.Equal(t, 60, quota, "final cache usage must replace the full-price input estimate")
		})
	}
}

func TestResponsesDisconnectGraceLeavesOtherRequestsCancellable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldGrace := constant.ResponsesDisconnectGraceSeconds
	t.Cleanup(func() { constant.ResponsesDisconnectGraceSeconds = oldGrace })
	for _, tc := range []struct {
		name        string
		grace       int
		stream      bool
		apiType     int
		format      types.RelayFormat
		finalFormat types.RelayFormat
	}{
		{name: "disabled", stream: true, format: types.RelayFormatOpenAIResponses, finalFormat: types.RelayFormatOpenAIResponses},
		{name: "chat completions", grace: 60, stream: true, format: types.RelayFormatOpenAI, finalFormat: types.RelayFormatOpenAI},
		{name: "Responses converted to chat", grace: 60, stream: true, format: types.RelayFormatOpenAIResponses, finalFormat: types.RelayFormatOpenAI},
		{name: "non-stream Responses", grace: 60, format: types.RelayFormatOpenAIResponses, finalFormat: types.RelayFormatOpenAIResponses},
		{name: "Anthropic passthrough without conversion metadata", grace: 60, stream: true, apiType: constant.APITypeAnthropic, format: types.RelayFormatOpenAIResponses},
		{name: "Gemini passthrough without conversion metadata", grace: 60, stream: true, apiType: constant.APITypeGemini, format: types.RelayFormatOpenAIResponses},
	} {
		t.Run(tc.name, func(t *testing.T) {
			constant.ResponsesDisconnectGraceSeconds = tc.grace
			upstreamDone := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				close(upstreamDone)
			}))
			t.Cleanup(upstream.Close)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			clientCtx, cancelClient := context.WithCancel(context.Background())
			t.Cleanup(cancelClient)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(clientCtx)
			info := &relaycommon.RelayInfo{
				RelayMode: relayconstant.RelayModeResponses, RelayFormat: tc.format, FinalRequestRelayFormat: tc.finalFormat,
				RequestURLPath: "/v1/responses", IsStream: tc.stream, DisablePing: true,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, ApiType: tc.apiType, ChannelBaseUrl: upstream.URL},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			resp, err := channel.DoApiRequest(adaptor, c, info, strings.NewReader(`{}`))
			require.NoError(t, err)
			t.Cleanup(func() { _ = resp.Body.Close() })
			assert.Nil(t, info.ResponsesStreamLifetime)
			var readErr error
			readerDone := make(chan struct{})
			go func() {
				_, readErr = io.Copy(io.Discard, resp.Body)
				close(readerDone)
			}()
			cancelClient()
			awaitResponsesStreamSignal(t, readerDone)
			awaitResponsesStreamSignal(t, upstreamDone)
			assert.ErrorIs(t, readErr, context.Canceled)
		})
	}
}

func TestOaiResponsesHandlerCountsOutputCallsNotDeclarations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	operation_setting.SetToolPriceForTest("priced_fn", 5.0)
	t.Cleanup(func() {
		operation_setting.DeleteToolPriceForTest("priced_fn")
	})

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Tools: []map[string]any{
			{"type": "web_search_preview"},
			{"type": "file_search"},
		},
		Output: []dto.ResponsesOutput{
			{Type: dto.BuildInCallWebSearchCall},
			{Type: dto.BuildInCallWebSearchCall},
			{Type: dto.BuildInCallFunctionCall, Name: "priced_fn"},
			{Type: dto.BuildInCallFunctionCall, Name: "unpriced_fn"},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: {ToolName: dto.BuildInToolWebSearchPreview, CallCount: 0},
				dto.BuildInToolFileSearch:       {ToolName: dto.BuildInToolFileSearch, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	usage, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, "priced_fn")
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools["priced_fn"].CallCount)
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, "unpriced_fn")
}

func TestOaiResponsesHandlerDeclaredToolsWithoutOutputCountZero(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Tools: []map[string]any{
			{"type": "web_search_preview"},
			{"type": "file_search"},
		},
		Output: []dto.ResponsesOutput{
			{Type: "message", Role: "assistant"},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: {ToolName: dto.BuildInToolWebSearchPreview, CallCount: 0},
				dto.BuildInToolFileSearch:       {ToolName: dto.BuildInToolFileSearch, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
}

func TestOaiResponsesHandlerCountsCompletedImageGenerationOutputs(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Status: []byte(`"completed"`),
		Output: []dto.ResponsesOutput{
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_1",
				Status: "completed",
				Result: "base64-a",
			},
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_2",
				Status: "completed",
				Result: "base64-b",
			},
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_empty",
				Status: "completed",
				Result: "",
			},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.1"}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
	assert.False(t, c.GetBool("image_generation_call"))
}

func TestOaiResponsesHandlerCountsImageGenerationOnIncompleteStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Status: []byte(`"incomplete"`),
		Output: []dto.ResponsesOutput{
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_1",
				Status: "completed",
				Result: "base64-a",
			},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolImageGeneration: {ToolName: dto.BuildInToolImageGeneration, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func runResponsesImageBillingStream(t *testing.T, events ...string) *relaycommon.RelayInfo {
	t.Helper()
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	var body strings.Builder
	for _, event := range events {
		body.WriteString("data: ")
		body.WriteString(event)
		body.WriteString("\n\n")
	}
	body.WriteString("data: [DONE]\n\n")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "responses-image-billing-test")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		DisablePing:     true,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-5.1",
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body.String())),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, info.ResponsesUsageInfo)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	return info
}

func TestOaiResponsesStreamHandlerDeduplicatesCompletedImageOutput(t *testing.T) {
	item := `{"type":"image_generation_call","id":"img_1","call_id":"call_1","status":"completed","result":"base64-a"}`
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.output_item.done","output_index":0,"item":`+item+`}`,
		`{"type":"response.completed","response":{"status":"completed","output":[`+item+`],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
	)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestOaiResponsesStreamHandlerCountsImageOutputOnIncomplete(t *testing.T) {
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","id":"img_1","status":"completed","result":"base64-a"}}`,
		`{"type":"response.incomplete","response":{"status":"incomplete"}}`,
	)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestOaiResponsesStreamHandlerDoesNotCountPartialImageEvent(t *testing.T) {
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.image_generation_call.partial_image","output_index":0,"partial_image_b64":"partial-bytes"}`,
		`{"type":"response.completed","response":{"status":"completed","output":[]}}`,
	)

	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestOaiResponsesHandlerRewritesSGLangCreatedAtToInt(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeSGLang},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"id":"resp_1","object":"response","created_at":1786588600.0,"status":"completed","output":[]}`)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `"created_at":1786588600`)
	assert.NotContains(t, w.Body.String(), `1786588600.0`)
}

func TestOaiResponsesStreamHandlerRewritesSGLangCreatedAtToInt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "sglang-created-at-test")

	info := &relaycommon.RelayInfo{
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeSGLang,
			UpstreamModelName: "served-model",
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"created_at\":1.7865886E9,\"status\":\"completed\",\"output\":[]}}\n\n" +
				"data: [DONE]\n\n",
		)),
		Header: http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `"created_at":1786588600`)
	assert.NotContains(t, w.Body.String(), `1.7865886E9`)
	assert.NotContains(t, w.Body.String(), `1786588600.0`)
}

func TestOaiResponsesStreamHandlerKeepsNonSGLangCreatedAt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "openai-created-at-test")

	info := &relaycommon.RelayInfo{
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-test"},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"created_at\":1786588600.0,\"status\":\"completed\",\"output\":[]}}\n\n" +
				"data: [DONE]\n\n",
		)),
		Header: http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `1786588600.0`)
}

// A converted hosted web search reaches Azure and Xinference Chat Completions
// as web_search_options, like OpenAI; the upstream decides whether it applies.
// Azure Responses bills web search by tool_usage.web_search.num_requests (Bing
// transactions) under bing_web_search, and the explicit zeros silence the
// web_search_call items, which leaves one surcharge row.
func TestAzureHostedWebSearch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	t.Run("Claude to Chat", func(t *testing.T) {
		const body = `{"model":"gpt-5.1","max_tokens":64,"messages":[{"role":"user","content":"Weather?"}],"tools":[{"type":"web_search_20250305","name":"web_search"}]}`
		for _, channelType := range []int{constant.ChannelTypeAzure, constant.ChannelTypeXinference, constant.ChannelTypeOpenAI} {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelType: channelType, UpstreamModelName: "gpt-5.1"},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			var request dto.ClaudeRequest
			require.NoError(t, common.UnmarshalJsonStr(body, &request))
			converted, err := adaptor.ConvertClaudeRequest(c, info, &request)
			require.NoError(t, err)
			wire, err := common.Marshal(converted)
			require.NoError(t, err)
			assert.True(t, strings.Contains(string(wire), `"web_search_options"`), channelType)
			var codes []string
			for _, diagnostic := range info.ConversionDiagnostics() {
				codes = append(codes, diagnostic.Code)
			}
			assert.False(t, slices.Contains(codes, "hosted_web_search_omitted"), channelType)
		}
	})

	const searchCall = `{"type":"web_search_call","status":"completed","action":{"type":"search","query":"go"}}`
	const usage = `"usage":{"input_tokens":10,"output_tokens":3,"total_tokens":13},"tool_usage":{"web_search":{"num_requests":5}}`
	output := strings.Repeat(searchCall+",", 3) + `{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Go 1.25"}]}`
	tests := []struct {
		name        string
		contentType string
		body        string
	}{
		{
			name:        "json",
			contentType: "application/json",
			body:        `{"id":"resp_1","object":"response","model":"gpt-5.1","status":"completed","output":[` + output + `],` + usage + `}`,
		},
		{
			name:        "stream",
			contentType: "text/event-stream",
			body: strings.Repeat(`data: {"type":"response.output_item.done","output_index":0,"item":`+searchCall+"}\n\n", 3) +
				`data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"gpt-5.1","status":"completed","output":[` + output + `],` + usage + "}}\n\ndata: [DONE]\n\n",
		},
	}
	for _, tt := range tests {
		t.Run("Responses "+tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				RelayMode:       relayconstant.RelayModeResponses,
				RelayFormat:     types.RelayFormatOpenAIResponses,
				OriginModelName: "gpt-5.1",
				IsStream:        tt.name == "stream",
				DisablePing:     true,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure, UpstreamModelName: "gpt-5.1"},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(tt.body)),
				Header:     http.Header{"Content-Type": []string{tt.contentType}},
			}
			var apiErr *types.NewAPIError
			if info.IsStream {
				_, apiErr = OaiResponsesStreamHandler(c, info, resp)
			} else {
				_, apiErr = OaiResponsesHandler(c, info, resp)
			}
			require.Nil(t, apiErr)
			billed := map[string]int{}
			for name, tool := range info.ResponsesUsageInfo.BuiltInTools {
				if tool.CallCount > 0 {
					billed[name] = tool.CallCount
				}
			}
			assert.Equal(t, map[string]int{"bing_web_search": 5}, billed)
		})
	}
}
