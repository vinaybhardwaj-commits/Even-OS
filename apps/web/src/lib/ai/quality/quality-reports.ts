import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';
import { generateInsight } from '../llm-client';

let _sql: any = null;

function getSql() {
  if (!_sql) {
    const { neon } = require('@neondatabase/serverless');
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

interface QualityReport {
  hospital_id: string;
  report_type: 'incident_trend' | 'infection' | 'compliance' | 'dashboard_summary';
  period_start: string;
  period_end: string;
  metrics: Record<string, number | string | string[]>;
  narrative: string;
  source: 'llm' | 'template';
  card: InsightCard;
}

interface IncidentMetrics {
  total_incidents: number;
  closure_rate: number;
  rca_completion_rate: number;
  leading_category: string;
  leading_category_count: number;
  trend_direction: 'up' | 'down' | 'stable';
  trend_percentage: number;
  [key: string]: number | string;
}

interface InfectionMetrics {
  total_infections: number;
  infections_week_trend: number;
  hai_rate_per_1000: number;
  leading_organism: string;
  resistant_organisms: string[];
  antibiotic_restriction_compliance: number;
  [key: string]: number | string | string[];
}

interface ComplianceMetrics {
  safety_rounds_completion: number;
  audit_score_average: number;
  quality_indicators_on_target: number;
  complaint_resolution_rate: number;
  sla_compliance_rate: number;
  [key: string]: number | string;
}

function getDateRanges(days: number = 30): { current_start: Date; current_end: Date; previous_start: Date; previous_end: Date } {
  const current_end = new Date();
  const current_start = new Date(current_end.getTime() - days * 24 * 60 * 60 * 1000);
  const previous_end = new Date(current_start.getTime() - 1);
  const previous_start = new Date(previous_end.getTime() - days * 24 * 60 * 60 * 1000);
  return { current_start, current_end, previous_start, previous_end };
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function createQualityInsightCard(
  hospital_id: string,
  report_type: string,
  narrative: string,
  metrics: Record<string, number | string | string[]>,
  source: 'llm' | 'template'
): Promise<InsightCard> {
  const card: InsightCard = {
    id: randomUUID(),
    hospital_id,
    module: 'quality',
    category: 'report',
    severity: determineSeverity(metrics),
    title: getTitleForReportType(report_type),
    body: narrative.substring(0, 500),
    explanation: narrative,
    data_sources: ['adverse_events', 'infection_surveillance', 'rca_investigations', 'safety_rounds', 'clinical_audits', 'sewa_complaints'],
    confidence: source === 'llm' ? 0.85 : 0.7,
    source: source === 'llm' ? 'llm' : 'template',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    const sql = getSql();
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity, title, body, explanation,
        data_sources, confidence, source, status, created_at, updated_at
      ) VALUES (
        ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
        ${card.title}, ${card.body}, ${card.explanation},
        ${JSON.stringify(card.data_sources)}, ${card.confidence}, ${card.source}, ${card.status},
        ${card.created_at}, ${card.updated_at}
      )
    `;
  } catch (error) {
    console.error('[AI-QualityReports] Failed to insert insight card:', error);
  }

  return card;
}

function determineSeverity(metrics: Record<string, number | string | string[]>): CardSeverity {
  const severity_indicators: CardSeverity[] = [];

  if (typeof metrics.closure_rate === 'number' && metrics.closure_rate < 0.5) {
    severity_indicators.push('high');
  }

  if (typeof metrics.rca_completion_rate === 'number' && metrics.rca_completion_rate < 0.6) {
    severity_indicators.push('high');
  }

  if (typeof metrics.trend_percentage === 'number' && metrics.trend_percentage > 15) {
    severity_indicators.push('medium');
  }

  if (typeof metrics.resistant_organism_count === 'number' && metrics.resistant_organism_count > 3) {
    severity_indicators.push('medium');
  }

  if (typeof metrics.audit_score_average === 'number' && metrics.audit_score_average < 70) {
    severity_indicators.push('high');
  }

  if (typeof metrics.sla_compliance_rate === 'number' && metrics.sla_compliance_rate < 0.8) {
    severity_indicators.push('medium');
  }

  if (severity_indicators.includes('high')) {
    return 'high';
  }
  if (severity_indicators.includes('medium')) {
    return 'medium';
  }
  return 'info';
}

function getTitleForReportType(report_type: string): string {
  switch (report_type) {
    case 'incident_trend':
      return 'Incident Trend Report';
    case 'infection':
      return 'Infection Surveillance Report';
    case 'compliance':
      return 'Compliance & Safety Report';
    case 'dashboard_summary':
      return 'Quality Executive Summary';
    default:
      return 'Quality Report';
  }
}

function generateIncidentTemplateFallback(metrics: IncidentMetrics): string {
  const trend_text = metrics.trend_direction === 'up' ? 'increased' : metrics.trend_direction === 'down' ? 'decreased' : 'remained stable';
  return `
Incident Trend Report (30-Day Period)

Total Incidents: ${metrics.total_incidents}
Closure Rate: ${(metrics.closure_rate * 100).toFixed(1)}%
RCA Completion Rate: ${(metrics.rca_completion_rate * 100).toFixed(1)}%
Leading Category: ${metrics.leading_category} (${metrics.leading_category_count} incidents)
Trend: ${trend_text} by ${metrics.trend_percentage.toFixed(1)}% vs previous period

Analysis:
Incident volume has ${trend_text} during the reporting period. The leading incident category is ${metrics.leading_category}, accounting for ${metrics.leading_category_count} of ${metrics.total_incidents} total incidents. Current closure rate stands at ${(metrics.closure_rate * 100).toFixed(1)}%, indicating ${metrics.closure_rate > 0.75 ? 'effective' : 'delayed'} incident resolution. Root cause analysis completion has reached ${(metrics.rca_completion_rate * 100).toFixed(1)}%, ${metrics.rca_completion_rate > 0.75 ? 'meeting' : 'falling short of'} best practice targets.
  `.trim();
}

function generateInfectionTemplateFallback(metrics: InfectionMetrics): string {
  const resistant_list = Array.isArray(metrics.resistant_organisms) ? metrics.resistant_organisms.join(', ') : 'None identified';
  return `
Infection Surveillance Report (30-Day Period)

Total HAI Cases: ${metrics.total_infections}
HAI Rate (per 1000 device-days): ${metrics.hai_rate_per_1000.toFixed(2)}
Leading Organism: ${metrics.leading_organism}
Week-over-Week Trend: ${metrics.infections_week_trend > 0 ? '+' : ''}${metrics.infections_week_trend}%
Antibiotic Resistance Compliance: ${(metrics.antibiotic_restriction_compliance * 100).toFixed(1)}%
Resistant Organisms (>50% resistance): ${resistant_list}

Analysis:
Hospital-acquired infection rate remains at ${metrics.hai_rate_per_1000.toFixed(2)} per 1000 device-days. The leading organism identified is ${metrics.leading_organism}. Antibiotic stewardship compliance stands at ${(metrics.antibiotic_restriction_compliance * 100).toFixed(1)}%, with ${Array.isArray(metrics.resistant_organisms) ? metrics.resistant_organisms.length : 0} organism(s) showing significant resistance patterns. Continued monitoring and intervention strategies are recommended.
  `.trim();
}

function generateComplianceTemplateFallback(metrics: ComplianceMetrics): string {
  return `
Compliance & Safety Report (30-Day Period)

Safety Rounds Completion: ${(metrics.safety_rounds_completion * 100).toFixed(1)}%
Clinical Audit Score (Average): ${metrics.audit_score_average.toFixed(1)}/100
Quality Indicators on Target: ${metrics.quality_indicators_on_target}
Complaint Resolution Rate: ${(metrics.complaint_resolution_rate * 100).toFixed(1)}%
SLA Compliance Rate: ${(metrics.sla_compliance_rate * 100).toFixed(1)}%

Analysis:
Safety rounds completion stands at ${(metrics.safety_rounds_completion * 100).toFixed(1)}%, ${metrics.safety_rounds_completion > 0.8 ? 'indicating strong' : 'indicating below-target'} safety engagement. Clinical audit average score of ${metrics.audit_score_average.toFixed(1)}/100 reflects overall compliance posture. Complaint resolution rate of ${(metrics.complaint_resolution_rate * 100).toFixed(1)}% and SLA compliance of ${(metrics.sla_compliance_rate * 100).toFixed(1)}% demonstrate responsiveness to stakeholder concerns. Focus areas for improvement include ${metrics.safety_rounds_completion < 0.8 ? 'safety round participation' : 'audit score optimization'}.
  `.trim();
}

export async function generateIncidentTrendReport(hospital_id: string, days: number = 30): Promise<QualityReport> {
  const { current_start, current_end, previous_start, previous_end } = getDateRanges(days);
  let narrative = '';
  let source: 'llm' | 'template' = 'template';
  const metrics: IncidentMetrics = {
    total_incidents: 0,
    closure_rate: 0,
    rca_completion_rate: 0,
    leading_category: 'Unknown',
    leading_category_count: 0,
    trend_direction: 'stable',
    trend_percentage: 0,
  };

  try {
    const sql = getSql();

    // Query current period incidents
    const current_incidents = await sql`
      SELECT
        incident_type,
        ae_severity,
        ae_status,
        COUNT(*) as count
      FROM adverse_events
      WHERE hospital_id = ${hospital_id}
        AND incident_date >= ${formatDate(current_start)}
        AND incident_date <= ${formatDate(current_end)}
      GROUP BY incident_type, ae_severity, ae_status
    `;

    const total_current = current_incidents.reduce((sum: number, row: any) => sum + row.count, 0);
    metrics.total_incidents = total_current;

    // Calculate closure rate
    const closed_incidents = current_incidents.filter(
      (row: any) => row.ae_status === 'closed' || row.ae_status === 'resolved'
    );
    const closed_count = closed_incidents.reduce((sum: number, row: any) => sum + row.count, 0);
    metrics.closure_rate = total_current > 0 ? closed_count / total_current : 0;

    // Find leading category
    if (current_incidents.length > 0) {
      const sorted = [...current_incidents].sort((a: any, b: any) => b.count - a.count);
      metrics.leading_category = sorted[0].incident_type || 'Unknown';
      metrics.leading_category_count = sorted[0].count;
    }

    // Calculate RCA completion rate
    const rca_investigations = await sql`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN rca_inv_status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM rca_investigations
      WHERE hospital_id = ${hospital_id}
        AND created_at >= ${formatDate(current_start)}
        AND created_at <= ${formatDate(current_end)}
    `;

    if (rca_investigations.length > 0 && rca_investigations[0].total > 0) {
      metrics.rca_completion_rate = rca_investigations[0].completed / rca_investigations[0].total;
    }

    // Compare with previous period for trend
    const previous_incidents = await sql`
      SELECT COUNT(*) as count
      FROM adverse_events
      WHERE hospital_id = ${hospital_id}
        AND incident_date >= ${formatDate(previous_start)}
        AND incident_date <= ${formatDate(previous_end)}
    `;

    const total_previous = previous_incidents[0]?.count || 0;
    if (total_previous > 0) {
      metrics.trend_percentage = ((total_current - total_previous) / total_previous) * 100;
      metrics.trend_direction = metrics.trend_percentage > 5 ? 'up' : metrics.trend_percentage < -5 ? 'down' : 'stable';
    }

    // Try LLM generation
    const llmResult = await generateInsight({
      hospital_id,
      module: 'quality',
      system_prompt:
        'You are a hospital quality and patient safety expert. Generate a concise, actionable narrative about incident trends.',
      user_prompt: `Analyze these incident metrics and provide a narrative summary:\n${JSON.stringify(metrics, null, 2)}`,
      max_tokens: 300,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (llmResult?.content) {
      narrative = llmResult.content.trim();
      source = 'llm';
    } else {
      narrative = generateIncidentTemplateFallback(metrics);
    }
  } catch (error) {
    console.error('[AI-QualityReports] Failed to generate incident trend report:', error);
    narrative = generateIncidentTemplateFallback(metrics);
  }

  const card = await createQualityInsightCard(hospital_id, 'incident_trend', narrative, metrics, source);

  return {
    hospital_id,
    report_type: 'incident_trend',
    period_start: formatDate(current_start),
    period_end: formatDate(current_end),
    metrics,
    narrative,
    source,
    card,
  };
}

export async function generateInfectionReport(hospital_id: string, days: number = 30): Promise<QualityReport> {
  const { current_start, current_end } = getDateRanges(days);
  let narrative = '';
  let source: 'llm' | 'template' = 'template';
  const metrics: InfectionMetrics = {
    total_infections: 0,
    infections_week_trend: 0,
    hai_rate_per_1000: 0,
    leading_organism: 'Unknown',
    resistant_organisms: [],
    antibiotic_restriction_compliance: 0,
  };

  try {
    const sql = getSql();

    // Query infection surveillance data
    const infections = await sql`
      SELECT
        infection_type,
        organism,
        COUNT(*) as count
      FROM infection_surveillance
      WHERE hospital_id = ${hospital_id}
        AND onset_date >= ${formatDate(current_start)}
        AND onset_date <= ${formatDate(current_end)}
      GROUP BY infection_type, organism
    `;

    metrics.total_infections = infections.reduce((sum: number, row: any) => sum + row.count, 0);

    // Find leading organism
    if (infections.length > 0) {
      const sorted = [...infections].sort((a: any, b: any) => b.count - a.count);
      metrics.leading_organism = sorted[0].organism || 'Unknown';
    }

    // Query HAI rates
    const hai_rates = await sql`
      SELECT rate_per_1000
      FROM infection_rates
      WHERE hospital_id = ${hospital_id}
        AND period_start >= ${formatDate(current_start)}
        AND period_end <= ${formatDate(current_end)}
      ORDER BY period_end DESC
      LIMIT 1
    `;

    if (hai_rates.length > 0) {
      metrics.hai_rate_per_1000 = hai_rates[0].rate_per_1000;
    }

    // Query antibiogram for resistant organisms
    const resistance_data = await sql`
      SELECT DISTINCT ag_organism
      FROM antibiogram_results
      WHERE hospital_id = ${hospital_id}
        AND pct_resistant > 50
        AND ag_period_start >= ${formatDate(current_start)}
      ORDER BY pct_resistant DESC
    `;

    metrics.resistant_organisms = resistance_data.map((row: any) => row.ag_organism);

    // Query antibiotic usage compliance
    const antibiotic_usage = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_restricted = true THEN 1 ELSE 0 END) as restricted_used
      FROM antibiotic_usage_log
      WHERE hospital_id = ${hospital_id}
        AND aul_start_date >= ${formatDate(current_start)}
        AND aul_start_date <= ${formatDate(current_end)}
    `;

    if (antibiotic_usage.length > 0 && antibiotic_usage[0].total > 0) {
      metrics.antibiotic_restriction_compliance = 1 - antibiotic_usage[0].restricted_used / antibiotic_usage[0].total;
    }

    // Calculate week-over-week trend
    const prev_week_start = new Date(current_start.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prev_week_infections = await sql`
      SELECT COUNT(*) as count
      FROM infection_surveillance
      WHERE hospital_id = ${hospital_id}
        AND onset_date >= ${formatDate(prev_week_start)}
        AND onset_date < ${formatDate(current_start)}
    `;

    const this_week_infections = await sql`
      SELECT COUNT(*) as count
      FROM infection_surveillance
      WHERE hospital_id = ${hospital_id}
        AND onset_date >= ${formatDate(new Date(current_end.getTime() - 7 * 24 * 60 * 60 * 1000))}
        AND onset_date <= ${formatDate(current_end)}
    `;

    const prev_count = prev_week_infections[0]?.count || 0;
    const this_count = this_week_infections[0]?.count || 0;
    if (prev_count > 0) {
      metrics.infections_week_trend = ((this_count - prev_count) / prev_count) * 100;
    }

    // Try LLM generation
    const llmResult = await generateInsight({
      hospital_id,
      module: 'quality',
      system_prompt: 'You are an infection prevention and control expert. Generate a concise narrative about infection surveillance trends.',
      user_prompt: `Analyze these infection surveillance metrics and provide a narrative summary:\n${JSON.stringify(metrics, null, 2)}`,
      max_tokens: 300,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (llmResult?.content) {
      narrative = llmResult.content.trim();
      source = 'llm';
    } else {
      narrative = generateInfectionTemplateFallback(metrics);
    }
  } catch (error) {
    console.error('[AI-QualityReports] Failed to generate infection report:', error);
    narrative = generateInfectionTemplateFallback(metrics);
  }

  const card = await createQualityInsightCard(hospital_id, 'infection', narrative, metrics, source);

  return {
    hospital_id,
    report_type: 'infection',
    period_start: formatDate(current_start),
    period_end: formatDate(current_end),
    metrics,
    narrative,
    source,
    card,
  };
}

export async function generateComplianceReport(hospital_id: string, days: number = 30): Promise<QualityReport> {
  const { current_start, current_end } = getDateRanges(days);
  let narrative = '';
  let source: 'llm' | 'template' = 'template';
  const metrics: ComplianceMetrics = {
    safety_rounds_completion: 0,
    audit_score_average: 0,
    quality_indicators_on_target: 0,
    complaint_resolution_rate: 0,
    sla_compliance_rate: 0,
  };

  try {
    const sql = getSql();

    // Query safety rounds completion
    const safety_rounds = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sr_status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM safety_rounds
      WHERE hospital_id = ${hospital_id}
        AND scheduled_date >= ${formatDate(current_start)}
        AND scheduled_date <= ${formatDate(current_end)}
    `;

    if (safety_rounds.length > 0 && safety_rounds[0].total > 0) {
      metrics.safety_rounds_completion = safety_rounds[0].completed / safety_rounds[0].total;
    }

    // Query clinical audit scores
    const audits = await sql`
      SELECT AVG(compliance_score) as avg_score
      FROM clinical_audits
      WHERE hospital_id = ${hospital_id}
        AND ca_completed_at >= ${formatDate(current_start)}
        AND ca_completed_at <= ${formatDate(current_end)}
        AND ca_status = 'completed'
    `;

    if (audits.length > 0 && audits[0].avg_score) {
      metrics.audit_score_average = audits[0].avg_score;
    }

    // Query quality indicators on target
    const quality_indicators = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN qiv_value >= 80 THEN 1 ELSE 0 END) as on_target
      FROM quality_indicator_values
      WHERE hospital_id = ${hospital_id}
        AND period_end >= ${formatDate(current_start)}
        AND period_end <= ${formatDate(current_end)}
    `;

    if (quality_indicators.length > 0) {
      metrics.quality_indicators_on_target = quality_indicators[0].on_target;
    }

    // Query complaint resolution
    const complaints = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sc_status = 'resolved' THEN 1 ELSE 0 END) as resolved
      FROM sewa_complaints
      WHERE hospital_id = ${hospital_id}
        AND sc_submitted_at >= ${formatDate(current_start)}
        AND sc_submitted_at <= ${formatDate(current_end)}
    `;

    if (complaints.length > 0 && complaints[0].total > 0) {
      metrics.complaint_resolution_rate = complaints[0].resolved / complaints[0].total;
    }

    // Query SLA compliance
    const sla_data = await sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN sc_resolved_at <= resolution_sla_due_at THEN 1 ELSE 0 END) as sla_met
      FROM sewa_complaints
      WHERE hospital_id = ${hospital_id}
        AND sc_submitted_at >= ${formatDate(current_start)}
        AND sc_submitted_at <= ${formatDate(current_end)}
        AND sc_resolved_at IS NOT NULL
    `;

    if (sla_data.length > 0 && sla_data[0].total > 0) {
      metrics.sla_compliance_rate = sla_data[0].sla_met / sla_data[0].total;
    }

    // Try LLM generation
    const llmResult = await generateInsight({
      hospital_id,
      module: 'quality',
      system_prompt:
        'You are a hospital compliance and quality officer. Generate a concise narrative about compliance posture and safety performance.',
      user_prompt: `Analyze these compliance metrics and provide a narrative summary:\n${JSON.stringify(metrics, null, 2)}`,
      max_tokens: 300,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (llmResult?.content) {
      narrative = llmResult.content.trim();
      source = 'llm';
    } else {
      narrative = generateComplianceTemplateFallback(metrics);
    }
  } catch (error) {
    console.error('[AI-QualityReports] Failed to generate compliance report:', error);
    narrative = generateComplianceTemplateFallback(metrics);
  }

  const card = await createQualityInsightCard(hospital_id, 'compliance', narrative, metrics, source);

  return {
    hospital_id,
    report_type: 'compliance',
    period_start: formatDate(current_start),
    period_end: formatDate(current_end),
    metrics,
    narrative,
    source,
    card,
  };
}

export async function generateQualityDashboardSummary(hospital_id: string): Promise<QualityReport> {
  let combined_narrative = '';
  let source: 'llm' | 'template' = 'template';
  const all_metrics: Record<string, any> = {};

  try {
    // Generate all three reports
    const incident_report = await generateIncidentTrendReport(hospital_id, 30);
    const infection_report = await generateInfectionReport(hospital_id, 30);
    const compliance_report = await generateComplianceReport(hospital_id, 30);

    all_metrics.incidents = incident_report.metrics;
    all_metrics.infections = infection_report.metrics;
    all_metrics.compliance = compliance_report.metrics;

    const combined_data = `
INCIDENT TRENDS:
${incident_report.narrative}

INFECTION SURVEILLANCE:
${infection_report.narrative}

COMPLIANCE & SAFETY:
${compliance_report.narrative}
    `.trim();

    // Try LLM generation for combined summary
    const llmResult = await generateInsight({
      hospital_id,
      module: 'quality',
      system_prompt:
        'You are a hospital executive dashboard expert. Synthesize quality, safety, and compliance data into a concise, actionable executive summary.',
      user_prompt: `Create a brief executive summary from these three reports:\n${combined_data}`,
      max_tokens: 400,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (llmResult?.content) {
      combined_narrative = llmResult.content.trim();
      source = 'llm';
    } else {
      combined_narrative = `
QUALITY EXECUTIVE SUMMARY

${incident_report.narrative}

${infection_report.narrative}

${compliance_report.narrative}
      `.trim();
    }
  } catch (error) {
    console.error('[AI-QualityReports] Failed to generate dashboard summary:', error);
    combined_narrative = 'Quality reporting summary unavailable. Please check individual reports.';
  }

  const card = await createQualityInsightCard(hospital_id, 'dashboard_summary', combined_narrative, all_metrics, source);

  return {
    hospital_id,
    report_type: 'dashboard_summary',
    period_start: formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    period_end: formatDate(new Date()),
    metrics: all_metrics,
    narrative: combined_narrative,
    source,
    card,
  };
}
