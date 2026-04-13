/**
 * Morning Briefing Generator — Even AI Operations Module
 *
 * Comprehensive daily operations brief covering:
 * - Census & bed utilization
 * - OT operations & scheduling
 * - Quality & safety incidents
 * - Billing & revenue
 * - Pharmacy inventory & stock status
 * - Staffing overview
 *
 * Resilient to missing data sources. Falls back to template if LLM unavailable.
 */

import { randomUUID } from 'crypto';
import { generateInsight } from '../llm-client';
import { InsightCard, CardSource, LLMResponse } from '../types';

// ============================================================================
// Types
// ============================================================================

interface CensusData {
  total_beds: number;
  occupied: number;
  available: number;
  occupancy_pct: number;
  overnight_admissions: number;
  planned_discharges: number;
  predicted_discharges: number;
}

interface OTData {
  scheduled_procedures: number;
  rooms_in_use: number;
  room_utilization_pct: number;
  cancellations: number;
  rescheduled: number;
}

interface QualityData {
  incidents_24h: number;
  open_capas: number;
  nabh_score: number;
  active_infections: number;
  critical_incidents: string[];
}

interface BillingData {
  pending_claims: number;
  pending_amount: number;
  revenue_today: number;
  revenue_yesterday: number;
  overdue_payments: number;
  overdue_amount: number;
}

interface PharmacyData {
  critical_stockouts: number;
  stockout_items: string[];
  expiring_30d: number;
  expiring_items: string[];
  narcotic_issues: number;
}

interface BriefingSections {
  census: CensusData;
  ot: OTData;
  quality: QualityData;
  billing: BillingData;
  pharmacy: PharmacyData;
}

export interface MorningBriefing {
  hospital_id: string;
  date: string;
  sections: BriefingSections;
  narrative: string;
  source: CardSource;
  card: InsightCard;
  critical_items: string[];
}

// ============================================================================
// SQL Helper
// ============================================================================

let _sql: any = null;

function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Data Gathering Functions (with fallbacks)
// ============================================================================

async function gatherCensusData(hospital_id: string): Promise<CensusData> {
  try {
    const sql = getSql();

    // Get bed counts
    const beds = await sql<any[]>`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'occupied' THEN 1 END) as occupied,
        COUNT(CASE WHEN status = 'available' THEN 1 END) as available
      FROM beds
      WHERE hospital_id = ${hospital_id}
    `;

    const total_beds = beds[0]?.total || 0;
    const occupied = beds[0]?.occupied || 0;
    const available = beds[0]?.available || 0;
    const occupancy_pct = total_beds > 0 ? Math.round((occupied / total_beds) * 100) : 0;

    // Overnight admissions (last 12 hours)
    const overnight = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM encounters
      WHERE hospital_id = ${hospital_id}
        AND admission_type = 'emergency'
        AND created_at >= NOW() - INTERVAL '12 hours'
    `;

    const overnight_admissions = overnight[0]?.count || 0;

    // Planned discharges today
    const planned = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM encounters
      WHERE hospital_id = ${hospital_id}
        AND status = 'active'
        AND planned_discharge_date::date = CURRENT_DATE
    `;

    const planned_discharges = planned[0]?.count || 0;

    // Predicted discharges (from bed_predictions)
    const predicted = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM bed_predictions
      WHERE hospital_id = ${hospital_id}
        AND predicted_discharge_date::date = CURRENT_DATE
    `;

    const predicted_discharges = predicted[0]?.count || 0;

    return {
      total_beds,
      occupied,
      available,
      occupancy_pct,
      overnight_admissions,
      planned_discharges,
      predicted_discharges,
    };
  } catch (error) {
    console.warn('[MorningBriefing] Census data gather failed:', error);
    return {
      total_beds: 0,
      occupied: 0,
      available: 0,
      occupancy_pct: 0,
      overnight_admissions: 0,
      planned_discharges: 0,
      predicted_discharges: 0,
    };
  }
}

async function gatherOTData(hospital_id: string): Promise<OTData> {
  try {
    const sql = getSql();

    // Today's scheduled procedures
    const scheduled = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM ot_schedules
      WHERE hospital_id = ${hospital_id}
        AND scheduled_date::date = CURRENT_DATE
        AND status IN ('scheduled', 'in_progress')
    `;

    const scheduled_procedures = scheduled[0]?.count || 0;

    // OT rooms in use (current)
    const inuse = await sql<any[]>`
      SELECT COUNT(DISTINCT ot_room_id) as count
      FROM ot_schedules
      WHERE hospital_id = ${hospital_id}
        AND scheduled_date::date = CURRENT_DATE
        AND status = 'in_progress'
    `;

    const rooms_in_use = inuse[0]?.count || 0;

    // Room utilization (rooms available in OT rooms table)
    const rooms_total = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM ot_rooms
      WHERE hospital_id = ${hospital_id}
    `;

    const room_utilization_pct =
      (rooms_total[0]?.count || 0) > 0
        ? Math.round((rooms_in_use / (rooms_total[0]?.count || 1)) * 100)
        : 0;

    // Cancellations & rescheduled
    const cancelled = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM ot_schedules
      WHERE hospital_id = ${hospital_id}
        AND scheduled_date::date = CURRENT_DATE
        AND status = 'cancelled'
    `;

    const rescheduled = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM ot_schedules
      WHERE hospital_id = ${hospital_id}
        AND scheduled_date::date = CURRENT_DATE
        AND previous_scheduled_date IS NOT NULL
    `;

    return {
      scheduled_procedures,
      rooms_in_use,
      room_utilization_pct,
      cancellations: cancelled[0]?.count || 0,
      rescheduled: rescheduled[0]?.count || 0,
    };
  } catch (error) {
    console.warn('[MorningBriefing] OT data gather failed:', error);
    return {
      scheduled_procedures: 0,
      rooms_in_use: 0,
      room_utilization_pct: 0,
      cancellations: 0,
      rescheduled: 0,
    };
  }
}

async function gatherQualityData(hospital_id: string): Promise<QualityData> {
  try {
    const sql = getSql();

    // Incidents in last 24 hours
    const incidents = await sql<any[]>`
      SELECT
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types
      FROM incident_reports
      WHERE hospital_id = ${hospital_id}
        AND created_at >= NOW() - INTERVAL '24 hours'
    `;

    const incidents_24h = incidents[0]?.count || 0;
    const critical_incidents =
      incidents[0]?.types?.split(',').filter((t: string) => t && t.length > 0) || [];

    // Open CAPA items
    const capas = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM rca_capa_items
      WHERE hospital_id = ${hospital_id}
        AND status = 'open'
    `;

    const open_capas = capas[0]?.count || 0;

    // Latest NABH score
    const nabh = await sql<any[]>`
      SELECT score
      FROM nabh_readiness_scores
      WHERE hospital_id = ${hospital_id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const nabh_score = nabh[0]?.score || 0;

    // Active infection alerts
    const infections = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM infection_surveillance
      WHERE hospital_id = ${hospital_id}
        AND status = 'active'
    `;

    const active_infections = infections[0]?.count || 0;

    return {
      incidents_24h,
      open_capas,
      nabh_score,
      active_infections,
      critical_incidents,
    };
  } catch (error) {
    console.warn('[MorningBriefing] Quality data gather failed:', error);
    return {
      incidents_24h: 0,
      open_capas: 0,
      nabh_score: 0,
      active_infections: 0,
      critical_incidents: [],
    };
  }
}

async function gatherBillingData(hospital_id: string): Promise<BillingData> {
  try {
    const sql = getSql();

    // Pending claims
    const pending = await sql<any[]>`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(CAST(claimed_amount AS NUMERIC)), 0) as amount
      FROM insurance_claims
      WHERE hospital_id = ${hospital_id}
        AND status = 'pending'
    `;

    const pending_claims = pending[0]?.count || 0;
    const pending_amount = pending[0]?.amount || 0;

    // Revenue today vs yesterday
    const today_revenue = await sql<any[]>`
      SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total
      FROM billing_accounts
      WHERE hospital_id = ${hospital_id}
        AND created_at::date = CURRENT_DATE
    `;

    const yesterday_revenue = await sql<any[]>`
      SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total
      FROM billing_accounts
      WHERE hospital_id = ${hospital_id}
        AND created_at::date = CURRENT_DATE - INTERVAL '1 day'
    `;

    const revenue_today = today_revenue[0]?.total || 0;
    const revenue_yesterday = yesterday_revenue[0]?.total || 0;

    // Overdue payments
    const overdue = await sql<any[]>`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(CAST(amount_due AS NUMERIC)), 0) as amount
      FROM billing_accounts
      WHERE hospital_id = ${hospital_id}
        AND due_date < CURRENT_DATE
        AND status != 'settled'
    `;

    const overdue_payments = overdue[0]?.count || 0;
    const overdue_amount = overdue[0]?.amount || 0;

    return {
      pending_claims,
      pending_amount,
      revenue_today,
      revenue_yesterday,
      overdue_payments,
      overdue_amount,
    };
  } catch (error) {
    console.warn('[MorningBriefing] Billing data gather failed:', error);
    return {
      pending_claims: 0,
      pending_amount: 0,
      revenue_today: 0,
      revenue_yesterday: 0,
      overdue_payments: 0,
      overdue_amount: 0,
    };
  }
}

async function gatherPharmacyData(hospital_id: string): Promise<PharmacyData> {
  try {
    const sql = getSql();

    // Critical stockouts
    const stockouts = await sql<any[]>`
      SELECT
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT drug_name) as items
      FROM pharmacy_inventory
      WHERE hospital_id = ${hospital_id}
        AND current_quantity = 0
      LIMIT 10
    `;

    const critical_stockouts = stockouts[0]?.count || 0;
    const stockout_items =
      stockouts[0]?.items?.split(',').filter((i: string) => i && i.length > 0) || [];

    // Expiring within 30 days
    const expiring = await sql<any[]>`
      SELECT
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT drug_name) as items
      FROM pharmacy_inventory
      WHERE hospital_id = ${hospital_id}
        AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND expiry_date > CURRENT_DATE
      LIMIT 10
    `;

    const expiring_30d = expiring[0]?.count || 0;
    const expiring_items =
      expiring[0]?.items?.split(',').filter((i: string) => i && i.length > 0) || [];

    // Narcotic discrepancies
    const narcotics = await sql<any[]>`
      SELECT COUNT(*) as count
      FROM pharmacy_inventory
      WHERE hospital_id = ${hospital_id}
        AND is_narcotic = true
        AND discrepancy_flag = true
    `;

    const narcotic_issues = narcotics[0]?.count || 0;

    return {
      critical_stockouts,
      stockout_items,
      expiring_30d,
      expiring_items,
      narcotic_issues,
    };
  } catch (error) {
    console.warn('[MorningBriefing] Pharmacy data gather failed:', error);
    return {
      critical_stockouts: 0,
      stockout_items: [],
      expiring_30d: 0,
      expiring_items: [],
      narcotic_issues: 0,
    };
  }
}

// ============================================================================
// Template Fallback (for when LLM is unavailable)
// ============================================================================

function generateTemplateBriefing(sections: BriefingSections): string {
  const date = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [];

  lines.push(`===== EVEN HOSPITAL MORNING OPERATIONS BRIEFING =====`);
  lines.push(`Date: ${date}`);
  lines.push('');

  // Census
  lines.push('CENSUS & BEDS');
  lines.push(`  Total Beds: ${sections.census.total_beds}`);
  lines.push(`  Occupied: ${sections.census.occupied} (${sections.census.occupancy_pct}%)`);
  lines.push(`  Available: ${sections.census.available}`);
  lines.push(`  Overnight Admissions: ${sections.census.overnight_admissions}`);
  lines.push(`  Planned Discharges Today: ${sections.census.planned_discharges}`);
  lines.push(`  Predicted Discharges: ${sections.census.predicted_discharges}`);
  lines.push('');

  // OT
  lines.push('OPERATING THEATRE');
  lines.push(`  Scheduled Procedures: ${sections.ot.scheduled_procedures}`);
  lines.push(`  Rooms in Use: ${sections.ot.rooms_in_use} (${sections.ot.room_utilization_pct}% util)`);
  lines.push(`  Cancellations: ${sections.ot.cancellations}`);
  lines.push(`  Rescheduled: ${sections.ot.rescheduled}`);
  lines.push('');

  // Quality
  lines.push('QUALITY & SAFETY');
  lines.push(`  Incidents (24h): ${sections.quality.incidents_24h}`);
  if (sections.quality.critical_incidents.length > 0) {
    lines.push(`    Types: ${sections.quality.critical_incidents.join(', ')}`);
  }
  lines.push(`  Open CAPA Items: ${sections.quality.open_capas}`);
  lines.push(`  NABH Readiness Score: ${sections.quality.nabh_score}`);
  lines.push(`  Active Infection Alerts: ${sections.quality.active_infections}`);
  lines.push('');

  // Billing
  lines.push('BILLING & REVENUE');
  lines.push(`  Pending Claims: ${sections.billing.pending_claims} (₹${sections.billing.pending_amount.toFixed(0)})`);
  lines.push(`  Revenue Today: ₹${sections.billing.revenue_today.toFixed(0)}`);
  lines.push(`  Revenue Yesterday: ₹${sections.billing.revenue_yesterday.toFixed(0)}`);
  lines.push(`  Overdue Payments: ${sections.billing.overdue_payments} (₹${sections.billing.overdue_amount.toFixed(0)})`);
  lines.push('');

  // Pharmacy
  lines.push('PHARMACY');
  lines.push(`  Critical Stockouts: ${sections.pharmacy.critical_stockouts}`);
  if (sections.pharmacy.stockout_items.length > 0) {
    lines.push(`    Items: ${sections.pharmacy.stockout_items.join(', ')}`);
  }
  lines.push(`  Expiring (30 days): ${sections.pharmacy.expiring_30d}`);
  if (sections.pharmacy.expiring_items.length > 0) {
    lines.push(`    Items: ${sections.pharmacy.expiring_items.join(', ')}`);
  }
  lines.push(`  Narcotic Discrepancies: ${sections.pharmacy.narcotic_issues}`);
  lines.push('');

  lines.push('===== END BRIEFING =====');

  return lines.join('\n');
}

// ============================================================================
// Card Insertion
// ============================================================================

async function insertBriefingCard(card: InsightCard): Promise<void> {
  try {
    const sql = getSql();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity,
        title, body, explanation, data_sources, suggested_action, action_url,
        confidence, source, status,
        created_at, expires_at
      ) VALUES (
        ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
        ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)},
        ${card.suggested_action || null}, ${card.action_url || null},
        ${card.confidence}, ${card.source}, ${card.status},
        ${card.created_at}, ${expiresAt}
      )
    `;
  } catch (error) {
    console.error('[MorningBriefing] Failed to insert card:', error);
    throw error;
  }
}

// ============================================================================
// Main Export Functions
// ============================================================================

export async function generateMorningBriefing(hospital_id: string): Promise<MorningBriefing> {
  const startTime = Date.now();
  const cardId = randomUUID();
  const date = new Date().toISOString().split('T')[0];

  console.log('[MorningBriefing] Starting briefing generation for', hospital_id);

  // Gather all data in parallel with fallbacks
  const [census, ot, quality, billing, pharmacy] = await Promise.all([
    gatherCensusData(hospital_id),
    gatherOTData(hospital_id),
    gatherQualityData(hospital_id),
    gatherBillingData(hospital_id),
    gatherPharmacyData(hospital_id),
  ]);

  const sections: BriefingSections = {
    census,
    ot,
    quality,
    billing,
    pharmacy,
  };

  // Identify critical items
  const critical_items: string[] = [];
  if (quality.incidents_24h > 0) {
    critical_items.push(`${quality.incidents_24h} incident(s) in last 24 hours`);
  }
  if (pharmacy.critical_stockouts > 0) {
    critical_items.push(`${pharmacy.critical_stockouts} critical drug stockout(s)`);
  }
  if (billing.overdue_payments > 0) {
    critical_items.push(`${billing.overdue_payments} overdue payment(s)`);
  }
  if (quality.active_infections > 0) {
    critical_items.push(`${quality.active_infections} active infection alert(s)`);
  }
  if (ot.cancellations > 0) {
    critical_items.push(`${ot.cancellations} OT procedure(s) cancelled`);
  }

  // Determine severity based on critical items
  const severity = critical_items.length > 0 ? 'high' : 'info';

  // Build user prompt with structured data
  const userPrompt = `
Hospital: ${hospital_id}
Date: ${date}

CENSUS & BEDS:
- Total Beds: ${census.total_beds}
- Occupied: ${census.occupied} (${census.occupancy_pct}%)
- Available: ${census.available}
- Overnight Admissions: ${census.overnight_admissions}
- Planned Discharges: ${census.planned_discharges}
- Predicted Discharges: ${census.predicted_discharges}

OPERATING THEATRE:
- Scheduled Procedures: ${ot.scheduled_procedures}
- Rooms in Use: ${ot.rooms_in_use} (${ot.room_utilization_pct}% utilization)
- Cancellations: ${ot.cancellations}
- Rescheduled: ${ot.rescheduled}

QUALITY & SAFETY:
- Incidents (24h): ${quality.incidents_24h}
- Incident Types: ${quality.critical_incidents.join(', ') || 'None'}
- Open CAPA Items: ${quality.open_capas}
- NABH Readiness Score: ${quality.nabh_score}
- Active Infection Alerts: ${quality.active_infections}

BILLING & REVENUE:
- Pending Claims: ${billing.pending_claims} (₹${billing.pending_amount.toFixed(0)})
- Today's Revenue: ₹${billing.revenue_today.toFixed(0)}
- Yesterday's Revenue: ₹${billing.revenue_yesterday.toFixed(0)}
- Overdue Payments: ${billing.overdue_payments} (₹${billing.overdue_amount.toFixed(0)})

PHARMACY:
- Critical Stockouts: ${pharmacy.critical_stockouts}
- Stockout Items: ${pharmacy.stockout_items.join(', ') || 'None'}
- Expiring (30 days): ${pharmacy.expiring_30d}
- Expiring Items: ${pharmacy.expiring_items.join(', ') || 'None'}
- Narcotic Discrepancies: ${pharmacy.narcotic_issues}

Generate a concise morning operations briefing for hospital leadership. Start with critical items, then summarize by section. Include actionable recommendations for any red flags.
  `.trim();

  const systemPrompt = `You are the Even Hospital morning briefing assistant. Generate a comprehensive but concise daily operations brief for the hospital leadership team.

Format your response as follows:
1. HEADLINE SUMMARY - 2-3 sentences on overall operational status
2. CRITICAL ITEMS - List any red flags requiring immediate attention (if none, state "All clear")
3. SECTION SUMMARIES - Brief bullet points for Census, OT, Quality, Billing, Pharmacy
4. RECOMMENDATIONS - 2-3 specific action items for today

Keep total length under 400 words. Use clear metrics and avoid jargon where possible.`;

  let narrative = '';
  let source: CardSource = 'template';

  // Attempt LLM generation
  try {
    console.log('[MorningBriefing] Calling LLM for narrative generation');

    const response = await generateInsight({
      hospital_id,
      module: 'operations',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 1500,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (response && response.content) {
      narrative = response.content;
      source = 'llm';
      console.log('[MorningBriefing] LLM generation successful');
    } else {
      console.warn('[MorningBriefing] LLM response invalid, falling back to template');
      narrative = generateTemplateBriefing(sections);
      source = 'template';
    }
  } catch (error) {
    console.warn('[MorningBriefing] LLM generation failed:', error);
    narrative = generateTemplateBriefing(sections);
    source = 'template';
  }

  // Create insight card
  const card: InsightCard = {
    id: cardId,
    hospital_id,
    module: 'operations',
    category: 'report',
    severity,
    title: `Morning Operations Briefing — ${date}`,
    body: narrative,
    explanation: `Automated daily briefing covering census, OT, quality, billing, and pharmacy operations. Generated from live hospital data at ${new Date().toLocaleTimeString('en-IN')}.`,
    data_sources: [
      'beds',
      'encounters',
      'bed_predictions',
      'ot_schedules',
      'ot_rooms',
      'incident_reports',
      'rca_capa_items',
      'nabh_readiness_scores',
      'infection_surveillance',
      'insurance_claims',
      'billing_accounts',
      'pharmacy_inventory',
    ],
    suggested_action:
      critical_items.length > 0
        ? 'Review critical items and coordinate team response'
        : 'Routine daily review',
    action_url: undefined,
    confidence: source === 'llm' ? 0.92 : 0.75,
    source,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Insert card
  await insertBriefingCard(card);

  const elapsedMs = Date.now() - startTime;
  console.log(`[MorningBriefing] Generation complete (${elapsedMs}ms, source: ${source})`);

  return {
    hospital_id,
    date,
    sections,
    narrative,
    source,
    card,
    critical_items,
  };
}

export async function getLatestBriefing(hospital_id: string): Promise<InsightCard | null> {
  try {
    const sql = getSql();

    const results = await sql<any[]>`
      SELECT *
      FROM ai_insight_cards
      WHERE hospital_id = ${hospital_id}
        AND module = 'operations'
        AND category = 'report'
        AND title ILIKE '%Morning Briefing%'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (results.length === 0) {
      return null;
    }

    const row = results[0];

    return {
      id: row.id,
      hospital_id: row.hospital_id,
      module: row.module,
      category: row.category,
      severity: row.severity,
      title: row.title,
      body: row.body,
      explanation: row.explanation,
      data_sources: Array.isArray(row.data_sources) ? row.data_sources : JSON.parse(row.data_sources || '[]'),
      suggested_action: row.suggested_action,
      action_url: row.action_url,
      confidence: row.confidence,
      source: row.source,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    console.error('[MorningBriefing] Failed to fetch latest briefing:', error);
    return null;
  }
}
