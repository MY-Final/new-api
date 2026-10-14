package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseHeaderNavLinksNormalizesEntries(t *testing.T) {
	links, err := ParseHeaderNavLinks(
		`[{"name":" 官网 ","url":" https://example.com "},{"name":"Help","url":"http://help.example.com/docs"}]`,
	)
	require.NoError(t, err)
	require.Len(t, links, 2)
	assert.Equal(t, "官网", links[0].Name)
	assert.Equal(t, "https://example.com", links[0].URL)
	assert.Equal(t, "Help", links[1].Name)

	empty, err := ParseHeaderNavLinks("  ")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestParseHeaderNavLinksRejectsInvalidEntries(t *testing.T) {
	tooMany := make([]string, 0, MaxHeaderNavLinks+1)
	for i := 0; i <= MaxHeaderNavLinks; i++ {
		tooMany = append(tooMany, fmt.Sprintf(`{"name":"link-%d","url":"https://example.com/%d"}`, i, i))
	}

	cases := []struct {
		name  string
		value string
	}{
		{"not an array", `{"name":"Help"}`},
		{"empty name", `[{"name":"  ","url":"https://example.com"}]`},
		{"duplicate name", `[{"name":"Help","url":"https://a.example.com"},{"name":" help ","url":"https://b.example.com"}]`},
		{"relative url", `[{"name":"Help","url":"/docs"}]`},
		{"bare host", `[{"name":"Help","url":"example.com"}]`},
		{"javascript scheme", `[{"name":"Help","url":"javascript:alert(1)"}]`},
		{"data scheme", `[{"name":"Help","url":"data:text/html,<script>alert(1)</script>"}]`},
		{"too many links", "[" + strings.Join(tooMany, ",") + "]"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseHeaderNavLinks(tc.value)
			require.Error(t, err)
		})
	}
}

func TestValidateHeaderNavModulesOptionChecksOnlyLinks(t *testing.T) {
	// Legacy shapes without links stay valid so an existing configuration can
	// still be saved from the console.
	valid := []string{
		"",
		"{}",
		`{"home":true,"console":false}`,
		`{"pricing":{"enabled":true,"requireAuth":false},"rankings":"false"}`,
		`{"home":true,"links":[]}`,
		`{"links":[{"name":"官网","url":"https://example.com"}]}`,
		`{"setupDownloadUrl":""}`,
		`{"setupDownloadUrl":"https://example.com/setup"}`,
	}
	for _, value := range valid {
		require.NoError(t, validateOptionValue("HeaderNavModules", value), value)
	}

	invalid := []string{
		`{"links":[{"name":"Help","url":"javascript:alert(1)"}]}`,
		`{"links":[{"name":"","url":"https://example.com"}]}`,
		`{"links":{"name":"Help","url":"https://example.com"}}`,
		`{"setupDownloadUrl":"javascript:alert(1)"}`,
		`{"setupDownloadUrl":"/setup"}`,
		`{"setupDownloadUrl":123}`,
		"not json",
	}
	for _, value := range invalid {
		require.Error(t, validateOptionValue("HeaderNavModules", value), value)
	}
}
