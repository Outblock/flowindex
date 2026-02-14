package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// NormalizeScript strips single-line (//) and multi-line (/* */) comments,
// collapses whitespace runs, and trims the result. This produces a canonical
// representation so that scripts differing only in comments hash identically.
func NormalizeScript(script string) string {
	var b strings.Builder
	b.Grow(len(script))
	i := 0
	inString := false
	var stringChar byte
	for i < len(script) {
		ch := script[i]

		// Track string literals so we don't strip "comments" inside strings.
		if inString {
			b.WriteByte(ch)
			if ch == '\\' && i+1 < len(script) {
				i++
				b.WriteByte(script[i])
			} else if ch == stringChar {
				inString = false
			}
			i++
			continue
		}

		if ch == '"' {
			inString = true
			stringChar = ch
			b.WriteByte(ch)
			i++
			continue
		}

		// Single-line comment: skip to end of line.
		if ch == '/' && i+1 < len(script) && script[i+1] == '/' {
			for i < len(script) && script[i] != '\n' {
				i++
			}
			// Emit a single space to avoid fusing tokens across removed comment.
			b.WriteByte(' ')
			continue
		}

		// Multi-line comment: skip to closing */.
		if ch == '/' && i+1 < len(script) && script[i+1] == '*' {
			i += 2
			for i+1 < len(script) && !(script[i] == '*' && script[i+1] == '/') {
				i++
			}
			if i+1 < len(script) {
				i += 2 // skip */
			}
			b.WriteByte(' ')
			continue
		}

		b.WriteByte(ch)
		i++
	}

	// Collapse whitespace runs into single spaces and trim.
	raw := b.String()
	var out strings.Builder
	out.Grow(len(raw))
	prevSpace := true // start true to trim leading whitespace
	for _, ch := range raw {
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			if !prevSpace {
				out.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		out.WriteRune(ch)
		prevSpace = false
	}
	result := strings.TrimRight(out.String(), " ")
	return result
}

// NormalizedScriptHash computes the SHA-256 hash of the normalized script.
func NormalizedScriptHash(script string) string {
	normalized := NormalizeScript(script)
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}
