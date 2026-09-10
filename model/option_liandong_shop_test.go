package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateLiandongShopUrl(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{"empty is allowed", "", true},
		{"valid https", "https://pay.ldxp.cn/shop/Q2JDSIRE", true},
		{"valid http", "http://example.com/shop", true},
		{"bare host is rejected", "example.com", false},
		{"non-http scheme is rejected", "ftp://example.com", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOptionValue("LiandongShopUrl", tc.value)
			if tc.want {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestValidateKunCodeRelayPulseUrl(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{"empty is allowed", "", true},
		{"valid https", "https://relaypulse.example.com", true},
		{"valid http", "http://localhost:3000", true},
		{"bare host is rejected", "relaypulse.example.com", false},
		{"non-http scheme is rejected", "javascript:alert(1)", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOptionValue("KunCodeRelayPulseUrl", tc.value)
			if tc.want {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
