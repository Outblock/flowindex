package matcher

import "encoding/json"

// ConditionMatcher defines the interface for matching webhook conditions
// against blockchain data objects.
type ConditionMatcher interface {
	// EventType returns the unique string identifier for this matcher,
	// e.g. "ft.transfer", "nft.transfer", "evm.transaction".
	EventType() string

	// Match checks whether the given data object satisfies the conditions
	// encoded in the JSON conditions blob. The data parameter is typically
	// a pointer to a models struct (TokenTransfer, Event, etc.).
	Match(data interface{}, conditions json.RawMessage) bool
}

// Registry holds a set of registered ConditionMatchers keyed by EventType.
type Registry struct {
	matchers map[string]ConditionMatcher
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{matchers: make(map[string]ConditionMatcher)}
}

// Register adds a ConditionMatcher to the registry, keyed by its EventType.
func (r *Registry) Register(m ConditionMatcher) {
	r.matchers[m.EventType()] = m
}

// Get returns the ConditionMatcher for the given eventType, or nil.
func (r *Registry) Get(eventType string) ConditionMatcher {
	return r.matchers[eventType]
}

// EventTypes returns all registered event type strings.
func (r *Registry) EventTypes() []string {
	types := make([]string, 0, len(r.matchers))
	for t := range r.matchers {
		types = append(types, t)
	}
	return types
}

// RegisterAll registers all built-in condition matchers.
func RegisterAll(r *Registry) {
	r.Register(&FTTransferMatcher{})
	r.Register(&LargeTransferMatcher{})
	r.Register(&NFTTransferMatcher{})
	r.Register(&AddressActivityMatcher{})
	r.Register(&ContractEventMatcher{})
	r.Register(&StakingEventMatcher{})
	r.Register(&DefiSwapMatcher{})
	r.Register(&DefiLiquidityMatcher{})
	r.Register(&AccountKeyChangeMatcher{})
	r.Register(&EVMTransactionMatcher{})
}
