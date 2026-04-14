import { getStreamServerClient } from './getstream';

// 7 channel types for Even OS config (without 'name' key, which is set via typeId)
export const CHANNEL_TYPES_CONFIG = {
  department: {
    typing_events: true,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    url_enrichment: true,
    custom_events: true,
    mutes: true,
    message_retention: '365',
  },
  'cross-functional': {
    typing_events: true,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    url_enrichment: true,
    custom_events: true,
    mutes: true,
  },
  'patient-thread': {
    typing_events: true,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    custom_events: true,
    mutes: false,
  },
  direct: {
    typing_events: true,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    url_enrichment: true,
    mutes: true,
  },
  'ops-broadcast': {
    typing_events: false,
    read_events: true,
    reactions: true,
    replies: false,
    uploads: true,
    url_enrichment: true,
    mutes: false,
  },
  'journey-step': {
    typing_events: false,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: false,
    custom_events: true,
    mutes: true,
  },
  'on-call': {
    typing_events: true,
    read_events: true,
    reactions: true,
    replies: true,
    uploads: true,
    custom_events: true,
    mutes: true,
  },
};

// 17 department channels (matching EHRC departments)
export const DEPARTMENT_CHANNELS = [
  { id: 'pharmacy', name: 'Pharmacy' },
  { id: 'nursing', name: 'Nursing' },
  { id: 'lab', name: 'Laboratory' },
  { id: 'radiology', name: 'Radiology' },
  { id: 'ot', name: 'Operation Theatre' },
  { id: 'billing', name: 'Billing & Revenue' },
  { id: 'customer-care', name: 'Customer Care' },
  { id: 'front-desk', name: 'Front Desk' },
  { id: 'housekeeping', name: 'Housekeeping' },
  { id: 'dietary', name: 'Dietary & Nutrition' },
  { id: 'physiotherapy', name: 'Physiotherapy' },
  { id: 'mrd', name: 'Medical Records' },
  { id: 'quality', name: 'Quality & Safety' },
  { id: 'infection-control', name: 'Infection Control' },
  { id: 'administration', name: 'Administration' },
  { id: 'medical-director', name: 'Medical Director Office' },
  { id: 'gm-office', name: 'GM Office' },
];

// 5 cross-functional channels
export const CROSS_FUNCTIONAL_CHANNELS = [
  { id: 'ops-daily-huddle', name: 'Daily Huddle' },
  { id: 'admission-coordination', name: 'Admission Coordination' },
  { id: 'discharge-coordination', name: 'Discharge Coordination' },
  { id: 'surgery-coordination', name: 'Surgery Coordination' },
  { id: 'emergency-escalation', name: 'Emergency Escalation' },
];

// Setup function: creates channel types + system bot + seeds channels
export async function setupGetStream() {
  const client = getStreamServerClient();
  const results: string[] = [];

  // Create system bot
  await client.upsertUser({
    id: 'even-os-system',
    name: 'Even OS',
    role: 'admin',
  });
  results.push('System bot (even-os-system) created');

  // Create channel types
  for (const [typeId, config] of Object.entries(CHANNEL_TYPES_CONFIG)) {
    try {
      await client.createChannelType({
        name: typeId,
        ...config,
      });
      results.push(`Channel type '${typeId}' created`);
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        results.push(`Channel type '${typeId}' already exists`);
      } else {
        results.push(`Channel type '${typeId}' error: ${e.message}`);
      }
    }
  }

  return results;
}

export async function seedChannels() {
  const client = getStreamServerClient();
  const results: string[] = [];

  // Seed department channels
  for (const dept of DEPARTMENT_CHANNELS) {
    try {
      const channel = client.channel('department', dept.id);
      await channel.create();
      results.push(`Department channel '${dept.id}' created`);
    } catch (e: any) {
      results.push(`Department '${dept.id}': ${e.message?.includes('already exists') ? 'exists' : e.message}`);
    }
  }

  // Seed cross-functional channels
  for (const cf of CROSS_FUNCTIONAL_CHANNELS) {
    try {
      const channel = client.channel('cross-functional', cf.id);
      await channel.create();
      results.push(`Cross-functional channel '${cf.id}' created`);
    } catch (e: any) {
      results.push(`Cross-functional '${cf.id}': ${e.message?.includes('already exists') ? 'exists' : e.message}`);
    }
  }

  // Seed broadcast channel
  try {
    const broadcast = client.channel('ops-broadcast', 'hospital-broadcast');
    await broadcast.create();
    results.push('Broadcast channel created');
  } catch (e: any) {
    results.push(`Broadcast: ${e.message?.includes('already exists') ? 'exists' : e.message}`);
  }

  return results;
}
