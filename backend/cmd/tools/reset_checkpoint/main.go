package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		log.Fatal("DB_URL is required (e.g. postgres://user:password@host:5432/db?sslmode=disable)")
	}

	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("Unable to parse DB URL: %v", err)
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pool.Close()

	ctx := context.Background()

	// Delete the checkpoint for history_ingester
	serviceName := "history_ingester"
	cmdTag, err := pool.Exec(ctx, "DELETE FROM indexing_checkpoints WHERE service_name = $1", serviceName)
	if err != nil {
		log.Fatalf("Failed to delete checkpoint: %v", err)
	}

	if cmdTag.RowsAffected() == 0 {
		fmt.Printf("No checkpoint found for '%s'. It might have already been reset or never existed.\n", serviceName)
	} else {
		fmt.Printf("Successfully deleted checkpoint for '%s'. The ingester will restart from START_BLOCK on next run.\n", serviceName)
	}
}
