/**
 * Even AI — NABH Readiness Scoring Engine
 * Quality Module (Module 13) — AI.4 Phase
 *
 * Simulates a NABH assessor by scoring the hospital against 6 key NABH chapters:
 * 1. COP (Care of Patients)
 * 2. MOM (Management of Medication)
 * 3. IPC (Infection Prevention & Control)
 * 4. PRE (Patient Rights & Education)
 * 5. FMS (Facility Management & Safety)
 * 6. QI (Quality Improvement)
 *
 * Features:
 * - Template-based scoring per chapter with 3 sub-checks each
 * - LLM enhancement for narrative summaries and recommendations
 * - Graceful error handling per chapter (one failure doesn't block others)
 * - InsightCard generation for admin dashboards
 * - Daily cron or on-demand execution
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

import type { InsightCard, CardSeverity } from '../types';
import { generateInsight } from '../llm-client';

// ============================================================================
// Lazy Singleton
// ============================================================================

let _sql: any = null;

/**
 * Get or create the Neon SQL client (lazy singleton)
 */
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Single chapter scoring result with sub-checks and findings
 */
export interface ChapterScore {
  chapter: string;
  score: number; // 0-100
  max_score: number;
  status: 'pass' | 'warning' | 'fail'; // >=80 pass, 60-79 warning, <60 fail
  findings: string[];
}

/**
 * Top gap identified across all chapters
 */
export interface NabhGap {
  chapter: string;
  gap: string;
  recommendation: string;
}

/**
 * Complete NABH audit result
 */
export interface NabhAuditResult {
  hospital_id: string;
  score_date: string;
  overall_score: number;
  chapter_scores: ChapterScore[];
  top_gaps: NabhGap[];
  action_items: string[];
  card: InsightCard;
}

/**
 * Stored NABH readiness score (matches nabh_readiness_scores table)
 */
export interface NabhReadinessScore {
  id: string;
  hospital_id: string;
  score_date: string;
  overall_score: number;
  chapter_scores: ChapterScore[];
  top_gaps: NabhGap[];
  action_items_generated: number;
  source: 'llm' | 'template';
  created_at: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Score a percentage value using graduated scoring:
 * - 100% = 33pts
 * - 80% = 25pts
 * - 60% = 15pts
 * - <60% = 5pts
 */
function scorePercentage(percentage: number, maxPoints: number = 33): number {
  if (percentage >= 100) return maxPoints;
  if (percentage >= 80) return Math.round((maxPoints / 33) * 25);
  if (percentage >= 60) return Math.round((maxPoints / 33) * 15);
  if (percentage < 60) return Math.round((maxPoints / 33) * 5);
  return 0;
}

/**
 * Determine severity status from score
 */
function getStatus(score: number): 'pass' | 'warning' | 'fail' {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
}

/**
 * Map severity to card severity
 */
function mapToCardSeverity(status: 'pass' | 'warning' | 'fail'): CardSeverity {
  if (status === 'pass') return 'low';
  if (status === 'warning') return 'high';
  return 'critical';
}

// ============================================================================
// Chapter 1: Care of Patients (COP)
// ============================================================================

async function scoreCOP(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: Care pathway adherence
    let pathwayScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN cp.id IS NOT NULL THEN 1 ELSE 0 END) as with_pathway
        FROM encounters e
        LEFT JOIN care_plans cp ON e.id = cp.encounter_id AND cp.status IN ('active', 'completed')
        WHERE e.hospital_id = ${hospital_id}
          AND e.admission_timestamp >= NOW() - INTERVAL '30 days'
          AND e.encounter_type IN ('inpatient', 'critical_care')
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const withPathway = Number(row.with_pathway) || 0;
      const percentage = total > 0 ? (withPathway / total) * 100 : 0;
      pathwayScore = scorePercentage(percentage);

      if (percentage < 100) {
        findings.push(`Care pathway adherence: ${percentage.toFixed(0)}% of encounters (target: 100%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring pathway adherence:', err);
      findings.push('Could not assess care pathway adherence');
      pathwayScore = 5;
    }

    // Sub-check 2: Informed consent completion
    let consentScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN signed_at IS NOT NULL THEN 1 ELSE 0 END) as signed
        FROM patient_consents
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
          AND consent_type IN ('treatment', 'procedure')
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const signed = Number(row.signed) || 0;
      const percentage = total > 0 ? (signed / total) * 100 : 0;
      consentScore = scorePercentage(percentage);

      if (percentage < 100) {
        findings.push(`Informed consent completion: ${percentage.toFixed(0)}% of consents signed (target: 100%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring consent completion:', err);
      findings.push('Could not assess informed consent completion');
      consentScore = 5;
    }

    // Sub-check 3: Clinical documentation (notes in last 24h)
    let docScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(DISTINCT e.id) as total_encounters,
          SUM(CASE WHEN cn.id IS NOT NULL THEN 1 ELSE 0 END) as with_notes
        FROM encounters e
        LEFT JOIN clinical_notes cn ON e.id = cn.encounter_id
          AND cn.created_at >= NOW() - INTERVAL '24 hours'
        WHERE e.hospital_id = ${hospital_id}
          AND e.admission_timestamp >= NOW() - INTERVAL '7 days'
          AND e.encounter_type IN ('inpatient', 'critical_care')
          AND e.status IN ('active', 'pending_discharge')
      `;

      const row = result[0];
      const total = Number(row.total_encounters) || 0;
      const withNotes = Number(row.with_notes) || 0;
      const percentage = total > 0 ? (withNotes / total) * 100 : 0;
      docScore = scorePercentage(percentage);

      if (percentage < 95) {
        findings.push(`Clinical documentation currency: ${percentage.toFixed(0)}% of active encounters documented in last 24h (target: 95%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring documentation:', err);
      findings.push('Could not assess clinical documentation timeliness');
      docScore = 5;
    }

    const copScore = Math.min(100, pathwayScore + consentScore + docScore);
    return {
      chapter: 'COP',
      score: copScore,
      max_score: 100,
      status: getStatus(copScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in COP chapter:', err);
    return {
      chapter: 'COP',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['COP assessment failed'],
    };
  }
}

// ============================================================================
// Chapter 2: Management of Medication (MOM)
// ============================================================================

async function scoreMOM(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: Unverified medication orders
    let verificationScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN allergy_verified = true THEN 1 ELSE 0 END) as verified
        FROM medication_orders
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const verified = Number(row.verified) || 0;
      const percentage = total > 0 ? (verified / total) * 100 : 100;
      verificationScore = scorePercentage(percentage);

      if (percentage < 100) {
        findings.push(`Unverified medication orders: ${(100 - percentage).toFixed(0)}% of orders (target: 0%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring medication verification:', err);
      findings.push('Could not assess medication order verification');
      verificationScore = 5;
    }

    // Sub-check 2: Antibiotic overuse (>7 days without review)
    let antibioticScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as overdue_reviews,
          SUM(mo.qty) as total_doses_pending_review
        FROM medication_orders mo
        WHERE mo.hospital_id = ${hospital_id}
          AND mo.medication_type = 'antibiotic'
          AND mo.created_at >= NOW() - INTERVAL '30 days'
          AND (mo.last_reviewed_at IS NULL OR mo.last_reviewed_at < NOW() - INTERVAL '7 days')
      `;

      const row = result[0];
      const overdueCount = Number(row.overdue_reviews) || 0;

      if (overdueCount === 0) {
        antibioticScore = 33;
      } else if (overdueCount <= 5) {
        antibioticScore = 20;
        findings.push(`Antibiotic overuse: ${overdueCount} orders pending review >7 days`);
      } else {
        antibioticScore = 5;
        findings.push(`Antibiotic overuse: ${overdueCount} orders overdue for 7+ day review`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring antibiotic compliance:', err);
      findings.push('Could not assess antibiotic stewardship');
      antibioticScore = 5;
    }

    // Sub-check 3: Medication errors in last 30 days
    let errorScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as error_count
        FROM medication_errors
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const errorCount = Number(result[0]?.error_count) || 0;

      if (errorCount === 0) {
        errorScore = 33;
      } else if (errorCount <= 2) {
        errorScore = 20;
        findings.push(`Medication errors: ${errorCount} events in last 30 days`);
      } else {
        errorScore = 5;
        findings.push(`Medication errors: ${errorCount} events in last 30 days (target: 0)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring medication errors:', err);
      findings.push('Could not assess medication error rate');
      errorScore = 5;
    }

    const momScore = Math.min(100, verificationScore + antibioticScore + errorScore);
    return {
      chapter: 'MOM',
      score: momScore,
      max_score: 100,
      status: getStatus(momScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in MOM chapter:', err);
    return {
      chapter: 'MOM',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['MOM assessment failed'],
    };
  }
}

// ============================================================================
// Chapter 3: Infection Prevention & Control (IPC)
// ============================================================================

async function scoreIPC(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: HAI cases in last 30 days
    let haiScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as hai_count
        FROM infection_surveillance
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
          AND is_hai = true
      `;

      const haiCount = Number(result[0]?.hai_count) || 0;

      if (haiCount === 0) {
        haiScore = 33;
      } else if (haiCount <= 2) {
        haiScore = 20;
        findings.push(`HAI cases detected: ${haiCount} in last 30 days`);
      } else {
        haiScore = 5;
        findings.push(`HAI cases: ${haiCount} in last 30 days (target: 0)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring HAI surveillance:', err);
      findings.push('Could not assess HAI surveillance data');
      haiScore = 5;
    }

    // Sub-check 2: Safety rounds completion rate
    let safetyRoundScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total_scheduled,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM safety_rounds
        WHERE hospital_id = ${hospital_id}
          AND scheduled_date >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total_scheduled) || 0;
      const completed = Number(row.completed) || 0;
      const percentage = total > 0 ? (completed / total) * 100 : 0;
      safetyRoundScore = scorePercentage(percentage, 33);

      if (percentage < 90) {
        findings.push(`Safety rounds completion: ${percentage.toFixed(0)}% (target: 90%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring safety rounds:', err);
      findings.push('Could not assess safety rounds completion');
      safetyRoundScore = 5;
    }

    // Sub-check 3: Antibiotic resistance monitoring
    let resistanceScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total_organisms,
          SUM(CASE WHEN resistance_percentage >= 50 THEN 1 ELSE 0 END) as highly_resistant
        FROM antibiogram_results
        WHERE hospital_id = ${hospital_id}
          AND period_end >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total_organisms) || 0;
      const highResistance = Number(row.highly_resistant) || 0;

      if (highResistance === 0 || total === 0) {
        resistanceScore = 33;
      } else {
        const resistantPct = (highResistance / total) * 100;
        if (resistantPct <= 20) {
          resistanceScore = 25;
        } else {
          resistanceScore = 5;
          findings.push(`High antibiotic resistance: ${resistantPct.toFixed(0)}% of organisms`);
        }
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring resistance monitoring:', err);
      findings.push('Could not assess antibiotic resistance patterns');
      resistanceScore = 5;
    }

    const ipcScore = Math.min(100, haiScore + safetyRoundScore + resistanceScore);
    return {
      chapter: 'IPC',
      score: ipcScore,
      max_score: 100,
      status: getStatus(ipcScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in IPC chapter:', err);
    return {
      chapter: 'IPC',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['IPC assessment failed'],
    };
  }
}

// ============================================================================
// Chapter 4: Patient Rights & Education (PRE)
// ============================================================================

async function scorePRE(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: Informed consent completion
    let consentScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN signed_at IS NOT NULL THEN 1 ELSE 0 END) as signed
        FROM patient_consents
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const signed = Number(row.signed) || 0;
      const percentage = total > 0 ? (signed / total) * 100 : 0;
      consentScore = scorePercentage(percentage);

      if (percentage < 100) {
        findings.push(`Informed consent completion: ${percentage.toFixed(0)}% (target: 100%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring consent:', err);
      findings.push('Could not assess patient consent');
      consentScore = 5;
    }

    // Sub-check 2: Complaint response rate (using sewa_complaints)
    let complaintScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
        FROM sewa_complaints
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const resolved = Number(row.resolved) || 0;
      const percentage = total > 0 ? (resolved / total) * 100 : 100;
      complaintScore = scorePercentage(percentage);

      if (percentage < 90) {
        findings.push(`Complaint response rate: ${percentage.toFixed(0)}% resolved (target: 90%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring complaint response:', err);
      findings.push('Could not assess complaint resolution');
      complaintScore = 5;
    }

    // Sub-check 3: Open complaints
    let openComplaintScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as open_count
        FROM sewa_complaints
        WHERE hospital_id = ${hospital_id}
          AND status != 'resolved'
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const openCount = Number(result[0]?.open_count) || 0;

      if (openCount === 0) {
        openComplaintScore = 33;
      } else if (openCount <= 5) {
        openComplaintScore = 20;
      } else {
        openComplaintScore = 5;
        findings.push(`Open complaints: ${openCount} pending resolution`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring open complaints:', err);
      findings.push('Could not assess open complaint count');
      openComplaintScore = 5;
    }

    const preScore = Math.min(100, consentScore + complaintScore + openComplaintScore);
    return {
      chapter: 'PRE',
      score: preScore,
      max_score: 100,
      status: getStatus(preScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in PRE chapter:', err);
    return {
      chapter: 'PRE',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['PRE assessment failed'],
    };
  }
}

// ============================================================================
// Chapter 5: Facility Management & Safety (FMS)
// ============================================================================

async function scoreFMS(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: Safety rounds completion rate
    let roundsScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM safety_rounds
        WHERE hospital_id = ${hospital_id}
          AND scheduled_date >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const total = Number(row.total) || 0;
      const completed = Number(row.completed) || 0;
      const percentage = total > 0 ? (completed / total) * 100 : 0;
      roundsScore = scorePercentage(percentage);

      if (percentage < 90) {
        findings.push(`Safety rounds completion: ${percentage.toFixed(0)}% (target: 90%)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring rounds completion:', err);
      findings.push('Could not assess safety rounds');
      roundsScore = 5;
    }

    // Sub-check 2: Open safety findings
    let findingsScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as open_count
        FROM safety_round_findings
        WHERE hospital_id = ${hospital_id}
          AND status = 'open'
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const openCount = Number(result[0]?.open_count) || 0;

      if (openCount === 0) {
        findingsScore = 33;
      } else if (openCount <= 10) {
        findingsScore = 20;
        findings.push(`Open safety findings: ${openCount}`);
      } else {
        findingsScore = 5;
        findings.push(`Open safety findings: ${openCount} (target: <5)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring open findings:', err);
      findings.push('Could not assess open safety findings');
      findingsScore = 5;
    }

    // Sub-check 3: Staff attendance metric
    let staffScore = 0;
    try {
      const result = await sql`
        SELECT
          AVG(CAST(staff_attendance_pct AS FLOAT)) as avg_attendance
        FROM dashboard_snapshots
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '7 days'
      `;

      const avgAttendance = Number(result[0]?.avg_attendance) || 0;
      const percentage = Math.max(0, Math.min(100, avgAttendance));
      staffScore = scorePercentage(percentage);

      if (percentage < 85) {
        findings.push(`Staff attendance: ${percentage.toFixed(0)}% average (target: 90%+)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring staff attendance:', err);
      findings.push('Could not assess staff attendance metrics');
      staffScore = 5;
    }

    const fmsScore = Math.min(100, roundsScore + findingsScore + staffScore);
    return {
      chapter: 'FMS',
      score: fmsScore,
      max_score: 100,
      status: getStatus(fmsScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in FMS chapter:', err);
    return {
      chapter: 'FMS',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['FMS assessment failed'],
    };
  }
}

// ============================================================================
// Chapter 6: Quality Improvement (QI)
// ============================================================================

async function scoreQI(hospital_id: string): Promise<ChapterScore> {
  const sql = getSql();
  const findings: string[] = [];

  try {
    // Sub-check 1: Adverse events and closure rate
    let incidentScore = 0;
    try {
      const result = await sql`
        SELECT
          COUNT(*) as total_events,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed
        FROM adverse_events
        WHERE hospital_id = ${hospital_id}
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const row = result[0];
      const totalEvents = Number(row.total_events) || 0;
      const closed = Number(row.closed) || 0;

      if (totalEvents === 0) {
        incidentScore = 33;
      } else {
        const closureRate = (closed / totalEvents) * 100;
        incidentScore = scorePercentage(closureRate);
        if (closureRate < 80) {
          findings.push(`Adverse event closure rate: ${closureRate.toFixed(0)}% (target: 80%+)`);
        }
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring adverse events:', err);
      findings.push('Could not assess adverse event closure');
      incidentScore = 5;
    }

    // Sub-check 2: Open RCA investigations
    let rcaScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as open_rca
        FROM rca_investigations
        WHERE hospital_id = ${hospital_id}
          AND status != 'rca_complete'
          AND created_at >= NOW() - INTERVAL '30 days'
      `;

      const openRCA = Number(result[0]?.open_rca) || 0;

      if (openRCA === 0) {
        rcaScore = 33;
      } else if (openRCA <= 3) {
        rcaScore = 20;
      } else {
        rcaScore = 5;
        findings.push(`Open RCA investigations: ${openRCA} (target: 0)`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring RCA status:', err);
      findings.push('Could not assess RCA investigation status');
      rcaScore = 5;
    }

    // Sub-check 3: Overdue CAPA items
    let capaScore = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as overdue_count
        FROM rca_capa_items
        WHERE hospital_id = ${hospital_id}
          AND status IN ('planned', 'in_progress', 'pending_effectiveness_review')
          AND target_completion_date < NOW()
      `;

      const overdueCount = Number(result[0]?.overdue_count) || 0;

      if (overdueCount === 0) {
        capaScore = 33;
      } else if (overdueCount <= 2) {
        capaScore = 20;
      } else {
        capaScore = 5;
        findings.push(`Overdue CAPA items: ${overdueCount} past target completion date`);
      }
    } catch (err) {
      console.error('[AI-NABH] Error scoring CAPA status:', err);
      findings.push('Could not assess CAPA item status');
      capaScore = 5;
    }

    const qiScore = Math.min(100, incidentScore + rcaScore + capaScore);
    return {
      chapter: 'QI',
      score: qiScore,
      max_score: 100,
      status: getStatus(qiScore),
      findings,
    };
  } catch (err) {
    console.error('[AI-NABH] Unexpected error in QI chapter:', err);
    return {
      chapter: 'QI',
      score: 0,
      max_score: 100,
      status: 'fail',
      findings: ['QI assessment failed'],
    };
  }
}

// ============================================================================
// Main NABH Audit Runner
// ============================================================================

/**
 * Run complete NABH readiness audit across all 6 chapters
 *
 * - Scores each chapter with 3 sub-checks
 * - Computes weighted overall score
 * - Identifies top 3 gaps
 * - Generates action items
 * - Attempts LLM enhancement for narrative
 * - Creates InsightCard
 * - Stores result in nabh_readiness_scores table
 *
 * @param hospital_id - Hospital UUID
 * @returns Promise<NabhAuditResult> with all scores, gaps, and card
 */
export async function runNabhAudit(hospital_id: string): Promise<NabhAuditResult> {
  const sql = getSql();
  const scoreDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`[AI-NABH] Starting audit for hospital ${hospital_id} on ${scoreDate}`);

  // Run all 6 chapter scorers in parallel
  const [copScore, momScore, ipcScore, preScore, fmsScore, qiScore] = await Promise.all([
    scoreCOP(hospital_id),
    scoreMOM(hospital_id),
    scoreIPC(hospital_id),
    scorePRE(hospital_id),
    scoreFMS(hospital_id),
    scoreQI(hospital_id),
  ]);

  const chapterScores = [copScore, momScore, ipcScore, preScore, fmsScore, qiScore];

  // Compute weighted overall score (equal weight per chapter)
  const overallScore = Math.round(
    chapterScores.reduce((sum: number, ch: ChapterScore) => sum + ch.score, 0) / chapterScores.length
  );

  // Identify top 3 gaps (lowest-scoring chapters)
  const sortedByScore = [...chapterScores].sort((a, b) => a.score - b.score);
  const topGaps: NabhGap[] = sortedByScore.slice(0, 3).map((ch) => ({
    chapter: ch.chapter,
    gap: ch.findings.length > 0 ? ch.findings[0] : `${ch.chapter} score: ${ch.score}`,
    recommendation: `Review and strengthen ${ch.chapter} chapter compliance`,
  }));

  // Generate template-based action items
  const actionItems: string[] = [];
  for (const chapter of chapterScores) {
    if (chapter.status === 'fail') {
      actionItems.push(`URGENT: Address ${chapter.chapter} failures — score ${chapter.score}/100`);
    } else if (chapter.status === 'warning') {
      actionItems.push(`Monitor ${chapter.chapter} closely — score ${chapter.score}/100`);
    }
  }

  // Attempt LLM enhancement for narrative
  let cardSource: 'llm' | 'template' = 'template';
  let body = `NABH Readiness Audit Report\n\nOverall Score: ${overallScore}/100\n\nChapter Breakdown:\n`;
  for (const ch of chapterScores) {
    body += `- ${ch.chapter}: ${ch.score}/100 (${ch.status})\n`;
  }
  body += `\nTop Gaps:\n`;
  for (const gap of topGaps) {
    body += `- ${gap.chapter}: ${gap.gap}\n`;
  }

  let explanation = 'Template-based NABH readiness assessment';

  // Try LLM enhancement
  try {
    const llmResult = await generateInsight({
      hospital_id,
      module: 'quality',
      system_prompt: 'You are a NABH compliance expert. Provide a concise narrative of hospital readiness and priority recommendations.',
      user_prompt: `Hospital NABH audit results:\n${body}\n\nProvide a brief (2-3 sentence) summary and top 2 priority actions.`,
      max_tokens: 300,
      temperature: 0.7,
      triggered_by: 'cron',
    });

    if (llmResult) {
      cardSource = 'llm';
      explanation = llmResult.content;
      console.log(`[AI-NABH] LLM enhancement successful`);
    }
  } catch (err) {
    console.error('[AI-NABH] LLM enhancement failed, using template:', err);
  }

  // Determine overall severity
  let severity: CardSeverity = 'low';
  if (overallScore < 60) severity = 'critical';
  else if (overallScore < 75) severity = 'high';
  else if (overallScore < 85) severity = 'medium';

  // Create InsightCard
  const cardId = randomUUID();
  const card: InsightCard = {
    id: cardId,
    hospital_id,
    module: 'quality',
    category: 'report',
    severity,
    title: `NABH Readiness: ${overallScore}/100`,
    body,
    explanation,
    data_sources: ['care_plans', 'medication_orders', 'infection_surveillance', 'sewa_complaints', 'safety_rounds', 'adverse_events', 'rca_investigations'],
    confidence: 0.85,
    source: cardSource,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Insert card into ai_insight_cards
  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity,
        title, body, explanation, data_sources, confidence, source, status,
        created_at, updated_at
      ) VALUES (
        ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
        ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)},
        ${card.confidence}, ${card.source}, ${card.status},
        ${card.created_at}, ${card.updated_at}
      )
    `;
    console.log(`[AI-NABH] InsightCard ${cardId} created`);
  } catch (err) {
    console.error('[AI-NABH] Failed to insert InsightCard:', err);
  }

  // Insert into nabh_readiness_scores table
  try {
    await sql`
      INSERT INTO nabh_readiness_scores (
        id, hospital_id, score_date, overall_score, chapter_scores,
        top_gaps, action_items_generated, source, created_at
      ) VALUES (
        ${randomUUID()}, ${hospital_id}, ${scoreDate}, ${overallScore},
        ${JSON.stringify(chapterScores)},
        ${JSON.stringify(topGaps)}, ${actionItems.length}, ${cardSource}, NOW()
      )
      ON CONFLICT (hospital_id, score_date) DO UPDATE SET
        overall_score = ${overallScore},
        chapter_scores = ${JSON.stringify(chapterScores)},
        top_gaps = ${JSON.stringify(topGaps)},
        action_items_generated = ${actionItems.length},
        source = ${cardSource}
    `;
    console.log(`[AI-NABH] Audit stored for ${hospital_id} on ${scoreDate}`);
  } catch (err) {
    console.error('[AI-NABH] Failed to store audit result:', err);
  }

  return {
    hospital_id,
    score_date: scoreDate,
    overall_score: overallScore,
    chapter_scores: chapterScores,
    top_gaps: topGaps,
    action_items: actionItems,
    card,
  };
}

// ============================================================================
// Retrieve Latest NABH Score
// ============================================================================

/**
 * Retrieve the latest (or specific date) NABH readiness score
 *
 * @param hospital_id - Hospital UUID
 * @param date - Optional YYYY-MM-DD format; defaults to most recent
 * @returns Promise<NabhReadinessScore | null>
 */
export async function getNabhScore(
  hospital_id: string,
  date?: string
): Promise<NabhReadinessScore | null> {
  const sql = getSql();

  try {
    let result;
    if (date) {
      result = await sql`
        SELECT
          id, hospital_id, score_date, overall_score, chapter_scores,
          top_gaps, action_items_generated, source, created_at
        FROM nabh_readiness_scores
        WHERE hospital_id = ${hospital_id} AND score_date = ${date}
        LIMIT 1
      `;
    } else {
      result = await sql`
        SELECT
          id, hospital_id, score_date, overall_score, chapter_scores,
          top_gaps, action_items_generated, source, created_at
        FROM nabh_readiness_scores
        WHERE hospital_id = ${hospital_id}
        ORDER BY score_date DESC
        LIMIT 1
      `;
    }

    if (!result || result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: String(row.id),
      hospital_id: String(row.hospital_id),
      score_date: String(row.score_date),
      overall_score: Number(row.overall_score),
      chapter_scores: row.chapter_scores as ChapterScore[],
      top_gaps: row.top_gaps as NabhGap[],
      action_items_generated: Number(row.action_items_generated),
      source: String(row.source) as 'llm' | 'template',
      created_at: String(row.created_at),
    };
  } catch (err) {
    console.error('[AI-NABH] Error retrieving NABH score:', err);
    return null;
  }
}
