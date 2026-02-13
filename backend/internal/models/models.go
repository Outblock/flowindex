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
	TransactionID   string `json:"transaction_id"`
	EVMHash         string `json:"evm_hash"`
	FromAddress     string `json:"from_address"`
	ToAddress       string `json:"to_address"`
	Nonce           uint64 `json:"nonce"`
	GasLimit        uint64 `json:"gas_limit"`
	GasUsed         uint64 `json:"gas_used"`
	GasPrice        string `json:"gas_price"`
	GasFeeCap       string `json:"gas_fee_cap"`
	GasTipCap       string `json:"gas_tip_cap"`
	Value           string `json:"value"`
	TxType          int    `json:"tx_type"`
	ChainID         string `json:"chain_id"`
	Data            string `json:"data"`
	Logs            []byte `json:"logs"`
	TransactionIndex int   `json:"transaction_index"`
	StatusCode      int    `json:"status_code"`
	Status          string `json:"status"`
}

// EVMTxHash represents a mapping from a Cadence tx to one or more EVM tx hashes.
type EVMTxHash struct {
	BlockHeight      uint64    `json:"block_height"`
	TransactionID    string    `json:"transaction_id"`
	EVMHash          string    `json:"evm_hash"`
	EventIndex       int       `json:"event_index"`
	TransactionIndex int       `json:"transaction_index,omitempty"`
	FromAddress      string    `json:"from_address,omitempty"`
	ToAddress        string    `json:"to_address,omitempty"`
	Nonce            uint64    `json:"nonce,omitempty"`
	GasLimit         uint64    `json:"gas_limit,omitempty"`
	GasUsed          uint64    `json:"gas_used,omitempty"`
	GasPrice         string    `json:"gas_price,omitempty"`
	GasFeeCap        string    `json:"gas_fee_cap,omitempty"`
	GasTipCap        string    `json:"gas_tip_cap,omitempty"`
	Value            string    `json:"value,omitempty"`
	TxType           int       `json:"tx_type,omitempty"`
	ChainID          string    `json:"chain_id,omitempty"`
	Data             string    `json:"data,omitempty"`
	Logs             string    `json:"logs,omitempty"`
	StatusCode       int       `json:"status_code,omitempty"`
	Status           string    `json:"status,omitempty"`
	Timestamp        time.Time `json:"timestamp"`
	CreatedAt        time.Time `json:"created_at"`
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

// TokenTransfer represents FT/NFT transfers (app.ft_transfers / app.nft_transfers).
type TokenTransfer struct {
	ID                   int       `json:"id"`
	TransactionID        string    `json:"transaction_id"`
	BlockHeight          uint64    `json:"block_height"`
	TokenContractAddress string    `json:"token_contract_address"`
	ContractName         string    `json:"contract_name,omitempty"`
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
	Address         string    `json:"address"`
	Name            string    `json:"name"`
	Code            string    `json:"code,omitempty"`
	Version         int       `json:"version"`
	Kind            string    `json:"kind,omitempty"`
	FirstSeenHeight uint64    `json:"first_seen_height,omitempty"`
	LastSeenHeight  uint64    `json:"last_seen_height,omitempty"`
	BlockHeight     uint64    `json:"block_height"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// ContractVersion represents a single version of a contract's code.
type ContractVersion struct {
	Address       string    `json:"address"`
	Name          string    `json:"name"`
	Version       int       `json:"version"`
	Code          string    `json:"code,omitempty"`
	BlockHeight   uint64    `json:"block_height"`
	TransactionID string    `json:"transaction_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// AddressStats represents the address_stats table
type AddressStats struct {
	Address          string    `json:"address"`
	TxCount          int64     `json:"tx_count"`
	TotalGasUsed     uint64    `json:"total_gas_used"`
	LastUpdatedBlock uint64    `json:"last_updated_block"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
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
	ContractAddress string          `json:"contract_address"`
	ContractName    string          `json:"contract_name,omitempty"`
	Name            string          `json:"name"`
	Symbol          string          `json:"symbol"`
	Decimals        int             `json:"decimals"`
	Description     string          `json:"description,omitempty"`
	ExternalURL     string          `json:"external_url,omitempty"`
	Logo            string          `json:"logo,omitempty"`
	VaultPath       string          `json:"vault_path,omitempty"`
	ReceiverPath    string          `json:"receiver_path,omitempty"`
	BalancePath     string          `json:"balance_path,omitempty"`
	Socials         json.RawMessage `json:"socials,omitempty"`
	EVMAddress      string          `json:"evm_address,omitempty"`
	HolderCount     int64           `json:"holder_count"`
	TransferCount   int64           `json:"transfer_count"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// FTHolding represents app.ft_holdings
type FTHolding struct {
	Address         string    `json:"address"`
	ContractAddress string    `json:"contract_address"`
	ContractName    string    `json:"contract_name,omitempty"`
	Balance         string    `json:"balance"`
	LastHeight      uint64    `json:"last_height"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// NFTCollection represents app.nft_collections
type NFTCollection struct {
	ContractAddress string          `json:"contract_address"`
	ContractName    string          `json:"contract_name,omitempty"`
	Name            string          `json:"name"`
	Symbol          string          `json:"symbol"`
	Description     string          `json:"description,omitempty"`
	ExternalURL     string          `json:"external_url,omitempty"`
	SquareImage     string          `json:"square_image,omitempty"`
	BannerImage     string          `json:"banner_image,omitempty"`
	Socials         json.RawMessage `json:"socials,omitempty"`
	PublicPath      string          `json:"public_path,omitempty"`
	EVMAddress      string          `json:"evm_address,omitempty"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// NFTItem represents app.nft_items
type NFTItem struct {
	ContractAddress   string          `json:"contract_address"`
	ContractName      string          `json:"contract_name,omitempty"`
	NFTID             string          `json:"nft_id"`
	Name              string          `json:"name,omitempty"`
	Description       string          `json:"description,omitempty"`
	Thumbnail         string          `json:"thumbnail,omitempty"`
	ExternalURL       string          `json:"external_url,omitempty"`
	SerialNumber      *int64          `json:"serial_number,omitempty"`
	EditionName       string          `json:"edition_name,omitempty"`
	EditionNumber     *int64          `json:"edition_number,omitempty"`
	EditionMax        *int64          `json:"edition_max,omitempty"`
	RarityScore       string          `json:"rarity_score,omitempty"`
	RarityDescription string          `json:"rarity_description,omitempty"`
	Traits            json.RawMessage `json:"traits,omitempty"`
	MetadataError     string          `json:"-"`
	Retries           int             `json:"-"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// NFTOwnership represents app.nft_ownership
type NFTOwnership struct {
	ContractAddress string    `json:"contract_address"`
	ContractName    string    `json:"contract_name,omitempty"`
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

// StakingNode represents app.staking_nodes
type StakingNode struct {
	NodeID            string    `json:"node_id"`
	Epoch             int64     `json:"epoch"`
	Address           string    `json:"address"`
	Role              int       `json:"role"`
	NetworkingAddress string    `json:"networking_address,omitempty"`
	TokensStaked      string    `json:"tokens_staked"`
	TokensCommitted   string    `json:"tokens_committed"`
	TokensUnstaking   string    `json:"tokens_unstaking"`
	TokensUnstaked    string    `json:"tokens_unstaked"`
	TokensRewarded    string    `json:"tokens_rewarded"`
	DelegatorCount    int       `json:"delegator_count"`
	FirstSeenHeight   int64     `json:"first_seen_height,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// StakingDelegator represents app.staking_delegators
type StakingDelegator struct {
	DelegatorID     int       `json:"delegator_id"`
	NodeID          string    `json:"node_id"`
	Address         string    `json:"address,omitempty"`
	TokensCommitted string    `json:"tokens_committed"`
	TokensStaked    string    `json:"tokens_staked"`
	TokensUnstaking string    `json:"tokens_unstaking"`
	TokensRewarded  string    `json:"tokens_rewarded"`
	TokensUnstaked  string    `json:"tokens_unstaked"`
	BlockHeight     int64     `json:"block_height,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// StakingEvent represents app.staking_events
type StakingEvent struct {
	BlockHeight   uint64    `json:"block_height"`
	TransactionID string    `json:"transaction_id"`
	EventIndex    int       `json:"event_index"`
	EventType     string    `json:"event_type"`
	NodeID        string    `json:"node_id,omitempty"`
	DelegatorID   int       `json:"delegator_id,omitempty"`
	Amount        string    `json:"amount,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
}

// DefiPair represents app.defi_pairs
type DefiPair struct {
	ID             string    `json:"id"`
	DexKey         string    `json:"dex_key"`
	Asset0ID       string    `json:"asset0_id"`
	Asset1ID       string    `json:"asset1_id"`
	Asset0Symbol   string    `json:"asset0_symbol"`
	Asset1Symbol   string    `json:"asset1_symbol"`
	FeeBps         int       `json:"fee_bps"`
	ReservesAsset0 string    `json:"reserves_asset0"`
	ReservesAsset1 string    `json:"reserves_asset1"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// DefiEvent represents app.defi_events
type DefiEvent struct {
	BlockHeight   uint64    `json:"block_height"`
	TransactionID string    `json:"transaction_id"`
	EventIndex    int       `json:"event_index"`
	PairID        string    `json:"pair_id"`
	EventType     string    `json:"event_type"`
	Maker         string    `json:"maker"`
	Asset0In      string    `json:"asset0_in"`
	Asset0Out     string    `json:"asset0_out"`
	Asset1In      string    `json:"asset1_in"`
	Asset1Out     string    `json:"asset1_out"`
	PriceNative   string    `json:"price_native"`
	Timestamp     time.Time `json:"timestamp"`
}

// DailyBalanceDelta represents app.daily_balance_deltas
type DailyBalanceDelta struct {
	Address         string `json:"address"`
	ContractAddress string `json:"contract_address"`
	ContractName    string `json:"contract_name"`
	Date            string `json:"date"`
	Delta           string `json:"delta"`
	TxCount         int    `json:"tx_count"`
	LastHeight      uint64 `json:"last_height"`
}

// NodeMetadata represents app.node_metadata (GeoIP enrichment)
type NodeMetadata struct {
	NodeID      string    `json:"node_id"`
	IPAddress   string    `json:"ip_address,omitempty"`
	Hostname    string    `json:"hostname,omitempty"`
	Country     string    `json:"country,omitempty"`
	CountryCode string    `json:"country_code,omitempty"`
	Region      string    `json:"region,omitempty"`
	City        string    `json:"city,omitempty"`
	Latitude    float64   `json:"latitude,omitempty"`
	Longitude   float64   `json:"longitude,omitempty"`
	ISP         string    `json:"isp,omitempty"`
	Org         string    `json:"org,omitempty"`
	ASNumber    string    `json:"as_number,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// EpochStats represents app.epoch_stats
type EpochStats struct {
	Epoch         int64     `json:"epoch"`
	StartHeight   int64     `json:"start_height,omitempty"`
	EndHeight     int64     `json:"end_height,omitempty"`
	StartTime     time.Time `json:"start_time,omitempty"`
	EndTime       time.Time `json:"end_time,omitempty"`
	TotalNodes    int       `json:"total_nodes"`
	TotalStaked   string    `json:"total_staked"`
	TotalRewarded string    `json:"total_rewarded"`
	UpdatedAt     time.Time `json:"updated_at"`
}
