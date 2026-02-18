package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/onflow/flow/protobuf/go/flow/access"
	"github.com/onflow/flow/protobuf/go/flow/entities"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Test RPC latency for different spork nodes and different API patterns
func main() {
	ctx := context.Background()

	type testCase struct {
		name   string
		node   string
		height uint64
		spork  int
	}

	tests := []testCase{
		{"spork14-blk20M", "access-001.mainnet14.nodes.onflow.org:9000", 20000000, 14},
		{"spork15-blk22M", "access-001.mainnet15.nodes.onflow.org:9000", 22000000, 15},
		{"spork21-blk46M", "access-001.mainnet21.nodes.onflow.org:9000", 46000000, 21},
		{"spork23-blk60M", "access-001.mainnet23.nodes.onflow.org:9000", 60000000, 23},
		{"spork24-blk80M", "access-001.mainnet24.nodes.onflow.org:9000", 80000000, 24},
	}

	// Also test below-root: can mainnet15 serve height 20M? (root=21291692)
	tests = append(tests, testCase{"spork15-below-root-20M", "access-001.mainnet15.nodes.onflow.org:9000", 20000000, 15})
	// Can mainnet16 serve height 20M? (root=23830813)
	tests = append(tests, testCase{"spork16-below-root-20M", "access-001.mainnet16.nodes.onflow.org:9000", 20000000, 16})

	for _, tc := range tests {
		fmt.Printf("\n========== %s (node=%s height=%d) ==========\n", tc.name, tc.node, tc.height)
		runTest(ctx, tc.node, tc.height, tc.spork)
	}
}

func runTest(ctx context.Context, node string, height uint64, spork int) {
	conn, err := grpc.DialContext(ctx, node,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(64*1024*1024)),
	)
	if err != nil {
		log.Printf("  FAIL: dial: %v", err)
		return
	}
	defer conn.Close()

	cli := access.NewAccessAPIClient(conn)

	// 1. GetBlockByHeight
	t0 := time.Now()
	blockResp, err := cli.GetBlockByHeight(ctx, &access.GetBlockByHeightRequest{Height: height})
	d1 := time.Since(t0)
	if err != nil {
		fmt.Printf("  GetBlockByHeight: FAIL (%v) [%v]\n", err, d1)
		return
	}
	block := blockResp.Block
	fmt.Printf("  GetBlockByHeight: OK [%v] blockID=%s collections=%d\n",
		d1, hex.EncodeToString(block.Id), len(block.CollectionGuarantees))

	// 2. GetCollection for each guarantee
	totalCollTime := time.Duration(0)
	var allTxIDs [][]byte
	for i, cg := range block.CollectionGuarantees {
		t := time.Now()
		collResp, err := cli.GetCollectionByID(ctx, &access.GetCollectionByIDRequest{Id: cg.CollectionId})
		d := time.Since(t)
		totalCollTime += d
		if err != nil {
			fmt.Printf("  GetCollection[%d]: FAIL (%v) [%v]\n", i, err, d)
			continue
		}
		for _, txID := range collResp.Collection.TransactionIds {
			allTxIDs = append(allTxIDs, txID)
		}
		if i == 0 {
			fmt.Printf("  GetCollection[0]: OK [%v] txs=%d\n", d, len(collResp.Collection.TransactionIds))
		}
	}
	fmt.Printf("  GetCollection total: %d collections [%v] total_txs=%d\n",
		len(block.CollectionGuarantees), totalCollTime, len(allTxIDs))

	// 3. Try bulk GetTransactionsByBlockID
	t0 = time.Now()
	bulkTxResp, err := cli.GetTransactionsByBlockID(ctx, &access.GetTransactionsByBlockIDRequest{BlockId: block.Id})
	d3 := time.Since(t0)
	if err != nil {
		fmt.Printf("  GetTransactionsByBlockID (bulk): FAIL (%v) [%v]\n", err, d3)
	} else {
		fmt.Printf("  GetTransactionsByBlockID (bulk): OK [%v] txs=%d\n", d3, len(bulkTxResp.Transactions))
	}

	// 4. Try bulk GetTransactionResultsByBlockID (raw, JSON-CDC)
	t0 = time.Now()
	bulkResResp, err := cli.GetTransactionResultsByBlockID(ctx, &access.GetTransactionsByBlockIDRequest{
		BlockId:              block.Id,
		EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
	})
	d4 := time.Since(t0)
	if err != nil {
		fmt.Printf("  GetTransactionResultsByBlockID (bulk raw): FAIL (%v) [%v]\n", err, d4)
	} else {
		totalEvents := 0
		for _, r := range bulkResResp.TransactionResults {
			totalEvents += len(r.Events)
		}
		fmt.Printf("  GetTransactionResultsByBlockID (bulk raw): OK [%v] results=%d events=%d\n",
			d4, len(bulkResResp.TransactionResults), totalEvents)
	}

	// 5. Individual GetTransactionResult for first 3 txs (raw)
	maxIndividual := 3
	if len(allTxIDs) < maxIndividual {
		maxIndividual = len(allTxIDs)
	}
	for i := 0; i < maxIndividual; i++ {
		t := time.Now()
		resp, err := cli.GetTransactionResult(ctx, &access.GetTransactionRequest{
			Id:                   allTxIDs[i],
			EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
		})
		d := time.Since(t)
		if err != nil {
			fmt.Printf("  GetTransactionResult[%d] (raw): FAIL (%v) [%v]\n", i, err, d)
		} else {
			fmt.Printf("  GetTransactionResult[%d] (raw): OK [%v] events=%d status=%v\n", i, d, len(resp.Events), resp.Status)
		}
	}

	// 6. Try GetEventsForBlockIDs with empty type (all events?)
	t0 = time.Now()
	evtResp, err := cli.GetEventsForBlockIDs(ctx, &access.GetEventsForBlockIDsRequest{
		Type:                 "", // empty = all events?
		BlockIds:             [][]byte{block.Id},
		EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
	})
	d6 := time.Since(t0)
	if err != nil {
		fmt.Printf("  GetEventsForBlockIDs (empty type): FAIL (%v) [%v]\n", err, d6)
	} else {
		totalEvts := 0
		for _, r := range evtResp.Results {
			totalEvts += len(r.Events)
		}
		fmt.Printf("  GetEventsForBlockIDs (empty type): OK [%v] blocks=%d events=%d\n",
			d6, len(evtResp.Results), totalEvts)
	}

	// 7. Try GetEventsForBlockIDs with wildcard "flow.*"
	t0 = time.Now()
	evtResp2, err := cli.GetEventsForBlockIDs(ctx, &access.GetEventsForBlockIDsRequest{
		Type:                 "flow.AccountCreated",
		BlockIds:             [][]byte{block.Id},
		EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
	})
	d7 := time.Since(t0)
	if err != nil {
		fmt.Printf("  GetEventsForBlockIDs (flow.AccountCreated): FAIL (%v) [%v]\n", err, d7)
	} else {
		totalEvts := 0
		for _, r := range evtResp2.Results {
			totalEvts += len(r.Events)
		}
		fmt.Printf("  GetEventsForBlockIDs (flow.AccountCreated): OK [%v] events=%d\n", d7, totalEvts)
	}

	// 8. Benchmark: fetch 5 consecutive blocks (block header only)
	t0 = time.Now()
	for i := uint64(0); i < 5; i++ {
		_, err := cli.GetBlockByHeight(ctx, &access.GetBlockByHeightRequest{Height: height + i})
		if err != nil {
			fmt.Printf("  Multi-block fetch: FAIL at height %d: %v\n", height+i, err)
			break
		}
	}
	d8 := time.Since(t0)
	fmt.Printf("  5 consecutive GetBlockByHeight: [%v] avg=%v\n", d8, d8/5)

	if os.Getenv("VERBOSE") != "" {
		// 9. Full block fetch simulation (what our ingester does)
		t0 = time.Now()
		// block already fetched
		// fetch collections
		for _, cg := range block.CollectionGuarantees {
			cli.GetCollectionByID(ctx, &access.GetCollectionByIDRequest{Id: cg.CollectionId})
		}
		// fetch individual tx results
		for _, txID := range allTxIDs {
			cli.GetTransactionResult(ctx, &access.GetTransactionRequest{
				Id:                   txID,
				EventEncodingVersion: entities.EventEncodingVersion_JSON_CDC_V0,
			})
		}
		d9 := time.Since(t0)
		fmt.Printf("  Full sequential fetch (colls+results): [%v] for %d txs = %v/tx\n",
			d9, len(allTxIDs), d9/time.Duration(max(len(allTxIDs), 1)))
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
