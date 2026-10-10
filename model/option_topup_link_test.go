package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateTopUpLink(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{"empty is allowed", "", true},
		{"valid https", "https://example.com/redeem", true},
		{"valid http", "http://localhost:3000/topup", true},
		{"bare host is rejected", "example.com", false},
		{"non-http scheme is rejected", "javascript:alert(1)", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOptionValue("TopUpLink", tc.value)
			if tc.want {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}
