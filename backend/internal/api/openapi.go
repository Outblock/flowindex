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
	openapiRaw     []byte
	openapiIsJSON  bool
	openapiRawOnce sync.Once
	openapiRawErr  error
)

var (
	openapiJSON     []byte
	openapiJSONOnce sync.Once
	openapiJSONErr  error
)

func ensureOpenAPIRaw() error {
	openapiRawOnce.Do(func() {
		paths := []string{
			strings.TrimSpace(os.Getenv("OPENAPI_SPEC_PATH")),
			"api.json",
			"openapi.json",
			"docs/openapi.json",
			"openapi.yaml",
			"docs/openapi.yaml",
			"openapi.yml",
			"docs/openapi.yml",
		}
		for _, p := range paths {
			if p == "" {
				continue
			}
			b, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			openapiRaw = b
			lower := strings.ToLower(p)
			if strings.HasSuffix(lower, ".json") {
				openapiIsJSON = true
			} else if strings.HasSuffix(lower, ".yaml") || strings.HasSuffix(lower, ".yml") {
				openapiIsJSON = false
			} else {
				trim := strings.TrimSpace(string(b))
				openapiIsJSON = strings.HasPrefix(trim, "{")
			}
			return
		}
		openapiRawErr = os.ErrNotExist
	})
	return openapiRawErr
}

func (s *Server) handleOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	if err := ensureOpenAPIRaw(); err != nil {
		http.Error(w, "openapi spec not found", http.StatusNotFound)
		return
	}
	if !openapiIsJSON {
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		w.Write(openapiRaw)
		return
	}
	var v interface{}
	if err := json.Unmarshal(openapiRaw, &v); err != nil {
		http.Error(w, "invalid openapi json", http.StatusInternalServerError)
		return
	}
	out, err := yaml.Marshal(v)
	if err != nil {
		http.Error(w, "failed to render yaml", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Write(out)
}

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	openapiJSONOnce.Do(func() {
		if err := ensureOpenAPIRaw(); err != nil {
			openapiJSONErr = err
			return
		}
		if openapiIsJSON {
			openapiJSON = openapiRaw
			return
		}
		var v interface{}
		if err := yaml.Unmarshal(openapiRaw, &v); err != nil {
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
