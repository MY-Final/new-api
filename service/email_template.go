package service

import (
	"bytes"
	"errors"
	"fmt"
	"html"
	"html/template"
	"maps"
	"strings"
	texttemplate "text/template"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// RenderEmailLayout wraps template content in the shared responsive shell using
// the configured brand and footer, so every outgoing message looks consistent.
func RenderEmailLayout(content string) string {
	layout := system_setting.EmailTemplateLayout()
	values := map[string]string{"SystemName": common.SystemName}
	return renderEmailLayoutWith(content, renderEmailText(layout.Brand, values), renderEmailText(layout.Footer, values))
}

func renderEmailLayoutWith(content string, brand string, footer string) string {
	if strings.TrimSpace(brand) == "" {
		brand = common.SystemName
	}
	if strings.TrimSpace(footer) == "" {
		footer = brand
	}
	return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">` +
		`<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">` +
		`<div style="padding:18px 24px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:600;color:#111827;">` + html.EscapeString(brand) + `</div>` +
		`<div style="padding:24px;font-size:14px;line-height:1.7;">` + content + `</div>` +
		`<div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#fafafa;color:#9ca3af;font-size:12px;">` + html.EscapeString(footer) + `</div>` +
		`</div></body></html>`
}

// renderEmailText renders a plain-text template such as the brand or footer.
// Invalid templates fall back to an empty value instead of failing the email.
func renderEmailText(source string, values map[string]string) string {
	if strings.TrimSpace(source) == "" {
		return ""
	}
	parsed, err := texttemplate.New("text").Option("missingkey=zero").Parse(source)
	if err != nil {
		return ""
	}
	var rendered bytes.Buffer
	if err := parsed.Execute(&rendered, values); err != nil {
		return ""
	}
	return rendered.String()
}

// RenderEmailTemplate resolves the effective template, renders subject and body
// with the supplied variables and returns the body wrapped in the shared
// layout. Variables are HTML-escaped inside the body.
func RenderEmailTemplate(key string, vars map[string]string) (string, string, error) {
	effective, _, ok := system_setting.EmailTemplateFor(key)
	if !ok {
		return "", "", fmt.Errorf("unknown email template %q", key)
	}
	return renderEmailTemplate(effective, vars, system_setting.EmailTemplateLayout())
}

// PreviewEmailTemplate renders unsaved editor values with the sample data for
// that template, so the admin sees exactly what recipients would receive.
func PreviewEmailTemplate(key string, subject string, body string, brand string, footer string) (string, string, error) {
	spec, ok := system_setting.EmailTemplateSpecFor(key)
	if !ok {
		return "", "", fmt.Errorf("unknown email template %q", key)
	}
	if err := system_setting.ValidateEmailTemplateEntry(key, subject, body); err != nil {
		return "", "", err
	}
	if err := system_setting.ValidateEmailLayoutEntry(brand, footer); err != nil {
		return "", "", err
	}
	effective := system_setting.EmailTemplate{Subject: subject, Body: body}
	if strings.TrimSpace(effective.Subject) == "" {
		effective.Subject = spec.DefaultSubject
	}
	if strings.TrimSpace(effective.Body) == "" {
		effective.Body = spec.DefaultBody
	}
	return renderEmailTemplate(effective, spec.Sample, system_setting.EmailLayout{Brand: brand, Footer: footer})
}

func renderEmailTemplate(effective system_setting.EmailTemplate, vars map[string]string, layout system_setting.EmailLayout) (string, string, error) {
	values := map[string]string{"SystemName": common.SystemName}
	maps.Copy(values, vars)
	brand := renderEmailText(layout.Brand, values)
	if strings.TrimSpace(brand) == "" {
		brand = common.SystemName
	}
	values["Brand"] = brand
	subject, err := texttemplate.New("subject").Option("missingkey=zero").Parse(effective.Subject)
	if err != nil {
		return "", "", errors.New("Invalid email template subject")
	}
	var renderedSubject bytes.Buffer
	if err := subject.Execute(&renderedSubject, values); err != nil {
		return "", "", errors.New("Invalid email template subject")
	}
	body, err := template.New("body").Option("missingkey=zero").Parse(effective.Body)
	if err != nil {
		return "", "", errors.New("Invalid email template body")
	}
	var renderedBody bytes.Buffer
	if err := body.Execute(&renderedBody, values); err != nil {
		return "", "", errors.New("Invalid email template body")
	}
	return renderedSubject.String(), renderEmailLayoutWith(renderedBody.String(), brand, renderEmailText(layout.Footer, values)), nil
}

func SendTemplateEmail(receiver string, key string, vars map[string]string) error {
	subject, body, err := RenderEmailTemplate(key, vars)
	if err != nil {
		return err
	}
	return common.SendEmail(subject, receiver, body)
}
