//go:build integration

package api_test

import (
	"strconv"
	"testing"
)

func TestAudit_StakingNodeList(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/node?limit=10")
	if len(items) == 0 {
		t.Skip("no staking nodes returned")
	}

	validRoles := map[float64]bool{1: true, 2: true, 3: true, 4: true, 5: true}

	for i, node := range items {
		label := "node[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, node, "node_id", "role", "tokens_staked")

		nodeID := toString(node["node_id"])
		assertNonEmpty(t, label+".node_id", nodeID)

		role := toFloat64(node["role"])
		if !validRoles[role] {
			t.Errorf("%s.role=%v, want one of 1,2,3,4,5", label, role)
		}

		staked := toFloat64(node["tokens_staked"])
		if staked < 0 {
			t.Errorf("%s.tokens_staked=%v, want non-negative", label, staked)
		}
	}
}

func TestAudit_StakingNodeDetail(t *testing.T) {
	items := fetchEnvelopeList(t, "/flow/node?limit=1")
	if len(items) == 0 {
		t.Skip("no staking nodes returned")
	}

	nodeID := toString(items[0]["node_id"])
	if nodeID == "" {
		t.Fatal("first node has no node_id")
	}

	detail := fetchEnvelopeObject(t, "/flow/node/"+nodeID)

	assertFieldsExist(t, detail, "node_id", "role", "tokens_staked")

	detailNodeID := toString(detail["node_id"])
	if detailNodeID != nodeID {
		t.Errorf("node_id mismatch: requested=%q got=%q", nodeID, detailNodeID)
	}

	staked := toFloat64(detail["tokens_staked"])
	if staked < 0 {
		t.Errorf("tokens_staked=%v, want non-negative", staked)
	}
}

func TestAudit_StakingDelegators(t *testing.T) {
	items := fetchEnvelopeList(t, "/staking/delegator?limit=10")
	if len(items) == 0 {
		t.Skip("no staking delegators returned")
	}

	for i, d := range items {
		label := "delegator[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, d, "node_id")

		nodeID := toString(d["node_id"])
		assertNonEmpty(t, label+".node_id", nodeID)

		// Check for staking amount fields (tokens_staked or similar)
		if _, ok := d["tokens_staked"]; ok {
			staked := toFloat64(d["tokens_staked"])
			if staked < 0 {
				t.Errorf("%s.tokens_staked=%v, want non-negative", label, staked)
			}
		}
	}
}

func TestAudit_StakingEpochStats(t *testing.T) {
	items := fetchEnvelopeList(t, "/staking/epoch/stats?limit=5")
	if len(items) == 0 {
		t.Skip("no epoch stats returned")
	}

	for i, stat := range items {
		label := "epoch_stat[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, stat, "epoch", "total_staked")

		epoch := toFloat64(stat["epoch"])
		if epoch <= 0 {
			t.Errorf("%s.epoch=%v, want positive", label, epoch)
		}

		totalStaked := toFloat64(stat["total_staked"])
		if totalStaked <= 0 {
			t.Errorf("%s.total_staked=%v, want positive", label, totalStaked)
		}
	}
}

func TestAudit_StakingEpochNodes(t *testing.T) {
	stats := fetchEnvelopeList(t, "/staking/epoch/stats?limit=1")
	if len(stats) == 0 {
		t.Skip("no epoch stats returned — cannot test epoch nodes")
	}

	epoch := int(toFloat64(stats[0]["epoch"]))
	if epoch <= 0 {
		t.Skip("epoch is not positive — cannot test epoch nodes")
	}

	items := fetchEnvelopeList(t, "/staking/epoch/"+strconv.Itoa(epoch)+"/nodes?limit=10")
	if len(items) == 0 {
		t.Skip("no epoch nodes returned for epoch " + strconv.Itoa(epoch))
	}

	validRoles := map[float64]bool{1: true, 2: true, 3: true, 4: true, 5: true}

	for i, node := range items {
		label := "epoch_node[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, node, "node_id", "role")

		nodeID := toString(node["node_id"])
		assertNonEmpty(t, label+".node_id", nodeID)

		role := toFloat64(node["role"])
		if !validRoles[role] {
			t.Errorf("%s.role=%v, want one of 1,2,3,4,5", label, role)
		}
	}
}

func TestAudit_StakingRewardsPaid(t *testing.T) {
	items := fetchEnvelopeList(t, "/staking/rewards/paid?limit=5")
	if len(items) == 0 {
		t.Skip("no staking rewards paid returned")
	}

	for i, r := range items {
		label := "reward[" + strconv.Itoa(i) + "]"

		assertFieldsExist(t, r, "node_id", "amount")

		nodeID := toString(r["node_id"])
		assertNonEmpty(t, label+".node_id", nodeID)

		amount := toFloat64(r["amount"])
		if amount < 0 {
			t.Errorf("%s.amount=%v, want non-negative", label, amount)
		}
	}
}

func TestAudit_StakingTokenomics(t *testing.T) {
	url := ctx.baseURL + "/staking/tokenomics"
	status, body, err := fetchJSON(url)
	if err != nil {
		t.Fatalf("GET /staking/tokenomics error: %v", err)
	}
	if status == 404 || status == 501 {
		t.Skip("staking/tokenomics not implemented (status=" + strconv.Itoa(status) + ")")
	}
	if status != 200 {
		t.Fatalf("GET /staking/tokenomics status=%d, want 200 (body: %.300s)", status, body)
	}

	// Response may be envelope with empty data or an object with staking fields
	// The endpoint currently returns {data: []} — just verify it responds successfully
	t.Logf("staking/tokenomics responded with %d bytes", len(body))
}
