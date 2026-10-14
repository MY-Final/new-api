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
		`[{"name":" 服务状态 ","url":" https://status.example.com ","adminOnly":true,"highlight":true}]`,
	)
	require.NoError(t, err)
	require.Len(t, pages, 1)
	assert.Equal(t, "服务状态", pages[0].Name)
	assert.Equal(t, "https://status.example.com", pages[0].URL)
	assert.True(t, pages[0].AdminOnly)
	assert.True(t, pages[0].Highlight)

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

// withOptionMap swaps the process-wide option map for the test and restores it.
func withOptionMap(t *testing.T, values map[string]string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = values
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
}

func TestSeedShopCustomPageSeedsEffectiveValueOnce(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	shopURL := "https://pay.example.com/shop/abc"
	require.NoError(t, db.Create(&Option{Key: LegacyShopOptionKey, Value: shopURL}).Error)
	// The effective value comes from the option map, which also carries the
	// code-level default during a real startup.
	withOptionMap(t, map[string]string{LegacyShopOptionKey: shopURL})

	require.NoError(t, SeedShopCustomPage())

	pages, err := ParseCustomPages(requireOptionValue(t, db, CustomPagesOptionKey))
	require.NoError(t, err)
	require.Len(t, pages, 1)
	assert.Equal(t, "Shop", pages[0].Name)
	assert.Equal(t, shopURL, pages[0].URL)
	assert.False(t, pages[0].AdminOnly)
	assert.True(t, pages[0].Highlight, "the shop entry keeps its sidebar highlight")
	requireOptionMissing(t, db, LegacyShopOptionKey)
	assert.Equal(t, "true", requireOptionValue(t, db, shopPageMigrationMarkerKey))

	common.OptionMapRWMutex.RLock()
	_, stillLoaded := common.OptionMap[LegacyShopOptionKey]
	common.OptionMapRWMutex.RUnlock()
	assert.False(t, stillLoaded, "the retired option is dropped from memory")

	// The marker makes it one-time: an administrator removing the entry must not
	// see it resurrected on the next startup.
	require.NoError(t, UpdateOption(CustomPagesOptionKey, "[]"))
	require.NoError(t, SeedShopCustomPage())

	pages, err = ParseCustomPages(requireOptionValue(t, db, CustomPagesOptionKey))
	require.NoError(t, err)
	assert.Empty(t, pages)
}

func TestSeedShopCustomPageKeepsAnExistingEntry(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	shopURL := "https://pay.example.com/shop/abc"
	configured := `[{"name":"Shop","url":"` + shopURL + `","adminOnly":false,"highlight":true}]`
	require.NoError(t, db.Create([]Option{
		{Key: CustomPagesOptionKey, Value: configured},
		{Key: LegacyShopOptionKey, Value: shopURL},
	}).Error)
	withOptionMap(t, map[string]string{
		LegacyShopOptionKey:  shopURL,
		CustomPagesOptionKey: configured,
	})

	require.NoError(t, SeedShopCustomPage())

	assert.Equal(t, configured, requireOptionValue(t, db, CustomPagesOptionKey))
	requireOptionMissing(t, db, LegacyShopOptionKey)
}

func TestSeedShopCustomPageSkipsWhenNothingConfigured(t *testing.T) {
	db := useFrontendOptionMigrationDB(t)
	withOptionMap(t, map[string]string{})

	require.NoError(t, SeedShopCustomPage())

	requireOptionMissing(t, db, CustomPagesOptionKey)
	assert.Equal(t, "true", requireOptionValue(t, db, shopPageMigrationMarkerKey))
}
