package models

import "time"

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

	TotalGasUsed uint64        `json:"total_gas_used"`
	IsSealed     bool          `json:"is_sealed"`
	Transactions []Transaction `json:"transactions,omitempty"` // For block details
	CreatedAt    time.Time     `json:"created_at"`
}

// Transaction represents the 'transactions' table
type Transaction struct {
	ID                     string   `json:"id"`
	BlockHeight            uint64   `json:"block_height"`
	ProposerAddress        string   `json:"proposer_address"`
	ProposerKeyIndex       uint32   `json:"proposer_key_index"`
	ProposerSequenceNumber uint64   `json:"proposer_sequence_number"`
	PayerAddress           string   `json:"payer_address"`
	Authorizers            []string `json:"authorizers"` // Stored as TEXT[] in DB
	Script                 string   `json:"script,omitempty"`
	Arguments              []byte   `json:"arguments,omitempty"` // Stored as JSONB
	Status                 string   `json:"status"`              // SEALED, EXPIRED, PENDING
	ErrorMessage           string   `json:"error_message,omitempty"`

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

	GasLimit  uint64    `json:"gas_limit"`
	GasUsed   uint64    `json:"gas_used"`
	CreatedAt time.Time `json:"created_at"`
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
	ID               int       `json:"id"`
	TransactionID    string    `json:"transaction_id"`
	TransactionIndex int       `json:"transaction_index"`
	Type             string    `json:"type"`
	EventIndex       int       `json:"event_index"`
	Payload          []byte    `json:"payload"` // Stored as JSONB
	BlockHeight      uint64    `json:"block_height"`
	CreatedAt        time.Time `json:"created_at"`
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
	IsNFT                bool      `json:"is_nft"`
	CreatedAt            time.Time `json:"created_at"`
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
	PublicKey     string    `json:"public_key"`
	Address       string    `json:"address"`
	TransactionID string    `json:"transaction_id"`
	BlockHeight   uint64    `json:"block_height"`
	CreatedAt     time.Time `json:"created_at"`
}
