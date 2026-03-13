package api

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"strings"

	"flowscan-clone/internal/repository"

	gethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

func normalizeEVMAddress(addr string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(addr)), "0x")
}

func collectUniqueEVMExecutionAddresses(evmExecs []repository.EVMTransactionRecord) []string {
	seen := make(map[string]struct{}, len(evmExecs)*2)
	out := make([]string, 0, len(evmExecs)*2)
	for _, exec := range evmExecs {
		for _, addr := range []string{exec.FromAddress, exec.ToAddress} {
			addr = normalizeEVMAddress(addr)
			if addr == "" {
				continue
			}
			if _, ok := seen[addr]; ok {
				continue
			}
			seen[addr] = struct{}{}
			out = append(out, addr)
		}
	}
	return out
}

func preferredEVMEntityLabel(label repository.EVMAddressLabelMetadata, contract repository.EVMContractMetadata) string {
	switch {
	case label.Name != "":
		return label.Name
	case contract.Name != "":
		return contract.Name
	case label.TokenName != "":
		return label.TokenName
	case label.TokenSymbol != "":
		return label.TokenSymbol
	default:
		return ""
	}
}

func deriveEVMEntityKind(label repository.EVMAddressLabelMetadata, contract repository.EVMContractMetadata) string {
	switch {
	case label.TokenSymbol != "" || label.TokenName != "":
		return "token"
	case contract.Address != "" || label.IsContract:
		return "contract"
	default:
		return "eoa"
	}
}

func buildEVMEntityMeta(addr string, labels map[string]repository.EVMAddressLabelMetadata, contracts map[string]repository.EVMContractMetadata) map[string]interface{} {
	addr = normalizeEVMAddress(addr)
	if addr == "" {
		return nil
	}

	label := labels[addr]
	contract := contracts[addr]
	out := map[string]interface{}{
		"address": formatAddressV1(addr),
		"kind":    deriveEVMEntityKind(label, contract),
	}
	if display := preferredEVMEntityLabel(label, contract); display != "" {
		out["label"] = display
	}
	if len(label.Tags) > 0 {
		out["tags"] = label.Tags
	}
	if label.TokenName != "" {
		out["token_name"] = label.TokenName
	}
	if label.TokenSymbol != "" {
		out["token_symbol"] = label.TokenSymbol
	}
	if contract.Name != "" {
		out["contract_name"] = contract.Name
	}
	if contract.ProxyType != "" {
		out["proxy_type"] = contract.ProxyType
	}
	if contract.ImplAddress != "" {
		out["implementation_address"] = formatAddressV1(contract.ImplAddress)
	}
	if label.IsVerified || contract.VerifiedAt != nil {
		out["verified"] = true
	}
	if label.IsContract {
		out["is_contract"] = true
	}
	return out
}

func normalizeABIValue(value interface{}) interface{} {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		return v
	case bool:
		return v
	case common.Address:
		return formatAddressV1(v.Hex())
	case *big.Int:
		if v == nil {
			return nil
		}
		return v.String()
	case big.Int:
		return v.String()
	case json.RawMessage:
		return string(v)
	}

	rv := reflect.ValueOf(value)
	if !rv.IsValid() {
		return nil
	}
	if rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		return normalizeABIValue(rv.Elem().Interface())
	}

	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return fmt.Sprint(rv.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return fmt.Sprint(rv.Uint())
	case reflect.Bool:
		return rv.Bool()
	case reflect.String:
		return rv.String()
	case reflect.Slice:
		if rv.Type().Elem().Kind() == reflect.Uint8 {
			return "0x" + hex.EncodeToString(rv.Bytes())
		}
		out := make([]interface{}, 0, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out = append(out, normalizeABIValue(rv.Index(i).Interface()))
		}
		return out
	case reflect.Array:
		if rv.Type().Elem().Kind() == reflect.Uint8 {
			buf := make([]byte, rv.Len())
			for i := 0; i < rv.Len(); i++ {
				buf[i] = byte(rv.Index(i).Uint())
			}
			return "0x" + hex.EncodeToString(buf)
		}
		out := make([]interface{}, 0, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out = append(out, normalizeABIValue(rv.Index(i).Interface()))
		}
		return out
	case reflect.Struct:
		// Handle tuple-like structs returned by go-ethereum ABI decoding.
		out := make(map[string]interface{}, rv.NumField())
		rt := rv.Type()
		for i := 0; i < rv.NumField(); i++ {
			field := rt.Field(i)
			if !field.IsExported() {
				continue
			}
			out[field.Name] = normalizeABIValue(rv.Field(i).Interface())
		}
		return out
	case reflect.Map:
		out := make(map[string]interface{}, rv.Len())
		iter := rv.MapRange()
		for iter.Next() {
			out[fmt.Sprint(iter.Key().Interface())] = normalizeABIValue(iter.Value().Interface())
		}
		return out
	default:
		return fmt.Sprint(value)
	}
}

func decodeABIWithContract(dataHex string, contract repository.EVMContractMetadata, impl repository.EVMContractMetadata) map[string]interface{} {
	dataHex = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(dataHex)), "0x")
	if len(dataHex) < 8 {
		return nil
	}
	raw, err := hex.DecodeString(dataHex)
	if err != nil || len(raw) < 4 {
		return nil
	}

	selected := contract
	viaProxy := false
	if contract.ProxyType != "" && contract.ImplAddress != "" && len(impl.ABI) > 0 && string(impl.ABI) != "null" {
		selected = impl
		viaProxy = true
	}
	if len(selected.ABI) == 0 || string(selected.ABI) == "null" {
		return nil
	}

	parsed, err := gethabi.JSON(strings.NewReader(string(selected.ABI)))
	if err != nil {
		return nil
	}
	method, err := parsed.MethodById(raw[:4])
	if err != nil || method == nil {
		return nil
	}

	out := map[string]interface{}{
		"selector":  "0x" + dataHex[:8],
		"method":    method.Name,
		"signature": method.Sig,
	}
	if selected.Name != "" {
		out["contract_name"] = selected.Name
	}
	if viaProxy {
		out["via_proxy"] = true
		if contract.ProxyType != "" {
			out["proxy_type"] = contract.ProxyType
		}
		if contract.Address != "" {
			out["proxy_address"] = formatAddressV1(contract.Address)
		}
		if impl.Address != "" {
			out["implementation_address"] = formatAddressV1(impl.Address)
		}
		if impl.Name != "" {
			out["implementation_name"] = impl.Name
		}
	}

	args, err := method.Inputs.UnpackValues(raw[4:])
	if err != nil {
		return out
	}
	if len(args) == 0 {
		return out
	}

	argOut := make([]map[string]interface{}, 0, len(args))
	for i, input := range method.Inputs {
		arg := map[string]interface{}{
			"type":  input.Type.String(),
			"value": normalizeABIValue(args[i]),
		}
		if input.Name != "" {
			arg["name"] = input.Name
		}
		argOut = append(argOut, arg)
	}
	out["args"] = argOut
	return out
}

func (s *Server) buildEnrichedEVMExecutions(ctx context.Context, evmExecs []repository.EVMTransactionRecord) []map[string]interface{} {
	if len(evmExecs) == 0 {
		return []map[string]interface{}{}
	}

	addresses := collectUniqueEVMExecutionAddresses(evmExecs)
	labelMap, _ := s.repo.GetEVMAddressLabelsByAddresses(ctx, addresses)
	contractMap, _ := s.repo.GetEVMContractsByAddresses(ctx, addresses)

	implAddresses := make([]string, 0)
	for _, contract := range contractMap {
		if contract.ImplAddress != "" {
			implAddresses = append(implAddresses, contract.ImplAddress)
		}
	}
	if len(implAddresses) > 0 {
		if implContracts, err := s.repo.GetEVMContractsByAddresses(ctx, implAddresses); err == nil {
			for addr, contract := range implContracts {
				contractMap[addr] = contract
			}
		}
	}

	out := make([]map[string]interface{}, 0, len(evmExecs))
	for _, rec := range evmExecs {
		item := toEVMTransactionOutput(rec)
		if meta := buildEVMEntityMeta(rec.FromAddress, labelMap, contractMap); meta != nil {
			item["from_meta"] = meta
		}
		if meta := buildEVMEntityMeta(rec.ToAddress, labelMap, contractMap); meta != nil {
			item["to_meta"] = meta
		}

		contract := contractMap[normalizeEVMAddress(rec.ToAddress)]
		impl := contractMap[contract.ImplAddress]
		if decoded := decodeABIWithContract(rec.Data, contract, impl); decoded != nil {
			item["decoded_call"] = decoded
		}
		out = append(out, item)
	}
	return out
}
