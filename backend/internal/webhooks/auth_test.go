package webhooks

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestExtractUserID_JWT(t *testing.T) {
	secret := "super-secret-jwt-token-with-at-least-32-characters-long"

	claims := jwt.MapClaims{
		"sub": "550e8400-e29b-41d4-a716-446655440000",
		"aud": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	auth := NewAuthMiddleware(secret, nil)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)

	userID, err := auth.ExtractUserID(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if userID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("expected user ID 550e..., got %s", userID)
	}
}

func TestExtractUserID_ExpiredJWT(t *testing.T) {
	secret := "super-secret-jwt-token-with-at-least-32-characters-long"

	claims := jwt.MapClaims{
		"sub": "550e8400-e29b-41d4-a716-446655440000",
		"exp": time.Now().Add(-time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(secret))

	auth := NewAuthMiddleware(secret, nil)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)

	_, err := auth.ExtractUserID(req)
	if err == nil {
		t.Fatal("expected error for expired JWT")
	}
}

func TestExtractUserID_NoAuth(t *testing.T) {
	auth := NewAuthMiddleware("secret", nil)
	req := httptest.NewRequest("GET", "/", nil)

	_, err := auth.ExtractUserID(req)
	if err == nil {
		t.Fatal("expected error for missing auth")
	}
}

func TestMiddleware_InjectsUserID(t *testing.T) {
	secret := "super-secret-jwt-token-with-at-least-32-characters-long"

	claims := jwt.MapClaims{
		"sub": "user-123",
		"aud": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString([]byte(secret))

	auth := NewAuthMiddleware(secret, nil)

	var capturedUserID string
	handler := auth.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = UserIDFromContext(r.Context())
		w.WriteHeader(200)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if capturedUserID != "user-123" {
		t.Errorf("expected user-123, got %s", capturedUserID)
	}
}
