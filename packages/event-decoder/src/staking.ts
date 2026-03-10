import { parseCadenceEventFields } from './cadence.js';
import type { StakingEvent, RawEvent } from './types.js';

// ── Staking event detection ──
// Matches the Go backend's isStakingEvent logic plus additional liquid staking patterns.

const STAKING_PATTERNS = [
  '.FlowIDTableStaking.',
  '.FlowStakingCollection.',
  '.FlowEpoch.',
  'LiquidStaking',
  'stFlowToken',
] as const;

function isStakingEvent(eventType: string): boolean {
  for (const pattern of STAKING_PATTERNS) {
    if (eventType.includes(pattern)) return true;
  }
  return false;
}

// ── Event name extraction ──
// "A.xxx.FlowIDTableStaking.TokensStaked" → "TokensStaked"

function extractEventName(eventType: string): string {
  const parts = eventType.split('.');
  if (parts.length > 0) {
    return parts[parts.length - 1];
  }
  return eventType;
}

// ── Main parser ──

export function parseStakingEvents(events: RawEvent[]): StakingEvent[] {
  const results: StakingEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (!isStakingEvent(evt.type)) continue;

    const fields = parseCadenceEventFields(evt.payload);
    if (!fields) continue;

    const action = extractEventName(evt.type);
    const nodeId = typeof fields['nodeID'] === 'string' ? fields['nodeID'] : '';
    const amount = typeof fields['amount'] === 'string' ? fields['amount'] : '';

    let delegatorId: number | undefined;
    const rawDelegator = fields['delegatorID'];
    if (rawDelegator != null && rawDelegator !== '') {
      const parsed = Number(rawDelegator);
      if (!Number.isNaN(parsed)) {
        delegatorId = parsed;
      }
    }

    results.push({
      action,
      nodeId,
      delegatorId,
      amount,
      event_index: evt.event_index ?? i,
    });
  }

  return results;
}
