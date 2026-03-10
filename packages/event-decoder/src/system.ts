import { parseCadenceEventFields, normalizeFlowAddress, formatAddr } from './cadence.js';
import type { SystemEvent, RawEvent } from './types.js';

// ── Helpers ──

function formatPath(v: any): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (v.domain && v.identifier) return `/${v.domain}/${v.identifier}`;
    if (v.value && typeof v.value === 'object') return formatPath(v.value);
  }
  return String(v ?? '');
}

function formatType(v: any): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (v.staticType?.typeID) return v.staticType.typeID;
    if (v.typeID) return v.typeID;
    if (v.value) return formatType(v.value);
  }
  return String(v ?? '');
}

// ── System event decoder ──

const SYSTEM_EVENT_PREFIX = 'flow.';

export function parseSystemEvents(events: RawEvent[]): SystemEvent[] {
  const results: SystemEvent[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.type.startsWith(SYSTEM_EVENT_PREFIX)) continue;

    const fields = parseCadenceEventFields(ev.payload);
    if (!fields) continue;

    const eventIndex = ev.event_index ?? i;
    const parsed = decodeSystemEvent(ev.type, fields, eventIndex);
    if (parsed) results.push(parsed);
  }

  return results;
}

function decodeSystemEvent(
  type: string,
  fields: Record<string, any>,
  eventIndex: number,
): SystemEvent | null {
  switch (type) {
    // ── Account events ──
    case 'flow.AccountCreated': {
      const addr = normalizeFlowAddress(fields.address);
      return {
        category: 'account',
        action: 'created',
        address: addr,
        detail: `Created account ${formatAddr(addr)}`,
        event_index: eventIndex,
      };
    }

    case 'flow.AccountKeyAdded': {
      const addr = normalizeFlowAddress(fields.address);
      const keyIndex = fields.keyIndex != null ? Number(fields.keyIndex) : undefined;
      const weight = fields.weight ?? '';
      return {
        category: 'key',
        action: 'key_added',
        address: addr,
        detail: `Added key #${keyIndex ?? '?'} (weight ${weight})`,
        event_index: eventIndex,
        keyIndex,
      };
    }

    case 'flow.AccountKeyRemoved': {
      const addr = normalizeFlowAddress(fields.address);
      return {
        category: 'key',
        action: 'key_removed',
        address: addr,
        detail: `Removed key from ${formatAddr(addr)}`,
        event_index: eventIndex,
      };
    }

    // ── Contract events ──
    case 'flow.AccountContractAdded': {
      const addr = normalizeFlowAddress(fields.address);
      const contract = fields.contract ?? '';
      return {
        category: 'contract',
        action: 'contract_deployed',
        address: addr,
        detail: `Deployed ${contract} to ${formatAddr(addr)}`,
        event_index: eventIndex,
        contractName: contract,
      };
    }

    case 'flow.AccountContractUpdated': {
      const addr = normalizeFlowAddress(fields.address);
      const contract = fields.contract ?? '';
      return {
        category: 'contract',
        action: 'contract_updated',
        address: addr,
        detail: `Updated ${contract} on ${formatAddr(addr)}`,
        event_index: eventIndex,
        contractName: contract,
      };
    }

    case 'flow.AccountContractRemoved': {
      const addr = normalizeFlowAddress(fields.address);
      const contract = fields.contract ?? '';
      return {
        category: 'contract',
        action: 'contract_removed',
        address: addr,
        detail: `Removed ${contract} from ${formatAddr(addr)}`,
        event_index: eventIndex,
        contractName: contract,
      };
    }

    // ── Capability events ──
    case 'flow.StorageCapabilityControllerIssued': {
      const addr = normalizeFlowAddress(fields.address);
      const typeStr = formatType(fields.type);
      const pathStr = formatPath(fields.path);
      return {
        category: 'capability',
        action: 'storage_capability_issued',
        address: addr,
        detail: `Issued storage capability for ${typeStr} at ${pathStr}`,
        event_index: eventIndex,
        capabilityType: typeStr,
        path: pathStr,
      };
    }

    case 'flow.AccountCapabilityControllerIssued': {
      const addr = normalizeFlowAddress(fields.address);
      return {
        category: 'capability',
        action: 'account_capability_issued',
        address: addr,
        detail: 'Issued account capability',
        event_index: eventIndex,
      };
    }

    case 'flow.CapabilityPublished': {
      const addr = normalizeFlowAddress(fields.address);
      const pathStr = formatPath(fields.path);
      return {
        category: 'capability',
        action: 'capability_published',
        address: addr,
        detail: `Published capability at ${pathStr}`,
        event_index: eventIndex,
        path: pathStr,
      };
    }

    case 'flow.CapabilityUnpublished': {
      const addr = normalizeFlowAddress(fields.address);
      const pathStr = formatPath(fields.path);
      return {
        category: 'capability',
        action: 'capability_unpublished',
        address: addr,
        detail: `Unpublished capability at ${pathStr}`,
        event_index: eventIndex,
        path: pathStr,
      };
    }

    case 'flow.StorageCapabilityControllerDeleted': {
      const addr = normalizeFlowAddress(fields.address);
      return {
        category: 'capability',
        action: 'storage_capability_deleted',
        address: addr,
        detail: 'Removed storage capability',
        event_index: eventIndex,
      };
    }

    case 'flow.AccountCapabilityControllerDeleted': {
      const addr = normalizeFlowAddress(fields.address);
      return {
        category: 'capability',
        action: 'account_capability_deleted',
        address: addr,
        detail: 'Removed account capability',
        event_index: eventIndex,
      };
    }

    case 'flow.StorageCapabilityControllerTargetChanged': {
      const addr = normalizeFlowAddress(fields.address);
      const pathStr = formatPath(fields.path);
      return {
        category: 'capability',
        action: 'storage_capability_retarget',
        address: addr,
        detail: `Changed capability target to ${pathStr}`,
        event_index: eventIndex,
        path: pathStr,
      };
    }

    // ── Inbox events ──
    case 'flow.InboxValuePublished': {
      const addr = normalizeFlowAddress(fields.provider);
      const recipient = normalizeFlowAddress(fields.recipient);
      const name = fields.name ?? '';
      return {
        category: 'inbox',
        action: 'inbox_published',
        address: addr,
        detail: `Published capability '${name}' to ${formatAddr(recipient)}`,
        event_index: eventIndex,
      };
    }

    case 'flow.InboxValueClaimed': {
      const addr = normalizeFlowAddress(fields.recipient);
      const provider = normalizeFlowAddress(fields.provider);
      const name = fields.name ?? '';
      return {
        category: 'inbox',
        action: 'inbox_claimed',
        address: addr,
        detail: `Claimed capability '${name}' from ${formatAddr(provider)}`,
        event_index: eventIndex,
      };
    }

    case 'flow.InboxValueUnpublished': {
      const addr = normalizeFlowAddress(fields.provider);
      const name = fields.name ?? '';
      return {
        category: 'inbox',
        action: 'inbox_unpublished',
        address: addr,
        detail: `Unpublished '${name}'`,
        event_index: eventIndex,
      };
    }

    default:
      return null;
  }
}
