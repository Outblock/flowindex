package ingester

import (
	"encoding/hex"
	"math/big"
	"strings"
)

// evmCallInfo holds decoded EVM transaction data collected from EVM.TransactionExecuted events.
type evmCallInfo struct {
	txID        string // Flow transaction ID
	evmHash     string // EVM transaction hash (64 hex, no 0x)
	from        string // EVM sender (40 hex, no 0x)
	to          string // EVM contract address (40 hex, no 0x)
	data        string // raw call data hex (no 0x)
	blockHeight uint64
}

// Well-known EVM function selectors (4 bytes hex, no 0x).
const (
	// ERC-20
	selERC20Transfer     = "a9059cbb" // transfer(address,uint256)
	selERC20TransferFrom = "23b872dd" // transferFrom(address,address,uint256) — also ERC-721

	// ERC-721
	selERC721SafeTransferFrom3 = "42842e0e" // safeTransferFrom(address,address,uint256)
	selERC721SafeTransferFrom4 = "b88d4fde" // safeTransferFrom(address,address,uint256,bytes)

	// ERC-1155
	selERC1155SafeTransferFrom  = "f242432a" // safeTransferFrom(address,address,uint256,uint256,bytes)
	selERC1155SafeBatchTransfer = "2eb2c2d6" // safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)
)

// decodedEVMCall holds the result of decoding EVM call data.
type decodedEVMCall struct {
	Recipient string // decoded transfer recipient (40 hex, no 0x)
	TokenID   string // decoded NFT token ID (decimal string), empty for FT
	CallType  string // "erc20_transfer", "erc20_transferFrom", "erc721_*", "erc1155_*", "unknown"
}

// decodeEVMCallData attempts to decode the recipient address from EVM call data.
func decodeEVMCallData(dataHex string) decodedEVMCall {
	data := strings.TrimPrefix(strings.ToLower(dataHex), "0x")
	if len(data) < 8 {
		return decodedEVMCall{CallType: "unknown"}
	}

	selector := data[:8]
	params := data[8:]

	switch selector {
	case selERC20Transfer:
		// transfer(address to, uint256 amount)
		if addr := extractABIAddress(params, 0); addr != "" {
			return decodedEVMCall{Recipient: addr, CallType: "erc20_transfer"}
		}

	case selERC20TransferFrom:
		// transferFrom(address from, address to, uint256 amount/tokenId)
		// Also matches ERC-721 transferFrom
		if addr := extractABIAddress(params, 1); addr != "" {
			tid := extractABIUint256(params, 2)
			return decodedEVMCall{Recipient: addr, TokenID: tid, CallType: "erc20_transferFrom"}
		}

	case selERC721SafeTransferFrom3:
		// safeTransferFrom(address from, address to, uint256 tokenId)
		if addr := extractABIAddress(params, 1); addr != "" {
			tid := extractABIUint256(params, 2)
			return decodedEVMCall{Recipient: addr, TokenID: tid, CallType: "erc721_safeTransferFrom"}
		}

	case selERC721SafeTransferFrom4:
		// safeTransferFrom(address from, address to, uint256 tokenId, bytes data)
		if addr := extractABIAddress(params, 1); addr != "" {
			tid := extractABIUint256(params, 2)
			return decodedEVMCall{Recipient: addr, TokenID: tid, CallType: "erc721_safeTransferFrom"}
		}

	case selERC1155SafeTransferFrom:
		// safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)
		if addr := extractABIAddress(params, 1); addr != "" {
			tid := extractABIUint256(params, 2)
			return decodedEVMCall{Recipient: addr, TokenID: tid, CallType: "erc1155_safeTransferFrom"}
		}

	case selERC1155SafeBatchTransfer:
		// safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)
		if addr := extractABIAddress(params, 1); addr != "" {
			return decodedEVMCall{Recipient: addr, CallType: "erc1155_safeBatchTransferFrom"}
		}
	}

	return decodedEVMCall{CallType: "unknown"}
}

// isKnownTokenSelector returns true if the call data starts with a recognized
// ERC-20/721/1155 transfer selector.
func isKnownTokenSelector(dataHex string) bool {
	data := strings.TrimPrefix(strings.ToLower(dataHex), "0x")
	if len(data) < 8 {
		return false
	}
	switch data[:8] {
	case selERC20Transfer, selERC20TransferFrom,
		selERC721SafeTransferFrom3, selERC721SafeTransferFrom4,
		selERC1155SafeTransferFrom, selERC1155SafeBatchTransfer:
		return true
	}
	return false
}

// extractABIAddress extracts an address from ABI-encoded parameters at the given
// word index (each word is 32 bytes = 64 hex chars). Returns normalized 40-char
// hex address or empty string.
func extractABIAddress(paramsHex string, wordIndex int) string {
	start := wordIndex * 64
	end := start + 64
	if len(paramsHex) < end {
		return ""
	}
	word := paramsHex[start:end]
	// Address is in the last 20 bytes (40 hex chars) of the 32-byte word.
	addrHex := word[24:64]
	// Validate non-zero.
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

// extractABIUint256 extracts a uint256 value as a decimal string from ABI params.
func extractABIUint256(paramsHex string, wordIndex int) string {
	start := wordIndex * 64
	end := start + 64
	if len(paramsHex) < end {
		return ""
	}
	word := paramsHex[start:end]
	b, err := hex.DecodeString(word)
	if err != nil {
		return ""
	}
	val := new(big.Int).SetBytes(b)
	return val.String()
}
