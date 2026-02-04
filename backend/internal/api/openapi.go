package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

var (
	openapiYAML     []byte
	openapiYAMLOnce sync.Once
	openapiYAMLErr  error
)

var (
	openapiJSON     []byte
	openapiJSONOnce sync.Once
	openapiJSONErr  error
)

func ensureOpenAPIYAML() error {
	openapiYAMLOnce.Do(func() {
		paths := []string{
			strings.TrimSpace(os.Getenv("OPENAPI_SPEC_PATH")),
			"docs/openapi.yaml",
			"openapi.yaml",
		}
		for _, p := range paths {
			if p == "" {
				continue
			}
			if b, err := os.ReadFile(p); err == nil {
				openapiYAML = b
				return
			}
		}
		openapiYAMLErr = os.ErrNotExist
	})
	return openapiYAMLErr
}

func (s *Server) handleOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	if err := ensureOpenAPIYAML(); err != nil {
		http.Error(w, "openapi spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Write(openapiYAML)
}

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	openapiJSONOnce.Do(func() {
		if err := ensureOpenAPIYAML(); err != nil {
			openapiJSONErr = err
			return
		}
		var v interface{}
		if err := yaml.Unmarshal(openapiYAML, &v); err != nil {
			openapiJSONErr = err
			return
		}
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			openapiJSONErr = err
			return
		}
		openapiJSON = b
	})

	if openapiJSONErr != nil {
		http.Error(w, openapiJSONErr.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(openapiJSON)
}
