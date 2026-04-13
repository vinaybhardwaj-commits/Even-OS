import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';

let _sql: any = null;
function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

/**
 * Build a quality insight card with standardized structure
 */
function buildQualityCard(
  hospital_id: string,
  opts: {
    severity: CardSeverity;
    title: string;
    body: string;
    explanation: string;
    data_sources: string[];
    action_url?: string;
    suggested_action?: string;
    target_patient_id?: string;
    target_encounter_id?: string;
  }
): InsightCard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hospital_id,
    module: 'quality',
    category: 'alert',
    severity: opts.severity,
    title: opts.title,
    body: opts.body,
    explanation: opts.explanation,
    data_sources: opts.data_sources,
    action_url: opts.action_url,
    suggested_action: opts.suggested_action,
    confidence: 0.9,
    source: 'template',
    status: 'active',
    target_patient_id: opts.target_patient_id,
    target_encounter_id: opts.target_encounter_id,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Insert quality insight card into database with 24h expiry
 */
async function insertQualityCard(card: InsightCard): Promise<void> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await sql`
    INSERT INTO ai_insight_cards (
      id, hospital_id, module, category, severity,
      title, body, explanation, data_sources, suggested_action, action_url,
      confidence, source, status,
      target_patient_id, target_encounter_id,
      created_at, expires_at
    ) VALUES (
      ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
      ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)},
      ${card.suggested_action || null}, ${card.action_url || null},
      ${card.confidence}, ${card.source}, ${card.status},
      ${card.target_patient_id || null}, ${card.target_encounter_id || null},
      ${card.created_at}, ${expiresAt}
    )
  `;
}

/**
 * Check 1: New HAI Cases Alert
 * Detects new healthcare-associated infection cases in the last hour
 */
export async function checkNewHAICases(
  hospital_id: string
): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const cases = await sql`
      SELECT
        is.id,
        is.infection_type,
        is.organism,
        is.onset_date,
        is.is_patient_id,
        is.is_encounter_id,
        p.first_name,
        p.last_name,
        e.ward_name,
        e.id as encounter_id
      FROM infection_surveillance is
      LEFT JOIN encounters e ON is.is_encounter_id = e.id
      LEFT JOIN patients p ON is.is_patient_id = p.id
      WHERE is.hospital_id = ${hospital_id}
        AND is.is_created_at > ${oneHourAgo}
      ORDER BY is.is_created_at DESC
      LIMIT 50
    `;

    for (const c of cases as any[]) {
      const patientName = c.first_name && c.last_name ? `${c.first_name} ${c.last_name}` : 'Unknown Patient';
      const ward = c.ward_name || 'Unspecified Ward';

      const card = buildQualityCard(hospital_id, {
        severity: 'critical',
        title: `New HAI Case Detected: ${c.infection_type}`,
        body: `${patientName} (${ward}) diagnosed with ${c.infection_type} caused by ${c.organism || 'unidentified organism'}. Onset: ${new Date(c.onset_date).toLocaleDateString()}.`,
        explanation: 'New healthcare-associated infection requires immediate isolation review, contact tracing, and infection control measures.',
        data_sources: ['infection_surveillance', 'encounters', 'patients'],
        action_url: c.encounter_id ? `/admin/quality/infection-surveillance/${c.id}` : undefined,
        suggested_action: 'Review isolation status and contact precautions. Notify Infection Control immediately.',
        target_patient_id: c.is_patient_id,
        target_encounter_id: c.is_encounter_id,
      });

      cards.push(card);
      await insertQualityCard(card);
    }

    console.error(`[AI-QualityMonitor] HAI check: ${cases.length} new cases found`);
  } catch (err) {
    const msg = `HAI check failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return { cards, errors };
}

/**
 * Check 2: Unresolved Medication Safety
 * Detects new medication orders without allergy verification
 */
export async function checkMedicationSafety(
  hospital_id: string
): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const unverified = await sql`
      SELECT
        mo.id,
        mo.encounter_id,
        mo.drug_name,
        mo.dose,
        mo.created_at,
        p.first_name,
        p.last_name,
        e.ward_name
      FROM medication_orders mo
      LEFT JOIN encounters e ON mo.encounter_id = e.id
      LEFT JOIN patients p ON e.patient_id = p.id
      WHERE mo.hospital_id = ${hospital_id}
        AND mo.created_at > ${oneHourAgo}
        AND (mo.allergy_verified IS NULL OR mo.allergy_verified = false)
        AND mo.status NOT IN ('cancelled', 'discontinued')
      ORDER BY mo.created_at DESC
      LIMIT 50
    `;

    for (const m of unverified as any[]) {
      const patientName = m.first_name && m.last_name ? `${m.first_name} ${m.last_name}` : 'Unknown Patient';
      const ward = m.ward_name || 'Unspecified Ward';

      const card = buildQualityCard(hospital_id, {
        severity: 'high',
        title: `Unverified Allergy Check: ${m.drug_name}`,
        body: `${patientName} (${ward}) prescribed ${m.drug_name} (${m.dose}) without allergy verification. Order placed at ${new Date(m.created_at).toLocaleTimeString()}.`,
        explanation: 'Medication orders must have documented allergy verification before administration to prevent adverse drug events.',
        data_sources: ['medication_orders', 'encounters'],
        action_url: `/admin/quality/medication-safety/${m.id}`,
        suggested_action: 'Complete allergy verification immediately before medication administration.',
        target_encounter_id: m.encounter_id,
      });

      cards.push(card);
      await insertQualityCard(card);
    }

    console.error(`[AI-QualityMonitor] Medication safety check: ${unverified.length} unverified orders found`);
  } catch (err) {
    const msg = `Medication safety check failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return { cards, errors };
}

/**
 * Check 3: Incident Pattern Detection
 * Detects systemic incident patterns (3+ of same type in 7 days)
 */
export async function checkIncidentPatterns(
  hospital_id: string
): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const patterns = await sql`
      SELECT
        incident_type,
        COUNT(*) as count,
        STRING_AGG(DISTINCT ae_status, ', ') as statuses
      FROM adverse_events
      WHERE hospital_id = ${hospital_id}
        AND incident_date > ${sevenDaysAgo}
      GROUP BY incident_type
      HAVING COUNT(*) >= 3
      ORDER BY count DESC
    `;

    for (const p of patterns as any[]) {
      const card = buildQualityCard(hospital_id, {
        severity: 'high',
        title: `Incident Pattern: ${p.incident_type} (${p.count} cases)`,
        body: `${p.count} incidents of type "${p.incident_type}" detected in the past 7 days. Status distribution: ${p.statuses}.`,
        explanation: 'Multiple incidents of the same type indicate a potential systemic issue requiring root cause analysis and corrective action.',
        data_sources: ['adverse_events'],
        action_url: `/admin/quality/adverse-events?filter_type=${encodeURIComponent(p.incident_type)}`,
        suggested_action: 'Investigate systemic root cause. Consider initiating RCA if not already underway.',
      });

      cards.push(card);
      await insertQualityCard(card);
    }

    console.error(`[AI-QualityMonitor] Incident pattern check: ${patterns.length} systemic patterns identified`);
  } catch (err) {
    const msg = `Incident pattern check failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return { cards, errors };
}

/**
 * Check 4: Overdue CAPA Items
 * Detects corrective action plan items overdue for implementation
 */
export async function checkOverdueCAPAs(
  hospital_id: string
): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();
    const now = new Date().toISOString();

    const overdueCapas = await sql`
      SELECT
        rci.id,
        rci.action_description,
        rci.capa_status,
        rci.target_implementation_date,
        rci.responsible_user_id,
        ri.rci_investigation_type,
        ri.rci_investigation_title,
        (DATE(now()) - DATE(rci.target_implementation_date))::int as days_overdue
      FROM rca_capa_items rci
      LEFT JOIN rca_investigations ri ON rci.rci_rca_id = ri.id
      WHERE rci.hospital_id = ${hospital_id}
        AND rci.capa_status NOT IN ('completed', 'closed')
        AND rci.target_implementation_date < ${now}
      ORDER BY rci.target_implementation_date ASC
      LIMIT 50
    `;

    for (const c of overdueCapas as any[]) {
      const daysOverdue = c.days_overdue || 0;
      const severity: CardSeverity = daysOverdue >= 7 ? 'high' : 'medium';
      const investigationType = c.rci_investigation_type || 'Investigation';

      const card = buildQualityCard(hospital_id, {
        severity,
        title: `Overdue CAPA: ${c.action_description.substring(0, 50)}...`,
        body: `${daysOverdue} days overdue. Action: ${c.action_description}. Status: ${c.capa_status}. Original target: ${new Date(c.target_implementation_date).toLocaleDateString()}.`,
        explanation: `Corrective action from ${investigationType} is overdue for implementation. Track and expedite closure to maintain patient safety and regulatory compliance.`,
        data_sources: ['rca_capa_items', 'rca_investigations'],
        action_url: `/admin/quality/rca/${c.id}`,
        suggested_action: `Update implementation timeline or close if action is complete. Responsible: User ID ${c.responsible_user_id}`,
      });

      cards.push(card);
      await insertQualityCard(card);
    }

    console.error(`[AI-QualityMonitor] Overdue CAPA check: ${overdueCapas.length} overdue items found`);
  } catch (err) {
    const msg = `Overdue CAPA check failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return { cards, errors };
}

/**
 * Check 5: Open Safety Findings
 * Detects safety round findings overdue for closure
 */
export async function checkOpenSafetyFindings(
  hospital_id: string
): Promise<{ cards: InsightCard[]; errors: string[] }> {
  const cards: InsightCard[] = [];
  const errors: string[] = [];

  try {
    const sql = getSql();
    const now = new Date().toISOString();

    const openFindings = await sql`
      SELECT
        srf.id,
        srf.checklist_item,
        srf.srf_severity,
        srf.srf_status,
        srf.target_closure_date,
        sr.srf_hospital_id,
        sr.srf_round_date,
        (DATE(now()) - DATE(srf.target_closure_date))::int as days_overdue
      FROM safety_round_findings srf
      LEFT JOIN safety_rounds sr ON srf.srf_safety_round_id = sr.id
      WHERE srf.hospital_id = ${hospital_id}
        AND srf.srf_status = 'open'
        AND srf.target_closure_date < ${now}
      ORDER BY srf.target_closure_date ASC
      LIMIT 50
    `;

    for (const f of openFindings as any[]) {
      const daysOverdue = f.days_overdue || 0;
      const isCritical = f.srf_severity === 'critical';
      const severity: CardSeverity = isCritical ? 'high' : 'medium';

      const card = buildQualityCard(hospital_id, {
        severity,
        title: `Overdue Safety Finding: ${f.checklist_item.substring(0, 50)}...`,
        body: `${daysOverdue} days overdue. Severity: ${f.srf_severity}. Finding from safety round on ${new Date(f.srf_round_date).toLocaleDateString()}. Target closure was ${new Date(f.target_closure_date).toLocaleDateString()}.`,
        explanation: 'Open safety findings overdue for closure require immediate attention to prevent escalation and maintain workplace safety standards.',
        data_sources: ['safety_round_findings', 'safety_rounds'],
        action_url: `/admin/quality/safety-findings/${f.id}`,
        suggested_action: 'Close finding if remediation complete, or update target closure date with justification.',
      });

      cards.push(card);
      await insertQualityCard(card);
    }

    console.error(`[AI-QualityMonitor] Open safety findings check: ${openFindings.length} overdue findings found`);
  } catch (err) {
    const msg = `Open safety findings check failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return { cards, errors };
}

/**
 * Main active monitoring orchestrator
 * Runs all 5 quality checks and aggregates results
 */
export async function runActiveMonitoring(hospital_id: string): Promise<{
  cards: InsightCard[];
  checks_run: number;
  alerts_generated: number;
  errors: string[];
}> {
  const allCards: InsightCard[] = [];
  const allErrors: string[] = [];
  let checksRun = 0;

  try {
    console.error(`[AI-QualityMonitor] Starting active quality monitoring for hospital ${hospital_id}`);

    // Check 1: New HAI Cases
    try {
      const { cards: haiCards, errors: haiErrors } = await checkNewHAICases(hospital_id);
      allCards.push(...haiCards);
      allErrors.push(...haiErrors);
      checksRun++;
    } catch (err) {
      const msg = `HAI check failed: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      console.error(`[AI-QualityMonitor] ${msg}`);
    }

    // Check 2: Medication Safety
    try {
      const { cards: medCards, errors: medErrors } = await checkMedicationSafety(hospital_id);
      allCards.push(...medCards);
      allErrors.push(...medErrors);
      checksRun++;
    } catch (err) {
      const msg = `Medication safety check failed: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      console.error(`[AI-QualityMonitor] ${msg}`);
    }

    // Check 3: Incident Patterns
    try {
      const { cards: patternCards, errors: patternErrors } = await checkIncidentPatterns(hospital_id);
      allCards.push(...patternCards);
      allErrors.push(...patternErrors);
      checksRun++;
    } catch (err) {
      const msg = `Incident pattern check failed: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      console.error(`[AI-QualityMonitor] ${msg}`);
    }

    // Check 4: Overdue CAPAs
    try {
      const { cards: capaCards, errors: capaErrors } = await checkOverdueCAPAs(hospital_id);
      allCards.push(...capaCards);
      allErrors.push(...capaErrors);
      checksRun++;
    } catch (err) {
      const msg = `Overdue CAPA check failed: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      console.error(`[AI-QualityMonitor] ${msg}`);
    }

    // Check 5: Open Safety Findings
    try {
      const { cards: safetyCards, errors: safetyErrors } = await checkOpenSafetyFindings(hospital_id);
      allCards.push(...safetyCards);
      allErrors.push(...safetyErrors);
      checksRun++;
    } catch (err) {
      const msg = `Open safety findings check failed: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      console.error(`[AI-QualityMonitor] ${msg}`);
    }

    console.error(
      `[AI-QualityMonitor] Completed: ${checksRun}/5 checks, ${allCards.length} alerts generated, ${allErrors.length} errors`
    );
  } catch (err) {
    const msg = `Active monitoring failed: ${err instanceof Error ? err.message : String(err)}`;
    allErrors.push(msg);
    console.error(`[AI-QualityMonitor] ${msg}`);
  }

  return {
    cards: allCards,
    checks_run: checksRun,
    alerts_generated: allCards.length,
    errors: allErrors,
  };
}
