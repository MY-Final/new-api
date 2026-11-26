package router

import (
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const (
	seoMetaPlaceholder     = "<!--seo-meta-->"
	seoNoscriptPlaceholder = "<!--seo-noscript-->"
)

var (
	htmlTitlePattern       = regexp.MustCompile(`(?is)<title>.*?</title>`)
	metaTitlePattern       = regexp.MustCompile(`(?is)<meta\s+name="title"\s+content="[^"]*"\s*/?>`)
	metaDescriptionPattern = regexp.MustCompile(`(?is)<meta\s+name="description"\s+content="[^"]*"\s*/?>`)
)

type seoPageMeta struct {
	title       string
	description string
	keywords    string
	indexable   bool
	includeLD   bool
}

type seoSitemapEntry struct {
	path       string
	changefreq string
	priority   string
}

var seoSitemapEntries = []seoSitemapEntry{
	{path: "/", changefreq: "daily", priority: "1.0"},
	{path: "/pricing", changefreq: "daily", priority: "0.9"},
	{path: "/rankings", changefreq: "daily", priority: "0.8"},
	{path: "/showcase", changefreq: "weekly", priority: "0.7"},
	{path: "/about", changefreq: "monthly", priority: "0.6"},
	{path: "/contact", changefreq: "monthly", priority: "0.5"},
	{path: "/user-agreement", changefreq: "yearly", priority: "0.3"},
	{path: "/privacy-policy", changefreq: "yearly", priority: "0.3"},
}

var robotsDisallowPaths = []string{
	"/api/",
	"/v1/",
	"/mj/",
	"/pg/",
	"/oauth/",
	"/sign-in",
	"/sign-up",
	"/register",
	"/forgot-password",
	"/reset",
	"/user/reset",
	"/otp",
	"/desktop/",
	"/setup",
	"/dashboard",
	"/keys",
	"/usage",
	"/usage-logs",
	"/wallet",
	"/finance",
	"/ledger",
	"/channels",
	"/models",
	"/users",
	"/system-settings",
	"/system-info",
	"/tickets",
	"/ticket-management",
	"/monitoring",
	"/security",
	"/profile",
	"/playground",
	"/chat",
	"/canvas",
	"/canvas-history",
	"/task-plugins",
	"/subscriptions",
	"/subscription-plans",
	"/subscription-dashboard",
	"/redemption-codes",
	"/invite-codes",
	"/affiliate-rebates",
	"/entertainment",
	"/intelligence-test",
	"/request-processing",
	"/error-requests",
	"/errors",
	"/embed",
	"/chat2link",
}

func serveRobotsTxt(c *gin.Context) {
	baseURL := resolveRequestOrigin(c)
	var b strings.Builder
	b.WriteString("User-agent: *\n")
	b.WriteString("Allow: /\n")
	for _, p := range robotsDisallowPaths {
		b.WriteString("Disallow: ")
		b.WriteString(p)
		b.WriteByte('\n')
	}
	if baseURL != "" {
		b.WriteString("Sitemap: ")
		b.WriteString(baseURL)
		b.WriteString("/sitemap.xml\n")
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(b.String()))
}

func serveSitemapXML(c *gin.Context) {
	baseURL := resolveRequestOrigin(c)
	if baseURL == "" {
		baseURL = resolveCanonicalOrigin(c)
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, entry := range seoSitemapEntries {
		loc := baseURL + entry.path
		b.WriteString("  <url>\n")
		b.WriteString("    <loc>")
		b.WriteString(html.EscapeString(loc))
		b.WriteString("</loc>\n")
		b.WriteString("    <changefreq>")
		b.WriteString(entry.changefreq)
		b.WriteString("</changefreq>\n")
		b.WriteString("    <priority>")
		b.WriteString(entry.priority)
		b.WriteString("</priority>\n")
		b.WriteString("  </url>\n")
	}
	b.WriteString("</urlset>\n")
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, "application/xml; charset=utf-8", []byte(b.String()))
}

func renderSEOIndexPage(c *gin.Context, indexPage []byte) []byte {
	raw := string(indexPage)
	if !strings.Contains(raw, "<head>") && !strings.Contains(raw, seoMetaPlaceholder) {
		return indexPage
	}

	systemName := strings.TrimSpace(common.SystemName)
	if systemName == "" {
		systemName = "New API"
	}

	urlPath := c.Request.URL.Path
	if urlPath == "" {
		urlPath = "/"
	}
	meta := resolveSEOPageMeta(systemName, urlPath)

	escapedTitle := html.EscapeString(meta.title)
	escapedDesc := html.EscapeString(meta.description)

	if htmlTitlePattern.MatchString(raw) {
		raw = htmlTitlePattern.ReplaceAllString(raw, "<title>"+escapedTitle+"</title>")
	}
	if metaTitlePattern.MatchString(raw) {
		raw = metaTitlePattern.ReplaceAllString(raw, `<meta name="title" content="`+escapedTitle+`" />`)
	}
	if metaDescriptionPattern.MatchString(raw) {
		raw = metaDescriptionPattern.ReplaceAllString(raw, `<meta name="description" content="`+escapedDesc+`" />`)
	}

	headTags := buildSEOHeadTags(c, systemName, urlPath, meta)
	if strings.Contains(raw, seoMetaPlaceholder) {
		raw = strings.Replace(raw, seoMetaPlaceholder, headTags, 1)
	} else if strings.Contains(raw, "</head>") {
		raw = strings.Replace(raw, "</head>", headTags+"\n  </head>", 1)
	}

	if meta.indexable {
		noscriptHTML := buildSEONoscript(systemName, meta)
		if strings.Contains(raw, seoNoscriptPlaceholder) {
			raw = strings.Replace(raw, seoNoscriptPlaceholder, noscriptHTML, 1)
		}
	} else {
		raw = strings.Replace(raw, seoNoscriptPlaceholder, "", 1)
	}

	return []byte(raw)
}

func resolveSEOPageMeta(systemName, urlPath string) seoPageMeta {
	keywords := fmt.Sprintf("%s, AI API Gateway, Unified LLM API, OpenAI API, Claude API, Gemini API, DeepSeek API, 大模型API聚合, AI接口中转, API分发网关", systemName)
	switch {
	case urlPath == "/" || urlPath == "/index.html":
		return seoPageMeta{
			title:       fmt.Sprintf("%s - Unified AI Model API Gateway | 统一大模型 API 聚合网关", systemName),
			description: fmt.Sprintf("%s is a unified AI model API gateway supporting OpenAI, Claude, Gemini, DeepSeek and more with pay-as-you-go billing and high availability. %s 提供稳定高效的统一大模型 API 聚合服务，兼容 OpenAI、Claude、Gemini、DeepSeek 等主流模型。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
			includeLD:   true,
		}
	case urlPath == "/pricing" || strings.HasPrefix(urlPath, "/pricing/"):
		return seoPageMeta{
			title:       fmt.Sprintf("Model Pricing & Marketplace - %s | 模型广场与价格表", systemName),
			description: fmt.Sprintf("Explore supported AI models, real-time token pricing, billing ratios, and endpoint details on %s. 查看 %s 支持的 AI 模型列表、实时计费价格、倍率与接口详情。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/rankings":
		return seoPageMeta{
			title:       fmt.Sprintf("Model Usage Rankings - %s | 模型用量排行榜", systemName),
			description: fmt.Sprintf("Discover popular AI models and usage trends on %s. 查看 %s 平台热门 AI 模型排行与调用趋势。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/showcase":
		return seoPageMeta{
			title:       fmt.Sprintf("Ecosystem Showcase - %s | 生态应用展示", systemName),
			description: fmt.Sprintf("Applications and developer tools powered by %s AI API gateway. 基于 %s 大模型 API 网关构建的应用与开发工具展示。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/about":
		return seoPageMeta{
			title:       fmt.Sprintf("About - %s | 关于我们", systemName),
			description: fmt.Sprintf("Learn more about %s, our unified AI API gateway architecture, reliability, and supported providers. 了解 %s 统一 AI API 网关的服务介绍与支持能力。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/contact":
		return seoPageMeta{
			title:       fmt.Sprintf("Contact - %s | 联系我们", systemName),
			description: fmt.Sprintf("Contact %s support and developer team. 联系 %s 技术支持与服务团队。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/privacy-policy":
		return seoPageMeta{
			title:       fmt.Sprintf("Privacy Policy - %s | 隐私政策", systemName),
			description: fmt.Sprintf("Privacy Policy for %s. %s 隐私政策说明。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	case urlPath == "/user-agreement":
		return seoPageMeta{
			title:       fmt.Sprintf("User Agreement - %s | 用户协议", systemName),
			description: fmt.Sprintf("Terms of Service and User Agreement for %s. %s 服务条款与用户协议。", systemName, systemName),
			keywords:    keywords,
			indexable:   true,
		}
	default:
		return seoPageMeta{
			title:       systemName,
			description: fmt.Sprintf("%s - Unified AI Model API Gateway. 统一大模型 API 聚合网关。", systemName),
			indexable:   false,
		}
	}
}

func buildSEOHeadTags(c *gin.Context, systemName, urlPath string, meta seoPageMeta) string {
	var b strings.Builder
	if !meta.indexable {
		b.WriteString(`<meta name="robots" content="noindex, nofollow" />`)
		return b.String()
	}

	b.WriteString(`<meta name="robots" content="index, follow" />` + "\n")
	if meta.keywords != "" {
		b.WriteString(`    <meta name="keywords" content="` + html.EscapeString(meta.keywords) + `" />` + "\n")
	}

	canonicalOrigin := resolveCanonicalOrigin(c)
	if canonicalOrigin != "" {
		canonicalURL := canonicalOrigin + urlPath
		escapedCanonical := html.EscapeString(canonicalURL)
		b.WriteString(`    <link rel="canonical" href="` + escapedCanonical + `" />` + "\n")
		b.WriteString(`    <meta property="og:url" content="` + escapedCanonical + `" />` + "\n")
	}

	escapedSite := html.EscapeString(systemName)
	escapedTitle := html.EscapeString(meta.title)
	escapedDesc := html.EscapeString(meta.description)

	b.WriteString(`    <meta property="og:type" content="website" />` + "\n")
	b.WriteString(`    <meta property="og:site_name" content="` + escapedSite + `" />` + "\n")
	b.WriteString(`    <meta property="og:title" content="` + escapedTitle + `" />` + "\n")
	b.WriteString(`    <meta property="og:description" content="` + escapedDesc + `" />` + "\n")
	b.WriteString(`    <meta property="og:locale" content="zh_CN" />` + "\n")
	b.WriteString(`    <meta property="og:locale:alternate" content="en_US" />` + "\n")
	b.WriteString(`    <meta name="twitter:card" content="summary_large_image" />` + "\n")
	b.WriteString(`    <meta name="twitter:title" content="` + escapedTitle + `" />` + "\n")
	b.WriteString(`    <meta name="twitter:description" content="` + escapedDesc + `" />`)

	if meta.includeLD {
		if ld := buildJSONLD(systemName, meta.description, canonicalOrigin); ld != "" {
			b.WriteString("\n    <script type=\"application/ld+json\">" + ld + "</script>")
		}
	}

	return b.String()
}

func buildJSONLD(systemName, description, origin string) string {
	graph := []map[string]any{
		{
			"@type":       "WebSite",
			"name":        systemName,
			"url":         origin,
			"description": description,
			"inLanguage":  []string{"zh-CN", "en"},
		},
		{
			"@type":               "SoftwareApplication",
			"name":                systemName,
			"applicationCategory": "DeveloperApplication",
			"operatingSystem":     "Web",
			"url":                 origin,
			"description":         description,
		},
	}
	payload := map[string]any{
		"@context": "https://schema.org",
		"@graph":   graph,
	}
	raw, err := common.Marshal(payload)
	if err != nil {
		return ""
	}
	// Prevent closing </script> injection inside JSON-LD.
	return strings.ReplaceAll(string(raw), "</", `<\/`)
}

func buildSEONoscript(systemName string, meta seoPageMeta) string {
	return fmt.Sprintf(
		`<noscript><main><h1>%s</h1><p>%s</p><nav><a href="/pricing">Model Pricing / 模型广场</a> | <a href="/rankings">Rankings / 排行榜</a> | <a href="/about">About / 关于</a></nav></main></noscript>`,
		html.EscapeString(systemName),
		html.EscapeString(meta.description),
	)
}

func resolveCanonicalOrigin(c *gin.Context) string {
	if configured := strings.TrimSpace(system_setting.ServerAddress); configured != "" {
		if parsed, err := url.Parse(configured); err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	return resolveRequestOrigin(c)
}

func resolveRequestOrigin(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if first, _, found := strings.Cut(host, ","); found {
		host = strings.TrimSpace(first)
	}
	if host == "" {
		host = strings.TrimSpace(c.Request.Host)
	}
	if !isSafeHost(host) {
		return ""
	}

	proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if first, _, found := strings.Cut(proto, ","); found {
		proto = strings.TrimSpace(first)
	}
	if proto != "http" && proto != "https" {
		if c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	return proto + "://" + host
}

func isSafeHost(host string) bool {
	if host == "" || strings.ContainsAny(host, " \t\r\n/\\<>\"'") {
		return false
	}
	parsed, err := url.Parse("https://" + host)
	return err == nil && parsed.Host == host
}
