package ingester

import (
	"context"
	"regexp"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// TxContractsWorker extracts contract imports/tags from transaction scripts/events.
type TxContractsWorker struct {
	repo *repository.Repository
}

func NewTxContractsWorker(repo *repository.Repository) *TxContractsWorker {
	return &TxContractsWorker{repo: repo}
}

func (w *TxContractsWorker) Name() string {
	return "tx_contracts_worker"
}

var importRe = regexp.MustCompile(`(?m)^\s*import\s+([A-Za-z0-9_]+)(?:\s+from\s+0x([0-9a-fA-F]+))?`)

func (w *TxContractsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// Use lightweight query: only fetches (id, script) — skips proposer, payer,
	// authorizers, gas_used, timestamp that we don't need.
	txScripts, err := w.repo.GetTxScriptsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return err
	}

	contracts := make([]models.TxContract, 0)
	tags := make([]models.TxTag, 0)
	seenTag := make(map[string]bool)
	addTag := func(txID, tag string) {
		if txID == "" || tag == "" {
			return
		}
		k := txID + "|" + tag
		if seenTag[k] {
			return
		}
		seenTag[k] = true
		tags = append(tags, models.TxTag{TransactionID: txID, Tag: tag})
	}

	for _, tx := range txScripts {
		if tx.Script != "" {
			matches := importRe.FindAllStringSubmatch(tx.Script, -1)
			for _, m := range matches {
				name := strings.TrimSpace(m[1])
				addr := strings.ToLower(strings.TrimSpace(m[2]))
				identifier := name
				if addr != "" {
					identifier = "A." + addr + "." + name
				}
				contracts = append(contracts, models.TxContract{
					TransactionID:      tx.ID,
					ContractIdentifier: identifier,
					Source:             "script_import",
				})
				if strings.Contains(identifier, "FlowTransactionScheduler") {
					addTag(tx.ID, "SCHEDULED_TX")
				}
			}
		}
	}

	// Tag transactions that have FT/NFT transfers (lightweight: only fetches distinct tx IDs).
	ftTxIDs, err := w.repo.GetTransferTxIDsInRange(ctx, fromHeight, toHeight, false)
	if err == nil {
		for _, txID := range ftTxIDs {
			addTag(txID, "FT_TRANSFER")
		}
	}
	nftTxIDs, err := w.repo.GetTransferTxIDsInRange(ctx, fromHeight, toHeight, true)
	if err == nil {
		for _, txID := range nftTxIDs {
			addTag(txID, "NFT_TRANSFER")
		}
	}

	// Additional tags derived from raw event types (no payload needed).
	eventTypes, err := w.repo.GetEventTypesInRange(ctx, fromHeight, toHeight)
	if err == nil {
		for _, evt := range eventTypes {
			evtType := evt.Type
			switch {
			case isEVMTransactionExecutedEvent(evtType):
				addTag(evt.TransactionID, "EVM")
			case strings.Contains(evtType, "FlowFees.FeesDeducted"):
				addTag(evt.TransactionID, "FEE")
			case strings.Contains(evtType, "NFTStorefront"):
				addTag(evt.TransactionID, "MARKETPLACE")
			case strings.Contains(evtType, "AccountContractAdded") || strings.Contains(evtType, "AccountContractUpdated"):
				addTag(evt.TransactionID, "CONTRACT_DEPLOY")
			case evtType == "flow.AccountCreated":
				addTag(evt.TransactionID, "ACCOUNT_CREATED")
			case strings.Contains(evtType, "AccountKeyAdded") || strings.Contains(evtType, "AccountKeyRemoved"):
				addTag(evt.TransactionID, "KEY_UPDATE")
			case strings.Contains(evtType, "FlowTransactionScheduler"):
				addTag(evt.TransactionID, "SCHEDULED_TX")
			// DeFi: DEX swaps and liquidity
			case strings.Contains(evtType, ".SwapPair.Swap") ||
				strings.Contains(evtType, ".BloctoSwapPair.Swap") ||
				strings.Contains(evtType, ".MetaPierSwapPair.Swap"):
				addTag(evt.TransactionID, "SWAP")
			case strings.Contains(evtType, ".SwapPair.AddLiquidity") ||
				strings.Contains(evtType, ".SwapPair.RemoveLiquidity"):
				addTag(evt.TransactionID, "LIQUIDITY")
			// Staking
			case strings.Contains(evtType, ".FlowIDTableStaking.TokensStaked") ||
				strings.Contains(evtType, ".FlowIDTableStaking.TokensUnstaked") ||
				strings.Contains(evtType, ".FlowIDTableStaking.TokensCommitted") ||
				strings.Contains(evtType, ".FlowIDTableStaking.RewardsPaid") ||
				strings.Contains(evtType, ".FlowIDTableStaking.DelegatorRewardsPaid"):
				addTag(evt.TransactionID, "STAKING")
			// Lending / borrowing (common DeFi patterns on Flow)
			case strings.Contains(evtType, "LiquidStaking") ||
				strings.Contains(evtType, "stFlowToken"):
				addTag(evt.TransactionID, "LIQUID_STAKING")
			// Token minting
			case strings.Contains(evtType, ".TokensMinted") && !strings.Contains(evtType, "FlowToken.TokensMinted"):
				addTag(evt.TransactionID, "TOKEN_MINT")
			// Token burning
			case strings.Contains(evtType, ".TokensBurned") && !strings.Contains(evtType, "FlowToken.TokensBurned"):
				addTag(evt.TransactionID, "TOKEN_BURN")
			}
		}
	}

	if err := w.repo.BulkUpsertTxContracts(ctx, contracts); err != nil {
		return err
	}
	if err := w.repo.BulkUpsertTxTags(ctx, tags); err != nil {
		return err
	}
	return nil
}
