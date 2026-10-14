package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubEmailTemplates replaces the option map with the given template overrides.
func stubEmailTemplates(t *testing.T, raw string) {
	t.Helper()
	options := map[string]string{}
	if raw != "" {
		options[system_setting.EmailTemplatesOption] = raw
	}
	common.OptionMapRWMutex.Lock()
	old := common.OptionMap
	common.OptionMap = options
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = old
		common.OptionMapRWMutex.Unlock()
	})
}

func TestRenderEmailTemplateUsesBuiltInDefaultInsideTheSharedLayout(t *testing.T) {
	stubEmailTemplates(t, "")
	subject, body, err := RenderEmailTemplate("verify", map[string]string{"Code": "123456", "Minutes": "10"})
	require.NoError(t, err)
	assert.Contains(t, subject, common.SystemName)
	assert.Contains(t, body, "123456")
	assert.Contains(t, body, "<!DOCTYPE html>")
	assert.Contains(t, body, common.SystemName)
}

func TestRenderEmailTemplateUsesCustomOverrideAndEscapesBodyVariables(t *testing.T) {
	stubEmailTemplates(t, `{"ticket":{"subject":"[{{.SystemName}}] {{.Title}}","body":"<p>{{.User}}</p><p>{{.Content}}</p>"}}`)
	subject, body, err := RenderEmailTemplate("ticket", map[string]string{
		"Title":   "Hello <b>world</b>",
		"User":    "alice",
		"Content": "<script>alert(1)</script>",
	})
	require.NoError(t, err)
	assert.Equal(t, "[New API] Hello <b>world</b>", subject, "subjects stay plain text")
	assert.Contains(t, body, "alice")
	assert.Contains(t, body, "&lt;script&gt;")
	assert.NotContains(t, body, "<script>")
}

func TestRenderEmailTemplateFallsBackPerFieldWhenOverrideIsBlank(t *testing.T) {
	stubEmailTemplates(t, `{"verify":{"subject":"Custom subject","body":""}}`)
	subject, body, err := RenderEmailTemplate("verify", map[string]string{"Code": "1"})
	require.NoError(t, err)
	assert.Equal(t, "Custom subject", subject)
	assert.Contains(t, body, "1", "a blank body keeps the built-in body")
}

func TestRenderEmailTemplateRejectsUnknownTemplateKeys(t *testing.T) {
	stubEmailTemplates(t, "")
	_, _, err := RenderEmailTemplate("missing", nil)
	assert.Error(t, err)
}

func TestValidateEmailTemplatesAcceptsDefaultsAndRejectsBrokenInput(t *testing.T) {
	assert.NoError(t, system_setting.ValidateEmailTemplates(""))
	assert.NoError(t, system_setting.ValidateEmailTemplates("{}"))
	assert.NoError(t, system_setting.ValidateEmailTemplates(`{"verify":{"subject":"{{.SystemName}}","body":"<p>{{.Code}}</p>"}}`))
	assert.Error(t, system_setting.ValidateEmailTemplates("not json"))
	assert.Error(t, system_setting.ValidateEmailTemplates(`{"nope":{"subject":"a","body":"b"}}`))
	assert.Error(t, system_setting.ValidateEmailTemplates(`{"verify":{"subject":"{{.Code","body":"b"}}`))
	assert.Error(t, system_setting.ValidateEmailTemplates(`{"verify":{"subject":"a\nb","body":"c"}}`))
}

func TestEmailTemplateDefaultsExposeEveryEditorField(t *testing.T) {
	defaults := system_setting.EmailTemplateDefaults()
	assert.Len(t, defaults, len(system_setting.EmailTemplateSpecs()))
	for _, item := range defaults {
		assert.NotEmpty(t, item.Key)
		assert.NotEmpty(t, item.Subject)
		assert.NotEmpty(t, item.Body)
		assert.NotEmpty(t, item.Variables)
	}
}

func TestQuotaNotificationsRenderTheQuotaTemplateWhenOverridden(t *testing.T) {
	stubEmailTemplates(t, `{"quota":{"subject":"额度提醒：{{.Title}}","body":"<p>剩余 {{.Remaining}}</p><p>{{.TopUpLink}}</p>"}}`)
	subject, body := renderEmailNotify(
		dto.NewNotify(dto.NotifyTypeQuotaExceed, "您的额度即将用尽", "legacy {{value}} content", []any{"ignored"}).
			WithVariables(map[string]string{"Remaining": "5,000", "TopUpLink": "https://example.com/wallet"}),
	)
	assert.Equal(t, "额度提醒：您的额度即将用尽", subject)
	assert.Contains(t, body, "5,000")
	assert.Contains(t, body, "https://example.com/wallet")
	assert.NotContains(t, body, "legacy ignored content", "quota emails must not mix the legacy body")
}

func TestQuotaNotificationsKeepTheirLocalizedContentWithoutAnOverride(t *testing.T) {
	stubEmailTemplates(t, "")
	subject, body := renderEmailNotify(
		dto.NewNotify(dto.NotifyTypeQuotaExceed, "额度提醒", "{{value}} 剩余", []any{"5,000"}).
			WithVariables(map[string]string{"Remaining": "5,000", "TopUpLink": "https://example.com/wallet"}),
	)
	assert.Equal(t, "额度提醒", subject)
	assert.Contains(t, body, "5,000 剩余")
}

func TestNotificationsWithoutNamedVariablesKeepTheLegacyContent(t *testing.T) {
	stubEmailTemplates(t, "")
	subject, body := renderEmailNotify(dto.NewNotify(dto.NotifyTypeChannelTest, "通道测试完成", "所有通道测试已完成", nil))
	assert.Equal(t, "通道测试完成", subject)
	assert.Contains(t, body, "所有通道测试已完成")
	subject, body = renderEmailNotify(dto.NewNotify(dto.NotifyTypeQuotaExceed, "额度提醒", "{{value}} 剩余", []any{"5,000"}))
	assert.Equal(t, "额度提醒", subject)
	assert.Contains(t, body, "5,000 剩余")
}

func TestPreviewEmailTemplateRendersSampleValuesInsideTheLayout(t *testing.T) {
	subject, body, err := PreviewEmailTemplate("verify", "自定义 {{.Code}}", "<p>验证码 {{.Code}}</p>", "", "")
	require.NoError(t, err)
	assert.Equal(t, "自定义 123456", subject)
	assert.Contains(t, body, "123456")
	assert.Contains(t, body, "<!DOCTYPE html>")
}

func TestPreviewEmailTemplateFallsBackToDefaultsAndRejectsInvalidInput(t *testing.T) {
	subject, body, err := PreviewEmailTemplate("ticket", "", "", "", "")
	require.NoError(t, err)
	assert.Contains(t, subject, "New ticket")
	assert.Contains(t, body, "alice")
	_, _, err = PreviewEmailTemplate("missing", "a", "b", "", "")
	assert.Error(t, err)
	_, _, err = PreviewEmailTemplate("verify", "{{.Code", "<p>b</p>", "", "")
	assert.Error(t, err)
}

func TestPreviewEmailTemplateUsesTheConfiguredBrandAndFooter(t *testing.T) {
	subject, body, err := PreviewEmailTemplate("verify", "{{.Brand}} 验证码", "<p>品牌：{{.Brand}}</p>", "kuncode", "kuncode support")
	require.NoError(t, err)
	assert.Equal(t, "kuncode 验证码", subject)
	assert.Contains(t, body, "kuncode support")
	assert.Contains(t, body, "品牌：kuncode")
	_, _, err = PreviewEmailTemplate("verify", "subject", "<p>b</p>", "a\nb", "")
	assert.Error(t, err)
}

func TestValidateEmailLayoutAcceptsDefaultsAndRejectsBrokenInput(t *testing.T) {
	assert.NoError(t, system_setting.ValidateEmailLayout(""))
	assert.NoError(t, system_setting.ValidateEmailLayout("{}"))
	assert.NoError(t, system_setting.ValidateEmailLayout(`{"brand":"kuncode","footer":"{{.SystemName}}"}`))
	assert.Error(t, system_setting.ValidateEmailLayout("not json"))
	assert.Error(t, system_setting.ValidateEmailLayout(`{"brand":"a\nb"}`))
	assert.Error(t, system_setting.ValidateEmailLayout(`{"brand":"{{.SystemName"}`))
}

func TestRenderEmailTemplateUsesTheStoredBrandForTheBrandVariable(t *testing.T) {
	stubEmailTemplates(t, `{"verify":{"subject":"{{.Brand}}","body":"<p>{{.Brand}}</p>"}}`)
	common.OptionMapRWMutex.Lock()
	common.OptionMap[system_setting.EmailLayoutOption] = `{"brand":"kuncode","footer":"kuncode team"}`
	common.OptionMapRWMutex.Unlock()
	subject, body, err := RenderEmailTemplate("verify", map[string]string{"Code": "1"})
	require.NoError(t, err)
	assert.Equal(t, "kuncode", subject)
	assert.Contains(t, body, "kuncode team")
}
