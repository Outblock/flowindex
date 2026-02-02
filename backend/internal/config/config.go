package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	DatabaseURL string `yaml:"database_url"`
	FlowRPCURL  string `yaml:"flow_rpc_url"`
	APIPort     int    `yaml:"api_port"`
	StartHeight int64  `yaml:"start_height"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	err = yaml.Unmarshal(data, &cfg)
	if err != nil {
		return nil, err
	}

	return &cfg, nil
}
