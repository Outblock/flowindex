package ingester

import (
	"context"
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// AccountsWorker builds app.accounts catalog from events + transaction participants.
type AccountsWorker struct {
	repo *repository.Repository
}

func NewAccountsWorker(repo *repository.Repository) *AccountsWorker {
	return &AccountsWorker{repo: repo}
}

func (w *AccountsWorker) Name() string {
	return "accounts_worker"
}

func (w *AccountsWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return err
	}
	txs, err := w.repo.GetRawTransactionsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return err
	}

	seen := make(map[string]*models.AccountCatalog)
	coaMappings := make(map[string]models.COAAccount)
	txByID := make(map[string]models.Transaction, len(txs))

	add := func(addr string, height uint64) {
		addr = normalizeAddressLower(addr)
		if addr == "" {
			return
		}
		if existing, ok := seen[addr]; ok {
			if height < existing.FirstSeenHeight {
				existing.FirstSeenHeight = height
			}
			if height > existing.LastSeenHeight {
				existing.LastSeenHeight = height
			}
			return
		}
		seen[addr] = &models.AccountCatalog{
			Address:         addr,
			FirstSeenHeight: height,
			LastSeenHeight:  height,
		}
	}

	for _, tx := range txs {
		txByID[tx.ID] = tx
	}

	for _, evt := range events {
		if evt.Type == "flow.AccountCreated" {
			var payload map[string]interface{}
			if err := json.Unmarshal(evt.Payload, &payload); err != nil {
				continue
			}
			if addr, ok := payload["address"].(string); ok {
				add(addr, evt.BlockHeight)
			}
			continue
		}

		if strings.Contains(evt.Type, "CadenceOwnedAccountCreated") {
			var payload map[string]interface{}
			if err := json.Unmarshal(evt.Payload, &payload); err != nil {
				continue
			}
			coaAddr, ok := payload["address"].(string)
			if !ok || coaAddr == "" {
				continue
			}
			coaAddr = normalizeAddressLower(coaAddr)
			if coaAddr == "" {
				continue
			}
			tx, ok := txByID[evt.TransactionID]
			if !ok {
				continue
			}
			owner := ""
			if len(tx.Authorizers) > 0 {
				owner = tx.Authorizers[0]
			} else if tx.PayerAddress != "" {
				owner = tx.PayerAddress
			} else {
				owner = tx.ProposerAddress
			}
			owner = normalizeAddressLower(owner)
			if owner == "" {
				continue
			}
			coaMappings[coaAddr] = models.COAAccount{
				COAAddress:    coaAddr,
				FlowAddress:   owner,
				TransactionID: evt.TransactionID,
				BlockHeight:   evt.BlockHeight,
			}
		}
	}

	for _, tx := range txs {
		add(tx.PayerAddress, tx.BlockHeight)
		add(tx.ProposerAddress, tx.BlockHeight)
		for _, auth := range tx.Authorizers {
			add(auth, tx.BlockHeight)
		}
	}

	accounts := make([]models.AccountCatalog, 0, len(seen))
	for _, v := range seen {
		accounts = append(accounts, *v)
	}
	if err := w.repo.UpsertAccounts(ctx, accounts); err != nil {
		return err
	}

	if len(coaMappings) > 0 {
		rows := make([]models.COAAccount, 0, len(coaMappings))
		for _, v := range coaMappings {
			rows = append(rows, v)
		}
		if err := w.repo.UpsertCOAAccounts(ctx, rows); err != nil {
			return err
		}
	}
	return nil
}

func normalizeAddressLower(addr string) string {
	addr = strings.TrimSpace(addr)
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")
	return addr
}
