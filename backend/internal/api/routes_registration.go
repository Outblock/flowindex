package api

import "github.com/gorilla/mux"

func registerBaseRoutes(r *mux.Router, s *Server) {
	r.HandleFunc("/health", s.handleHealth).Methods("GET", "OPTIONS")
	r.HandleFunc("/openapi.yaml", s.handleOpenAPIYAML).Methods("GET", "OPTIONS")
	r.HandleFunc("/openapi.json", s.handleOpenAPIJSON).Methods("GET", "OPTIONS")
	r.HandleFunc("/status", s.handleStatus).Methods("GET", "OPTIONS")
	r.HandleFunc("/ws", s.handleWebSocket).Methods("GET", "OPTIONS")
	r.HandleFunc("/ws/status", s.handleStatusWebSocket).Methods("GET", "OPTIONS")
}

func registerAdminRoutes(r *mux.Router, s *Server) {
	r.HandleFunc("/admin/refetch-token-metadata", s.handleAdminRefetchTokenMetadata).Methods("POST", "OPTIONS")
}

func registerAPIRoutes(r *mux.Router, s *Server) {
	registerFlowRoutes(r, s)
	registerAccountingRoutes(r, s)
	registerStatusRoutes(r, s)
	registerDeferredRoutes(r, s)
}

func registerFlowRoutes(r *mux.Router, s *Server) {
	r.HandleFunc("/flow/block", s.handleFlowListBlocks).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/block/{height}", s.handleFlowGetBlock).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/block/{height}/service-event", s.handleFlowBlockServiceEvents).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/block/{height}/transaction", s.handleFlowBlockTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/transaction", s.handleFlowListTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/transaction/{id}", s.handleFlowGetTransaction).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account", s.handleFlowListAccounts).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}", s.handleFlowGetAccount).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/storage", s.handleGetAccountStorage).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/storage/links", s.handleGetAccountStorageLinks).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/storage/item", s.handleGetAccountStorageItem).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/transaction", s.handleFlowAccountTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/ft/transfer", s.handleFlowAccountFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/nft/transfer", s.handleFlowAccountNFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/ft/holding", s.handleFlowAccountFTHoldings).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/ft", s.handleFlowAccountFTVaults).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/ft/{token}", s.handleFlowAccountFTToken).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/ft/{token}/transfer", s.handleFlowAccountFTTokenTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/nft", s.handleFlowAccountNFTCollections).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/nft/{nft_type}", s.handleFlowAccountNFTByCollection).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft/transfer", s.handleFlowFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft", s.handleFlowListFTTokens).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft/{token}", s.handleFlowGetFTToken).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft/{token}/holding", s.handleFlowFTHoldingsByToken).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft/{token}/top-account", s.handleFlowTopFTAccounts).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/ft/{token}/account/{address}", s.handleFlowAccountFTHoldingByToken).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/transfer", s.handleFlowNFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft", s.handleFlowListNFTCollections).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}", s.handleFlowGetNFTCollection).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}/holding", s.handleFlowNFTHoldingsByCollection).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}/top-account", s.handleFlowTopNFTAccounts).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/search", s.handleFlowNFTSearch).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}/item", s.handleFlowNFTCollectionItems).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}/item/{id}", s.handleFlowNFTItem).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/nft/{nft_type}/item/{id}/transfer", s.handleFlowNFTItemTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract", s.handleFlowListContracts).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract/{identifier}", s.handleFlowGetContract).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract/{identifier}/transaction", s.handleContractTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract/{identifier}/version", s.handleContractVersionList).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract/{identifier}/version/{id}", s.handleFlowGetContractVersion).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/contract/{identifier}/{id}", s.handleFlowGetContractVersion).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/evm/transaction", s.handleFlowListEVMTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/evm/transaction/{hash}", s.handleFlowGetEVMTransaction).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/evm/token", s.handleFlowListEVMTokens).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/evm/token/{address}", s.handleFlowGetEVMToken).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/node", s.handleListNodes).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/node/{node_id}", s.handleGetNode).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/node/{node_id}/reward/delegation", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/scheduled-transaction", s.handleFlowScheduledTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/scheduled-transaction", s.handleFlowAccountScheduledTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/account/{address}/tax-report", s.handleTaxReport).Methods("GET", "OPTIONS")
	r.HandleFunc("/flow/key/{publicKey}", s.handleFlowSearchByPublicKey).Methods("GET", "OPTIONS")
}

func registerAccountingRoutes(r *mux.Router, s *Server) {
	r.HandleFunc("/accounting/account/{address}", s.handleFlowGetAccount).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/account/{address}/transaction", s.handleFlowAccountTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/account/{address}/ft/transfer", s.handleFlowAccountFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/account/{address}/nft", s.handleFlowAccountNFTCollections).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/account/{address}/ft", s.handleFlowAccountFTVaults).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/transaction", s.handleFlowListTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/transaction/{id}", s.handleFlowGetTransaction).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/nft/transfer", s.handleFlowNFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/accounting/account/{address}/tax-report", s.handleTaxReport).Methods("GET", "OPTIONS")
}

func registerStatusRoutes(r *mux.Router, s *Server) {
	r.HandleFunc("/status/count", s.handleStatusCount).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/stat", s.handleStatusStat).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/stat/{timescale}/trend", s.handleStatusStatTrend).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/flow/stat", s.handleStatusFlowStat).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/epoch/status", s.handleStatusEpochStatus).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/epoch/stat", s.handleStatusEpochStat).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/tokenomics", s.handleStatusTokenomics).Methods("GET", "OPTIONS")
	r.HandleFunc("/status/price", s.handleStatusPrice).Methods("GET", "OPTIONS")
}

func registerDeferredRoutes(r *mux.Router, s *Server) {
	// DeFi endpoints
	r.HandleFunc("/defi/asset", s.handleDefiListAssets).Methods("GET", "OPTIONS")
	r.HandleFunc("/defi/events", s.handleDefiListEvents).Methods("GET", "OPTIONS")
	r.HandleFunc("/defi/latest-block", s.handleDefiLatestBlock).Methods("GET", "OPTIONS")
	r.HandleFunc("/defi/latest-swap", s.handleDefiLatestSwap).Methods("GET", "OPTIONS")
	r.HandleFunc("/defi/pair", s.handleDefiListPairs).Methods("GET", "OPTIONS")
	// Staking endpoints
	r.HandleFunc("/staking/delegator", s.handleStakingDelegators).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/account/{address}/ft/transfer", s.handleStakingAccountFTTransfers).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/account/{address}/transaction", s.handleStakingAccountTransactions).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/epoch/stats", s.handleGetEpochStats).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/epoch/{epoch}/nodes", s.handleListEpochNodes).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/epoch/{epoch}/role/{role}/nodes/aggregate", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/epoch/{epoch}/role/{role}/nodes/count", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/epoch/{epoch}/role/{role}/nodes/grouped", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/ft_transfer/{address}", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/node/{node_id}/event", s.handleGetNodeEvents).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/rewards/paid", s.handleStakingRewardsPaid).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/rewards/staking", s.handleStakingRewardsStaking).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/tokenomics", s.handleStakingTokenomics).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/transaction/address/{address}", s.handleNotImplemented).Methods("GET", "OPTIONS")
	r.HandleFunc("/staking/transaction/{transaction_id}", s.handleNotImplemented).Methods("GET", "OPTIONS")
}
