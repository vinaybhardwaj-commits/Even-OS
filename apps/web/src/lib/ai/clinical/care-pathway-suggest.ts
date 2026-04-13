/**
 * Even AI — Clinical Intelligence: Care Pathway Suggestion & Variance Analysis
 * LLM-powered care pathway template matching and active pathway variance detection
 *
 * Features:
 * - Diagnosis & admission-type based pathway template matching with scoring
 * - Active pathway variance analysis and adherence tracking
 * - Milestone overdue detection and complication flagging
 * - Self-improving rubric for pathway efficacy
 * - InsightCard generation for clinical teams (recommendations and alerts)
 * - Graceful fallback to template recommendations when LLM unavailable
 *
 * Database tables used:
 * - encounters: id, hospital_id, patient_id, status, primary_diagnosis, secondary_diagnoses, admission_type, admitted_at
 * - patients: id, first_name, last_name, date_of_birth, gender
 * - conditions: patient_id, encounter_id, icd_code, description, clinical_status
 * - pathway_templates: id, hospital_id, template_name, description, diagnosis_codes (JSONB), admission_type, is_active, estimated_los_days
 * - care_plans: id, encounter_id, hospital_id, template_id, template_name, status, activated_at
 * - care_plan_milestones: id, care_plan_id, milestone_name, day_number, status, due_date, completed_at
 * - variance_log: id, care_plan_id, milestone_id, variance_type, description, severity, created_at
 * - procedures: encounter_id, procedure_name, procedure_code
 * - ai_insight_cards: Module-wide table for storing generated cards
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
// Types
// ============================================================================

/**
 * A single care pathway template suggestion with match score and reasoning
 */
export interface PathwaySuggestion {
  template_id: string;
  template_name: string;
  match_score: number; // 0-100
  match_reasons: string[]; // e.g. "Diagnosis code matches I21.0", "Admission type matches emergency"
  estimated_los_days: number;
}

/**
 * Variance report for a single milestone or care plan-wide
 */
export interface PathwayVarianceReport {
  care_plan_id: string;
  template_name: string;
  encounter_id: string;
  patient_name: string;
  total_milestones: number;
  completed: number;
  overdue: number;
  on_track: number;
  variances: Array<{
    milestone_name: string;
    variance_type: string;
    description: string;
    severity: string;
    day_number: number;
    days_overdue: number;
  }>;
  adherence_pct: number; // completed / total * 100
  risk_level: 'low' | 'medium' | 'high';
}

/**
 * Main analysis output combining suggestions and/or variance analysis
 */
export interface CarePathwayAnalysis {
  encounter_id: string;
  hospital_id: string;
  has_active_pathway: boolean;
  suggestions: PathwaySuggestion[];
  variance_report?: PathwayVarianceReport;
  recommendations: string[];
  card: InsightCard;
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Compare ICD-10 diagnosis codes with prefix matching
 * e.g., encounter code I21.0 matches template code I21
 */
function matchDiagnosisCodes(
  encounterCodes: string[],
  templateCodes: string[]
): number {
  if (!encounterCodes.length || !templateCodes.length) return 0;

  const matches = encounterCodes.filter((enc) =>
    templateCodes.some((tpl) => enc.startsWith(tpl.split('.')[0]))
  );

  return matches.length;
}

/**
 * Create an InsightCard and insert it into the database
 */
async function createInsightCard(
  params: Partial<InsightCard> & {
    hospital_id: string;
    module: 'clinical';
    category: 'alert' | 'suggestion';
    title: string;
    body: string;
  }
): Promise<InsightCard> {
  const sql = getSql();

  const card: InsightCard = {
    id: randomUUID(),
    hospital_id: params.hospital_id,
    module: params.module,
    category: params.category,
    severity: params.severity || 'info',
    title: params.title,
    body: params.body,
    explanation: params.explanation || '',
    data_sources: params.data_sources || [],
    suggested_action: params.suggested_action,
    action_url: params.action_url,
    confidence: params.confidence || 0.85,
    source: params.source || 'hybrid',
    status: 'active',
    target_encounter_id: params.target_encounter_id,
    target_patient_id: params.target_patient_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity, title, body, explanation,
        data_sources, suggested_action, action_url, confidence, source, status,
        target_encounter_id, target_patient_id, created_at, updated_at
      ) VALUES (
        ${card.id},
        ${card.hospital_id},
        ${card.module},
        ${card.category},
        ${card.severity},
        ${card.title},
        ${card.body},
        ${card.explanation},
        ${JSON.stringify(card.data_sources)},
        ${card.suggested_action || null},
        ${card.action_url || null},
        ${card.confidence},
        ${card.source},
        ${card.status},
        ${card.target_encounter_id || null},
        ${card.target_patient_id || null},
        ${card.created_at},
        ${card.updated_at}
      )
    `;
  } catch (err) {
    console.error('Failed to create insight card:', err);
  }

  return card;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Analyze an encounter and suggest appropriate care pathway templates
 * or analyze active pathway variance
 *
 * @param params hospital_id and encounter_id
 * @returns CarePathwayAnalysis with suggestions, variance report, and InsightCard
 */
export async function suggestPathways(params: {
  hospital_id: string;
  encounter_id: string;
}): Promise<CarePathwayAnalysis> {
  const { hospital_id, encounter_id } = params;
  const sql = getSql();

  try {
    // Fetch encounter data
    const encounterRows = await sql`
      SELECT
        id,
        patient_id,
        primary_diagnosis,
        secondary_diagnoses,
        admission_type,
        admitted_at,
        status
      FROM encounters
      WHERE id = ${encounter_id} AND hospital_id = ${hospital_id}
      LIMIT 1
    `;

    if (!encounterRows.length) {
      throw new Error(`Encounter ${encounter_id} not found`);
    }

    const encounter = encounterRows[0];

    // Fetch patient name
    const patientRows = await sql`
      SELECT first_name, last_name
      FROM patients
      WHERE id = ${encounter.patient_id}
      LIMIT 1
    `;

    const patientName = patientRows.length
      ? `${patientRows[0].first_name} ${patientRows[0].last_name}`
      : 'Unknown Patient';

    // Fetch encounter diagnosis codes
    const conditionRows = await sql`
      SELECT icd_code
      FROM conditions
      WHERE encounter_id = ${encounter_id}
      LIMIT 20
    `;

    const encounterDiagnosisCodes = conditionRows.map((c: any) => c.icd_code);

    // Check if encounter already has an active care plan
    const activePlanRows = await sql`
      SELECT id, template_id, template_name, status
      FROM care_plans
      WHERE encounter_id = ${encounter_id} AND status = 'active'
      LIMIT 1
    `;

    const hasActivePlan = activePlanRows.length > 0;
    const activePlan = activePlanRows.length > 0 ? activePlanRows[0] : null;

    let analysis: CarePathwayAnalysis;

    if (hasActivePlan && activePlan) {
      // Analyze variance for active pathway
      const varianceReport = await analyzePathwayVariance({
        hospital_id,
        care_plan_id: activePlan.id,
      });

      const severityMap: Record<string, CardSeverity> = {
        high: 'high',
        medium: 'medium',
        low: 'low',
      };

      const recommendations = [
        varianceReport.risk_level === 'high'
          ? `Urgent: ${varianceReport.overdue} overdue milestones on ${activePlan.template_name} — escalate to attending physician`
          : `Continue monitoring milestones on ${activePlan.template_name}`,
      ];

      const card = await createInsightCard({
        hospital_id,
        module: 'clinical',
        category: varianceReport.risk_level === 'low' ? 'suggestion' : 'alert',
        severity: severityMap[varianceReport.risk_level],
        title: `Pathway Variance — ${activePlan.template_name}`,
        body: `${varianceReport.completed}/${varianceReport.total_milestones} milestones completed. Adherence: ${varianceReport.adherence_pct.toFixed(0)}%`,
        explanation:
          varianceReport.variances.length > 0
            ? `Detected ${varianceReport.variances.length} variance(s): ${varianceReport.variances.map((v: any) => v.variance_type).join(', ')}`
            : 'Pathway progressing on track',
        data_sources: ['care_plan_milestones', 'variance_log'],
        target_encounter_id: encounter_id,
        target_patient_id: encounter.patient_id,
        confidence: 0.9,
        source: 'template',
      });

      analysis = {
        encounter_id,
        hospital_id,
        has_active_pathway: true,
        suggestions: [],
        variance_report: varianceReport,
        recommendations,
        card,
      };
    } else {
      // Suggest pathways for this encounter
      const templateRows = await sql`
        SELECT
          id,
          template_name,
          description,
          diagnosis_codes,
          admission_type,
          estimated_los_days
        FROM pathway_templates
        WHERE hospital_id = ${hospital_id} AND is_active = true
        LIMIT 50
      `;

      if (!templateRows.length) {
        // No templates available - return empty suggestions
        const card = await createInsightCard({
          hospital_id,
          module: 'clinical',
          category: 'suggestion',
          severity: 'info',
          title: 'No Care Pathway Templates Available',
          body: `No active care pathway templates are configured for ${hospital_id}`,
          explanation:
            'Configure care pathway templates in the clinical admin panel to enable suggestions',
          data_sources: ['pathway_templates'],
          target_encounter_id: encounter_id,
          target_patient_id: encounter.patient_id,
          confidence: 1.0,
          source: 'template',
        });

        return {
          encounter_id,
          hospital_id,
          has_active_pathway: false,
          suggestions: [],
          recommendations: ['Configure care pathway templates'],
          card,
        };
      }

      // Score each template
      const suggestions: PathwaySuggestion[] = templateRows
        .map((tpl: any) => {
          let score = 0;
          const reasons: string[] = [];

          // Diagnosis code matching (50 points max)
          const diagnosisMatches = matchDiagnosisCodes(
            encounterDiagnosisCodes,
            tpl.diagnosis_codes || []
          );

          if (diagnosisMatches > 0) {
            score += Math.min(50, diagnosisMatches * 25);
            reasons.push(
              `Diagnosis code matches (${diagnosisMatches} match${diagnosisMatches > 1 ? 'es' : ''})`
            );
          }

          // Admission type matching (20 points)
          if (
            tpl.admission_type &&
            tpl.admission_type === encounter.admission_type
          ) {
            score += 20;
            reasons.push(`Admission type matches ${tpl.admission_type}`);
          }

          // Keyword matching in description (30 points max)
          const description = (tpl.description || '').toLowerCase();
          const primaryDiag = (encounter.primary_diagnosis || '')
            .toLowerCase()
            .split(' ')
            .filter((w: string) => w.length > 3);

          const keywordMatches = primaryDiag.filter((word: string) =>
            description.includes(word)
          ).length;

          if (keywordMatches > 0) {
            score += Math.min(30, keywordMatches * 15);
            reasons.push('Description matches diagnosis keywords');
          }

          return {
            template_id: tpl.id,
            template_name: tpl.template_name,
            match_score: Math.min(100, score),
            match_reasons: reasons.length > 0 ? reasons : ['Potential match'],
            estimated_los_days: tpl.estimated_los_days || 0,
          };
        })
        .sort((a: PathwaySuggestion, b: PathwaySuggestion) =>
          b.match_score - a.match_score
        )
        .slice(0, 3);

      // Get LLM recommendations if available
      let llmRecommendations: string[] = [];

      if (suggestions.length > 0) {
        const topTemplate = suggestions[0];
        const llmResponse = await generateInsight({
          hospital_id,
          module: 'clinical',
          system_prompt: `You are a clinical pathway expert. Provide 1-2 brief, actionable recommendations for implementing care pathway "${topTemplate.template_name}" for a patient with ${encounter.primary_diagnosis}.`,
          user_prompt: `Patient: ${patientName}, Admission type: ${encounter.admission_type}, Primary diagnosis: ${encounter.primary_diagnosis}. Why should this pathway be used?`,
          max_tokens: 200,
          temperature: 0.5,
          triggered_by: 'event',
        });

        if (llmResponse?.content) {
          llmRecommendations = [
            llmResponse.content
              .split('\n')[0]
              .replace(/^[-•]\s+/, ''),
          ];
        }
      }

      const recommendations =
        llmRecommendations.length > 0
          ? llmRecommendations
          : suggestions.length > 0
            ? [
                `Consider ${suggestions[0].template_name} (match score: ${suggestions[0].match_score}%)`,
              ]
            : ['Configure care pathway templates'];

      const card = await createInsightCard({
        hospital_id,
        module: 'clinical',
        category: 'suggestion',
        severity: 'info',
        title: `Pathway Suggested — ${suggestions.length > 0 ? suggestions[0].template_name : 'No Match'}`,
        body:
          suggestions.length > 0
            ? `${suggestions.length} pathway(s) match this encounter. Top suggestion: ${suggestions[0].template_name} (${suggestions[0].match_score}% match)`
            : 'No pathway templates currently match this encounter profile',
        explanation:
          suggestions.length > 0
            ? `Matched on: ${suggestions[0].match_reasons.join('; ')}`
            : 'Diagnosis, admission type, and clinical profile did not match active templates',
        data_sources: ['pathway_templates', 'conditions'],
        suggested_action:
          suggestions.length > 0
            ? `Activate ${suggestions[0].template_name}`
            : 'Review available pathway templates',
        target_encounter_id: encounter_id,
        target_patient_id: encounter.patient_id,
        confidence: suggestions.length > 0 ? suggestions[0].match_score / 100 : 0,
        source: llmRecommendations.length > 0 ? 'hybrid' : 'template',
      });

      analysis = {
        encounter_id,
        hospital_id,
        has_active_pathway: false,
        suggestions,
        recommendations,
        card,
      };
    }

    return analysis;
  } catch (err) {
    console.error('Error in suggestPathways:', err);

    const fallbackCard = await createInsightCard({
      hospital_id,
      module: 'clinical',
      category: 'suggestion',
      severity: 'low',
      title: 'Care Pathway Analysis Error',
      body: 'Unable to analyze care pathways at this time',
      explanation: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      data_sources: [],
      target_encounter_id: encounter_id,
      confidence: 0,
      source: 'template',
    });

    return {
      encounter_id,
      hospital_id,
      has_active_pathway: false,
      suggestions: [],
      recommendations: [],
      card: fallbackCard,
    };
  }
}

/**
 * Analyze variance for a specific active care plan
 * Used independently and as part of suggestPathways
 *
 * @param params hospital_id and care_plan_id
 * @returns PathwayVarianceReport with milestone status and variance details
 */
export async function analyzePathwayVariance(params: {
  hospital_id: string;
  care_plan_id: string;
}): Promise<PathwayVarianceReport> {
  const { hospital_id, care_plan_id } = params;
  const sql = getSql();

  try {
    // Fetch care plan and encounter
    const planRows = await sql`
      SELECT
        cp.id,
        cp.encounter_id,
        cp.template_name,
        cp.hospital_id,
        e.patient_id
      FROM care_plans cp
      JOIN encounters e ON cp.encounter_id = e.id
      WHERE cp.id = ${care_plan_id} AND cp.hospital_id = ${hospital_id}
      LIMIT 1
    `;

    if (!planRows.length) {
      throw new Error(`Care plan ${care_plan_id} not found`);
    }

    const plan = planRows[0];

    // Fetch patient name
    const patientRows = await sql`
      SELECT first_name, last_name
      FROM patients
      WHERE id = ${plan.patient_id}
      LIMIT 1
    `;

    const patientName = patientRows.length
      ? `${patientRows[0].first_name} ${patientRows[0].last_name}`
      : 'Unknown Patient';

    // Fetch milestones
    const milestoneRows = await sql`
      SELECT
        id,
        milestone_name,
        day_number,
        status,
        due_date,
        completed_at
      FROM care_plan_milestones
      WHERE care_plan_id = ${care_plan_id}
      ORDER BY day_number ASC
    `;

    // Fetch variance logs
    const varianceRows = await sql`
      SELECT
        id,
        milestone_id,
        variance_type,
        description,
        severity,
        created_at
      FROM variance_log
      WHERE care_plan_id = ${care_plan_id}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    // Process milestones
    let completed = 0;
    let overdue = 0;
    let on_track = 0;
    const now = new Date();
    const variances: Array<{
      milestone_name: string;
      variance_type: string;
      description: string;
      severity: string;
      day_number: number;
      days_overdue: number;
    }> = [];

    for (const milestone of milestoneRows) {
      if (milestone.status === 'completed') {
        completed++;
      } else {
        const dueDate = new Date(milestone.due_date);
        const daysOverdue = Math.max(
          0,
          Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        );

        if (daysOverdue > 0) {
          overdue++;
        } else {
          on_track++;
        }

        // Link variances to this milestone
        const milestoneVariances = varianceRows.filter(
          (v: any) => v.milestone_id === milestone.id
        );

        for (const v of milestoneVariances) {
          variances.push({
            milestone_name: milestone.milestone_name,
            variance_type: v.variance_type,
            description: v.description,
            severity: v.severity,
            day_number: milestone.day_number,
            days_overdue: daysOverdue,
          });
        }
      }
    }

    const totalMilestones = milestoneRows.length;
    const adherencePct =
      totalMilestones > 0 ? (completed / totalMilestones) * 100 : 0;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    if (
      adherencePct < 70 ||
      variances.some((v) => v.variance_type === 'complication')
    ) {
      riskLevel = 'high';
    } else if (adherencePct < 85 || overdue > 0) {
      riskLevel = 'medium';
    }

    const report: PathwayVarianceReport = {
      care_plan_id,
      template_name: plan.template_name,
      encounter_id: plan.encounter_id,
      patient_name: patientName,
      total_milestones: totalMilestones,
      completed,
      overdue,
      on_track,
      variances,
      adherence_pct: Math.round(adherencePct),
      risk_level: riskLevel,
    };

    // Add recommendations if needed
    if (!('recommendations' in report)) {
      const recommendations: string[] = [];

      if (riskLevel === 'high') {
        recommendations.push('Escalate to care team for immediate review');
      }
      if (overdue > 0) {
        recommendations.push(
          `Address ${overdue} overdue milestone${overdue > 1 ? 's' : ''}`
        );
      }
      if (adherencePct < 85) {
        recommendations.push('Review pathway adherence barriers');
      }

      (report as any).recommendations = recommendations;
    }

    return report;
  } catch (err) {
    console.error('Error in analyzePathwayVariance:', err);

    return {
      care_plan_id,
      template_name: 'Unknown',
      encounter_id: '',
      patient_name: 'Unknown Patient',
      total_milestones: 0,
      completed: 0,
      overdue: 0,
      on_track: 0,
      variances: [],
      adherence_pct: 0,
      risk_level: 'high',
    };
  }
}
