package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCustomPagesNormalizesEntries(t *testing.T) {
	pages, err := ParseCustomPages(
		`[{"name":" 服务状态 ","url":" https://status.example.com ","adminOnly":true}]`,
	)
	require.NoError(t, err)
	require.Len(t, pages, 1)
	assert.Equal(t, "服务状态", pages[0].Name)
	assert.Equal(t, "https://status.example.com", pages[0].URL)
	assert.True(t, pages[0].AdminOnly)

	empty, err := ParseCustomPages("   ")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestParseCustomPagesRejectsInvalidEntries(t *testing.T) {
	tooMany := make([]string, 0, maxCustomPages+1)
	for i := 0; i <= maxCustomPages; i++ {
		tooMany = append(tooMany, fmt.Sprintf(`{"name":"page-%d","url":"https://example.com/%d"}`, i, i))
	}

	cases := []struct {
		name  string
		value string
	}{
		{"object instead of array", `{"name":"status","url":"https://status.example.com"}`},
		{"blank name", `[{"name":"   ","url":"https://status.example.com"}]`},
		{"name with line break", `[{"name":"status\npage","url":"https://status.example.com"}]`},
		{"missing url", `[{"name":"status"}]`},
		{"javascript scheme", `[{"name":"status","url":"javascript:alert(1)"}]`},
		{"data scheme", `[{"name":"status","url":"data:text/html,hi"}]`},
		{"relative url", `[{"name":"status","url":"/internal/status"}]`},
		{"host without scheme", `[{"name":"status","url":"status.example.com"}]`},
		{
			"duplicate name",
			`[{"name":"status","url":"https://a.example.com"},{"name":" status ","url":"https://b.example.com"}]`,
		},
		{"too many entries", "[" + strings.Join(tooMany, ",") + "]"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseCustomPages(tc.value)
			require.Error(t, err)
		})
	}
}

func TestValidateOptionValueGuardsCustomPages(t *testing.T) {
	require.NoError(t, validateOptionValue(CustomPagesOptionKey, `[]`))
	require.NoError(t, validateOptionValue(CustomPagesOptionKey, ""))
	require.Error(t, validateOptionValue(
		CustomPagesOptionKey,
		`[{"name":"status","url":"javascript:alert(1)"}]`,
	))
}

func TestGetCustomPagesForRoleHidesAdminOnlyPages(t *testing.T) {
	raw := `[{"name":"Public status","url":"https://status.example.com"},` +
		`{"name":"Admin monitoring","url":"https://monitoring.example.com","adminOnly":true}]`

	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	previous, hadPrevious := common.OptionMap[CustomPagesOptionKey]
	common.OptionMap[CustomPagesOptionKey] = raw
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if hadPrevious {
			common.OptionMap[CustomPagesOptionKey] = previous
			return
		}
		delete(common.OptionMap, CustomPagesOptionKey)
	})

	userPages, err := GetCustomPagesForRole(common.RoleCommonUser)
	require.NoError(t, err)
	require.Len(t, userPages, 1)
	assert.Equal(t, "Public status", userPages[0].Name)

	adminPages, err := GetCustomPagesForRole(common.RoleAdminUser)
	require.NoError(t, err)
	require.Len(t, adminPages, 2)
	assert.Equal(t, "Admin monitoring", adminPages[1].Name)
}

func TestTransformLegacyChannelDetectionSeedsCustomPages(t *testing.T) {
	value, err := transformLegacyChannelDetection(" https://relaypulse.example.com ")
	require.NoError(t, err)

	pages, err := ParseCustomPages(value)
	require.NoError(t, err)
	require.Len(t, pages, 1)
	assert.Equal(t, "Channel Detection", pages[0].Name)
	assert.Equal(t, "https://relaypulse.example.com", pages[0].URL)
	assert.False(t, pages[0].AdminOnly)

	_, err = transformLegacyChannelDetection("relaypulse.example.com")
	require.Error(t, err)
}

func TestMigrateLegacyCustomPagesWritesOptionAndDropsLegacyKey(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	require.NoError(t, db.Create(&Option{
		Key:   LegacyChannelDetectionOptionKey,
		Value: "https://relaypulse.example.com",
	}).Error)

	require.NoError(t, MigrateLegacyCustomPages())

	pages, err := ParseCustomPages(requireOptionValue(t, db, CustomPagesOptionKey))
	require.NoError(t, err)
	require.Len(t, pages, 1)
	assert.Equal(t, "Channel Detection", pages[0].Name)
	assert.Equal(t, "https://relaypulse.example.com", pages[0].URL)
	requireOptionMissing(t, db, LegacyChannelDetectionOptionKey)

	// Idempotent: a second startup must not touch the stored configuration.
	before, err := AllOption()
	require.NoError(t, err)
	require.NoError(t, MigrateLegacyCustomPages())
	after, err := AllOption()
	require.NoError(t, err)
	assert.ElementsMatch(t, before, after)
}

func TestMigrateLegacyCustomPagesKeepsConfiguredPages(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	configured := `[{"name":"Status","url":"https://status.example.com","adminOnly":false}]`
	require.NoError(t, db.Create([]Option{
		{Key: CustomPagesOptionKey, Value: configured},
		{Key: LegacyChannelDetectionOptionKey, Value: "https://relaypulse.example.com"},
	}).Error)

	require.NoError(t, MigrateLegacyCustomPages())

	assert.Equal(t, configured, requireOptionValue(t, db, CustomPagesOptionKey))
	requireOptionMissing(t, db, LegacyChannelDetectionOptionKey)
}

func TestMigrateLegacyCustomPagesKeepsInvalidLegacyValue(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	require.NoError(t, db.Create(&Option{
		Key:   LegacyChannelDetectionOptionKey,
		Value: "not-a-url",
	}).Error)

	require.NoError(t, MigrateLegacyCustomPages())

	requireOptionMissing(t, db, CustomPagesOptionKey)
	assert.Equal(t, "not-a-url", requireOptionValue(t, db, LegacyChannelDetectionOptionKey))
}
