package system_setting

import (
	"errors"
	"fmt"
	"html/template"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
)

// EmailTemplatesOption stores administrator overrides for transactional email.
// A template that is missing or blank falls back to the built-in default.
const EmailTemplatesOption = "EmailTemplates"

// EmailTemplateDefaultsOption is a computed, read-only option that exposes the
// built-in templates so the admin editor can show and restore them.
const EmailTemplateDefaultsOption = "EmailTemplateDefaults"

// EmailLayoutOption stores the brand and footer used by the shared email shell.
const EmailLayoutOption = "EmailLayout"

const (
	emailTemplateSubjectLimit = 200
	emailTemplateBodyLimit    = 20000
	emailBrandLimit           = 60
	emailFooterLimit          = 300
)

type EmailTemplate struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

type EmailTemplateSpec struct {
	Key            string
	DefaultSubject string
	DefaultBody    string
	Variables      []string
	// HTMLVariables are rendered as trusted HTML instead of text. They are
	// always produced by the server, never by user input.
	HTMLVariables []string
	// Sample values replace the variables in the admin preview.
	Sample map[string]string
}

type EmailTemplateDefault struct {
	Key       string   `json:"key"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Variables []string `json:"variables"`
}

type EmailLayout struct {
	Brand  string `json:"brand"`
	Footer string `json:"footer"`
}

// EmailTemplateSpecs is the ordered catalog rendered by the admin editor.
func EmailTemplateSpecs() []EmailTemplateSpec {
	return []EmailTemplateSpec{
		{
			Key:            "verify",
			DefaultSubject: "{{.SystemName}}邮箱验证邮件",
			DefaultBody: "<p>您好，你正在进行{{.SystemName}}邮箱验证。</p>" +
				"<p>您的验证码为: <strong>{{.Code}}</strong></p>" +
				"<p>验证码 {{.Minutes}} 分钟内有效，如果不是本人操作，请忽略。</p>",
			Variables: []string{"SystemName", "Brand", "Code", "Minutes"},
			Sample:    map[string]string{"Code": "123456", "Minutes": "10"},
		},
		{
			Key:            "reset",
			DefaultSubject: "{{.SystemName}}密码重置",
			DefaultBody: "<p>您好，你正在进行{{.SystemName}}密码重置。</p>" +
				"<p>点击 <a href=\"{{.Link}}\">此处</a> 进行密码重置。</p>" +
				"<p>如果链接无法点击，请复制下面的链接到浏览器中打开：<br>{{.Link}}</p>" +
				"<p>重置链接 {{.Minutes}} 分钟内有效，如果不是本人操作，请忽略。</p>",
			Variables: []string{"SystemName", "Brand", "Link", "Minutes"},
			Sample: map[string]string{
				"Link":    "https://example.com/user/reset?email=user%40example.com&token=ABC123",
				"Minutes": "10",
			},
		},
		{
			Key:            "binding",
			DefaultSubject: "{{.SystemName}} — 邮箱变更确认",
			DefaultBody: "<p>检测到账号邮箱变更请求{{if .Email}}：<strong>{{.Email}}</strong>{{end}}。</p>" +
				"<p>验证码：<strong>{{.Code}}</strong></p>" +
				"<p>验证码 {{.Minutes}} 分钟内有效。如果这不是你本人操作，请不要泄露验证码。</p>",
			Variables: []string{"SystemName", "Brand", "Email", "Code", "Minutes"},
			Sample: map[string]string{
				"Email":   "new-address@example.com",
				"Code":    "123456",
				"Minutes": "10",
			},
		},
		{
			Key:            "quota",
			DefaultSubject: "{{.Title}}",
			DefaultBody: "<p>{{.Title}}</p>" +
				"<p>当前剩余额度：<strong>{{.Remaining}}</strong></p>" +
				"<p>为了不影响您的使用，请及时充值：<a href=\"{{.TopUpLink}}\">{{.TopUpLink}}</a></p>",
			Variables: []string{"SystemName", "Brand", "Title", "Remaining", "TopUpLink"},
			Sample: map[string]string{
				"Title":     "您的额度即将用尽",
				"Remaining": "5,000",
				"TopUpLink": "https://example.com/wallet",
			},
		},
		{
			Key:            "security",
			DefaultSubject: "{{.SystemName}} — 账号安全提醒",
			DefaultBody: "<p>你的账号安全设置发生了变更：{{.Event}}。</p>" +
				"<p>如果这不是你本人操作，请立即检查账号安全设置、退出其他登录会话，并联系管理员。</p>",
			Variables: []string{"SystemName", "Brand", "Event"},
			Sample:    map[string]string{"Event": "password changed"},
		},
		{
			Key:            "ticket",
			DefaultSubject: "[{{.SystemName}}] {{.Kind}} #{{.TicketID}}: {{.Title}}",
			DefaultBody: "<p>{{.Kind}}</p><ul>" +
				"<li><strong>Ticket ID:</strong> #{{.TicketID}}</li>" +
				"<li><strong>Title:</strong> {{.Title}}</li>" +
				"<li><strong>Category:</strong> {{.Category}}</li>" +
				"<li><strong>Status:</strong> {{.Status}}</li>" +
				"<li><strong>User:</strong> {{.User}}</li>" +
				"</ul><pre style=\"white-space:pre-wrap;font-family:inherit\">{{.Content}}</pre>",
			Variables: []string{
				"SystemName", "Brand", "Kind", "TicketID", "Title", "Category", "Status", "User", "Content",
			},
			Sample: map[string]string{
				"Kind":     "New ticket",
				"TicketID": "12",
				"Title":    "Cannot call gpt-4o",
				"Category": "api",
				"Status":   "pending",
				"User":     "alice",
				"Content":  "The request returns 500 since this morning.",
			},
		},
		{
			Key:            "usage",
			DefaultSubject: "{{.SystemName}} — 用量日报",
			DefaultBody: "<p style=\"margin:0 0 4px;font-size:15px;font-weight:600;\">{{.Greeting}}</p>" +
				"<p style=\"margin:0 0 16px;color:#6b7280;font-size:13px;\">{{.DateRange}}</p>" +
				"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:separate;border-spacing:8px 0;\"><tr>" +
				"<td width=\"33%\" style=\"border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;\"><div style=\"color:#6b7280;font-size:12px;\">请求数</div><div style=\"font-size:18px;font-weight:600;margin-top:2px;\">{{.RequestCount}}</div></td>" +
				"<td width=\"33%\" style=\"border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;\"><div style=\"color:#6b7280;font-size:12px;\">额度消耗</div><div style=\"font-size:18px;font-weight:600;margin-top:2px;\">{{.Quota}}</div></td>" +
				"<td width=\"33%\" style=\"border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;\"><div style=\"color:#6b7280;font-size:12px;\">Tokens</div><div style=\"font-size:18px;font-weight:600;margin-top:2px;\">{{.TotalTokens}}</div></td>" +
				"</tr></table>" +
				"<p style=\"margin:12px 0 0;color:#4b5563;font-size:13px;\">{{.QuotaNote}}</p>" +
				"<p style=\"margin:20px 0 8px;font-size:14px;font-weight:600;\">{{.GroupTitle}}</p>" +
				"{{.GroupTable}}" +
				"<p style=\"margin:18px 0 0;color:#9ca3af;font-size:12px;\">{{.Footer}}</p>",
			Variables: []string{
				"SystemName", "Brand", "Greeting", "DateRange", "RequestCount", "Quota", "TotalTokens",
				"QuotaNote", "GroupTitle", "GroupTable", "Footer",
			},
			HTMLVariables: []string{"GroupTable"},
			Sample: map[string]string{
				"Greeting":     "alice，这是你 2026-10-21 的用量日报。",
				"DateRange":    "统计范围：2026-10-21 00:00–22:00（北京时间）",
				"RequestCount": "128",
				"Quota":        "$1.23",
				"TotalTokens":  "1,204,880",
				"QuotaNote":    "余额扣费 $1.00 · 订阅用量 $0.23 · 合计 $1.23",
				"GroupTitle":   "分组明细",
				"GroupTable": "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;font-size:13px;\">" +
					"<tr style=\"color:#6b7280;font-size:12px;text-align:left;\"><th style=\"padding:6px 4px;border-bottom:1px solid #e5e7eb;font-weight:500;\">分组</th><th style=\"padding:6px 4px;border-bottom:1px solid #e5e7eb;font-weight:500;\">请求数</th><th style=\"padding:6px 4px;border-bottom:1px solid #e5e7eb;font-weight:500;\">额度</th><th style=\"padding:6px 4px;border-bottom:1px solid #e5e7eb;font-weight:500;\">Tokens</th></tr>" +
					"<tr style=\"border-bottom:1px solid #f3f4f6;\"><td style=\"padding:8px 4px;\">default</td><td style=\"padding:8px 4px;\">128</td><td style=\"padding:8px 4px;\">$1.23</td><td style=\"padding:8px 4px;\">1,204,880</td></tr></table>",
				"Footer": "统计截止北京时间 22:00，完整数据请前往平台查看。",
			},
		},
	}
}

// EmailTemplateLayout reads the configured email shell. Blank values fall back
// to the system name when rendering.
func EmailTemplateLayout() EmailLayout {
	common.OptionMapRWMutex.RLock()
	raw := common.Interface2String(common.OptionMap[EmailLayoutOption])
	common.OptionMapRWMutex.RUnlock()
	layout := EmailLayout{}
	if raw == "" {
		return layout
	}
	if err := common.UnmarshalJsonStr(raw, &layout); err != nil {
		return EmailLayout{}
	}
	return layout
}

// ValidateEmailLayoutEntry validates brand and footer values coming from the
// editor, including the unsaved values used for a preview.
func ValidateEmailLayoutEntry(brand string, footer string) error {
	if strings.ContainsAny(brand, "\r\n") {
		return errors.New("Email brand must be a single line")
	}
	if err := validateEmailTemplateText(brand, emailBrandLimit); err != nil {
		return err
	}
	if err := validateEmailTemplateText(footer, emailFooterLimit); err != nil {
		return err
	}
	if _, err := template.New("brand").Parse(brand); err != nil {
		return errors.New("Invalid email brand template")
	}
	if _, err := template.New("footer").Parse(footer); err != nil {
		return errors.New("Invalid email footer template")
	}
	return nil
}

func ValidateEmailLayout(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var layout EmailLayout
	if err := common.UnmarshalJsonStr(value, &layout); err != nil {
		return errors.New("Invalid email layout configuration")
	}
	return ValidateEmailLayoutEntry(layout.Brand, layout.Footer)
}

// EmailTemplateSpecFor returns the single spec for key, if it exists.
func EmailTemplateSpecFor(key string) (EmailTemplateSpec, bool) {
	for _, spec := range EmailTemplateSpecs() {
		if spec.Key == key {
			return spec, true
		}
	}
	return EmailTemplateSpec{}, false
}

// EmailTemplates reads the stored overrides. Invalid JSON never breaks sending:
// it simply falls back to the built-in defaults.
func EmailTemplates() map[string]EmailTemplate {
	common.OptionMapRWMutex.RLock()
	raw := common.Interface2String(common.OptionMap[EmailTemplatesOption])
	common.OptionMapRWMutex.RUnlock()
	if raw == "" {
		return map[string]EmailTemplate{}
	}
	templates := map[string]EmailTemplate{}
	if err := common.UnmarshalJsonStr(raw, &templates); err != nil {
		return map[string]EmailTemplate{}
	}
	return templates
}

// EmailTemplateFor resolves the effective template for key.
func EmailTemplateFor(key string) (EmailTemplate, EmailTemplateSpec, bool) {
	for _, spec := range EmailTemplateSpecs() {
		if spec.Key != key {
			continue
		}
		effective := EmailTemplate{Subject: spec.DefaultSubject, Body: spec.DefaultBody}
		if custom, ok := EmailTemplates()[key]; ok {
			if strings.TrimSpace(custom.Subject) != "" {
				effective.Subject = custom.Subject
			}
			if strings.TrimSpace(custom.Body) != "" {
				effective.Body = custom.Body
			}
		}
		return effective, spec, true
	}
	return EmailTemplate{}, EmailTemplateSpec{}, false
}

// HasEmailTemplateOverride reports whether an administrator saved a custom
// template for key. Templates without an override keep the built-in localized
// content, so untouched installs are unaffected by the template feature.
func HasEmailTemplateOverride(key string) bool {
	template, ok := EmailTemplates()[key]
	if !ok {
		return false
	}
	return strings.TrimSpace(template.Subject) != "" || strings.TrimSpace(template.Body) != ""
}

func EmailTemplateDefaults() []EmailTemplateDefault {
	specs := EmailTemplateSpecs()
	defaults := make([]EmailTemplateDefault, 0, len(specs))
	for _, spec := range specs {
		defaults = append(defaults, EmailTemplateDefault{Key: spec.Key, Subject: spec.DefaultSubject, Body: spec.DefaultBody, Variables: spec.Variables})
	}
	return defaults
}

func EmailTemplateDefaultsJSON() string {
	encoded, err := common.Marshal(EmailTemplateDefaults())
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func validateEmailTemplateText(text string, limit int) error {
	if len(text) > limit {
		return fmt.Errorf("Email template is too long")
	}
	for _, character := range text {
		if unicode.IsControl(character) && character != '\n' && character != '\t' {
			return errors.New("Email template contains control characters")
		}
	}
	return nil
}

// ValidateEmailTemplateEntry validates one template exactly like the saved
// option, so the preview can reject the same input the editor cannot store.
func ValidateEmailTemplateEntry(key string, subject string, body string) error {
	if _, ok := EmailTemplateSpecFor(key); !ok {
		return fmt.Errorf("Unknown email template: %s", key)
	}
	if strings.ContainsAny(subject, "\r\n") {
		return errors.New("Email template subject must be a single line")
	}
	if err := validateEmailTemplateText(subject, emailTemplateSubjectLimit); err != nil {
		return err
	}
	if err := validateEmailTemplateText(body, emailTemplateBodyLimit); err != nil {
		return err
	}
	if _, err := template.New("subject").Parse(subject); err != nil {
		return fmt.Errorf("Invalid email template subject for %s", key)
	}
	if _, err := template.New("body").Parse(body); err != nil {
		return fmt.Errorf("Invalid email template body for %s", key)
	}
	return nil
}

func ValidateEmailTemplates(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	var templates map[string]EmailTemplate
	if err := common.UnmarshalJsonStr(value, &templates); err != nil {
		return errors.New("Invalid email template configuration")
	}
	known := make(map[string]struct{})
	for _, spec := range EmailTemplateSpecs() {
		known[spec.Key] = struct{}{}
	}
	for key, tpl := range templates {
		if _, ok := known[key]; !ok {
			return fmt.Errorf("Unknown email template: %s", key)
		}
		if err := ValidateEmailTemplateEntry(key, tpl.Subject, tpl.Body); err != nil {
			return err
		}
	}
	return nil
}
