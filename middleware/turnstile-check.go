package middleware

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

type turnstileCheckResponse struct {
	Success bool `json:"success"`
}

func TurnstileCheck(scene string) gin.HandlerFunc {
	return func(c *gin.Context) {
		common.OptionMapRWMutex.RLock()
		enabled := common.TurnstileCheckEnabled && system_setting.GetTurnstileSettings().EnabledFor(scene)
		secret := common.TurnstileSecretKey
		common.OptionMapRWMutex.RUnlock()
		if enabled && !c.GetBool(magpieAccessTokenContextKey) {
			response := c.Query("turnstile")
			if response == "" {
				common.ApiErrorT(c, "Turnstile token is empty")
				c.Abort()
				return
			}
			if len(response) > 2048 || secret == "" {
				common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
				c.Abort()
				return
			}
			form := url.Values{
				"secret":   {secret},
				"response": {response},
				"remoteip": {c.ClientIP()},
			}
			request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
				"https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
			if err != nil {
				common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
				c.Abort()
				return
			}
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			client := &http.Client{Timeout: 10 * time.Second}
			rawRes, err := client.Do(request)
			if err != nil {
				common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
				c.Abort()
				return
			}
			defer rawRes.Body.Close()
			var res turnstileCheckResponse
			err = common.DecodeJson(rawRes.Body, &res)
			if err != nil || rawRes.StatusCode != http.StatusOK {
				common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
				c.Abort()
				return
			}
			if !res.Success {
				common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
				c.Abort()
				return
			}
		}
		c.Next()
	}
}
