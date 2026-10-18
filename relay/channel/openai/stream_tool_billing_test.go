package openai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestObserveStreamChoicesDedupesFunctionCallNames(t *testing.T) {
	info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
	seen := make(map[string]struct{})
	var names []string

	chunks := []string{
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":"}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\"}"}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"get_time","arguments":""}}]}}]}`,
		`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{}"}}]}}]}`,
	}
	for _, chunk := range chunks {
		observeStreamChoices(info, chunk, seen, &names)
	}

	require.Len(t, names, 2)
	assert.Equal(t, []string{"get_weather", "get_time"}, names)
	assert.Empty(t, info.StreamStatus.ResponseOutcome(), "tool call deltas carry no finish reason")

	observeStreamChoices(info, `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`, seen, &names)
	assert.Equal(t, "completed", info.StreamStatus.ResponseOutcome())
	assert.False(t, info.PerformanceBusinessRejection)

	filtered := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
	observeStreamChoices(filtered, `{"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}`, map[string]struct{}{}, &names)
	assert.True(t, filtered.PerformanceBusinessRejection)
}

func newChatCompletionResponseTestContext(t *testing.T, body string, clientStream bool) (*gin.Context, *httptest.ResponseRecorder, *http.Response, *relaycommon.RelayInfo) {
	t.Helper()
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })
	c, recorder, resp, info := newResponsesChatTestContext(t, body, true)
	info.RelayMode = relayconstant.RelayModeChatCompletions
	info.StartTime = time.Now()
	info.Request = &dto.GeneralOpenAIRequest{Stream: lo.ToPtr(clientStream)}
	info.SetEstimatePromptTokens(11)
	return c, recorder, resp, info
}

func TestOaiNonStreamAggregatesChatCompletionSSE(t *testing.T) {
	body := strings.Join([]string{
		`data: {"id":"chatcmpl_buffered","object":"chat.completion.chunk","created":1710000000,"model":"upstream-model","system_fingerprint":"fp_test","choices":[{"index":2,"delta":{"role":"assistant","refusal":"Cannot "}},{"index":0,"delta":{"role":"assistant","reasoning_content":"think ","content":"hel","annotations":[{"type":"url_citation","url_citation":{"url":"https://example.com"}}]},"logprobs":{"content":[{"token":"hel","logprob":-0.1}]}},{"index":1,"delta":{"tool_calls":[{"index":0,"id":"call_lookup","type":"function","function":{"name":"lookup","arguments":"{\"q\":"}}]}}]}`,
		`data: {"choices":[{"index":0,"delta":{"reasoning_content":"first","content":"lo"},"finish_reason":"stop","logprobs":{"content":[{"token":"lo","logprob":-0.2}]}},{"index":1,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"x\"}"}}]},"finish_reason":"tool_calls"},{"index":2,"delta":{"refusal":"answer"},"finish_reason":"stop"}]}`,
		`data: {"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25,"prompt_tokens_details":{"cached_tokens":7}}}`,
		`data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"prompt_tokens_details":{"cached_tokens":0}}}`,
		`data: [DONE]`,
		"",
	}, "\n\n")
	c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, false)

	value, apiErr := (&Adaptor{}).DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	usage, ok := value.(*dto.Usage)
	require.True(t, ok)
	require.NotNil(t, usage)
	assert.Equal(t, 14, usage.PromptTokens)
	assert.Equal(t, 11, usage.CompletionTokens)
	assert.Equal(t, 25, usage.TotalTokens)
	assert.Equal(t, 7, usage.PromptTokensDetails.CachedTokens)
	assert.False(t, info.IsStream)
	assert.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
	assert.NotContains(t, recorder.Body.String(), "data:")
	response := gjson.ParseBytes(recorder.Body.Bytes())
	require.True(t, response.IsObject())
	assert.Equal(t, "chatcmpl_buffered", response.Get("id").String())
	assert.Equal(t, "chat.completion", response.Get("object").String())
	assert.Equal(t, int64(1710000000), response.Get("created").Int())
	assert.Equal(t, "upstream-model", response.Get("model").String())
	assert.Equal(t, "fp_test", response.Get("system_fingerprint").String())
	require.Len(t, response.Get("choices").Array(), 3)
	assert.Equal(t, "hello", response.Get("choices.0.message.content").String())
	assert.Equal(t, "think first", response.Get("choices.0.message.reasoning_content").String())
	assert.Equal(t, "https://example.com", response.Get("choices.0.message.annotations.0.url_citation.url").String())
	assert.Equal(t, "stop", response.Get("choices.0.finish_reason").String())
	assert.Equal(t, int64(2), response.Get("choices.0.logprobs.content.#").Int())
	assert.Equal(t, "lo", response.Get("choices.0.logprobs.content.1.token").String())
	assert.Equal(t, "call_lookup", response.Get("choices.1.message.tool_calls.0.id").String())
	assert.Equal(t, "lookup", response.Get("choices.1.message.tool_calls.0.function.name").String())
	assert.JSONEq(t, `{"q":"x"}`, response.Get("choices.1.message.tool_calls.0.function.arguments").String())
	assert.False(t, response.Get("choices.1.message.tool_calls.0.index").Exists())
	assert.Equal(t, "tool_calls", response.Get("choices.1.finish_reason").String())
	assert.Equal(t, "Cannot answer", response.Get("choices.2.message.refusal").String())
	assert.Equal(t, int64(7), response.Get("usage.prompt_tokens_details.cached_tokens").Int())
}

func TestOaiNonStreamAcceptsCompatibleChatCompletionOutputs(t *testing.T) {
	cases := []struct {
		name string
		body string
		path string
		want string
	}{
		{"JSON mislabeled SSE", `{"id":"chat_json","object":"chat.completion","created":1710000000,"model":"upstream-model","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25}}`, "choices.0.message.content", "hello"},
		{"explicit refusal", "data: {\"choices\":[{\"index\":0,\"delta\":{\"refusal\":\"Cannot answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", "choices.0.message.refusal", "Cannot answer"},
		{"content filter", "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"content_filter\"}]}\n\ndata: [DONE]\n\n", "choices.0.finish_reason", "content_filter"},
		{"tool call without text", "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", "choices.0.message.tool_calls.0.function.name", "lookup"},
		{"reasoning without text", "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"thinking\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n", "choices.0.message.reasoning_content", "thinking"},
		{"legacy function call", "data: {\"choices\":[{\"index\":0,\"delta\":{\"function_call\":{\"name\":\"lookup\",\"arguments\":\"{}\"}},\"finish_reason\":\"function_call\"}]}\n\ndata: [DONE]\n\n", "choices.0.message.function_call.name", "lookup"},
		{"done without finish reason", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n", "choices.0.message.content", "hello"},
		{"fragmented audio", "data: {\"choices\":[{\"index\":0,\"delta\":{\"audio\":{\"id\":\"audio_1\",\"data\":\"YWJj\",\"transcript\":\"hello \"}}}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"audio\":{\"data\":\"ZGVm\",\"transcript\":\"world\"}},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", "choices.0.message.audio.data", "YWJjZGVm"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, tc.body, false)
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.False(t, info.IsStream)
			assert.Contains(t, recorder.Header().Get("Content-Type"), "application/json")
			assert.Equal(t, tc.want, gjson.GetBytes(recorder.Body.Bytes(), tc.path).String())
			if tc.name == "JSON mislabeled SSE" {
				assert.JSONEq(t, tc.body, recorder.Body.String())
			}
			if tc.name == "fragmented audio" {
				assert.Equal(t, "hello world", gjson.GetBytes(recorder.Body.Bytes(), "choices.0.message.audio.transcript").String())
				assert.Equal(t, "audio_1", gjson.GetBytes(recorder.Body.Bytes(), "choices.0.message.audio.id").String())
			}
		})
	}
}

func TestOaiNonStreamPreservesProviderCacheUsage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		channel int
		frame   string
	}{
		{"DeepSeek cache hit tokens", constant.ChannelTypeDeepSeek, `{"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25,"prompt_cache_hit_tokens":7}}`},
		{"Moonshot choice cache usage", constant.ChannelTypeMoonshot, `{"choices":[{"index":0,"delta":{},"usage":{"cached_tokens":7}}],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25}}`},
		{"Moonshot cached tokens", constant.ChannelTypeMoonshot, `{"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25,"cached_tokens":7}}`},
		{"OpenAI compatible cache timing", constant.ChannelTypeOpenAI, `{"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":11,"total_tokens":25},"timings":{"cache_n":7}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}]}\n\ndata: " + tc.frame + "\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}}\n\ndata: [DONE]\n\n"
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, false)
			info.ChannelType = tc.channel
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 14, usage.PromptTokens)
			assert.Equal(t, 11, usage.CompletionTokens)
			assert.Equal(t, 25, usage.TotalTokens)
			assert.Equal(t, 7, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, int64(7), gjson.GetBytes(recorder.Body.Bytes(), "usage.prompt_tokens_details.cached_tokens").Int())
		})
	}
}

func TestOaiRejectsEmptyChatCompletionResponses(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"done only", "data: [DONE]\n\n"},
		{"usage only", "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":0,\"total_tokens\":11}}\n\ndata: [DONE]\n\n"},
		{"role only", "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: [DONE]\n\n"},
		{"empty choices JSON", `{"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":0,"total_tokens":11}}`},
		{"empty message JSON", `{"choices":[{"index":0,"message":{"role":"assistant","content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":0,"total_tokens":11}}`},
		{"upstream error", "data: {\"error\":{\"message\":\"upstream failed\",\"type\":\"server_error\"}}\n\ndata: [DONE]\n\n"},
		{"malformed chunk", "data: {bad-json}\n\ndata: [DONE]\n\n"},
		{"truncated content", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n"},
		{"one completed choice and one truncated choice", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"complete\"},\"finish_reason\":\"stop\"},{\"index\":1,\"delta\":{\"content\":\"partial\"}}]}\n\n"},
		{"empty tools JSON", ` {"choices":[{"message":{"tool_calls":[{}]},"finish_reason":"stop"}]}`},
		{"empty audio JSON", ` {"choices":[{"message":{"audio":{"id":"empty"}},"finish_reason":"stop"}]}`},
		{"invalid tool index", "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":{},\"function\":{\"name\":\"lookup\"}}]}}]}\n\ndata: [DONE]\n\n"},
		{"invalid tool id", "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":{},\"function\":{\"name\":\"lookup\"}}]}}]}\n\ndata: [DONE]\n\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, tc.body, false)
			usage, apiErr := (&Adaptor{}).DoResponse(c, resp, info)
			require.NotNil(t, apiErr)
			assert.Nil(t, usage)
			assert.GreaterOrEqual(t, apiErr.StatusCode, http.StatusBadRequest)
			assert.False(t, c.Writer.Written(), "a failed buffered request must remain safe to retry")
			assert.Empty(t, recorder.Body.String())
			assert.NotContains(t, recorder.Header().Get("Content-Type"), "text/event-stream")
		})
	}
}

func TestOaiNonStreamCancellationBeforeDelivery(t *testing.T) {
	c, recorder, resp, info := newChatCompletionResponseTestContext(t, "", false)
	requestCtx, cancel := context.WithCancel(c.Request.Context())
	c.Request = c.Request.WithContext(requestCtx)
	reader, writer := io.Pipe()
	resp.Body = reader
	t.Cleanup(func() { cancel(); _ = writer.Close(); _ = reader.Close() })
	type result struct {
		usage *dto.Usage
		err   *types.NewAPIError
	}
	finished := make(chan result, 1)
	go func() {
		usage, apiErr := OaiStreamHandler(c, info, resp)
		finished <- result{usage: usage, err: apiErr}
	}()
	_, err := io.WriteString(writer, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"buffered\"}}]}\n\n")
	require.NoError(t, err)
	cancel()
	select {
	case got := <-finished:
		require.NotNil(t, got.err)
		assert.Nil(t, got.usage)
		assert.False(t, c.Writer.Written())
		assert.Empty(t, recorder.Body.String())
	case <-time.After(5 * time.Second):
		_ = writer.Close()
		t.Fatal("buffered response did not stop after client cancellation")
	}
}

func TestOaiNonStreamReadFailureBeforeDelivery(t *testing.T) {
	for _, failure := range []string{"idle timeout", "read error"} {
		t.Run(failure, func(t *testing.T) {
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, "", false)
			if failure == "idle timeout" {
				constant.StreamingTimeout = 1
				reader, writer := io.Pipe()
				resp.Body = reader
				t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
			} else {
				resp.Body = io.NopCloser(io.MultiReader(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"), iotest.ErrReader(io.ErrUnexpectedEOF)))
			}
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.NotNil(t, apiErr)
			assert.Nil(t, usage)
			assert.False(t, c.Writer.Written())
			assert.Empty(t, recorder.Body.String())
		})
	}
}

func TestOaiNonStreamForceFormatPreservesRefusal(t *testing.T) {
	for _, body := range []string{
		"data: {\"choices\":[{\"index\":0,\"delta\":{\"refusal\":\"Cannot answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
		`{"choices":[{"index":0,"message":{"role":"assistant","refusal":"Cannot answer"},"finish_reason":"stop"}]}`,
	} {
		c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, false)
		info.ChannelSetting.ForceFormat = true
		usage, apiErr := OaiStreamHandler(c, info, resp)
		require.Nil(t, apiErr)
		require.NotNil(t, usage)
		assert.Equal(t, "Cannot answer", gjson.GetBytes(recorder.Body.Bytes(), "choices.0.message.refusal").String())
	}
}

func TestOaiStreamPreservesSSEAndRejectsEmptyOutput(t *testing.T) {
	for _, tc := range []struct {
		name  string
		body  string
		valid bool
	}{
		{"normal stream", "data: {\"id\":\"chat_1\",\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", true},
		{"empty stream after bookkeeping", "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"total_tokens\":11}}\n\ndata: [DONE]\n\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, tc.body, true)
			usage, apiErr := OaiStreamHandler(c, info, resp)
			if tc.valid {
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Contains(t, recorder.Header().Get("Content-Type"), "text/event-stream")
				assert.Contains(t, recorder.Body.String(), "hello")
				assert.Contains(t, recorder.Body.String(), "data: [DONE]")
				return
			}
			require.NotNil(t, apiErr)
			assert.Nil(t, usage)
			assert.True(t, c.Writer.Written())
			assert.True(t, types.IsSkipRetryError(apiErr), "an already started response cannot be retried")
			assert.NotContains(t, recorder.Body.String(), "data: [DONE]", "an empty stream must not emit a success terminator")
		})
	}
}

// Flush snapshots cross a channel so the test never races the streaming writer.
type streamFlushRecorder struct {
	*httptest.ResponseRecorder
	flushed chan string
}

func (r *streamFlushRecorder) Flush() {
	r.ResponseRecorder.Flush()
	select {
	case r.flushed <- r.Body.String():
	default:
	}
}

func TestOaiStreamDeliversOutputBeforeNextFrame(t *testing.T) {
	for _, tc := range []struct {
		name   string
		format types.RelayFormat
		delta  string
		want   string
	}{
		{"OpenAI text", types.RelayFormatOpenAI, `"content":"hello"`, `"content":"hello"`},
		{"Claude text", types.RelayFormatClaude, `"content":"hello"`, `"text":"hello"`},
		{"Gemini text", types.RelayFormatGemini, `"content":"hello"`, `"text":"hello"`},
		{"reasoning", types.RelayFormatOpenAI, `"reasoning_content":"thinking"`, `"reasoning_content":"thinking"`},
		{"tool call", types.RelayFormatOpenAI, `"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]`, `"name":"lookup"`},
		{"refusal", types.RelayFormatOpenAI, `"refusal":"Cannot answer"`, `"refusal":"Cannot answer"`},
		{"audio", types.RelayFormatOpenAI, `"audio":{"data":"YWJj"}`, `"data":"YWJj"`},
		{"Completions", types.RelayFormatOpenAI, `"content":"hello"`, `"text":"hello"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, "", true)
			info.RelayFormat = tc.format
			info.StartTime = time.Now()
			if tc.name == "Completions" {
				info.RelayMode = relayconstant.RelayModeCompletions
			}
			writer := &streamFlushRecorder{ResponseRecorder: recorder, flushed: make(chan string, 16)}
			streamCtx, _ := gin.CreateTestContext(writer)
			streamCtx.Request = c.Request
			c = streamCtx
			reader, upstream := io.Pipe()
			resp.Body = reader
			t.Cleanup(func() { _ = upstream.Close(); _ = reader.Close() })
			type result struct {
				usage *dto.Usage
				err   *types.NewAPIError
			}
			finished := make(chan result, 1)
			go func() {
				usage, apiErr := OaiStreamHandler(c, info, resp)
				finished <- result{usage: usage, err: apiErr}
			}()
			frame := `data: {"id":"chat_immediate","model":"gpt-test","choices":[{"index":0,"delta":{` + tc.delta + `}}]}`
			if tc.name == "Completions" {
				frame = `data: {"id":"cmpl_immediate","model":"gpt-test","choices":[{"index":0,"text":"hello"}]}`
			}
			_, err := io.WriteString(upstream, frame+"\n\n")
			require.NoError(t, err)
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			visible := false
			for !visible {
				select {
				case snapshot := <-writer.flushed:
					visible = strings.Contains(snapshot, tc.want)
				case <-deadline.C:
					t.Fatal("first output was held waiting for another upstream frame")
				}
			}
			_, err = io.WriteString(upstream, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":3,\"total_tokens\":14}}\n\ndata: [DONE]\n\n")
			require.NoError(t, err)
			select {
			case got := <-finished:
				require.Nil(t, got.err)
				require.NotNil(t, got.usage)
				assert.Equal(t, 3, got.usage.CompletionTokens)
				assert.Equal(t, 1, strings.Count(recorder.Body.String(), tc.want))
				timing := info.TimingSnapshot()
				require.Contains(t, timing, "first_output_received_ms")
				require.Contains(t, timing, "first_output_written_ms")
				require.Contains(t, timing, "response_completed_ms")
				assert.LessOrEqual(t, timing["first_output_received_ms"], timing["first_output_written_ms"])
				assert.LessOrEqual(t, timing["first_output_written_ms"], timing["response_completed_ms"])
			case <-deadline.C:
				t.Fatal("stream did not finish after DONE")
			}
		})
	}
}

func TestOaiStreamUsageAndFinalization(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		for _, terminal := range []string{"stop", ""} {
			t.Run(string(format)+" finish="+terminal, func(t *testing.T) {
				frames := []string{
					`data: {"id":"chat_usage","model":"gpt-test","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"` + terminal + `"}],"usage":{"prompt_tokens":11,"completion_tokens":1,"total_tokens":12}}`,
					`data: {"choices":[],"usage":{"prompt_tokens":14,"completion_tokens":3,"total_tokens":17,"prompt_tokens_details":{"cached_tokens":7}}}`,
					`data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`,
					`data: [DONE]`, "",
				}
				c, recorder, resp, info := newChatCompletionResponseTestContext(t, strings.Join(frames, "\n\n"), true)
				info.RelayFormat = format
				info.ShouldIncludeUsage = false
				usage, apiErr := OaiStreamHandler(c, info, resp)
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Equal(t, 14, usage.PromptTokens)
				assert.Equal(t, 3, usage.CompletionTokens)
				assert.Equal(t, 7, usage.PromptTokensDetails.CachedTokens)
				assert.Equal(t, 1, strings.Count(recorder.Body.String(), "hello"))
				if format == types.RelayFormatOpenAI {
					assert.NotContains(t, recorder.Body.String(), `"choices":[]`)
				}
				if format == types.RelayFormatClaude {
					assert.Equal(t, 1, strings.Count(recorder.Body.String(), "event: message_stop\n"))
					assert.Contains(t, recorder.Body.String(), `"output_tokens":3`)
					assert.Contains(t, recorder.Body.String(), `"cache_read_input_tokens":7`)
				}
			})
		}
	}
}

func TestOaiStreamThinkingConversionDoesNotRepeatPayload(t *testing.T) {
	body := "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"think_once\"}}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"answer_once\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
	c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, true)
	info.ChannelSetting.ThinkingToContent = true
	info.ThinkingContentInfo.IsFirstThinkingContent = true
	usage, apiErr := OaiStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	var content strings.Builder
	for line := range strings.SplitSeq(recorder.Body.String(), "\n") {
		if data, ok := strings.CutPrefix(line, "data: "); ok {
			content.WriteString(gjson.Get(data, "choices.0.delta.content").String())
		}
	}
	for _, value := range []string{"<think>", "</think>", "think_once", "answer_once"} {
		assert.Equal(t, 1, strings.Count(content.String(), value))
	}
}

func TestOaiStreamDoesNotReplayLastPayload(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		for _, tool := range []bool{false, true} {
			name := string(format)
			delta := `"content":"unique_answer"`
			finish := "stop"
			if tool {
				name += " tool"
				delta = `"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"unique_lookup","arguments":"{}"}}]`
				finish = "tool_calls"
			}
			t.Run(name, func(t *testing.T) {
				body := `data: {"id":"chat_single","model":"gpt-test","choices":[{"index":0,"delta":{` + delta + `},"finish_reason":"` + finish + `"}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}` + "\n\ndata: [DONE]\n\n"
				c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, true)
				info.RelayFormat = format
				usage, apiErr := OaiStreamHandler(c, info, resp)
				require.Nil(t, apiErr)
				require.NotNil(t, usage)
				assert.Equal(t, 11, usage.PromptTokens)
				assert.Equal(t, 3, usage.CompletionTokens)
				want := "unique_answer"
				if tool {
					want = "unique_lookup"
				}
				assert.Equal(t, 1, strings.Count(recorder.Body.String(), want))
				if format == types.RelayFormatClaude {
					assert.Equal(t, 1, strings.Count(recorder.Body.String(), "event: message_start\n"))
					assert.Equal(t, 1, strings.Count(recorder.Body.String(), "event: message_delta\n"))
					assert.Equal(t, 1, strings.Count(recorder.Body.String(), "event: message_stop\n"))
				}
			})
		}
	}
}

func TestOaiStreamBookkeepingOnlyRemainsSafeToRetry(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		for _, tc := range []struct {
			name         string
			frame        string
			includeUsage bool
		}{
			{"role only", `{"choices":[{"index":0,"delta":{"role":"assistant"}}]}`, true},
			{"usage only", `{"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":0,"total_tokens":11}}`, true},
			{"usage excluded", `{"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":0,"total_tokens":11}}`, false},
		} {
			t.Run(string(format)+" "+tc.name, func(t *testing.T) {
				c, recorder, resp, info := newChatCompletionResponseTestContext(t, "data: "+tc.frame+"\n\ndata: [DONE]\n\n", true)
				info.RelayFormat = format
				info.ShouldIncludeUsage = tc.includeUsage
				usage, apiErr := OaiStreamHandler(c, info, resp)
				require.NotNil(t, apiErr)
				assert.Nil(t, usage)
				assert.False(t, c.Writer.Written(), "an empty response must leave another channel safe to retry")
				assert.False(t, types.IsSkipRetryError(apiErr))
				assert.Empty(t, recorder.Body.String())
				timing := info.TimingSnapshot()
				for _, key := range []string{"first_output_received_ms", "first_output_written_ms", "response_completed_ms"} {
					assert.NotContains(t, timing, key)
				}
			})
		}
	}
}

func TestOaiStreamClaudeTruncationDoesNotEmitSuccessTerminal(t *testing.T) {
	for _, readErr := range []error{nil, io.ErrUnexpectedEOF} {
		name := "EOF"
		if readErr != nil {
			name = "reader error"
		}
		t.Run(name, func(t *testing.T) {
			body := `data: {"id":"chat_partial","choices":[{"index":0,"delta":{"content":"partial_answer"}}]}` + "\n\n"
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, true)
			info.RelayFormat = types.RelayFormatClaude
			if readErr != nil {
				resp.Body = io.NopCloser(io.MultiReader(strings.NewReader(body), iotest.ErrReader(readErr)))
			}
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Contains(t, recorder.Body.String(), "partial_answer")
			assert.NotContains(t, recorder.Body.String(), "event: message_delta\n")
			assert.NotContains(t, recorder.Body.String(), "event: message_stop\n")
			timing := info.TimingSnapshot()
			assert.Contains(t, timing, "first_output_received_ms")
			assert.Contains(t, timing, "first_output_written_ms")
			assert.NotContains(t, timing, "response_completed_ms")
		})
	}
}

func TestOaiStreamContentFilterHasNoFirstOutputTiming(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		t.Run(string(format), func(t *testing.T) {
			body := `data: {"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}],"usage":{"prompt_tokens":11,"completion_tokens":0,"total_tokens":11}}` + "\n\ndata: [DONE]\n\n"
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, true)
			info.RelayFormat = format
			usage, apiErr := OaiStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.True(t, info.PerformanceBusinessRejection)
			assert.NotEmpty(t, recorder.Body.String())
			timing := info.TimingSnapshot()
			assert.NotContains(t, timing, "first_output_received_ms")
			assert.NotContains(t, timing, "first_output_written_ms")
			assert.Contains(t, timing, "response_completed_ms")
		})
	}
}

type partialStreamWriteRecorder struct {
	*httptest.ResponseRecorder
}

func (r *partialStreamWriteRecorder) Write(data []byte) (int, error) {
	n, _ := r.ResponseRecorder.Write(data[:min(3, len(data))])
	return n, io.ErrClosedPipe
}

func TestOaiStreamPartialWriteDoesNotRecordOutputDelivery(t *testing.T) {
	for _, format := range []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude, types.RelayFormatGemini} {
		t.Run(string(format), func(t *testing.T) {
			body := `data: {"choices":[{"index":0,"delta":{"content":"undelivered"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}` + "\n\ndata: [DONE]\n\n"
			c, recorder, resp, info := newChatCompletionResponseTestContext(t, body, true)
			info.RelayFormat = format
			streamCtx, _ := gin.CreateTestContext(&partialStreamWriteRecorder{ResponseRecorder: recorder})
			streamCtx.Request = c.Request
			usage, apiErr := OaiStreamHandler(streamCtx, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.True(t, info.StreamStatus.HasErrors())
			assert.NotEmpty(t, recorder.Body.String(), "the failed writer reports bytes written with an error")
			assert.NotContains(t, recorder.Body.String(), "undelivered")
			timing := info.TimingSnapshot()
			assert.Contains(t, timing, "first_output_received_ms")
			assert.NotContains(t, timing, "first_output_written_ms")
			assert.NotContains(t, timing, "response_completed_ms")
		})
	}
}
