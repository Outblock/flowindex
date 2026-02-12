package ingester

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/rlp"
)

// EVMWorker parses EVM events from raw.events and materializes app.evm_* tables.
type EVMWorker struct {
	repo *repository.Repository
}

func NewEVMWorker(repo *repository.Repository) *EVMWorker {
	return &EVMWorker{repo: repo}
}

func (w *EVMWorker) Name() string {
	return "evm_worker"
}

func (w *EVMWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("fetch raw events: %w", err)
	}

	hashes := make([]models.EVMTxHash, 0)
	for _, evt := range events {
		if !isEVMTransactionExecutedEvent(evt.Type) {
			continue
		}

		var payload map[string]interface{}
		dec := json.NewDecoder(bytes.NewReader(evt.Payload))
		dec.UseNumber()
		if err := dec.Decode(&payload); err != nil {
			log.Printf("[evm_worker] skip: JSON decode error at block %d tx %s event %d: %v",
				evt.BlockHeight, evt.TransactionID, evt.EventIndex, err)
			continue
		}

		h := extractEVMHashFromPayload(payload)
		if h == "" {
			log.Printf("[evm_worker] skip: no EVM hash in payload at block %d tx %s event %d",
				evt.BlockHeight, evt.TransactionID, evt.EventIndex)
			continue
		}
		fromAddr, toAddr, dataHex := "", "", ""
		var (
			nonce     uint64
			gasLimit  uint64
			gasPrice  string
			gasFeeCap string
			gasTipCap string
			value     string
			txType    int
			chainID   string
		)
		if txPayload := extractEVMPayloadBytes(payload); len(txPayload) > 0 {
			if decoded, ok := decodeEVMTransactionPayload(txPayload); ok {
				fromAddr = decoded.From
				toAddr = decoded.To
				dataHex = decoded.Data
				nonce = decoded.Nonce
				gasLimit = decoded.GasLimit
				gasPrice = decoded.GasPrice
				gasFeeCap = decoded.GasFeeCap
				gasTipCap = decoded.GasTipCap
				value = decoded.Value
				txType = decoded.TxType
				chainID = decoded.ChainID
			}
		}
		if fromAddr == "" {
			fromAddr = extractEVMHexField(payload, "from", "fromAddress", "sender")
		}
		if toAddr == "" {
			toAddr = extractEVMHexField(payload, "to", "toAddress", "recipient")
		}
		if dataHex == "" {
			dataHex = extractEVMHexField(payload, "data", "input")
		}
		if nonce == 0 {
			nonce = extractEVMUint64(payload, "nonce")
		}
		if gasLimit == 0 {
			gasLimit = extractEVMUint64(payload, "gasLimit", "gas", "gas_limit")
		}
		if gasPrice == "" {
			gasPrice = extractEVMBigIntString(payload, "gasPrice", "gas_price")
		}
		if gasFeeCap == "" {
			gasFeeCap = extractEVMBigIntString(payload, "maxFeePerGas", "max_fee_per_gas", "gasFeeCap", "gas_fee_cap")
		}
		if gasTipCap == "" {
			gasTipCap = extractEVMBigIntString(payload, "maxPriorityFeePerGas", "max_priority_fee_per_gas", "gasTipCap", "gas_tip_cap")
		}
		if value == "" {
			value = extractEVMBigIntString(payload, "value")
		}
		if txType == 0 {
			txType = extractEVMInt(payload, "type", "txType", "tx_type")
		}
		if chainID == "" {
			chainID = extractEVMBigIntString(payload, "chainId", "chain_id")
		}
		logsJSON := extractEVMLogsJSON(payload)
		gasUsed := extractEVMUint64(payload, "gasUsed", "gas_used", "gasConsumed", "gas_consumed")
		statusCode := extractEVMInt(payload, "statusCode", "status_code", "errorCode", "error_code")
		status := extractEVMString(payload, "status", "executionStatus", "result")

		hashes = append(hashes, models.EVMTxHash{
			BlockHeight:      evt.BlockHeight,
			TransactionID:    evt.TransactionID,
			EVMHash:          h,
			EventIndex:       evt.EventIndex,
			TransactionIndex: evt.TransactionIndex,
			FromAddress:      fromAddr,
			ToAddress:        toAddr,
			Nonce:            nonce,
			GasLimit:         gasLimit,
			GasUsed:          gasUsed,
			GasPrice:         gasPrice,
			GasFeeCap:        gasFeeCap,
			GasTipCap:        gasTipCap,
			Value:            value,
			TxType:           txType,
			ChainID:          chainID,
			Data:             dataHex,
			Logs:             logsJSON,
			StatusCode:       statusCode,
			Status:           status,
			Timestamp:        evt.Timestamp,
		})
	}

	if len(hashes) == 0 {
		return nil
	}

	minHeight := hashes[0].BlockHeight
	maxHeight := hashes[0].BlockHeight
	for _, row := range hashes[1:] {
		if row.BlockHeight < minHeight {
			minHeight = row.BlockHeight
		}
		if row.BlockHeight > maxHeight {
			maxHeight = row.BlockHeight
		}
	}

	if err := w.repo.EnsureAppPartitions(ctx, minHeight, maxHeight); err != nil {
		return fmt.Errorf("ensure app partitions: %w", err)
	}

	if err := w.repo.UpsertEVMTxHashes(ctx, hashes); err != nil {
		return fmt.Errorf("upsert evm tx hashes: %w", err)
	}

	return nil
}

type decodedEVMTx struct {
	From      string
	To        string
	Data      string
	Nonce     uint64
	GasLimit  uint64
	GasPrice  string
	GasFeeCap string
	GasTipCap string
	Value     string
	TxType    int
	ChainID   string
}

func decodeEVMTransactionPayload(payload []byte) (decodedEVMTx, bool) {
	var tx types.Transaction
	if err := tx.UnmarshalBinary(payload); err != nil {
		if err := rlp.DecodeBytes(payload, &tx); err != nil {
			return decodedEVMTx{}, false
		}
	}

	var signer types.Signer
	if chainID := tx.ChainId(); chainID != nil {
		signer = types.LatestSignerForChainID(chainID)
	} else {
		signer = types.HomesteadSigner{}
	}
	decoded := decodedEVMTx{
		Nonce:    tx.Nonce(),
		GasLimit: tx.Gas(),
		TxType:   int(tx.Type()),
	}
	if sender, err := types.Sender(signer, &tx); err == nil {
		decoded.From = hex.EncodeToString(sender.Bytes())
	}
	if toAddr := tx.To(); toAddr != nil {
		decoded.To = hex.EncodeToString(toAddr.Bytes())
	}
	if len(tx.Data()) > 0 {
		decoded.Data = hex.EncodeToString(tx.Data())
	}
	if price := tx.GasPrice(); price != nil {
		decoded.GasPrice = price.String()
	}
	if feeCap := tx.GasFeeCap(); feeCap != nil {
		decoded.GasFeeCap = feeCap.String()
	}
	if tipCap := tx.GasTipCap(); tipCap != nil {
		decoded.GasTipCap = tipCap.String()
	}
	if value := tx.Value(); value != nil {
		decoded.Value = value.String()
	}
	if chainID := tx.ChainId(); chainID != nil {
		decoded.ChainID = chainID.String()
	}
	return decoded, true
}
