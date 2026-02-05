package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

type openapiCache struct {
	raw     []byte
	isJSON  bool
	rawOnce sync.Once
	rawErr  error

	json     []byte
	jsonOnce sync.Once
	jsonErr  error
}

func (c *openapiCache) ensureRaw(paths []string) error {
	c.rawOnce.Do(func() {
		for _, p := range paths {
			if p == "" {
				continue
			}
			b, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			c.raw = b
			lower := strings.ToLower(p)
			if strings.HasSuffix(lower, ".json") {
				c.isJSON = true
			} else if strings.HasSuffix(lower, ".yaml") || strings.HasSuffix(lower, ".yml") {
				c.isJSON = false
			} else {
				trim := strings.TrimSpace(string(b))
				c.isJSON = strings.HasPrefix(trim, "{")
			}
			return
		}
		c.rawErr = os.ErrNotExist
	})
	return c.rawErr
}

func (c *openapiCache) renderJSON(paths []string) ([]byte, error) {
	c.jsonOnce.Do(func() {
		if err := c.ensureRaw(paths); err != nil {
			c.jsonErr = err
			return
		}
		if c.isJSON {
			c.json = c.raw
			return
		}
		var v interface{}
		if err := yaml.Unmarshal(c.raw, &v); err != nil {
			c.jsonErr = err
			return
		}
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			c.jsonErr = err
			return
		}
		c.json = b
	})
	if c.jsonErr != nil {
		return nil, c.jsonErr
	}
	return c.json, nil
}

func (c *openapiCache) renderYAML(paths []string) ([]byte, error) {
	if err := c.ensureRaw(paths); err != nil {
		return nil, err
	}
	if !c.isJSON {
		return c.raw, nil
	}
	var v interface{}
	if err := json.Unmarshal(c.raw, &v); err != nil {
		return nil, err
	}
	out, err := yaml.Marshal(v)
	if err != nil {
		return nil, err
	}
	return out, nil
}

var (
	openapiDefault openapiCache
	openapiV1      openapiCache
	openapiV2      openapiCache
)

func (s *Server) handleOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	paths := []string{
		strings.TrimSpace(os.Getenv("OPENAPI_SPEC_PATH")),
		"openapi-v2.json",
		"api.json",
		"openapi.json",
		"docs/openapi.json",
		"openapi.yaml",
		"docs/openapi.yaml",
		"openapi.yml",
		"docs/openapi.yml",
	}
	out, err := openapiDefault.renderYAML(paths)
	if err != nil {
		http.Error(w, "openapi spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Write(out)
}

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	paths := []string{
		strings.TrimSpace(os.Getenv("OPENAPI_SPEC_PATH")),
		"openapi-v2.json",
		"api.json",
		"openapi.json",
		"docs/openapi.json",
		"openapi.yaml",
		"docs/openapi.yaml",
		"openapi.yml",
		"docs/openapi.yml",
	}
	openapiJSON, err := openapiDefault.renderJSON(paths)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(openapiJSON)
}

func (s *Server) handleOpenAPIV1JSON(w http.ResponseWriter, r *http.Request) {
	paths := []string{
		strings.TrimSpace(os.Getenv("OPENAPI_V1_SPEC_PATH")),
		"openapi-v1.json",
		"find-api.json",
	}
	out, err := openapiV1.renderJSON(paths)
	if err != nil {
		http.Error(w, "openapi v1 spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(out)
}

func (s *Server) handleOpenAPIV2JSON(w http.ResponseWriter, r *http.Request) {
	paths := []string{
		strings.TrimSpace(os.Getenv("OPENAPI_V2_SPEC_PATH")),
		"openapi-v2.json",
		"api.json",
	}
	out, err := openapiV2.renderJSON(paths)
	if err != nil {
		http.Error(w, "openapi v2 spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(out)
}
