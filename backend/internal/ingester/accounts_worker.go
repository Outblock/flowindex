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

	for _, evt := range events {
		if !strings.Contains(evt.Type, "AccountCreated") {
			continue
		}
		var payload map[string]interface{}
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			continue
		}
		if addr, ok := payload["address"].(string); ok {
			add(addr, evt.BlockHeight)
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
	return w.repo.UpsertAccounts(ctx, accounts)
}

func normalizeAddressLower(addr string) string {
	addr = strings.TrimSpace(addr)
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")
	return addr
}
