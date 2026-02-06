package repository

import "strings"

func isSystemTransaction(txPayer, txProposer string) bool {
	return strings.EqualFold(strings.TrimSpace(txPayer), systemFlowAddressHex) &&
		strings.EqualFold(strings.TrimSpace(txProposer), systemFlowAddressHex)
}
