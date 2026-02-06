package models

import (
	"encoding/json"
	"time"
)

// Block represents the 'blocks' table
type Block struct {
	Height          uint64    `json:"height"`
	ID              string    `json:"id"`
	ParentID        string    `json:"parent_id"`
	Timestamp       time.Time `json:"timestamp"`
	CollectionCount int       `json:"collection_count"`
	TxCount         int       `json:"tx_count"`
	EventCount      int       `json:"event_count"`
	StateRootHash   string    `json:"state_root_hash"`

	// Redundancy Fields
	CollectionGuarantees []byte `json:"collection_guarantees,omitempty"`
	BlockSeals           []byte `json:"block_seals,omitempty"`
	Signatures           []byte `json:"signatures,omitempty"`
	ParentVoterSignature string `json:"parent_voter_signature,omitempty"`
	BlockStatus          string `json:"block_status,omitempty"`
	ExecutionResultID    string `json:"execution_result_id,omitempty"`

	TotalGasUsed uint64        `json:"total_gas_used"`
	IsSealed     bool          `json:"is_sealed"`
	Transactions []Transaction `json:"transactions,omitempty"` // For block details
	CreatedAt    time.Time     `json:"created_at"`
}

// Transaction represents the 'transactions' table
type Transaction struct {
	ID                     string          `json:"id"`
	BlockHeight            uint64          `json:"block_height"`
	TransactionIndex       int             `json:"transaction_index"` // Position in block
	ProposerAddress        string          `json:"proposer_address"`
	ProposerKeyIndex       uint32          `json:"proposer_key_index"`
	ProposerSequenceNumber uint64          `json:"proposer_sequence_number"`
	PayerAddress           string          `json:"payer_address"`
	Authorizers            []string        `json:"authorizers"` // Stored as TEXT[] in DB
	Script                 string          `json:"script,omitempty"`
	Arguments              json.RawMessage `json:"arguments,omitempty"` // Stored as JSONB
	Status                 string          `json:"status"`              // SEALED, EXPIRED, PENDING
	ErrorMessage           string          `json:"error_message,omitempty"`

	// Redundancy Fields
	ReferenceBlockID   string `json:"reference_block_id,omitempty"`
	ProposalKey        []byte `json:"proposal_key,omitempty"`
	PayloadSignatures  []byte `json:"payload_signatures,omitempty"`
	EnvelopeSignatures []byte `json:"envelope_signatures,omitempty"`

	// EVM Support
	IsEVM    bool   `json:"is_evm"`
	EVMHash  string `json:"evm_hash,omitempty"`
	EVMFrom  string `json:"evm_from,omitempty"`
	EVMTo    string `json:"evm_to,omitempty"`
	EVMValue string `json:"evm_value,omitempty"`

	GasLimit         uint64    `json:"gas_limit"`
	GasUsed          uint64    `json:"gas_used"`
	ComputationUsage uint64    `json:"computation_usage"`
	StatusCode       int       `json:"status_code"`
	ExecutionStatus  string    `json:"execution_status"` // Success, Failure, Pending
	EventCount       int       `json:"event_count"`
	Events           []Event   `json:"events,omitempty"`
	Timestamp        time.Time `json:"timestamp"`
	CreatedAt        time.Time `json:"created_at"`
}

// EVMTransaction represents details from 'evm_transactions' table
type EVMTransaction struct {
	TransactionID string `json:"transaction_id"`
	EVMHash       string `json:"evm_hash"`
	FromAddress   string `json:"from_address"`
	ToAddress     string `json:"to_address"`
	Value         string `json:"value"`
	Data          string `json:"data"`
	GasUsed       uint64 `json:"gas_used"`
	Logs          []byte `json:"logs"`
}

// Event represents the 'events' table
type Event struct {
	ID               int             `json:"id"`
	TransactionID    string          `json:"transaction_id"`
	TransactionIndex int             `json:"transaction_index"`
	Type             string          `json:"type"`
	EventIndex       int             `json:"event_index"`
	ContractAddress  string          `json:"contract_address,omitempty"`
	ContractName     string          `json:"contract_name,omitempty"`
	EventName        string          `json:"event_name,omitempty"`
	Payload          json.RawMessage `json:"payload"`          // Stored as JSONB
	Values           json.RawMessage `json:"values,omitempty"` // Flattened key-value pairs
	BlockHeight      uint64          `json:"block_height"`
	Timestamp        time.Time       `json:"timestamp"`
	CreatedAt        time.Time       `json:"created_at"`
}

// Collection represents a block collection (raw.collections)
type Collection struct {
	BlockHeight    uint64    `json:"block_height"`
	ID             string    `json:"id"`
	TransactionIDs []string  `json:"transaction_ids"`
	Timestamp      time.Time `json:"timestamp"`
}

// TokenTransfer represents 'token_transfers' (Fungible & NFT)
type TokenTransfer struct {
	ID                   int       `json:"id"`
	TransactionID        string    `json:"transaction_id"`
	BlockHeight          uint64    `json:"block_height"`
	TokenContractAddress string    `json:"token_contract_address"`
	FromAddress          string    `json:"from_address"`
	ToAddress            string    `json:"to_address"`
	Amount               string    `json:"amount"`
	TokenID              string    `json:"token_id,omitempty"` // For NFTs
	EventIndex           int       `json:"event_index"`
	IsNFT                bool      `json:"is_nft"`
	Timestamp            time.Time `json:"timestamp"`
	CreatedAt            time.Time `json:"created_at"`
}

// COAAccount maps a Cadence Owned Account (EVM/COA) address to a Flow address.
type COAAccount struct {
	COAAddress    string    `json:"coa_address"`
	FlowAddress   string    `json:"flow_address"`
	TransactionID string    `json:"transaction_id"`
	BlockHeight   uint64    `json:"block_height"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// NFTTransfer represents the 'nft_transfers' table
type NFTTransfer struct {
	ID                   int       `json:"id"`
	TransactionID        string    `json:"transaction_id"`
	BlockHeight          uint64    `json:"block_height"`
	TokenContractAddress string    `json:"token_contract_address"`
	NFTID                string    `json:"nft_id"`
	FromAddress          string    `json:"from_address"`
	ToAddress            string    `json:"to_address"`
	EventIndex           int       `json:"event_index"`
	Timestamp            time.Time `json:"timestamp"`
	CreatedAt            time.Time `json:"created_at"`
}

// AddressTransaction represents the lookup table 'address_transactions'
type AddressTransaction struct {
	Address         string `json:"address"`
	TransactionID   string `json:"transaction_id"`
	BlockHeight     uint64 `json:"block_height"`
	TransactionType string `json:"transaction_type"`
	Role            string `json:"role"`
}

// IndexingCheckpoint represents 'indexing_checkpoints'
type IndexingCheckpoint struct {
	ServiceName string    `json:"service_name"`
	LastHeight  uint64    `json:"last_height"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AccountKey represents the public key to address mapping
type AccountKey struct {
	Address          string `json:"address"`
	KeyIndex         int    `json:"key_index"`
	PublicKey        string `json:"public_key,omitempty"`
	SigningAlgorithm string `json:"signing_algorithm,omitempty"`
	HashingAlgorithm string `json:"hashing_algorithm,omitempty"`
	Weight           int    `json:"weight,omitempty"`
	Revoked          bool   `json:"revoked"`

	AddedAtHeight     uint64 `json:"added_at_height,omitempty"`
	RevokedAtHeight   uint64 `json:"revoked_at_height,omitempty"`
	LastUpdatedHeight uint64 `json:"last_updated_height,omitempty"`
}

// SmartContract represents the smart_contracts table
type SmartContract struct {
	ID            int       `json:"id"`
	Address       string    `json:"address"`
	Name          string    `json:"name"`
	Code          string    `json:"code,omitempty"`
	Version       int       `json:"version"`
	TransactionID string    `json:"transaction_id"`
	BlockHeight   uint64    `json:"block_height"`
	IsEVM         bool      `json:"is_evm"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// AddressStats represents the address_stats table
type AddressStats struct {
	Address            string    `json:"address"`
	TxCount            int64     `json:"tx_count"`
	TokenTransferCount int64     `json:"token_transfer_count"`
	NFTTransferCount   int64     `json:"nft_transfer_count"`
	TotalGasUsed       uint64    `json:"total_gas_used"`
	LastUpdatedBlock   uint64    `json:"last_updated_block"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// DailyStat represents daily transaction statistics
type DailyStat struct {
	Date           string `json:"date"`
	TxCount        int64  `json:"tx_count"`
	ActiveAccounts int64  `json:"active_accounts"`
	NewContracts   int    `json:"new_contracts"`
}

// AccountCatalog represents app.accounts
type AccountCatalog struct {
	Address         string    `json:"address"`
	FirstSeenHeight uint64    `json:"first_seen_height"`
	LastSeenHeight  uint64    `json:"last_seen_height"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// FTToken represents app.ft_tokens
type FTToken struct {
	ContractAddress string    `json:"contract_address"`
	Name            string    `json:"name"`
	Symbol          string    `json:"symbol"`
	Decimals        int       `json:"decimals"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// FTHolding represents app.ft_holdings
type FTHolding struct {
	Address         string    `json:"address"`
	ContractAddress string    `json:"contract_address"`
	Balance         string    `json:"balance"`
	LastHeight      uint64    `json:"last_height"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// NFTCollection represents app.nft_collections
type NFTCollection struct {
	ContractAddress string    `json:"contract_address"`
	Name            string    `json:"name"`
	Symbol          string    `json:"symbol"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// NFTOwnership represents app.nft_ownership
type NFTOwnership struct {
	ContractAddress string    `json:"contract_address"`
	NFTID           string    `json:"nft_id"`
	Owner           string    `json:"owner"`
	LastHeight      uint64    `json:"last_height"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// TxContract represents app.tx_contracts
type TxContract struct {
	TransactionID      string `json:"transaction_id"`
	ContractIdentifier string `json:"contract_identifier"`
	Source             string `json:"source"`
}

// TxTag represents app.tx_tags
type TxTag struct {
	TransactionID string `json:"transaction_id"`
	Tag           string `json:"tag"`
}

// StatusSnapshot represents cached status payloads
type StatusSnapshot struct {
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
	AsOf    time.Time       `json:"as_of"`
}
