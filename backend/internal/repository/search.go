package repository

import (
	"context"
	"sync"
)

// SearchContractResult represents a smart contract match from unified search.
type SearchContractResult struct {
	Address        string `json:"address"`
	Name           string `json:"name"`
	Kind           string `json:"kind"`
	DependentCount int    `json:"dependent_count"`
}

// SearchTokenResult represents a fungible token match from unified search.
type SearchTokenResult struct {
	Address      string `json:"address"`
	ContractName string `json:"contract_name"`
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	MarketSymbol string `json:"market_symbol,omitempty"`
	Logo         string `json:"logo,omitempty"`
	IsVerified   bool   `json:"is_verified"`
}

// SearchNFTCollectionResult represents an NFT collection match from unified search.
type SearchNFTCollectionResult struct {
	Address      string `json:"address"`
	ContractName string `json:"contract_name"`
	Name         string `json:"name"`
	ItemCount    int64  `json:"item_count"`
	SquareImage  string `json:"square_image,omitempty"`
	IsVerified   bool   `json:"is_verified"`
}

// SearchAllResult aggregates results from all search categories.
type SearchAllResult struct {
	Contracts      []SearchContractResult      `json:"contracts"`
	Tokens         []SearchTokenResult         `json:"tokens"`
	NFTCollections []SearchNFTCollectionResult  `json:"nft_collections"`
}

// SearchAll runs parallel searches across contracts, tokens, and NFT collections.
// Limit defaults to 3 and is capped at 5.
func (r *Repository) SearchAll(ctx context.Context, query string, limit int) (*SearchAllResult, error) {
	if limit <= 0 {
		limit = 3
	}
	if limit > 5 {
		limit = 5
	}

	pattern := "%" + query + "%"

	var (
		wg          sync.WaitGroup
		contracts   []SearchContractResult
		tokens      []SearchTokenResult
		collections []SearchNFTCollectionResult
		errContracts, errTokens, errCollections error
	)

	wg.Add(3)

	// 1. Search smart contracts by name
	go func() {
		defer wg.Done()
		rows, err := r.db.Query(ctx, `
			SELECT encode(address, 'hex'), COALESCE(name, ''), COALESCE(kind, ''), COALESCE(dependent_count, 0)
			FROM app.smart_contracts
			WHERE COALESCE(name, '') ILIKE $1
			   OR encode(address, 'hex') ILIKE $1
			ORDER BY COALESCE(dependent_count, 0) DESC, address ASC
			LIMIT $2`, pattern, limit)
		if err != nil {
			errContracts = err
			return
		}
		defer rows.Close()
		for rows.Next() {
			var c SearchContractResult
			if err := rows.Scan(&c.Address, &c.Name, &c.Kind, &c.DependentCount); err != nil {
				errContracts = err
				return
			}
			contracts = append(contracts, c)
		}
		errContracts = rows.Err()
	}()

	// 2. Search fungible tokens by name/symbol
	go func() {
		defer wg.Done()
		rows, err := r.db.Query(ctx, `
			SELECT encode(contract_address, 'hex'), COALESCE(contract_name, ''), COALESCE(name, ''), COALESCE(symbol, ''), COALESCE(market_symbol, ''), COALESCE(logo, ''), COALESCE(is_verified, false)
			FROM app.ft_tokens
			WHERE COALESCE(name, '') ILIKE $1
			   OR COALESCE(symbol, '') ILIKE $1
			   OR COALESCE(contract_name, '') ILIKE $1
			ORDER BY COALESCE(is_verified, false) DESC, contract_address ASC
			LIMIT $2`, pattern, limit)
		if err != nil {
			errTokens = err
			return
		}
		defer rows.Close()
		for rows.Next() {
			var t SearchTokenResult
			if err := rows.Scan(&t.Address, &t.ContractName, &t.Name, &t.Symbol, &t.MarketSymbol, &t.Logo, &t.IsVerified); err != nil {
				errTokens = err
				return
			}
			tokens = append(tokens, t)
		}
		errTokens = rows.Err()
	}()

	// 3. Search NFT collections by name, joined with stats for nft_count
	go func() {
		defer wg.Done()
		rows, err := r.db.Query(ctx, `
			SELECT encode(c.contract_address, 'hex'), COALESCE(c.contract_name, ''), COALESCE(c.name, ''), COALESCE(s.nft_count, 0), COALESCE(c.square_image, ''), COALESCE(c.is_verified, false)
			FROM app.nft_collections c
			LEFT JOIN app.nft_collection_stats s ON s.contract_address = c.contract_address AND s.contract_name = c.contract_name
			WHERE COALESCE(c.name, '') ILIKE $1
			   OR COALESCE(c.contract_name, '') ILIKE $1
			   OR encode(c.contract_address, 'hex') ILIKE $1
			ORDER BY COALESCE(c.is_verified, false) DESC, COALESCE(s.nft_count, 0) DESC, c.contract_address ASC
			LIMIT $2`, pattern, limit)
		if err != nil {
			errCollections = err
			return
		}
		defer rows.Close()
		for rows.Next() {
			var n SearchNFTCollectionResult
			if err := rows.Scan(&n.Address, &n.ContractName, &n.Name, &n.ItemCount, &n.SquareImage, &n.IsVerified); err != nil {
				errCollections = err
				return
			}
			collections = append(collections, n)
		}
		errCollections = rows.Err()
	}()

	wg.Wait()

	// Return first error encountered
	if errContracts != nil {
		return nil, errContracts
	}
	if errTokens != nil {
		return nil, errTokens
	}
	if errCollections != nil {
		return nil, errCollections
	}

	// Ensure non-nil slices for clean JSON marshaling
	if contracts == nil {
		contracts = []SearchContractResult{}
	}
	if tokens == nil {
		tokens = []SearchTokenResult{}
	}
	if collections == nil {
		collections = []SearchNFTCollectionResult{}
	}

	return &SearchAllResult{
		Contracts:      contracts,
		Tokens:         tokens,
		NFTCollections: collections,
	}, nil
}
