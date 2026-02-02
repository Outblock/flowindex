package indexer

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"flowscan-clone/internal/flow"

	"github.com/jackc/pgx/v5/pgxpool"
	flowSDK "github.com/onflow/flow-go-sdk"
)

func Start(ctx context.Context, client *flow.Client, db *pgxpool.Pool, startHeight uint64) {
	log.Printf("Starting indexer from height: %d", startHeight)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Get latest sealed height to know when to stop "catching up"
			latest, err := client.GetLatestBlock(ctx)
			if err != nil {
				log.Printf("Error fetching latest block: %v", err)
				time.Sleep(2 * time.Second)
				continue
			}

			currentHeight := startHeight
			if currentHeight < uint64(latest.Height) {
				// Catch up historical blocks
				for currentHeight <= uint64(latest.Height) {
					if err := processBlock(ctx, client, db, currentHeight); err != nil {
						log.Printf("Error processing block %d: %v", currentHeight, err)
						// Continue to next, don't stop on error
					}
					currentHeight++
				}
			}

			// Subscribe to new blocks (polling loop for now)
			// In production, use SubscribeFinalizedBlocks from gRPC server stream
			log.Printf("Indexer is up to date. Polling for new blocks...")
			time.Sleep(2 * time.Second)
		}
	}
}

func processBlock(ctx context.Context, client *flow.Client, db *pgxpool.Pool, height uint64) error {
	block, err := client.GetBlockByHeight(ctx, height)
	if err != nil {
		return err
	}

	log.Printf("Indexing block %d...", height)

	// Marshal complex fields to JSON
	collectionGuarantees, _ := json.Marshal(block.CollectionGuarantees)

	// Insert Block
	_, err = db.Exec(ctx, `
		INSERT INTO blocks (height, id, parent_id, timestamp, collection_guarantees, proposer_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (height) DO NOTHING
	`, block.Height, block.ID, block.ParentID, block.Timestamp, collectionGuarantees, block.ProposerID)

	if err != nil {
		return err
	}

	// Process Collections/Transactions
	for _, guarantee := range block.CollectionGuarantees {
		coll, err := client.GetCollection(ctx, guarantee.CollectionID)
		if err != nil {
			log.Printf("Error fetching collection %s: %v", guarantee.CollectionID.String(), err)
			continue
		}

		for _, txID := range coll.TransactionIDs {
			tx, err := client.GetTransaction(ctx, txID)
			if err != nil {
				log.Printf("Error fetching transaction %s: %v", txID.String(), err)
				continue
			}
			processTransaction(ctx, client, db, tx, block.Height)
		}
	}

	return nil
}

func processTransaction(ctx context.Context, client *flow.Client, db *pgxpool.Pool, tx *flowSDK.Transaction, blockHeight uint64) {
	// Get Transaction Result
	result, _ := client.GetTransactionResult(ctx, tx.ID())

	status := "PENDING"
	if result != nil {
		switch result.Status {
		case flowSDK.TransactionStatusPending:
			status = "PENDING"
		case flowSDK.TransactionStatusFinalized:
			status = "FINALIZED"
		case flowSDK.TransactionStatusExecuted:
			status = "EXECUTED"
		case flowSDK.TransactionStatusSealed:
			status = "SEALED"
		}
	}

	proposalKeyJSON, _ := json.Marshal(tx.ProposalKey)
	authorizersJSON, _ := json.Marshal(tx.Authorizers)
	signaturesJSON, _ := json.Marshal(tx.EnvelopeSignatures)
	argsJSON, _ := json.Marshal(tx.Arguments)

	_, err := db.Exec(ctx, `
		INSERT INTO transactions (id, block_height, script, arguments, gas_limit, proposal_key, payer, authorizers, signatures, status, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO NOTHING
	`, tx.ID().String(), blockHeight, string(tx.Script), argsJSON, tx.GasLimit, proposalKeyJSON, tx.Payer.String(), authorizersJSON, signaturesJSON, status, "")

	if err != nil {
		log.Printf("Error inserting transaction %s: %v", tx.ID().String(), err)
	}
}
