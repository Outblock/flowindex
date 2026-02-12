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

var openapiDefault openapiCache

func specPaths() []string {
	return []string{
		strings.TrimSpace(os.Getenv("OPENAPI_SPEC_PATH")),
		"openapi.json",
		"api.json",
		"docs/openapi.json",
		"openapi.yaml",
		"docs/openapi.yaml",
		"openapi.yml",
		"docs/openapi.yml",
	}
}

func (s *Server) handleOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	out, err := openapiDefault.renderYAML(specPaths())
	if err != nil {
		http.Error(w, "openapi spec not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Write(out)
}

func (s *Server) handleOpenAPIJSON(w http.ResponseWriter, r *http.Request) {
	out, err := openapiDefault.renderJSON(specPaths())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(out)
}
