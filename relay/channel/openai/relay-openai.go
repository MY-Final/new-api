package openai

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel/openrouter"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/tokenkit"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

func sendStreamData(c *gin.Context, info *relaycommon.RelayInfo, data string, forceFormat bool, thinkToContent bool) error {
	if data == "" {
		return nil
	}

	if !forceFormat && !thinkToContent {
		return helper.StringData(c, data)
	}

	var lastStreamResponse dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &lastStreamResponse); err != nil {
		return err
	}

	if !thinkToContent {
		return helper.ObjectData(c, lastStreamResponse)
	}

	hasThinkingContent := false
	hasContent := false
	var thinkingContent strings.Builder
	for _, choice := range lastStreamResponse.Choices {
		if len(choice.Delta.GetReasoningContent()) > 0 {
			hasThinkingContent = true
			thinkingContent.WriteString(choice.Delta.GetReasoningContent())
		}
		if len(choice.Delta.GetContentString()) > 0 {
			hasContent = true
		}
	}

	// Handle think to content conversion
	if info.ThinkingContentInfo.IsFirstThinkingContent {
		if hasThinkingContent {
			response := lastStreamResponse.Copy()
			for i := range response.Choices {
				// send `think` tag with thinking content
				response.Choices[i].Delta.SetContentString("<think>\n" + thinkingContent.String())
				response.Choices[i].Delta.ReasoningContent = nil
				response.Choices[i].Delta.Reasoning = nil
			}
			info.ThinkingContentInfo.IsFirstThinkingContent = false
			info.ThinkingContentInfo.HasSentThinkingContent = true
			return helper.ObjectData(c, response)
		}
	}

	if lastStreamResponse.Choices == nil || len(lastStreamResponse.Choices) == 0 {
		return helper.ObjectData(c, lastStreamResponse)
	}

	// Process each choice
	for i, choice := range lastStreamResponse.Choices {
		// Handle transition from thinking to content
		// only send `</think>` tag when previous thinking content has been sent
		if hasContent && !info.ThinkingContentInfo.SendLastThinkingContent && info.ThinkingContentInfo.HasSentThinkingContent {
			response := lastStreamResponse.Copy()
			for j := range response.Choices {
				response.Choices[j].Delta.SetContentString("\n</think>\n")
				response.Choices[j].Delta.ReasoningContent = nil
				response.Choices[j].Delta.Reasoning = nil
			}
			info.ThinkingContentInfo.SendLastThinkingContent = true
			if err := helper.ObjectData(c, response); err != nil {
				return err
			}
		}

		// Convert reasoning content to regular content if any
		if len(choice.Delta.GetReasoningContent()) > 0 {
			lastStreamResponse.Choices[i].Delta.SetContentString(choice.Delta.GetReasoningContent())
			lastStreamResponse.Choices[i].Delta.ReasoningContent = nil
			lastStreamResponse.Choices[i].Delta.Reasoning = nil
		} else if !hasThinkingContent && !hasContent {
			// flush thinking content
			lastStreamResponse.Choices[i].Delta.ReasoningContent = nil
			lastStreamResponse.Choices[i].Delta.Reasoning = nil
		}
	}

	return helper.ObjectData(c, lastStreamResponse)
}

func OaiStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, common.LogText("invalid response or response body"))
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	if info.RelayMode == relayconstant.RelayModeChatCompletions {
		clientStream := info.IsStream
		if info.Request != nil {
			clientStream = info.Request.IsStream(c.Request)
		} else if value, exists := c.Get(string(constant.ContextKeyIsStream)); exists {
			clientStream, _ = value.(bool)
		}
		if !clientStream {
			info.IsStream = false
			return OpenaiHandler(c, info, resp)
		}
	}

	defer service.CloseResponseBodyGracefully(resp)

	model := info.UpstreamModelName
	var responseId string
	var createAt int64 = 0
	var systemFingerprint string
	var containStreamUsage bool
	var responseTextBuilder strings.Builder
	var toolCount int
	var usage = &dto.Usage{}
	var lastStreamData string
	var pendingStreamData string
	var secondLastStreamData string // 保留倒数第二个stream data；部分兼容网关把完整usage放在倒数第二个事件
	seenStreamToolCalls := make(map[string]struct{})
	var streamFunctionCallNames []string
	var hasOutput bool
	var firstOutputReceived, firstOutputWritten bool

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if data == "" {
			return
		}
		frame := gjson.Parse(data)
		frameHasOutput := hasChatCompletionOutput(frame, true)
		frameIsRejection := false
		for _, choice := range frame.Get("choices").Array() {
			frameIsRejection = frameIsRejection || choice.Get("finish_reason").String() == constant.FinishReasonContentFilter
		}
		if info.RelayMode == relayconstant.RelayModeCompletions {
			for _, choice := range frame.Get("choices").Array() {
				frameHasOutput = frameHasOutput || choice.Get("text").String() != ""
			}
		}
		hasOutput = hasOutput || frameHasOutput || frameIsRejection
		isFirstFrame := lastStreamData == ""
		if lastStreamData != "" {
			secondLastStreamData = lastStreamData
		}
		lastStreamData = data
		if frameHasOutput && !firstOutputReceived {
			info.MarkFirstOutputReceivedAt(sr.DataReceivedAt)
			firstOutputReceived = true
		}
		observeStreamChoices(info, data, seenStreamToolCalls, &streamFunctionCallNames)
		if err := processTokenData(info, data, &responseTextBuilder, &toolCount); err != nil {
			logger.LogError(c, common.LogText("error processing stream token data: %s", err.Error()))
			sr.Error(err)
		}

		// Keep tail snapshots for accounting, but never hold output for the next frame.
		if info.RelayFormat == types.RelayFormatOpenAI && !info.ShouldIncludeUsage &&
			len(frame.Get("choices").Array()) == 0 && frame.Get("usage").IsObject() {
			return
		}
		// Preserve the safe retry of a single bookkeeping-only response.
		// Meaningful output is always sent in this callback, without a frame delay.
		if isFirstFrame && !hasOutput {
			pendingStreamData = data
			return
		}
		if pendingStreamData != "" {
			if err := HandleStreamFormat(c, info, pendingStreamData, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent, true); err != nil {
				sr.Error(err)
				return
			}
			pendingStreamData = ""
		}
		sizeBefore := c.Writer.Size()
		if err := HandleStreamFormat(c, info, data, info.ChannelSetting.ForceFormat, info.ChannelSetting.ThinkingToContent, true); err != nil {
			sr.Error(err)
		} else if info.RelayFormat == types.RelayFormatOpenAI && frameHasOutput &&
			!firstOutputWritten && c.Writer.Size() > sizeBefore && c.Request.Context().Err() == nil {
			info.MarkFirstOutputWritten()
			firstOutputWritten = true
		}
	})

	info.StreamStatus.RequireTerminal()
	if info.RelayMode == relayconstant.RelayModeChatCompletions && !hasOutput {
		apiErr := types.NewOpenAIError(fmt.Errorf("upstream returned no chat completion output"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
		info.StreamStatus.MarkFailed(string(apiErr.GetErrorCode()), apiErr.ToOpenAIError().Type, apiErr.StatusCode)
		if c.Writer.Written() {
			types.ErrOptionWithSkipRetry()(apiErr)
		}
		return nil, apiErr
	}

	// 处理最后的响应
	if err := handleLastResponse(lastStreamData, &responseId, &createAt, &systemFingerprint, &model, &usage,
		&containStreamUsage); err != nil {
		logger.LogError(c, common.LogText("error handling last response: %s, lastStreamData: [%s]", err.Error(), lastStreamData))
	}

	// 部分兼容网关把完整的累计usage附在倒数第二个事件上，随后发送一个空的最后事件。
	// 仅当最后一个事件没有有效usage时，回退到倒数第二个事件的完整快照。
	usageFrame := lastStreamData
	if !containStreamUsage && secondLastStreamData != "" {
		var streamResp struct {
			Usage *dto.Usage `json:"usage"`
		}
		err := common.Unmarshal([]byte(secondLastStreamData), &streamResp)
		if err == nil && streamResp.Usage != nil &&
			streamResp.Usage.PromptTokens > 0 &&
			(streamResp.Usage.CompletionTokens > 0 || streamResp.Usage.TotalTokens > 0) {
			usage = dto.MergeUsageNonZero(usage, streamResp.Usage)
			containStreamUsage = true
			usageFrame = secondLastStreamData

			if common.DebugEnabled {
				logger.LogDebug(c, "usage extracted from second last SSE: PromptTokens=%d, CompletionTokens=%d, TotalTokens=%d, InputTokens=%d, OutputTokens=%d",
					usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens,
					usage.InputTokens, usage.OutputTokens)
			}
		}
	}

	if !containStreamUsage {
		usage = service.ResponseText2Usage(c, responseTextBuilder.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
		usage.CompletionTokens += toolCount * 7
	}

	applyUsagePostProcessing(info, usage, common.StringToByteSlice(usageFrame))

	for _, name := range streamFunctionCallNames {
		info.CountBillableToolCall(dto.BuildInCallFunctionCall, name)
	}

	if c.Request.Context().Err() == nil && info.StreamStatus.IsNormalEnd() && !info.StreamStatus.HasErrors() &&
		(info.StreamStatus.EndReason == relaycommon.StreamEndReasonDone || info.StreamStatus.ResponseOutcome() == string(relaycommon.ResponseOutcomeCompleted)) {
		if err := HandleFinalResponse(c, info, lastStreamData, responseId, createAt, model, systemFingerprint, usage, containStreamUsage, true); err != nil {
			info.StreamStatus.RecordError(err.Error())
		} else if c.Request.Context().Err() == nil {
			info.MarkResponseCompleted()
		}
	}

	return usage, nil
}

// hasChatCompletionOutput excludes bookkeeping-only responses without rejecting
// tool calls, reasoning, multimodal output, or an explicit safety refusal.
func hasChatCompletionOutput(response gjson.Result, stream bool) bool {
	for _, choice := range response.Get("choices").Array() {
		message := choice.Get("message")
		if stream {
			message = choice.Get("delta")
		}
		for _, field := range []string{"content", "reasoning_content", "reasoning", "refusal"} {
			value := message.Get(field)
			if value.Type == gjson.String && value.String() != "" {
				return true
			}
			for _, part := range value.Array() {
				if part.Get("text").String() != "" || part.Get("image_url.url").String() != "" || part.Get("refusal").String() != "" {
					return true
				}
			}
		}
		for _, tool := range message.Get("tool_calls").Array() {
			if tool.Get("function.name").String() != "" || tool.Get("function.arguments").String() != "" {
				return true
			}
		}
		for _, field := range []string{"function_call.name", "function_call.arguments", "audio.data", "audio.transcript"} {
			if message.Get(field).String() != "" {
				return true
			}
		}
	}
	return false
}

// bufferChatCompletionStream builds the same JSON response OpenaiHandler already
// validates, converts, and accounts for. Nothing is written before validation.
func bufferChatCompletionStream(body []byte, info *relaycommon.RelayInfo) ([]byte, error) {
	response := map[string]any{"object": "chat.completion", "model": info.UpstreamModelName}
	choices := make(map[int]map[string]any)
	var usage *dto.Usage
	var sawDone bool
	if info.StreamStatus == nil {
		info.StreamStatus = relaycommon.NewStreamStatus()
	}
	info.StreamStatus.RequireTerminal()
	scanner := helper.NewStreamScanner(bytes.NewReader(body))
	for scanner.Scan() {
		data, ok := strings.CutPrefix(scanner.Text(), "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			sawDone = true
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
			break
		}
		if data == "" {
			continue
		}
		var frame struct {
			ID                string  `json:"id"`
			Model             string  `json:"model"`
			Created           int64   `json:"created"`
			SystemFingerprint *string `json:"system_fingerprint"`
			Choices           []struct {
				Index        int            `json:"index"`
				Delta        map[string]any `json:"delta"`
				FinishReason *string        `json:"finish_reason"`
				Logprobs     map[string]any `json:"logprobs"`
			} `json:"choices"`
			Usage *dto.Usage `json:"usage"`
			Error any        `json:"error"`
		}
		if err := common.UnmarshalJsonStr(data, &frame); err != nil {
			return nil, fmt.Errorf("invalid chat completion stream: %w", err)
		}
		if frame.Error != nil {
			return nil, fmt.Errorf("upstream chat completion stream returned an error")
		}
		info.SetFirstResponseTime()
		info.ReceivedResponseCount++
		if frame.ID != "" {
			response["id"] = frame.ID
		}
		if frame.Model != "" {
			response["model"] = frame.Model
		}
		if frame.Created != 0 {
			response["created"] = frame.Created
		}
		if frame.SystemFingerprint != nil {
			response["system_fingerprint"] = *frame.SystemFingerprint
		}
		if frame.Usage == nil {
			frame.Usage = &dto.Usage{}
		}
		applyUsagePostProcessing(info, frame.Usage, common.StringToByteSlice(data))
		usage = dto.MergeUsageNonZero(usage, frame.Usage)
		for _, delta := range frame.Choices {
			if tools, ok := delta.Delta["tool_calls"].([]any); ok {
				for _, item := range tools {
					tool, ok := item.(map[string]any)
					if !ok {
						return nil, fmt.Errorf("invalid chat completion tool call")
					}
					if value, exists := tool["index"]; exists {
						index, ok := value.(float64)
						if !ok || index < 0 || index != math.Trunc(index) {
							return nil, fmt.Errorf("invalid chat completion tool index")
						}
					} else if id, _ := tool["id"].(string); id == "" {
						return nil, fmt.Errorf("chat completion tool call has no index or id")
					}
					if value, exists := tool["id"]; exists {
						if _, ok := value.(string); !ok {
							return nil, fmt.Errorf("invalid chat completion tool id")
						}
					}
				}
			}
			choice := choices[delta.Index]
			if choice == nil {
				choice = map[string]any{"index": delta.Index, "message": map[string]any{"role": "assistant", "content": nil}, "finish_reason": nil}
				choices[delta.Index] = choice
			}
			mergeChatCompletionDelta(choice["message"].(map[string]any), delta.Delta)
			if delta.FinishReason != nil && *delta.FinishReason != "" {
				choice["finish_reason"] = *delta.FinishReason
				info.StreamStatus.MarkCompleted()
			}
			if delta.Logprobs != nil {
				if choice["logprobs"] == nil {
					choice["logprobs"] = make(map[string]any)
				}
				mergeChatCompletionDelta(choice["logprobs"].(map[string]any), delta.Logprobs)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonEOF, nil)
	indexes := make([]int, 0, len(choices))
	for index := range choices {
		indexes = append(indexes, index)
	}
	slices.Sort(indexes)
	ordered := make([]map[string]any, 0, len(indexes))
	for _, index := range indexes {
		choice := choices[index]
		if !sawDone && choice["finish_reason"] == nil {
			return nil, fmt.Errorf("upstream chat completion stream ended without completion")
		}
		message := choice["message"].(map[string]any)
		if tools, ok := message["tool_calls"].([]any); ok {
			for _, tool := range tools {
				delete(tool.(map[string]any), "index")
			}
		}
		ordered = append(ordered, choice)
	}
	response["choices"] = ordered
	response["usage"] = usage
	return common.Marshal(response)
}

// mergeChatCompletionDelta preserves compatible extensions while joining only
// fragment fields; tool calls are joined by index rather than appended per chunk.
func mergeChatCompletionDelta(message, delta map[string]any) {
	for field, value := range delta {
		switch value := value.(type) {
		case string:
			switch field {
			case "content", "reasoning_content", "reasoning", "refusal", "arguments", "name", "data", "transcript":
				previous, _ := message[field].(string)
				message[field] = previous + value
			default:
				message[field] = value
			}
		case map[string]any:
			previous, _ := message[field].(map[string]any)
			if previous == nil {
				previous = make(map[string]any)
				message[field] = previous
			}
			mergeChatCompletionDelta(previous, value)
		case []any:
			previous, _ := message[field].([]any)
			if field != "tool_calls" {
				message[field] = append(previous, value...)
				continue
			}
			for _, item := range value {
				tool, ok := item.(map[string]any)
				if !ok {
					continue
				}
				var existing map[string]any
				for _, candidate := range previous {
					call := candidate.(map[string]any)
					index, indexed := tool["index"].(float64)
					previousIndex, previousIndexed := call["index"].(float64)
					id, _ := tool["id"].(string)
					previousID, _ := call["id"].(string)
					if indexed && previousIndexed && index == previousIndex || !indexed && id != "" && id == previousID {
						existing = call
						break
					}
				}
				if existing == nil {
					existing = make(map[string]any)
					previous = append(previous, existing)
				}
				mergeChatCompletionDelta(existing, tool)
			}
			message[field] = previous
		default:
			if value != nil {
				message[field] = value
			}
		}
	}
}

// observeStreamChoices collects billable function call names and records the
// finish reason facts used by health sampling from one parsed chunk.
func observeStreamChoices(info *relaycommon.RelayInfo, data string, seen map[string]struct{}, names *[]string) {
	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
		return
	}
	for _, choice := range streamResponse.Choices {
		if choice.FinishReason != nil && *choice.FinishReason != "" {
			if *choice.FinishReason == constant.FinishReasonContentFilter {
				info.PerformanceBusinessRejection = true
			}
			info.StreamStatus.MarkCompleted()
		}
		for i, tc := range choice.Delta.ToolCalls {
			name := strings.TrimSpace(tc.Function.Name)
			if name == "" {
				continue
			}
			toolIdx := i
			if tc.Index != nil {
				toolIdx = *tc.Index
			}
			fallbackKey := fmt.Sprintf("index\x00%d\x00%d\x00%s", choice.Index, toolIdx, name)
			activeKey := fmt.Sprintf("active\x00%d\x00%d\x00%s", choice.Index, toolIdx, name)
			callID := strings.TrimSpace(tc.ID)
			if callID != "" {
				idKey := fmt.Sprintf("id\x00%d\x00%s", choice.Index, callID)
				if _, ok := seen[idKey]; ok {
					continue
				}
				seen[idKey] = struct{}{}
				seen[activeKey] = struct{}{}
				if _, delayedID := seen[fallbackKey]; delayedID {
					delete(seen, fallbackKey)
					continue
				}
			} else {
				if _, ok := seen[fallbackKey]; ok {
					continue
				}
				if _, ok := seen[activeKey]; ok {
					continue
				}
				seen[fallbackKey] = struct{}{}
				seen[activeKey] = struct{}{}
			}
			*names = append(*names, name)
		}
	}
}

func OpenaiHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusBadGateway)
	}
	defer service.CloseResponseBodyGracefully(resp)

	var simpleResponse dto.OpenAITextResponse
	var responseBody []byte
	var err error
	bufferedChatStream := info.RelayMode == relayconstant.RelayModeChatCompletions && strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream")
	if bufferedChatStream {
		var body bytes.Buffer
		helper.StreamScannerHandler(c, resp, info, func(line string, result *helper.StreamResult) {
			if strings.TrimSpace(line) != "" {
				info.SetFirstResponseTime()
			}
			body.WriteString(line)
			body.WriteByte('\n')
			data, ok := strings.CutPrefix(line, "data:")
			if ok && strings.TrimSpace(data) == "[DONE]" {
				result.Done()
			}
		}, helper.StreamScannerOptions{Buffered: true, RawLines: true})
		if requestErr := c.Request.Context().Err(); requestErr != nil {
			return nil, types.NewErrorWithStatusCode(requestErr, types.ErrorCodeDoRequestFailed, http.StatusRequestTimeout, types.ErrOptionWithSkipRetry())
		}
		if !info.StreamStatus.IsNormalEnd() || info.StreamStatus.HasErrors() {
			return nil, types.NewOpenAIError(fmt.Errorf("failed to read chat completion response: %s", info.StreamStatus.EndReason), types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway)
		}
		responseBody = bytes.TrimSuffix(body.Bytes(), []byte{'\n'})
	} else {
		responseBody, err = io.ReadAll(resp.Body)
	}
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	if requestErr := c.Request.Context().Err(); requestErr != nil {
		return nil, types.NewErrorWithStatusCode(requestErr, types.ErrorCodeDoRequestFailed, http.StatusRequestTimeout, types.ErrOptionWithSkipRetry())
	}
	logger.LogDebug(c, "upstream response body: %s", responseBody)
	if info.RelayMode == relayconstant.RelayModeChatCompletions {
		if !gjson.ValidBytes(responseBody) {
			responseBody, err = bufferChatCompletionStream(responseBody, info)
			if err != nil {
				info.StreamStatus.MarkFailed(string(types.ErrorCodeBadResponseBody), string(types.ErrorCodeBadResponseBody), http.StatusBadGateway)
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
			}
			bufferedChatStream = true
		}
		// Both buffered SSE and JSON mislabeled as SSE are JSON to this client.
		if resp.Header == nil {
			resp.Header = make(http.Header)
		}
		resp.Header.Set("Content-Type", "application/json; charset=utf-8")
		resp.Header.Del("Transfer-Encoding")
	}
	// Unmarshal to simpleResponse
	if info.ChannelType == constant.ChannelTypeOpenRouter && info.ChannelOtherSettings.IsOpenRouterEnterprise() {
		// 尝试解析为 openrouter enterprise
		var enterpriseResponse openrouter.OpenRouterEnterpriseResponse
		err = common.Unmarshal(responseBody, &enterpriseResponse)
		if err != nil {
			return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		if enterpriseResponse.Success {
			responseBody = enterpriseResponse.Data
		} else {
			logger.LogError(c, common.LogText("openrouter enterprise response success=false, data: %s", enterpriseResponse.Data))
			return nil, types.NewOpenAIError(fmt.Errorf("openrouter response success=false"), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
	}

	err = common.Unmarshal(responseBody, &simpleResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	if oaiError := simpleResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}
	hasOutput := hasChatCompletionOutput(gjson.ParseBytes(responseBody), false)
	info.ObserveResponseModel(simpleResponse.Model)
	for _, choice := range simpleResponse.Choices {
		if choice.FinishReason == constant.FinishReasonContentFilter {
			hasOutput = true
			info.PerformanceBusinessRejection = true
			common.SetContextKey(c, constant.ContextKeyAdminRejectReason, "openai_finish_reason=content_filter")
			break
		}
	}
	if info.RelayMode == relayconstant.RelayModeChatCompletions && !hasOutput {
		info.StreamStatus.MarkFailed(string(types.ErrorCodeBadResponseBody), string(types.ErrorCodeBadResponseBody), http.StatusBadGateway)
		return nil, types.NewOpenAIError(fmt.Errorf("upstream returned no chat completion output"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}

	for _, choice := range simpleResponse.Choices {
		for _, tc := range choice.Message.ParseToolCalls() {
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, tc.Function.Name)
		}
	}
	info.ApplyVendorToolUsage(responseBody)

	forceFormat := false
	if info.ChannelSetting.ForceFormat {
		forceFormat = true
	}

	usageModified := false
	if simpleResponse.Usage.PromptTokens == 0 {
		completionTokens := simpleResponse.Usage.CompletionTokens
		if completionTokens == 0 {
			for _, choice := range simpleResponse.Choices {
				ctkm := tokenkit.Count(info.UpstreamModelName, choice.Message.StringContent()+choice.Message.GetReasoningContent())
				completionTokens += ctkm
			}
		}
		fallbackUsage := &dto.Usage{
			PromptTokens:     info.GetEstimatePromptTokens(),
			CompletionTokens: completionTokens,
			TotalTokens:      info.GetEstimatePromptTokens() + completionTokens,
		}
		simpleResponse.Usage = *fallbackUsage
		usageModified = true
	}

	applyUsagePostProcessing(info, &simpleResponse.Usage, responseBody)

	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		if usageModified {
			var bodyMap map[string]any
			err = common.Unmarshal(responseBody, &bodyMap)
			if err != nil {
				return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
			bodyMap["usage"] = simpleResponse.Usage
			responseBody, _ = common.Marshal(bodyMap)
		}
		// Buffered chat is already normalized; the legacy DTO drops extensions
		// such as refusal, function_call, and audio from that response.
		if forceFormat && !bufferedChatStream {
			responseBody, err = common.Marshal(simpleResponse)
			if err != nil {
				return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
			}
		} else {
			break
		}
	case types.RelayFormatClaude:
		convertResult, err := service.ConvertResponse(c, info, types.RelayFormatClaude, &simpleResponse)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		claudeRespStr, err := common.Marshal(convertResult.Value)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		responseBody = claudeRespStr
	case types.RelayFormatGemini:
		convertResult, err := service.ConvertResponse(c, info, types.RelayFormatGemini, &simpleResponse)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		geminiRespStr, err := common.Marshal(convertResult.Value)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		responseBody = geminiRespStr
	}

	service.IOCopyBytesGracefully(c, resp, responseBody)

	return &simpleResponse.Usage, nil
}
