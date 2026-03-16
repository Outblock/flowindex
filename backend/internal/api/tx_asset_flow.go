package api

import (
	"encoding/hex"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

const (
	crossVMMatchWindow   = 24
	defiActionsTokenID   = "A.6d888f175c158410.DeFiActions"
	selERC20Transfer     = "a9059cbb"
	selERC20TransferFrom = "23b872dd"
)

var bridgedTokenRegex = regexp.MustCompile(`evmvmbridgedtoken_([a-f0-9]{40})`)

// Staking contract names — when these appear in transaction events,
// FlowToken burns/mints should be classified as stake/unstake.
var stakingContracts = map[string]bool{
	"FlowIDTableStaking":  true,
	"FlowStakingCollection": true,
	"LockedTokens":        true,
	"FlowEpoch":           true,
	"FlowDKG":             true,
	"FlowClusterQC":       true,
}

// hasStakingEventsInTx checks if any event in the transaction belongs to a staking contract.
// Event.Type format: "A.<address>.<ContractName>.<EventName>" — extract the 3rd segment.
func hasStakingEventsInTx(events []models.Event) bool {
	for _, e := range events {
		// Check ContractName field first (may be populated in some code paths)
		if e.ContractName != "" && stakingContracts[e.ContractName] {
			return true
		}
		// Fallback: parse contract name from the fully-qualified event type
		parts := strings.Split(e.Type, ".")
		if len(parts) >= 3 && stakingContracts[parts[2]] {
			return true
		}
	}
	return false
}

type canonicalFTTransfer struct {
	Token          string
	ContractName   string
	FromAddress    string
	ToAddress      string
	Amount         string
	EventIndex     int
	TransferType   string
	EVMToAddress   string
	EVMFromAddress string
	IsCrossVM      bool
}

type parsedEVMExecution struct {
	EventIndex int
	From       string
	To         string
	Recipient  string
	CallType   string
	HasValue   bool
}

type decodedEVMRecipient struct {
	Recipient string
	CallType  string
}

type canonicalSummaryContext struct {
	FlowAddress string
	COAAddress  string
}

func normalizeHexAddress(addr string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(addr)), "0x")
}

func parseAmountFloat(val string) float64 {
	f, _ := strconv.ParseFloat(val, 64)
	return f
}

func isZeroAmount(val string) bool {
	return parseAmountFloat(val) <= 0
}

func isLikelyCOA(addr string) bool {
	return len(addr) == 40 && strings.HasPrefix(addr, strings.Repeat("0", 10))
}

func isBookkeepingFTTransfer(row repository.FTTransferRow) bool {
	token := strings.TrimSpace(row.Token)
	if token == "" {
		return true
	}
	if token == defiActionsTokenID || strings.Contains(token, ".DeFiActions") {
		return true
	}
	return strings.TrimSpace(row.FromAddress) == "" && strings.TrimSpace(row.ToAddress) == ""
}

func parseEVMExecutions(evmExecs []repository.EVMTransactionRecord) []parsedEVMExecution {
	out := make([]parsedEVMExecution, 0, len(evmExecs))
	for _, exec := range evmExecs {
		decoded := decodeEVMRecipientFromCallData(exec.Data)
		out = append(out, parsedEVMExecution{
			EventIndex: exec.EventIndex,
			From:       normalizeHexAddress(exec.FromAddress),
			To:         normalizeHexAddress(exec.ToAddress),
			Recipient:  normalizeHexAddress(decoded.Recipient),
			CallType:   decoded.CallType,
			HasValue:   strings.TrimSpace(exec.Value) != "" && strings.TrimSpace(exec.Value) != "0",
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].EventIndex < out[j].EventIndex })
	return out
}

func decodeEVMRecipientFromCallData(dataHex string) decodedEVMRecipient {
	data := strings.TrimPrefix(strings.ToLower(dataHex), "0x")
	if len(data) < 8 {
		return decodedEVMRecipient{CallType: "unknown"}
	}

	selector := data[:8]
	params := data[8:]
	switch selector {
	case selERC20Transfer:
		if addr := extractABIAddress(params, 0); addr != "" {
			return decodedEVMRecipient{Recipient: addr, CallType: "erc20_transfer"}
		}
	case selERC20TransferFrom:
		if addr := extractABIAddress(params, 1); addr != "" {
			return decodedEVMRecipient{Recipient: addr, CallType: "erc20_transferFrom"}
		}
	}
	return decodedEVMRecipient{CallType: "unknown"}
}

func extractABIAddress(paramsHex string, wordIndex int) string {
	start := wordIndex * 64
	end := start + 64
	if len(paramsHex) < end {
		return ""
	}
	word := paramsHex[start:end]
	addrHex := word[24:64]
	if strings.Trim(addrHex, "0") == "" {
		return ""
	}
	return addrHex
}

func extractEmbeddedEVMContract(token string) string {
	match := bridgedTokenRegex.FindStringSubmatch(strings.ToLower(token))
	if len(match) != 2 {
		return ""
	}
	return match[1]
}

func inferFlowBridgeRecipient(transfer canonicalFTTransfer, executions []parsedEVMExecution) string {
	if !strings.Contains(transfer.Token, "FlowToken") || !isLikelyCOA(transfer.ToAddress) {
		return transfer.EVMToAddress
	}
	candidates := make([]parsedEVMExecution, 0)
	for _, exec := range executions {
		if exec.EventIndex <= transfer.EventIndex || exec.EventIndex-transfer.EventIndex > crossVMMatchWindow {
			continue
		}
		if exec.From == transfer.ToAddress {
			candidates = append(candidates, exec)
		}
	}
	for _, exec := range candidates {
		if (exec.CallType == "erc20_transfer" || exec.CallType == "erc20_transferFrom") && exec.Recipient != "" {
			return exec.Recipient
		}
	}
	for _, exec := range candidates {
		if exec.HasValue && exec.To != "" {
			return exec.To
		}
	}
	return transfer.EVMToAddress
}

func inferBridgedMintSender(transfer canonicalFTTransfer, executions []parsedEVMExecution) string {
	embeddedContract := extractEmbeddedEVMContract(transfer.Token)
	if embeddedContract == "" {
		return ""
	}
	for i := len(executions) - 1; i >= 0; i-- {
		exec := executions[i]
		if exec.EventIndex >= transfer.EventIndex || transfer.EventIndex-exec.EventIndex > crossVMMatchWindow {
			continue
		}
		if exec.To != embeddedContract {
			continue
		}
		if (exec.CallType == "erc20_transfer" || exec.CallType == "erc20_transferFrom") && exec.From != "" {
			return exec.From
		}
	}
	return ""
}

func sameTokenAmount(a, b canonicalFTTransfer) bool {
	return a.Token == b.Token && a.Amount == b.Amount
}

func isDuplicateBurn(transfer canonicalFTTransfer, all []canonicalFTTransfer) bool {
	if transfer.TransferType != "burn" || transfer.FromAddress == "" || transfer.ToAddress != "" {
		return false
	}
	for _, candidate := range all {
		if candidate.EventIndex == transfer.EventIndex {
			continue
		}
		if sameTokenAmount(candidate, transfer) && candidate.FromAddress == transfer.FromAddress && candidate.ToAddress != "" {
			return true
		}
	}
	return false
}

func isDuplicateMint(transfer canonicalFTTransfer, all []canonicalFTTransfer) bool {
	if transfer.TransferType != "mint" || transfer.FromAddress != "" || transfer.ToAddress == "" {
		return false
	}
	for _, candidate := range all {
		if candidate.EventIndex == transfer.EventIndex {
			continue
		}
		if sameTokenAmount(candidate, transfer) && candidate.ToAddress == transfer.ToAddress && candidate.FromAddress != "" {
			return true
		}
	}
	return false
}

func canonicalizeFTTransfers(rows []repository.FTTransferRow, evmExecs []repository.EVMTransactionRecord, hasStaking ...bool) []canonicalFTTransfer {
	isStakingTx := len(hasStaking) > 0 && hasStaking[0]
	executions := parseEVMExecutions(evmExecs)
	base := make([]canonicalFTTransfer, 0, len(rows))
	for _, row := range rows {
		if isZeroAmount(row.Amount) || isBookkeepingFTTransfer(row) {
			continue
		}

		transfer := canonicalFTTransfer{
			Token:        row.Token,
			ContractName: row.ContractName,
			FromAddress:  normalizeHexAddress(row.FromAddress),
			ToAddress:    normalizeHexAddress(row.ToAddress),
			Amount:       row.Amount,
			EventIndex:   row.EventIndex,
		}
		isFlowToken := transfer.ContractName == "FlowToken"
		switch {
		case transfer.FromAddress == "" && transfer.ToAddress != "":
			if isStakingTx && isFlowToken {
				transfer.TransferType = "unstake"
			} else {
				transfer.TransferType = "mint"
			}
		case transfer.FromAddress != "" && transfer.ToAddress == "":
			if isStakingTx && isFlowToken {
				transfer.TransferType = "stake"
			} else {
				transfer.TransferType = "burn"
			}
		default:
			transfer.TransferType = "transfer"
		}

		if transfer.FromAddress == "" && transfer.ToAddress != "" {
			if sender := inferBridgedMintSender(transfer, executions); sender != "" {
				transfer.FromAddress = sender
				transfer.EVMFromAddress = sender
				transfer.TransferType = "transfer"
				transfer.IsCrossVM = true
			}
		}

		if recipient := inferFlowBridgeRecipient(transfer, executions); recipient != "" {
			transfer.EVMToAddress = recipient
			transfer.IsCrossVM = true
		}

		if transfer.EVMFromAddress != "" {
			transfer.IsCrossVM = true
		}

		base = append(base, transfer)
	}

	filtered := make([]canonicalFTTransfer, 0, len(base))
	for _, transfer := range base {
		if isDuplicateBurn(transfer, base) || isDuplicateMint(transfer, base) {
			continue
		}
		filtered = append(filtered, transfer)
	}
	return filtered
}

func isOperationalNoiseSummaryTransfer(transfer canonicalFTTransfer, all []canonicalFTTransfer) bool {
	if !strings.EqualFold(tokenSymbolFromIdentifier(transfer.Token), "FLOW") {
		return false
	}
	amount := parseAmountFloat(transfer.Amount)
	if amount <= 0.001 {
		return true
	}
	hasNonFlow := false
	for _, candidate := range all {
		if !strings.EqualFold(tokenSymbolFromIdentifier(candidate.Token), "FLOW") {
			hasNonFlow = true
			break
		}
	}
	return hasNonFlow && amount < 0.25 && !transfer.IsCrossVM
}

func tokenSymbolFromIdentifier(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) == 0 {
		return token
	}
	return parts[len(parts)-1]
}

func buildCanonicalTransferSummary(transfers []canonicalFTTransfer) repository.TransferSummary {
	meaningful := make([]canonicalFTTransfer, 0, len(transfers))
	for _, transfer := range transfers {
		if !isOperationalNoiseSummaryTransfer(transfer, transfers) {
			meaningful = append(meaningful, transfer)
		}
	}
	if len(meaningful) == 0 {
		meaningful = transfers
	}

	summaryTransfers := append([]canonicalFTTransfer(nil), meaningful...)
	sort.Slice(summaryTransfers, func(i, j int) bool { return summaryTransfers[i].EventIndex < summaryTransfers[j].EventIndex })

	out := repository.TransferSummary{FT: make([]repository.FTTransferSummaryItem, 0, len(summaryTransfers)), NFT: []repository.NFTTransferSummaryItem{}}
	var prevToken, prevAmount string
	for _, transfer := range summaryTransfers {
		if transfer.Token == prevToken && transfer.Amount == prevAmount {
			continue
		}
		out.FT = append(out.FT, repository.FTTransferSummaryItem{
			Token:     transfer.Token,
			Amount:    transfer.Amount,
			Direction: "transfer",
		})
		prevToken = transfer.Token
		prevAmount = transfer.Amount
	}
	return out
}

func normalizeCanonicalSummaryContext(flowAddress, coaAddress string) canonicalSummaryContext {
	return canonicalSummaryContext{
		FlowAddress: normalizeHexAddress(flowAddress),
		COAAddress:  normalizeHexAddress(coaAddress),
	}
}

func (ctx canonicalSummaryContext) tracked(addr string) bool {
	addr = normalizeHexAddress(addr)
	return addr != "" && (addr == ctx.FlowAddress || addr == ctx.COAAddress)
}

func effectiveCanonicalSource(transfer canonicalFTTransfer) string {
	if transfer.EVMFromAddress != "" {
		return transfer.EVMFromAddress
	}
	return transfer.FromAddress
}

func effectiveCanonicalDestination(transfer canonicalFTTransfer) string {
	if transfer.EVMToAddress != "" {
		return transfer.EVMToAddress
	}
	return transfer.ToAddress
}

func classifyCanonicalTransferForContext(transfer canonicalFTTransfer, ctx canonicalSummaryContext) (direction, counterparty string, include bool) {
	if ctx.FlowAddress == "" && ctx.COAAddress == "" {
		return "transfer", "", true
	}

	source := effectiveCanonicalSource(transfer)
	dest := effectiveCanonicalDestination(transfer)
	sourceTracked := ctx.tracked(source) || ctx.tracked(transfer.FromAddress)
	destTracked := ctx.tracked(dest) || ctx.tracked(transfer.ToAddress)

	switch {
	case sourceTracked && destTracked:
		return "transfer", "", true
	case sourceTracked:
		counterparty = dest
		if counterparty == "" || ctx.tracked(counterparty) {
			counterparty = transfer.ToAddress
		}
		if ctx.tracked(counterparty) {
			counterparty = ""
		}
		return "out", counterparty, true
	case destTracked:
		counterparty = source
		if counterparty == "" || ctx.tracked(counterparty) {
			counterparty = transfer.FromAddress
		}
		if ctx.tracked(counterparty) {
			counterparty = ""
		}
		return "in", counterparty, true
	default:
		return "", "", false
	}
}

func buildCanonicalTransferSummaryForContext(transfers []canonicalFTTransfer, flowAddress, coaAddress string) repository.TransferSummary {
	ctx := normalizeCanonicalSummaryContext(flowAddress, coaAddress)
	meaningful := make([]canonicalFTTransfer, 0, len(transfers))
	for _, transfer := range transfers {
		if !isOperationalNoiseSummaryTransfer(transfer, transfers) {
			meaningful = append(meaningful, transfer)
		}
	}
	if len(meaningful) == 0 {
		meaningful = transfers
	}

	summaryTransfers := append([]canonicalFTTransfer(nil), meaningful...)
	sort.Slice(summaryTransfers, func(i, j int) bool { return summaryTransfers[i].EventIndex < summaryTransfers[j].EventIndex })

	out := repository.TransferSummary{FT: []repository.FTTransferSummaryItem{}, NFT: []repository.NFTTransferSummaryItem{}}
	seen := make(map[string]struct{}, len(summaryTransfers))
	for _, transfer := range summaryTransfers {
		direction, counterparty, include := classifyCanonicalTransferForContext(transfer, ctx)
		if !include {
			continue
		}
		key := transfer.Token + "|" + transfer.Amount + "|" + direction + "|" + counterparty
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out.FT = append(out.FT, repository.FTTransferSummaryItem{
			Token:        transfer.Token,
			Amount:       transfer.Amount,
			Direction:    direction,
			Counterparty: counterparty,
		})
	}
	return out
}

func attoFLOWToFLOWString(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" {
		return "0"
	}
	n := new(big.Int)
	if _, ok := n.SetString(value, 10); !ok {
		return value
	}
	denom := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	intPart := new(big.Int)
	fracPart := new(big.Int)
	intPart.DivMod(n, denom, fracPart)
	if fracPart.Sign() == 0 {
		return intPart.String()
	}
	frac := fracPart.Text(10)
	if len(frac) < 18 {
		frac = strings.Repeat("0", 18-len(frac)) + frac
	}
	frac = strings.TrimRight(frac, "0")
	return intPart.String() + "." + frac
}

func decodeDirectCallPayload(hexPayload string) (from, to, data, value string, ok bool) {
	hexPayload = strings.TrimPrefix(strings.ToLower(hexPayload), "0x")
	if !strings.HasPrefix(hexPayload, "ff") || len(hexPayload) < 10 {
		return "", "", "", "", false
	}
	bytes, err := hex.DecodeString(hexPayload[2:])
	if err != nil || len(bytes) == 0 {
		return "", "", "", "", false
	}
	pos := 0
	switch {
	case bytes[pos] >= 0xf8:
		pos += 1 + int(bytes[pos]-0xf7)
	case bytes[pos] >= 0xc0:
		pos++
	default:
		return "", "", "", "", false
	}
	readItem := func() []byte {
		if pos >= len(bytes) {
			return nil
		}
		b := bytes[pos]
		switch {
		case b <= 0x7f:
			pos++
			return []byte{b}
		case b <= 0xb7:
			length := int(b - 0x80)
			pos++
			out := bytes[pos : pos+length]
			pos += length
			return out
		case b <= 0xbf:
			lenLen := int(b - 0xb7)
			pos++
			length := 0
			for i := 0; i < lenLen; i++ {
				length = (length << 8) | int(bytes[pos+i])
			}
			pos += lenLen
			out := bytes[pos : pos+length]
			pos += length
			return out
		default:
			return nil
		}
	}

	readItem() // nonce
	readItem() // subtype
	fromBytes := readItem()
	toBytes := readItem()
	dataBytes := readItem()
	valueBytes := readItem()

	if len(fromBytes) == 20 {
		from = hex.EncodeToString(fromBytes)
	}
	if len(toBytes) == 20 {
		to = hex.EncodeToString(toBytes)
		if strings.Trim(to, "0") == "" {
			to = ""
		}
	}
	if len(dataBytes) > 0 {
		data = hex.EncodeToString(dataBytes)
	}
	if len(valueBytes) > 0 {
		value = attoFLOWToFLOWString(new(big.Int).SetBytes(valueBytes).String())
	} else {
		value = "0"
	}
	return from, to, data, value, true
}
