package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"flowscan-clone/internal/models"
)

// nftBackfillRequest is the JSON body for POST /flow/nft/backfill.
// The frontend sends ownership and metadata data it fetched from chain via Cadence.
type nftBackfillRequest struct {
	Owner       string                     `json:"owner"`
	Collections []nftBackfillCollectionData `json:"collections"`
}

type nftBackfillCollectionData struct {
	// Type identifier, e.g. "A.0b2a3299cc857e29.TopShot.Collection"
	ID         string   `json:"id"`
	PublicPath string   `json:"public_path"`
	NFTIDs     []string `json:"nft_ids"`
	// Detailed metadata for individual NFTs (optional, sent after getNftsFromCollection).
	Items []nftBackfillItem `json:"items,omitempty"`
}

type nftBackfillItem struct {
	NFTID            string `json:"nft_id"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	Thumbnail        string `json:"thumbnail"`
	ExternalURL      string `json:"external_url"`
	SerialNumber     *int64 `json:"serial_number"`
	EditionName      string `json:"edition_name"`
	EditionNumber    *int64 `json:"edition_number"`
	EditionMax       *int64 `json:"edition_max"`
	RarityScore      string `json:"rarity_score"`
	RarityDescription string `json:"rarity_description"`
	Traits           json.RawMessage `json:"traits"`
}

// parseCollectionID extracts contract address and name from a type identifier.
// e.g. "A.0b2a3299cc857e29.TopShot.Collection" -> ("0b2a3299cc857e29", "TopShot")
func parseCollectionID(id string) (contractAddr, contractName string, ok bool) {
	parts := strings.Split(id, ".")
	if len(parts) < 3 || parts[0] != "A" {
		return "", "", false
	}
	return parts[1], parts[2], true
}

func (s *Server) handleFlowNFTBackfill(w http.ResponseWriter, r *http.Request) {
	var req nftBackfillRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	owner := normalizeAddr(req.Owner)
	if owner == "" {
		writeAPIError(w, http.StatusBadRequest, "owner is required")
		return
	}

	ctx := r.Context()

	for _, col := range req.Collections {
		contractAddr, contractName, ok := parseCollectionID(col.ID)
		if !ok {
			continue
		}

		// 1. Backfill ownership if NFT IDs provided.
		if len(col.NFTIDs) > 0 {
			// Process in batches of 500.
			for i := 0; i < len(col.NFTIDs); i += 500 {
				end := i + 500
				if end > len(col.NFTIDs) {
					end = len(col.NFTIDs)
				}
				if err := s.repo.BulkUpsertNFTOwnership(ctx, owner, contractAddr, contractName, col.NFTIDs[i:end]); err != nil {
					log.Printf("[nft_backfill] ownership upsert error for %s.%s: %v", contractAddr, contractName, err)
				}
			}
		}

		// 2. Cache public path if provided.
		if col.PublicPath != "" {
			path := col.PublicPath
			// Normalize: ensure /public/ prefix for storage consistency.
			if !strings.HasPrefix(path, "/public/") {
				path = "/public/" + path
			}
			if err := s.repo.UpdateCollectionPublicPath(ctx, contractAddr, contractName, path); err != nil {
				log.Printf("[nft_backfill] public_path update error for %s.%s: %v", contractAddr, contractName, err)
			}
		}

		// 3. Backfill item metadata if provided.
		if len(col.Items) > 0 {
			items := make([]models.NFTItem, 0, len(col.Items))
			for _, it := range col.Items {
				if it.NFTID == "" || it.Name == "" {
					continue
				}
				items = append(items, models.NFTItem{
					ContractAddress:   contractAddr,
					ContractName:      contractName,
					NFTID:             it.NFTID,
					Name:              it.Name,
					Description:       it.Description,
					Thumbnail:         it.Thumbnail,
					ExternalURL:       it.ExternalURL,
					SerialNumber:      it.SerialNumber,
					EditionName:       it.EditionName,
					EditionNumber:     it.EditionNumber,
					EditionMax:        it.EditionMax,
					RarityScore:       it.RarityScore,
					RarityDescription: it.RarityDescription,
					Traits:            it.Traits,
				})
			}
			if len(items) > 0 {
				if err := s.repo.UpsertNFTItems(ctx, items); err != nil {
					log.Printf("[nft_backfill] items upsert error for %s.%s: %v", contractAddr, contractName, err)
				}
			}
		}
	}

	writeAPIResponse(w, map[string]string{"status": "ok"}, nil, nil)
}
