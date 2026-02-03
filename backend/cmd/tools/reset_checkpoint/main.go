package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	// Default DB URL from config
	dbURL := "postgres://stats:n0uejXPl61ci6ldCuE2gQU5Y@localhost:7433/stats?sslmode=disable"
	if url := os.Getenv("DB_URL"); url != "" {
		dbURL = url
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
