package webhooks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	jwtlib "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userIDKey contextKey = "webhook_user_id"

type APIKeyLookup func(ctx context.Context, keyHash string) (userID string, err error)

type AuthMiddleware struct {
	jwtSecret    []byte
	apiKeyLookup APIKeyLookup
}

func NewAuthMiddleware(jwtSecret string, apiKeyLookup APIKeyLookup) *AuthMiddleware {
	return &AuthMiddleware{
		jwtSecret:    []byte(jwtSecret),
		apiKeyLookup: apiKeyLookup,
	}
}

func (a *AuthMiddleware) ExtractUserID(r *http.Request) (string, error) {
	// Try API Key first
	if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
		if a.apiKeyLookup == nil {
			return "", fmt.Errorf("API key auth not configured")
		}
		hash := sha256.Sum256([]byte(apiKey))
		keyHash := hex.EncodeToString(hash[:])
		userID, err := a.apiKeyLookup(r.Context(), keyHash)
		if err != nil {
			return "", fmt.Errorf("API key lookup failed: %w", err)
		}
		if userID == "" {
			return "", fmt.Errorf("invalid API key")
		}
		return userID, nil
	}

	// Try JWT
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", fmt.Errorf("missing Authorization header or X-API-Key")
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	tokenStr = strings.TrimSpace(tokenStr)

	token, err := jwtlib.Parse(tokenStr, func(token *jwtlib.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwtlib.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return a.jwtSecret, nil
	})
	if err != nil {
		return "", fmt.Errorf("invalid JWT: %w", err)
	}

	claims, ok := token.Claims.(jwtlib.MapClaims)
	if !ok || !token.Valid {
		return "", fmt.Errorf("invalid JWT claims")
	}

	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", fmt.Errorf("JWT missing sub claim")
	}

	return sub, nil
}

func (a *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		userID, err := a.ExtractUserID(r)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func UserIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

func HashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}
