package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testIndexHTML = `<!doctype html>
<html lang="en">
  <head>
    <title>New API</title>
    <meta name="title" content="New API" />
    <meta name="description" content="Unified AI API gateway and admin dashboard." />
    <!--seo-meta-->
  </head>
  <body>
    <div id="root"></div>
    <!--seo-noscript-->
  </body>
</html>`

func newTestSEORouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	SetWebRouter(r, WebAssets{IndexPage: []byte(testIndexHTML)}, func(c *gin.Context) { c.Next() })
	return r
}

func TestSEORobotsAndSitemapAcrossDomains(t *testing.T) {
	r := newTestSEORouter()

	for _, host := range []string{"kuncode.120403.xyz", "wcnmb.fun", "wcnmb.si"} {
		t.Run(host, func(t *testing.T) {
			robotsReq := httptest.NewRequest(http.MethodGet, "/robots.txt", nil)
			robotsReq.Host = host
			robotsReq.Header.Set("X-Forwarded-Proto", "https")
			robotsResp := httptest.NewRecorder()
			r.ServeHTTP(robotsResp, robotsReq)

			require.Equal(t, http.StatusOK, robotsResp.Code)
			assert.Contains(t, robotsResp.Header().Get("Content-Type"), "text/plain")
			assert.Contains(t, robotsResp.Body.String(), "Disallow: /api/")
			assert.Contains(t, robotsResp.Body.String(), "Disallow: /dashboard")
			assert.Contains(t, robotsResp.Body.String(), "Sitemap: https://"+host+"/sitemap.xml")

			sitemapReq := httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil)
			sitemapReq.Host = host
			sitemapReq.Header.Set("X-Forwarded-Proto", "https")
			sitemapResp := httptest.NewRecorder()
			r.ServeHTTP(sitemapResp, sitemapReq)

			require.Equal(t, http.StatusOK, sitemapResp.Code)
			assert.Contains(t, sitemapResp.Header().Get("Content-Type"), "application/xml")
			assert.Contains(t, sitemapResp.Body.String(), "<loc>https://"+host+"/</loc>")
			assert.Contains(t, sitemapResp.Body.String(), "<loc>https://"+host+"/pricing</loc>")
			assert.Contains(t, sitemapResp.Body.String(), "<loc>https://"+host+"/rankings</loc>")
		})
	}
}

func TestSEOIndexPageInjection(t *testing.T) {
	origSystemName := common.SystemName
	origServerAddress := system_setting.ServerAddress
	t.Cleanup(func() {
		common.SystemName = origSystemName
		system_setting.ServerAddress = origServerAddress
	})

	common.SystemName = "KunRouter"
	system_setting.ServerAddress = "https://kuncode.120403.xyz"

	r := newTestSEORouter()

	t.Run("public home page injects bilingual meta, canonical, OG and JSON-LD", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = "wcnmb.fun"
		req.Header.Set("X-Forwarded-Proto", "https")
		resp := httptest.NewRecorder()
		r.ServeHTTP(resp, req)

		require.Equal(t, http.StatusOK, resp.Code)
		body := resp.Body.String()
		assert.Contains(t, body, "<title>KunRouter - Unified AI Model API Gateway | 统一大模型 API 聚合网关</title>")
		assert.Contains(t, body, `<meta name="robots" content="index, follow" />`)
		assert.Contains(t, body, `<link rel="canonical" href="https://kuncode.120403.xyz/" />`)
		assert.Contains(t, body, `<meta property="og:site_name" content="KunRouter" />`)
		assert.Contains(t, body, `application/ld+json`)
		assert.Contains(t, body, `<noscript><main><h1>KunRouter</h1>`)
	})

	t.Run("public pricing page injects pricing title", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/pricing", nil)
		req.Host = "wcnmb.si"
		req.Header.Set("X-Forwarded-Proto", "https")
		resp := httptest.NewRecorder()
		r.ServeHTTP(resp, req)

		require.Equal(t, http.StatusOK, resp.Code)
		body := resp.Body.String()
		assert.Contains(t, body, "<title>Model Pricing &amp; Marketplace - KunRouter | 模型广场与价格表</title>")
		assert.Contains(t, body, `<link rel="canonical" href="https://kuncode.120403.xyz/pricing" />`)
	})

	t.Run("private console page is marked noindex", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/dashboard", nil)
		req.Host = "kuncode.120403.xyz"
		resp := httptest.NewRecorder()
		r.ServeHTTP(resp, req)

		require.Equal(t, http.StatusOK, resp.Code)
		body := resp.Body.String()
		assert.Contains(t, body, `<meta name="robots" content="noindex, nofollow" />`)
		assert.NotContains(t, body, `application/ld+json`)
		assert.NotContains(t, body, `<noscript>`)
	})
}
