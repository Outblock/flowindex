// ── Main orchestrator: decodes all event types from a raw event list ──

import { parseTokenEvents } from './tokens.js';
import { parseEVMEvents } from './evm.js';
import { parseSystemEvents } from './system.js';
import { parseDefiEvents } from './defi.js';
import { parseStakingEvents } from './staking.js';
import { deriveTags } from './tags.js';
import { parseCadenceEventFields } from './cadence.js';
import type { RawEvent, DecodedEvents } from './types.js';

export function decodeEvents(events: RawEvent[], script?: string | null): DecodedEvents {
  const { transfers, nftTransfers } = parseTokenEvents(events);
  const evmExecutions = parseEVMEvents(events);
  const systemEvents = parseSystemEvents(events);
  const defiEvents = parseDefiEvents(events);
  const stakingEvents = parseStakingEvents(events);
  const tags = deriveTags(events);
  const fee = extractFee(events);
  const contractImports = extractContractImports(script);

  return { transfers, nftTransfers, evmExecutions, defiEvents, stakingEvents, systemEvents, fee, tags, contractImports };
}

function extractFee(events: RawEvent[]): number {
  for (const event of events) {
    const eventType = event.type || '';
    if (!eventType.includes('FlowFees.FeesDeducted')) continue;
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    const fields = parseCadenceEventFields(payload);
    if (!fields) continue;
    const amount = fields.amount;
    if (amount != null) {
      const n = parseFloat(String(amount));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function extractContractImports(script: string | undefined | null): string[] {
  if (!script) return [];
  const imports: string[] = [];
  const re = /import\s+(\w+)\s+from\s+(0x[0-9a-fA-F]+)/g;
  let match;
  while ((match = re.exec(script)) !== null) {
    imports.push(`A.${match[2].replace(/^0x/, '')}.${match[1]}`);
  }
  return imports;
}
