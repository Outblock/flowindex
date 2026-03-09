package repository

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"strings"
)

// BackfillEVMBridgeTransfers fixes ft_transfers rows for EVMVMBridgedToken/NFT
// contracts where the to_address is NULL (Cadence-side burns that are actually
// cross-VM bridge transfers). It decodes EVM call data from raw events to
// resolve the actual EVM recipient.
func (r *Repository) BackfillEVMBridgeTransfers(ctx context.Context) error {
	log.Printf("[backfill_evm_bridge] starting...")

	// Step 1: Find all affected ft_transfers rows
	rows, err := r.db.Query(ctx, `
		SELECT ft.block_height, encode(ft.transaction_id, 'hex'), ft.event_index, ft.contract_name
		FROM app.ft_transfers ft
		WHERE ft.contract_name LIKE 'EVMVMBridgedToken_%%'
		  AND ft.to_address IS NULL
		ORDER BY ft.block_height`)
	if err != nil {
		return fmt.Errorf("query affected rows: %w", err)
	}
	defer rows.Close()

	type affectedRow struct {
		blockHeight  int64
		txID         string
		eventIndex   int
		contractName string
	}
	var affected []affectedRow
	for rows.Next() {
		var r affectedRow
		if err := rows.Scan(&r.blockHeight, &r.txID, &r.eventIndex, &r.contractName); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		affected = append(affected, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows err: %w", err)
	}

	log.Printf("[backfill_evm_bridge] found %d affected ft_transfer rows", len(affected))
	if len(affected) == 0 {
		return nil
	}

	// Also find affected NFT transfers
	nftRows, err := r.db.Query(ctx, `
		SELECT ft.block_height, encode(ft.transaction_id, 'hex'), ft.event_index, ft.contract_name
		FROM app.nft_transfers ft
		WHERE ft.contract_name LIKE 'EVMVMBridgedNFT_%%'
		  AND ft.to_address IS NULL
		ORDER BY ft.block_height`)
	if err != nil {
		return fmt.Errorf("query affected nft rows: %w", err)
	}
	defer nftRows.Close()

	var affectedNFT []affectedRow
	for nftRows.Next() {
		var r affectedRow
		if err := nftRows.Scan(&r.blockHeight, &r.txID, &r.eventIndex, &r.contractName); err != nil {
			return fmt.Errorf("scan nft: %w", err)
		}
		affectedNFT = append(affectedNFT, r)
	}
	if err := nftRows.Err(); err != nil {
		return fmt.Errorf("nft rows err: %w", err)
	}
	log.Printf("[backfill_evm_bridge] found %d affected nft_transfer rows", len(affectedNFT))

	// Step 2: Group by transaction_id to batch-fetch EVM events
	txIDs := make(map[string]bool)
	for _, r := range affected {
		txIDs[r.txID] = true
	}
	for _, r := range affectedNFT {
		txIDs[r.txID] = true
	}

	// Step 3: For each transaction, fetch EVM.TransactionExecuted events and decode
	evmByTx := make(map[string][]evmBackfillInfo)

	txList := make([]string, 0, len(txIDs))
	for id := range txIDs {
		txList = append(txList, id)
	}

	// Process in batches of 100 tx IDs
	const batchSize = 100
	for i := 0; i < len(txList); i += batchSize {
		end := i + batchSize
		if end > len(txList) {
			end = len(txList)
		}
		batch := txList[i:end]

		// Build bytea array for IN clause
		byteaArr := make([][]byte, len(batch))
		for j, id := range batch {
			b, _ := hex.DecodeString(id)
			byteaArr[j] = b
		}

		evtRows, err := r.db.Query(ctx, `
			SELECT encode(transaction_id, 'hex'), payload
			FROM raw.events
			WHERE transaction_id = ANY($1)
			  AND LOWER(type) LIKE '%evm.transactionexecuted%'`, byteaArr)
		if err != nil {
			return fmt.Errorf("query evm events: %w", err)
		}

		for evtRows.Next() {
			var txID string
			var payload []byte
			if err := evtRows.Scan(&txID, &payload); err != nil {
				evtRows.Close()
				return fmt.Errorf("scan evm event: %w", err)
			}

			info := parseEVMPayloadForBackfill(payload)
			if info.data != "" {
				evmByTx[txID] = append(evmByTx[txID], info)
			}
		}
		evtRows.Close()
	}

	log.Printf("[backfill_evm_bridge] loaded EVM events for %d transactions", len(evmByTx))

	// Step 4: Match and update ft_transfers
	updated := 0
	for _, row := range affected {
		evmInfos := evmByTx[row.txID]
		if len(evmInfos) == 0 {
			continue
		}

		evmContract := extractContractFromName(row.contractName)
		if evmContract == "" {
			continue
		}

		// Find matching EVM execution targeting this contract
		for _, info := range evmInfos {
			if info.to != evmContract {
				continue
			}

			decoded := decodeCallDataForBackfill(info.data)
			if decoded.callType == "unknown" || decoded.recipient == "" {
				continue
			}

			// Update: set to_address = COA (from), and store the decoded recipient
			coaBytes, _ := hex.DecodeString(info.from)
			txIDBytes, _ := hex.DecodeString(row.txID)

			_, err := r.db.Exec(ctx, `
				UPDATE app.ft_transfers
				SET to_address = $1
				WHERE block_height = $2 AND transaction_id = $3 AND event_index = $4`,
				coaBytes, row.blockHeight, txIDBytes, row.eventIndex)
			if err != nil {
				log.Printf("[backfill_evm_bridge] update ft error height=%d tx=%s idx=%d: %v",
					row.blockHeight, row.txID, row.eventIndex, err)
			} else {
				updated++
			}
			break
		}
	}

	// Step 5: Same for NFT transfers
	nftUpdated := 0
	for _, row := range affectedNFT {
		evmInfos := evmByTx[row.txID]
		if len(evmInfos) == 0 {
			continue
		}

		evmContract := extractContractFromName(row.contractName)
		if evmContract == "" {
			continue
		}

		for _, info := range evmInfos {
			if info.to != evmContract {
				continue
			}

			decoded := decodeCallDataForBackfill(info.data)
			if decoded.callType == "unknown" || decoded.recipient == "" {
				continue
			}

			coaBytes, _ := hex.DecodeString(info.from)
			txIDBytes, _ := hex.DecodeString(row.txID)

			_, err := r.db.Exec(ctx, `
				UPDATE app.nft_transfers
				SET to_address = $1
				WHERE block_height = $2 AND transaction_id = $3 AND event_index = $4`,
				coaBytes, row.blockHeight, txIDBytes, row.eventIndex)
			if err != nil {
				log.Printf("[backfill_evm_bridge] update nft error height=%d tx=%s idx=%d: %v",
					row.blockHeight, row.txID, row.eventIndex, err)
			} else {
				nftUpdated++
			}
			break
		}
	}

	log.Printf("[backfill_evm_bridge] done: updated %d ft_transfers, %d nft_transfers", updated, nftUpdated)
	return nil
}

// ── Local helpers (self-contained to avoid circular deps with ingester) ──

func parseEVMPayloadForBackfill(payload []byte) evmBackfillInfo {
	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return evmBackfillInfo{}
	}

	from := extractBackfillHexField(raw, "from", "fromAddress", "sender")
	to := extractBackfillHexField(raw, "to", "toAddress", "recipient")
	data := extractBackfillHexField(raw, "data", "input")

	// Try decoding the raw transaction payload for direct calls
	if (from == "" || to == "" || data == "") {
		if txPayload := extractBackfillPayloadBytes(raw); len(txPayload) > 0 {
			if decoded := decodeBackfillTxPayload(txPayload); decoded != nil {
				if from == "" {
					from = decoded.from
				}
				if to == "" {
					to = decoded.to
				}
				if data == "" {
					data = decoded.data
				}
			}
		}
	}

	return evmBackfillInfo{from: from, to: to, data: data}
}

type evmBackfillInfo struct {
	from string
	to   string
	data string
}

type decodedBackfillPayload struct {
	from string
	to   string
	data string
}

func extractBackfillHexField(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		v, ok := m[key]
		if !ok {
			continue
		}
		switch vv := v.(type) {
		case string:
			s := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(vv)), "0x")
			if len(s) > 0 && isHexString(s) {
				return s
			}
		case []interface{}:
			// byte array
			buf := make([]byte, len(vv))
			for i, b := range vv {
				if n, ok := b.(float64); ok {
					buf[i] = byte(int(n) & 0xff)
				}
			}
			return hex.EncodeToString(buf)
		}
	}
	return ""
}

func isHexString(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func extractBackfillPayloadBytes(m map[string]interface{}) []byte {
	for _, key := range []string{"payload", "transaction", "tx", "txPayload", "transactionPayload"} {
		v, ok := m[key]
		if !ok {
			continue
		}
		switch vv := v.(type) {
		case string:
			s := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(vv)), "0x")
			b, err := hex.DecodeString(s)
			if err == nil && len(b) > 0 {
				return b
			}
		case []interface{}:
			buf := make([]byte, len(vv))
			for i, b := range vv {
				if n, ok := b.(float64); ok {
					buf[i] = byte(int(n) & 0xff)
				}
			}
			if len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

func decodeBackfillTxPayload(payload []byte) *decodedBackfillPayload {
	if len(payload) < 2 || payload[0] != 0xff {
		return nil
	}
	// RLP decode: 0xff || RLP([nonce, subType, from(20), to(20), data, value, gasLimit, ...])
	data := payload[1:]
	pos := 0
	if pos >= len(data) {
		return nil
	}
	// Skip list header
	b := data[pos]
	if b >= 0xf8 {
		pos += 1 + int(b-0xf7)
	} else if b >= 0xc0 {
		pos += 1
	} else {
		return nil
	}

	readItem := func() []byte {
		if pos >= len(data) {
			return nil
		}
		b := data[pos]
		if b <= 0x7f {
			pos++
			return []byte{b}
		}
		if b <= 0xb7 {
			l := int(b - 0x80)
			pos++
			if pos+l > len(data) {
				return nil
			}
			out := data[pos : pos+l]
			pos += l
			return out
		}
		if b <= 0xbf {
			ll := int(b - 0xb7)
			pos++
			l := 0
			for i := 0; i < ll && pos+i < len(data); i++ {
				l = (l << 8) | int(data[pos+i])
			}
			pos += ll
			if pos+l > len(data) {
				return nil
			}
			out := data[pos : pos+l]
			pos += l
			return out
		}
		return nil
	}

	readItem() // nonce
	readItem() // subType
	fromBytes := readItem()
	toBytes := readItem()
	dataBytes := readItem()

	result := &decodedBackfillPayload{}
	if len(fromBytes) == 20 {
		result.from = hex.EncodeToString(fromBytes)
	}
	if len(toBytes) == 20 {
		result.to = hex.EncodeToString(toBytes)
	}
	if len(dataBytes) > 0 {
		result.data = hex.EncodeToString(dataBytes)
	}
	return result
}

func extractContractFromName(contractName string) string {
	// EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750
	// EVMVMBridgedNFT_abc123
	idx := strings.LastIndex(contractName, "_")
	if idx < 0 || idx == len(contractName)-1 {
		return ""
	}
	addr := strings.ToLower(contractName[idx+1:])
	if !isHexString(addr) || len(addr) == 0 {
		return ""
	}
	// Normalize to 40 hex chars
	if len(addr) < 40 {
		addr = strings.Repeat("0", 40-len(addr)) + addr
	}
	return addr
}

type backfillDecodedCall struct {
	recipient string
	tokenID   string
	callType  string
}

func decodeCallDataForBackfill(dataHex string) backfillDecodedCall {
	data := strings.TrimPrefix(strings.ToLower(dataHex), "0x")
	if len(data) < 8 {
		return backfillDecodedCall{callType: "unknown"}
	}

	selector := data[:8]
	params := data[8:]

	extractAddr := func(wordIdx int) string {
		start := wordIdx * 64
		end := start + 64
		if len(params) < end {
			return ""
		}
		word := params[start:end]
		addrHex := word[24:64]
		allZero := true
		for _, c := range addrHex {
			if c != '0' {
				allZero = false
				break
			}
		}
		if allZero {
			return ""
		}
		return addrHex
	}

	extractUint256 := func(wordIdx int) string {
		start := wordIdx * 64
		end := start + 64
		if len(params) < end {
			return ""
		}
		word := params[start:end]
		b, err := hex.DecodeString(word)
		if err != nil {
			return ""
		}
		val := new(big.Int).SetBytes(b)
		return val.String()
	}

	switch selector {
	case "a9059cbb": // transfer(address,uint256)
		if addr := extractAddr(0); addr != "" {
			return backfillDecodedCall{recipient: addr, callType: "erc20_transfer"}
		}
	case "23b872dd": // transferFrom(address,address,uint256)
		if addr := extractAddr(1); addr != "" {
			tid := extractUint256(2)
			return backfillDecodedCall{recipient: addr, tokenID: tid, callType: "erc20_transferFrom"}
		}
	case "42842e0e", "b88d4fde": // safeTransferFrom(address,address,uint256[,bytes])
		if addr := extractAddr(1); addr != "" {
			tid := extractUint256(2)
			return backfillDecodedCall{recipient: addr, tokenID: tid, callType: "erc721_safeTransferFrom"}
		}
	case "f242432a": // safeTransferFrom(address,address,uint256,uint256,bytes)
		if addr := extractAddr(1); addr != "" {
			tid := extractUint256(2)
			return backfillDecodedCall{recipient: addr, tokenID: tid, callType: "erc1155_safeTransferFrom"}
		}
	case "2eb2c2d6": // safeBatchTransferFrom
		if addr := extractAddr(1); addr != "" {
			return backfillDecodedCall{recipient: addr, callType: "erc1155_safeBatchTransferFrom"}
		}
	}

	return backfillDecodedCall{callType: "unknown"}
}
