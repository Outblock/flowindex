package repository

import "testing"

func TestSanitizeForPG(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "no change", in: `{"k":"v"}`, want: `{"k":"v"}`},
		{name: "raw null byte", in: "ab\x00cd", want: "abcd"},
		{name: "json escaped lower", in: `{"s":"a\u0000b"}`, want: `{"s":"ab"}`},
		{name: "json escaped upper", in: `{"s":"a\U0000b"}`, want: `{"s":"ab"}`},
		{name: "mixed", in: "x\x00y\\u0000z", want: "xyz"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := sanitizeForPG(tc.in)
			if got != tc.want {
				t.Fatalf("sanitizeForPG(%q)=%q want %q", tc.in, got, tc.want)
			}
		})
	}
}
