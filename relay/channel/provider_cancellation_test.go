package channel_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/relay/channel/coze"
	"github.com/QuantumNous/new-api/relay/channel/dify"
	"github.com/QuantumNous/new-api/relay/channel/jimeng"
	"github.com/QuantumNous/new-api/relay/channel/replicate"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProviderRequestsStopOnClientCancellation(t *testing.T) {
	service.InitHttpClient()
	tests := []struct {
		name string
		path string
		run  func(*gin.Context, *relaycommon.RelayInfo) error
	}{
		{
			name: "coze poll", path: "/v3/chat/retrieve",
			run: func(c *gin.Context, info *relaycommon.RelayInfo) error {
				_, err := (&coze.Adaptor{}).DoRequest(c, info, strings.NewReader("{}"))
				return err
			},
		},
		{
			name: "coze detail", path: "/v3/chat/message/list",
			run: func(c *gin.Context, info *relaycommon.RelayInfo) error {
				_, err := (&coze.Adaptor{}).DoRequest(c, info, strings.NewReader("{}"))
				return err
			},
		},
		{
			name: "dify upload", path: "/v1/files/upload",
			run: func(c *gin.Context, info *relaycommon.RelayInfo) error {
				message := dto.Message{Role: "user"}
				message.SetMediaContent([]dto.MediaContent{{
					Type:     dto.ContentTypeImageURL,
					ImageUrl: &dto.MessageImageUrl{Url: "data:image/png;base64,aGVsbG8="},
				}})
				_, err := (&dify.Adaptor{}).ConvertOpenAIRequest(c, info, &dto.GeneralOpenAIRequest{User: []byte("\"test-user\""), Messages: []dto.Message{message}})
				return err
			},
		},
		{
			name: "replicate upload", path: "/v1/files",
			run: func(c *gin.Context, info *relaycommon.RelayInfo) error {
				info.RelayMode = relayconstant.RelayModeImagesEdits
				_, err := (&replicate.Adaptor{}).ConvertImageRequest(c, info, dto.ImageRequest{Prompt: "edit this image"})
				return err
			},
		},
		{
			name: "jimeng request", path: "/",
			run: func(c *gin.Context, info *relaycommon.RelayInfo) error {
				_, err := (&jimeng.Adaptor{}).DoRequest(c, info, strings.NewReader("{}"))
				return err
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			started := make(chan struct{})
			canceled := make(chan struct{})
			release := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if r.URL.Path != tt.path {
					_, _ = io.WriteString(w, "{\"code\":0,\"data\":{\"id\":\"chat\",\"conversation_id\":\"conversation\",\"status\":\"completed\"}}")
					return
				}
				close(started)
				select {
				case <-r.Context().Done():
					close(canceled)
				case <-release:
				}
			}))
			defer upstream.Close()
			defer close(release)
			requestContext, cancel := context.WithCancel(context.Background())
			defer cancel()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			file, err := writer.CreateFormFile("image", "image.png")
			require.NoError(t, err)
			_, err = io.WriteString(file, "image bytes")
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", &body).WithContext(requestContext)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: upstream.URL, ApiKey: "ak|sk"}}
			done := make(chan error, 1)
			go func() { done <- tt.run(c, info) }()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("provider request did not start")
			}
			cancel()
			select {
			case err := <-done:
				if tt.name != "dify upload" {
					require.Error(t, err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("provider request did not stop after client cancellation")
			}
			select {
			case <-canceled:
			case <-time.After(2 * time.Second):
				t.Fatal("upstream did not observe client cancellation")
			}
		})
	}
}

func TestCozeStreamCancellationPreservesUsage(t *testing.T) {
	tests := []struct {
		name     string
		event    string
		canceled bool
		want     *dto.Usage
	}{
		{
			name:     "provider usage",
			event:    "event: conversation.chat.completed\ndata: {\"usage\":{\"input_count\":5,\"output_count\":3,\"token_count\":8}}\n\n",
			canceled: true,
			want:     &dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8},
		},
		{
			name:     "partial output",
			event:    "event: conversation.message.delta\ndata: {\"content\":\"hello\"}\n\n",
			canceled: true,
			want:     &dto.Usage{PromptTokens: 5, CompletionTokens: 1, TotalTokens: 6},
		},
		{name: "upstream failure", event: "", canceled: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			requestContext, cancel := context.WithCancel(context.Background())
			defer cancel()
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(requestContext)
			c.Set("coze_input_count", 5)
			reader, writer := io.Pipe()
			defer reader.Close()
			done := make(chan struct{})
			go func() {
				_, _ = io.WriteString(writer, tt.event)
				if tt.canceled {
					cancel()
					_ = writer.CloseWithError(context.Canceled)
				} else {
					_ = writer.CloseWithError(errors.New("upstream interrupted"))
				}
				close(done)
			}()
			info := &relaycommon.RelayInfo{IsStream: true, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-4o"}}
			usage, apiErr := (&coze.Adaptor{}).DoResponse(c, &http.Response{Body: reader}, info)
			<-done
			if !tt.canceled {
				require.NotNil(t, apiErr)
				assert.Nil(t, usage)
				return
			}
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, tt.want, usage)
			assert.NotContains(t, recorder.Body.String(), "[DONE]")
			require.NotNil(t, info.StreamStatus)
			assert.Equal(t, relaycommon.StreamEndReasonClientGone, info.StreamStatus.EndReason)
			assert.ErrorIs(t, info.StreamStatus.EndError, context.Canceled)
			service.MarkRequestPolicySuccess(c, info.StreamStatus)
			assert.False(t, service.RequestPolicy(c).Successful, "interrupted output must not be audited as a completed request")
		})
	}
}
