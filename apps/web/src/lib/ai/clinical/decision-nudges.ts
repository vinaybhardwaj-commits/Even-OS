import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';

let _sql: any = null;

function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Helper: build a partial InsightCard for clinical nudges
// ============================================================================

function buildNudgeCard(
  hospital_id: string,
  opts: {
    target_patient_id: string;
    target_encounter_id: string;
    severity: CardSeverity;
    title: string;
    body: string;
    action_url: string;
    explanation: string;
    data_sources: string[];
  }
): InsightCard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hospital_id,
    module: 'clinical',
    category: 'alert',
    severity: opts.severity,
    title: opts.title,
    body: opts.body,
    explanation: opts.explanation,
    data_sources: opts.data_sources,
    action_url: opts.action_url,
    confidence: 0.85,
    source: 'template',
    status: 'active',
    target_patient_id: opts.target_patient_id,
    target_encounter_id: opts.target_encounter_id,
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Insert insight card into ai_insight_cards table
// ============================================================================

async function insertInsightCard(card: InsightCard): Promise<InsightCard> {
  const sql = getSql();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity,
        title, body, explanation, data_sources, suggested_action, action_url,
        confidence, source, status,
        target_patient_id, target_encounter_id,
        created_at, expires_at
      ) VALUES (
        ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
        ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)}, ${card.suggested_action || null}, ${card.action_url || null},
        ${card.confidence}, ${card.source}, ${card.status},
        ${card.target_patient_id || null}, ${card.target_encounter_id || null},
        ${now}, ${expiresAt}
      )
    `;

    return { ...card, created_at: now.toISOString() };
  } catch (err) {
    console.error(`[AI] Failed to insert insight card: ${(err as Error).message}`);
    throw err;
  }
}

// ============================================================================
// 1. NEWS2 Deterioration Alert Check
// ============================================================================

export async function checkNEWS2Alerts(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const result = await sql`
      SELECT
        e.id as encounter_id,
        e.patient_id,
        e.ward_name,
        p.first_name,
        p.last_name,
        o.value_numeric,
        o.recorded_at
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      JOIN observations o ON e.id = o.encounter_id
      WHERE e.hospital_id = ${hospital_id}
        AND e.status = 'admitted'
        AND o.observation_type = 'NEWS2'
      ORDER BY e.id, o.recorded_at DESC
    `;

    interface NEWS2Row {
      encounter_id: string;
      patient_id: string;
      ward_name: string;
      first_name: string;
      last_name: string;
      value_numeric: number;
      recorded_at: Date;
    }

    const rows = result as NEWS2Row[];

    const encounterMap = new Map<string, NEWS2Row[]>();
    rows.forEach((row: NEWS2Row) => {
      if (!encounterMap.has(row.encounter_id)) {
        encounterMap.set(row.encounter_id, []);
      }
      encounterMap.get(row.encounter_id)!.push(row);
    });

    for (const [encounterId, scores] of encounterMap.entries()) {
      if (scores.length === 0) continue;

      const current = scores[0];
      const previous = scores[1];
      const currentScore = current.value_numeric || 0;
      const previousScore = previous?.value_numeric || 0;
      const trend =
        currentScore > previousScore
          ? 'rising'
          : currentScore < previousScore
            ? 'falling'
            : 'stable';

      let severity: CardSeverity = 'low';
      if (currentScore >= 9) {
        severity = 'critical';
      } else if (currentScore >= 7) {
        severity = 'high';
      } else if (currentScore >= 5) {
        severity = 'medium';
      }

      if (severity !== 'low') {
        cards.push(
          buildNudgeCard(hospital_id, {
            target_patient_id: current.patient_id,
            target_encounter_id: encounterId,
            severity,
            title: `NEWS2 Alert — ${current.first_name} ${current.last_name} (${current.ward_name})`,
            body: `Current NEWS2: ${currentScore} | Trend: ${trend} | Previous: ${previousScore}`,
            action_url: `/encounters/${encounterId}/vitals`,
            explanation: `NEWS2 score of ${currentScore} detected (trend: ${trend}). Threshold: 5+ triggers alert.`,
            data_sources: ['observations', 'encounters'],
          })
        );
      }
    }
  } catch (err) {
    console.error(`[AI] NEWS2 alert check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 2. Overdue Lab Orders Check
// ============================================================================

export async function checkOverdueLabOrders(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const now = new Date();
    const result = await sql`
      SELECT
        sr.id as request_id,
        sr.encounter_id,
        sr.request_type,
        sr.created_at,
        e.patient_id,
        p.first_name,
        p.last_name
      FROM service_requests sr
      JOIN encounters e ON sr.encounter_id = e.id
      JOIN patients p ON e.patient_id = p.id
      WHERE e.hospital_id = ${hospital_id}
        AND sr.request_type = 'lab'
        AND sr.status = 'ordered'
        AND sr.created_at < ${new Date(now.getTime() - 6 * 60 * 60 * 1000)}
      ORDER BY sr.created_at ASC
    `;

    interface LabRow {
      request_id: string;
      encounter_id: string;
      patient_id: string;
      first_name: string;
      last_name: string;
      created_at: Date;
    }

    const rows = result as LabRow[];

    rows.forEach((row: LabRow) => {
      const hoursSinceCreation = (now.getTime() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);

      let severity: CardSeverity = 'medium';
      if (hoursSinceCreation >= 24) {
        severity = 'critical';
      } else if (hoursSinceCreation >= 12) {
        severity = 'high';
      }

      cards.push(
        buildNudgeCard(hospital_id, {
          target_patient_id: row.patient_id,
          target_encounter_id: row.encounter_id,
          severity,
          title: `Overdue Lab — ${row.first_name} ${row.last_name}`,
          body: `Lab order pending for ${Math.round(hoursSinceCreation)} hours`,
          action_url: `/encounters/${row.encounter_id}/service-requests`,
          explanation: `Lab request ${row.request_id} has been in 'ordered' status for ${Math.round(hoursSinceCreation)} hours (>6h threshold).`,
          data_sources: ['service_requests', 'encounters'],
        })
      );
    });
  } catch (err) {
    console.error(`[AI] Overdue lab orders check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 3. Unverified Medication Allergies Check
// ============================================================================

export async function checkUnverifiedAllergyMeds(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const result = await sql`
      SELECT
        mo.id as order_id,
        mo.encounter_id,
        mo.drug_name,
        mo.dose,
        mo.allergy_verified,
        e.patient_id,
        p.first_name,
        p.last_name
      FROM medication_orders mo
      JOIN encounters e ON mo.encounter_id = e.id
      JOIN patients p ON e.patient_id = p.id
      WHERE e.hospital_id = ${hospital_id}
        AND mo.status IN ('ordered', 'active')
        AND (mo.allergy_verified IS NULL OR mo.allergy_verified = false)
      ORDER BY mo.created_at DESC
    `;

    interface MedRow {
      order_id: string;
      encounter_id: string;
      patient_id: string;
      drug_name: string;
      dose: string;
      allergy_verified: boolean | null;
      first_name: string;
      last_name: string;
    }

    const medRows = result as MedRow[];

    for (const med of medRows) {
      let hasConflict = false;

      try {
        const allergyResult = await sql`
          SELECT substance FROM allergies
          WHERE patient_id = ${med.patient_id}
            AND (substance ILIKE ${`%${med.drug_name}%`} OR substance ILIKE ${`%${med.drug_name.split(' ')[0]}%`})
          LIMIT 1
        `;

        interface AllergyRow {
          substance: string;
        }

        if ((allergyResult as AllergyRow[]).length > 0) {
          hasConflict = true;
        }
      } catch (allergyErr) {
        console.error(`[AI] Failed to check allergies for patient ${med.patient_id}: ${(allergyErr as Error).message}`);
      }

      const severity: CardSeverity = hasConflict ? 'critical' : 'medium';

      cards.push(
        buildNudgeCard(hospital_id, {
          target_patient_id: med.patient_id,
          target_encounter_id: med.encounter_id,
          severity,
          title: `Allergy Check Needed — ${med.drug_name}`,
          body: hasConflict
            ? `Patient has documented allergy. Verify before administering ${med.drug_name} (${med.dose})`
            : `Allergy verification pending for ${med.drug_name} (${med.dose})`,
          action_url: `/encounters/${med.encounter_id}/medications`,
          explanation: hasConflict
            ? `Documented allergy conflict found for ${med.drug_name}. Allergy verification is missing on order ${med.order_id}.`
            : `Allergy verification not completed for ${med.drug_name} (order ${med.order_id}).`,
          data_sources: ['medication_orders', 'allergies'],
        })
      );
    }
  } catch (err) {
    console.error(`[AI] Unverified allergy check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 4. Overdue Clinical Notes Check
// ============================================================================

export async function checkOverdueClinicalNotes(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const result = await sql`
      SELECT
        e.id as encounter_id,
        e.patient_id,
        e.ward_name,
        p.first_name,
        p.last_name,
        MAX(ci.signed_at) as last_note_at
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      LEFT JOIN clinical_impressions ci ON e.id = ci.encounter_id AND ci.status = 'signed'
      WHERE e.hospital_id = ${hospital_id}
        AND e.status = 'admitted'
      GROUP BY e.id, e.patient_id, e.ward_name, p.first_name, p.last_name
      HAVING MAX(ci.signed_at) IS NULL OR MAX(ci.signed_at) < ${oneDayAgo}
      ORDER BY e.admitted_at ASC
    `;

    interface NoteRow {
      encounter_id: string;
      patient_id: string;
      ward_name: string;
      first_name: string;
      last_name: string;
      last_note_at: Date | null;
    }

    const rows = result as NoteRow[];

    rows.forEach((row: NoteRow) => {
      const hoursSinceNote = row.last_note_at
        ? (now.getTime() - new Date(row.last_note_at).getTime()) / (1000 * 60 * 60)
        : 999;

      let severity: CardSeverity = 'medium';
      if (hoursSinceNote >= 48) {
        severity = 'high';
      }

      cards.push(
        buildNudgeCard(hospital_id, {
          target_patient_id: row.patient_id,
          target_encounter_id: row.encounter_id,
          severity,
          title: `Overdue Notes — ${row.first_name} ${row.last_name}`,
          body: row.last_note_at
            ? `Last clinical note: ${Math.round(hoursSinceNote)} hours ago`
            : 'No signed clinical notes yet',
          action_url: `/encounters/${row.encounter_id}/clinical-notes`,
          explanation: `Admitted patient has ${row.last_note_at ? `no note in ${Math.round(hoursSinceNote)} hours` : 'no signed clinical notes'}. Expected: at least one note per 24h.`,
          data_sources: ['clinical_impressions', 'encounters'],
        })
      );
    });
  } catch (err) {
    console.error(`[AI] Overdue clinical notes check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 5. Overdue Care Pathway Milestones Check
// ============================================================================

export async function checkOverduePathwayMilestones(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const now = new Date();

    const result = await sql`
      SELECT
        cpm.id as milestone_id,
        cpm.care_plan_id,
        cpm.status,
        cpm.due_date,
        cp.encounter_id,
        e.patient_id,
        p.first_name,
        p.last_name
      FROM care_plan_milestones cpm
      JOIN care_plans cp ON cpm.care_plan_id = cp.id
      JOIN encounters e ON cp.encounter_id = e.id
      JOIN patients p ON e.patient_id = p.id
      WHERE e.hospital_id = ${hospital_id}
        AND cpm.status != 'completed'
        AND cpm.due_date < ${now}
      ORDER BY cpm.due_date ASC
    `;

    interface MilestoneRow {
      milestone_id: string;
      care_plan_id: string;
      encounter_id: string;
      patient_id: string;
      first_name: string;
      last_name: string;
      due_date: Date;
      status: string;
    }

    const rows = result as MilestoneRow[];

    rows.forEach((row: MilestoneRow) => {
      const hoursOverdue = (now.getTime() - new Date(row.due_date).getTime()) / (1000 * 60 * 60);

      let severity: CardSeverity = 'medium';
      if (hoursOverdue >= 72) {
        severity = 'critical';
      } else if (hoursOverdue >= 24) {
        severity = 'high';
      }

      cards.push(
        buildNudgeCard(hospital_id, {
          target_patient_id: row.patient_id,
          target_encounter_id: row.encounter_id,
          severity,
          title: `Pathway Milestone Overdue — ${row.first_name} ${row.last_name}`,
          body: `Milestone status: ${row.status} | ${Math.round(hoursOverdue)} hours overdue`,
          action_url: `/encounters/${row.encounter_id}/care-plan`,
          explanation: `Milestone ${row.milestone_id} on care plan ${row.care_plan_id} is ${Math.round(hoursOverdue)} hours past due date.`,
          data_sources: ['care_plan_milestones', 'care_plans'],
        })
      );
    });
  } catch (err) {
    console.error(`[AI] Overdue pathway milestones check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 6. Vital Sign Trend Alert Check
// ============================================================================

export async function checkVitalTrends(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const result = await sql`
      SELECT
        e.id as encounter_id,
        e.patient_id,
        e.ward_name,
        p.first_name,
        p.last_name,
        o.observation_type,
        o.value_numeric,
        o.recorded_at,
        ROW_NUMBER() OVER (PARTITION BY e.id, o.observation_type ORDER BY o.recorded_at DESC) as rn
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      JOIN observations o ON e.id = o.encounter_id
      WHERE e.hospital_id = ${hospital_id}
        AND e.status = 'admitted'
        AND o.observation_type IN ('temperature', 'pulse', 'spo2', 'respiratory_rate')
      ORDER BY e.id, o.observation_type, o.recorded_at DESC
    `;

    interface VitalRow {
      encounter_id: string;
      patient_id: string;
      ward_name: string;
      first_name: string;
      last_name: string;
      observation_type: string;
      value_numeric: number;
      recorded_at: Date;
      rn: number;
    }

    const allRows = result as VitalRow[];

    const vitalMap = new Map<string, Map<string, VitalRow[]>>();

    allRows.forEach((row: VitalRow) => {
      if (row.rn <= 3) {
        if (!vitalMap.has(row.encounter_id)) {
          vitalMap.set(row.encounter_id, new Map());
        }
        const vitalTypeMap = vitalMap.get(row.encounter_id)!;
        if (!vitalTypeMap.has(row.observation_type)) {
          vitalTypeMap.set(row.observation_type, []);
        }
        vitalTypeMap.get(row.observation_type)!.push(row);
      }
    });

    for (const [encounterId, vitalTypeMap] of vitalMap.entries()) {
      const firstRow = allRows.find((r: VitalRow) => r.encounter_id === encounterId && r.rn === 1);
      if (!firstRow) continue;

      for (const [vitalType, observations] of vitalTypeMap.entries()) {
        if (observations.length < 2) continue;

        const values = observations.map((o: VitalRow) => o.value_numeric).reverse();
        let alertType: string | null = null;
        let severity: CardSeverity = 'medium';

        if (values.length === 3) {
          const deteriorating = (values[0] < values[1] && values[1] < values[2]) ||
            (values[0] > values[1] && values[1] > values[2]);
          if (deteriorating) {
            alertType = `${vitalType} deteriorating trend`;
            severity = 'medium';
          }
        }

        const current = values[0];
        if (vitalType === 'temperature' && current > 38.5) {
          alertType = 'High fever';
          severity = 'high';
        } else if (vitalType === 'pulse' && current > 110) {
          alertType = 'Tachycardia';
          severity = 'high';
        } else if (vitalType === 'spo2' && current < 94) {
          alertType = 'Low SpO2';
          severity = 'high';
        } else if (vitalType === 'respiratory_rate' && current > 24) {
          alertType = 'High respiratory rate';
          severity = 'high';
        }

        if (alertType) {
          cards.push(
            buildNudgeCard(hospital_id, {
              target_patient_id: firstRow.patient_id,
              target_encounter_id: encounterId,
              severity,
              title: `Vital Trend Alert — ${firstRow.first_name} ${firstRow.last_name}`,
              body: `${alertType}: ${current} (${vitalType})`,
              action_url: `/encounters/${encounterId}/vitals`,
              explanation: `${alertType} detected for ${vitalType}. Current: ${current}. Recent values: ${values.join(', ')}.`,
              data_sources: ['observations', 'encounters'],
            })
          );
        }
      }
    }
  } catch (err) {
    console.error(`[AI] Vital trend check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// 7. Missing Consent for Scheduled Procedure Check
// ============================================================================

export async function checkMissingConsents(hospital_id: string): Promise<InsightCard[]> {
  const sql = getSql();
  const cards: InsightCard[] = [];

  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const result = await sql`
      SELECT
        p.id as procedure_id,
        p.encounter_id,
        p.procedure_name,
        p.scheduled_at,
        e.patient_id,
        pt.first_name,
        pt.last_name
      FROM procedures p
      JOIN encounters e ON p.encounter_id = e.id
      JOIN patients pt ON e.patient_id = pt.id
      WHERE e.hospital_id = ${hospital_id}
        AND p.status IN ('preparation', 'scheduled')
        AND p.scheduled_at BETWEEN ${now} AND ${tomorrow}
      ORDER BY p.scheduled_at ASC
    `;

    interface ProcedureRow {
      procedure_id: string;
      encounter_id: string;
      patient_id: string;
      procedure_name: string;
      scheduled_at: Date;
      first_name: string;
      last_name: string;
    }

    const procRows = result as ProcedureRow[];

    for (const proc of procRows) {
      try {
        const consentResult = await sql`
          SELECT id FROM patient_consents
          WHERE encounter_id = ${proc.encounter_id}
            AND procedure_id = ${proc.procedure_id}
            AND status = 'signed'
          LIMIT 1
        `;

        interface ConsentRow {
          id: string;
        }

        if ((consentResult as ConsentRow[]).length === 0) {
          cards.push(
            buildNudgeCard(hospital_id, {
              target_patient_id: proc.patient_id,
              target_encounter_id: proc.encounter_id,
              severity: 'high',
              title: `Missing Consent — ${proc.procedure_name}`,
              body: `${proc.procedure_name} scheduled for ${new Date(proc.scheduled_at).toLocaleString()} without signed consent`,
              action_url: `/encounters/${proc.encounter_id}/consents`,
              explanation: `Procedure ${proc.procedure_name} (${proc.procedure_id}) is scheduled within 24h but has no signed consent on file.`,
              data_sources: ['procedures', 'patient_consents'],
            })
          );
        }
      } catch (consentErr) {
        console.error(
          `[AI] Failed to check consent for procedure ${proc.procedure_id}: ${(consentErr as Error).message}`
        );
      }
    }
  } catch (err) {
    console.error(`[AI] Missing consent check failed: ${(err as Error).message}`);
  }

  return cards;
}

// ============================================================================
// Main clinical nudge scan runner
// ============================================================================

export async function runClinicalNudgeScan(hospital_id: string): Promise<{
  cards: InsightCard[];
  checks_run: number;
  alerts_generated: number;
  errors: string[];
}> {
  const allCards: InsightCard[] = [];
  const errors: string[] = [];

  const checks: Array<() => Promise<InsightCard[]>> = [
    () => checkNEWS2Alerts(hospital_id),
    () => checkOverdueLabOrders(hospital_id),
    () => checkUnverifiedAllergyMeds(hospital_id),
    () => checkOverdueClinicalNotes(hospital_id),
    () => checkOverduePathwayMilestones(hospital_id),
    () => checkVitalTrends(hospital_id),
    () => checkMissingConsents(hospital_id),
  ];

  for (const check of checks) {
    try {
      const cards = await check();
      allCards.push(...cards);
    } catch (err) {
      const errorMsg = `Check failed: ${(err as Error).message}`;
      errors.push(errorMsg);
      console.error(`[AI] ${errorMsg}`);
    }
  }

  // Insert all cards into database
  let successCount = 0;
  for (const card of allCards) {
    try {
      await insertInsightCard(card);
      successCount++;
    } catch (insertErr) {
      const errorMsg = `Failed to insert card (${card.title}): ${(insertErr as Error).message}`;
      errors.push(errorMsg);
    }
  }

  return {
    cards: allCards,
    checks_run: checks.length,
    alerts_generated: successCount,
    errors,
  };
}
