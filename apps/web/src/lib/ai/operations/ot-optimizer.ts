import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity, CardCategory } from '../types';
import { generateInsight } from '../llm-client';

// Initialize Neon SQL client
let _sql: any = null;
function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

/**
 * Helper function to build OT-specific InsightCards
 */
function buildOTCard(hospital_id: string, opts: {
  severity: CardSeverity;
  title: string;
  body: string;
  explanation: string;
  data_sources: string[];
  category?: CardCategory;
  action_url?: string;
  suggested_action?: string;
}): InsightCard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hospital_id,
    module: 'ot',
    category: opts.category || 'suggestion',
    severity: opts.severity,
    title: opts.title,
    body: opts.body,
    explanation: opts.explanation,
    data_sources: opts.data_sources,
    action_url: opts.action_url,
    suggested_action: opts.suggested_action,
    confidence: 0.85,
    source: 'template',
    status: 'active',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Helper function to insert InsightCard into database with 24h expiry
 */
async function insertOTCard(card: InsightCard): Promise<void> {
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
}

/**
 * Analyzes today's OT schedule for efficiency issues
 * - Identifies gaps between procedures
 * - Detects overlaps/double-booking
 * - Flags historically overrunning procedures
 * - Identifies underutilized rooms
 */
export async function analyzeOTSchedule(hospital_id: string) {
  const sql = getSql();

  // Get today's OT schedules
  const schedules = await sql`
    SELECT
      os.id,
      os.room_id,
      os.start_time,
      os.end_time,
      os.scheduled_date,
      os.status,
      os.procedure_type,
      os.actual_start,
      os.actual_end,
      or.name as room_name,
      or.room_number
    FROM ot_schedules os
    JOIN ot_rooms or ON os.room_id = or.id
    WHERE os.hospital_id = ${hospital_id}
      AND os.scheduled_date = CURRENT_DATE
    ORDER BY or.id, os.start_time
  `;

  // Get OT rooms for utilization baseline
  const rooms = await sql`
    SELECT id, name, room_number, status
    FROM ot_rooms
    WHERE hospital_id = ${hospital_id}
  `;

  // Analyze historical overruns (last 30 days completed procedures)
  const historicalData = await sql`
    SELECT
      procedure_type,
      EXTRACT(EPOCH FROM (actual_end - actual_start)) / 60 as duration_min,
      EXTRACT(EPOCH FROM (end_time - start_time)) / 60 as scheduled_duration_min
    FROM ot_schedules
    WHERE hospital_id = ${hospital_id}
      AND status = 'completed'
      AND scheduled_date >= CURRENT_DATE - INTERVAL '30 days'
      AND actual_start IS NOT NULL
      AND actual_end IS NOT NULL
  `;

  const cards: InsightCard[] = [];
  let gapsFound = 0;
  let overlapsFound = 0;

  // Group schedules by room
  const schedulesByRoom: Record<string, any[]> = {};
  for (const schedule of schedules) {
    if (!schedulesByRoom[schedule.room_id]) {
      schedulesByRoom[schedule.room_id] = [];
    }
    schedulesByRoom[schedule.room_id].push(schedule);
  }

  // Analyze gaps and overlaps per room
  for (const [roomId, roomSchedules] of Object.entries(schedulesByRoom)) {
    const sorted = roomSchedules.sort((a, b) => {
      const timeA = new Date(`2000-01-01T${a.start_time}`).getTime();
      const timeB = new Date(`2000-01-01T${b.start_time}`).getTime();
      return timeA - timeB;
    });

    const roomInfo = roomSchedules[0];

    // Check for gaps
    for (let i = 0; i < sorted.length - 1; i++) {
      const endTime = new Date(`2000-01-01T${sorted[i].end_time}`).getTime();
      const nextStart = new Date(`2000-01-01T${sorted[i + 1].start_time}`).getTime();
      const gapMin = (nextStart - endTime) / (1000 * 60);

      if (gapMin > 60) {
        gapsFound++;
        const card = buildOTCard(hospital_id, {
          severity: 'medium',
          category: 'suggestion',
          title: `Scheduling Gap in ${roomInfo.room_name}`,
          body: `${gapMin.toFixed(0)} minute gap between procedures ${sorted[i].procedure_type} and ${sorted[i + 1].procedure_type}`,
          explanation: `Large gaps between procedures reduce room utilization and increase overhead costs. Consider consolidating schedules or bringing forward non-emergency procedures.`,
          data_sources: ['ot_schedules'],
          suggested_action: 'Review and consolidate OT schedule',
          action_url: `/admin/ot/schedule?room=${roomId}&date=${roomInfo.scheduled_date}`,
        });
        cards.push(card);
      }
    }

    // Check for overlaps
    for (let i = 0; i < sorted.length - 1; i++) {
      const endTime = new Date(`2000-01-01T${sorted[i].end_time}`).getTime();
      const nextStart = new Date(`2000-01-01T${sorted[i + 1].start_time}`).getTime();

      if (endTime > nextStart) {
        overlapsFound++;
        const card = buildOTCard(hospital_id, {
          severity: 'high',
          category: 'alert',
          title: `Scheduling Conflict in ${roomInfo.room_name}`,
          body: `Double-booking detected: ${sorted[i].procedure_type} overlaps with ${sorted[i + 1].procedure_type}`,
          explanation: `OT rooms cannot accommodate simultaneous procedures. Immediate intervention required to reassign one procedure to another room or reschedule.`,
          data_sources: ['ot_schedules'],
          suggested_action: 'Resolve scheduling conflict immediately',
          action_url: `/admin/ot/schedule?room=${roomId}&date=${roomInfo.scheduled_date}&conflict=true`,
        });
        cards.push(card);
      }
    }
  }

  // Calculate utilization per room
  const roomUtilization: Record<string, { scheduled_min: number; room_name: string; room_number: string }> = {};
  for (const room of rooms) {
    roomUtilization[room.id] = { scheduled_min: 0, room_name: room.name, room_number: room.room_number };
  }

  for (const schedule of schedules) {
    if (schedule.status === 'scheduled' || schedule.status === 'completed' || schedule.status === 'in-progress') {
      const start = new Date(`2000-01-01T${schedule.start_time}`).getTime();
      const end = new Date(`2000-01-01T${schedule.end_time}`).getTime();
      roomUtilization[schedule.room_id].scheduled_min += (end - start) / (1000 * 60);
    }
  }

  // Flag underutilized rooms (< 50% utilization assuming 8-hour OT day)
  const otDayMin = 8 * 60; // 480 minutes
  for (const [roomId, data] of Object.entries(roomUtilization)) {
    const utilization = (data.scheduled_min / otDayMin) * 100;
    if (utilization < 50 && utilization > 0) {
      const card = buildOTCard(hospital_id, {
        severity: 'low',
        category: 'suggestion',
        title: `Low Utilization: ${data.room_name}`,
        body: `Room utilization at ${utilization.toFixed(0)}% for today. Consider scheduling additional procedures.`,
        explanation: `Underutilized OT rooms represent lost capacity and increased per-procedure overhead. Improving scheduling efficiency can optimize resource allocation.`,
        data_sources: ['ot_schedules', 'ot_rooms'],
        suggested_action: 'Add procedures to schedule',
        action_url: `/admin/ot/schedule?room=${roomId}&date=${new Date().toISOString().split('T')[0]}`,
      });
      cards.push(card);
    }
  }

  // Detect procedures with historical overruns
  const procedureOverruns: Record<string, { count: number; avg_actual: number; avg_scheduled: number }> = {};
  for (const record of historicalData) {
    if (!procedureOverruns[record.procedure_type]) {
      procedureOverruns[record.procedure_type] = { count: 0, avg_actual: 0, avg_scheduled: 0 };
    }
    procedureOverruns[record.procedure_type].count++;
    procedureOverruns[record.procedure_type].avg_actual += record.duration_min || 0;
    procedureOverruns[record.procedure_type].avg_scheduled += record.scheduled_duration_min || 0;
  }

  for (const [procType, data] of Object.entries(procedureOverruns)) {
    const avgActual = data.avg_actual / data.count;
    const avgScheduled = data.avg_scheduled / data.count;
    const overrunMin = avgActual - avgScheduled;

    if (overrunMin > 5) {
      // More than 5 minute average overrun
      const card = buildOTCard(hospital_id, {
        severity: 'medium',
        category: 'prediction',
        title: `${procType} Procedures Historically Overrun`,
        body: `${procType} procedures average ${overrunMin.toFixed(0)} min over scheduled time (${data.count} procedures in past 30 days).`,
        explanation: `Historical data shows this procedure type consistently exceeds scheduled duration. Allocate additional time in future schedules to prevent cascade delays.`,
        data_sources: ['ot_schedules'],
        suggested_action: 'Adjust procedure duration in schedule templates',
        action_url: `/admin/ot/procedure-templates?type=${encodeURIComponent(procType)}`,
      });
      cards.push(card);
    }
  }

  // Insert all cards
  for (const card of cards) {
    await insertOTCard(card);
  }

  // Calculate total utilization
  const totalScheduledMin = Object.values(roomUtilization).reduce((sum, r) => sum + r.scheduled_min, 0);
  const totalCapacityMin = rooms.length * otDayMin;
  const utilizationPct = totalCapacityMin > 0 ? (totalScheduledMin / totalCapacityMin) * 100 : 0;

  return {
    total_procedures: schedules.length,
    utilization_pct: Math.round(utilizationPct),
    gaps_found: gapsFound,
    overlaps_found: overlapsFound,
    cards,
  };
}

/**
 * Analyzes OT turnover times between procedures
 * Returns per-room and overall statistics
 */
export async function getOTTurnoverAnalysis(hospital_id: string, days: number = 30) {
  const sql = getSql();

  // Get completed procedures from last N days, ordered chronologically per room
  const procedures = await sql`
    SELECT
      os.id,
      os.room_id,
      os.actual_end,
      os.actual_start,
      os.procedure_type,
      or.name as room_name,
      or.room_number,
      LAG(os.actual_end) OVER (
        PARTITION BY os.room_id
        ORDER BY os.actual_end
      ) as prev_procedure_end
    FROM ot_schedules os
    JOIN ot_rooms or ON os.room_id = or.id
    WHERE os.hospital_id = ${hospital_id}
      AND os.status = 'completed'
      AND os.scheduled_date >= CURRENT_DATE - INTERVAL '${days} days'
      AND os.actual_start IS NOT NULL
      AND os.actual_end IS NOT NULL
    ORDER BY os.room_id, os.actual_end
  `;

  // Calculate turnover times per room
  const roomStats: Record<string, {
    room_id: string;
    room_name: string;
    room_number: string;
    turnovers: number[];
    procedure_count: number;
  }> = {};

  for (const proc of procedures) {
    if (!roomStats[proc.room_id]) {
      roomStats[proc.room_id] = {
        room_id: proc.room_id,
        room_name: proc.room_name,
        room_number: proc.room_number,
        turnovers: [],
        procedure_count: 0,
      };
    }

    roomStats[proc.room_id].procedure_count++;

    if (proc.prev_procedure_end) {
      const prevEnd = new Date(proc.prev_procedure_end).getTime();
      const currStart = new Date(proc.actual_start).getTime();
      const turnoverMin = (currStart - prevEnd) / (1000 * 60);
      if (turnoverMin >= 0) {
        roomStats[proc.room_id].turnovers.push(turnoverMin);
      }
    }
  }

  // Calculate averages and utilization
  const rooms = Object.values(roomStats).map(room => {
    const avgTurnover = room.turnovers.length > 0
      ? room.turnovers.reduce((a, b) => a + b, 0) / room.turnovers.length
      : 0;

    // Rough utilization: assume 8-hour OT day minus turnovers
    const totalTurnoverMin = room.turnovers.reduce((a, b) => a + b, 0);
    const otDayMin = 8 * 60;
    const utilization = Math.max(0, 100 - ((totalTurnoverMin / otDayMin) * 100));

    return {
      room_id: room.room_id,
      room_name: room.room_name,
      room_number: room.room_number,
      avg_turnover_min: Math.round(avgTurnover * 10) / 10,
      procedure_count: room.procedure_count,
      utilization_pct: Math.round(utilization),
    };
  });

  // Calculate overall average
  const allTurnovers = Object.values(roomStats).flatMap(r => r.turnovers);
  const overallAvgTurnover = allTurnovers.length > 0
    ? allTurnovers.reduce((a, b) => a + b, 0) / allTurnovers.length
    : 0;

  return {
    rooms,
    overall_avg_turnover_min: Math.round(overallAvgTurnover * 10) / 10,
  };
}

/**
 * Generates LLM-enhanced OT efficiency report
 * Combines utilization data, cancellations, and delays into narrative analysis
 */
export async function getOTEfficiencyReport(hospital_id: string) {
  const sql = getSql();

  // Gather metrics
  const scheduleStats = await sql`
    SELECT
      COUNT(*) as total_procedures,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      ROUND(AVG(CASE
        WHEN status = 'completed' AND actual_start IS NOT NULL AND start_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (actual_start - start_time::timestamp)) / 60
        ELSE 0
      END)::numeric, 1) as avg_delay_min
    FROM ot_schedules
    WHERE hospital_id = ${hospital_id}
      AND scheduled_date >= CURRENT_DATE - INTERVAL '7 days'
  `;

  const stats = scheduleStats[0] || {
    total_procedures: 0,
    cancelled_count: 0,
    completed_count: 0,
    avg_delay_min: 0,
  };

  // Get procedure type distribution
  const procTypes = await sql`
    SELECT
      procedure_type,
      COUNT(*) as count
    FROM ot_schedules
    WHERE hospital_id = ${hospital_id}
      AND scheduled_date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY procedure_type
    ORDER BY count DESC
    LIMIT 5
  `;

  // Get turnover analysis
  const turnoverData = await getOTTurnoverAnalysis(hospital_id, 7);

  // Prepare context for LLM
  const systemPrompt = `You are an expert hospital operations analyst specializing in Operating Theatre (OT) efficiency.
Analyze OT metrics and provide actionable, specific recommendations to improve scheduling efficiency, reduce delays, and optimize room utilization.
Focus on data-driven insights that can be implemented immediately.`;

  const procedureList = procTypes.map((p: any) => `${p.procedure_type} (${p.count} procedures)`).join(', ');
  const topRooms = turnoverData.rooms
    .sort((a: any, b: any) => b.utilization_pct - a.utilization_pct)
    .slice(0, 3)
    .map((r: any) => `${r.room_name}: ${r.utilization_pct}% utilization, ${r.avg_turnover_min} min avg turnover`)
    .join('; ');

  const userPrompt = `Analyze this 7-day OT performance:
- Total procedures: ${stats.total_procedures}
- Completed: ${stats.completed_count}
- Cancelled: ${stats.cancelled_count} (${stats.total_procedures > 0 ? ((stats.cancelled_count / stats.total_procedures) * 100).toFixed(1) : 0}% cancellation rate)
- Average delay: ${stats.avg_delay_min} minutes
- Common procedures: ${procedureList || 'none'}
- Top rooms: ${topRooms || 'insufficient data'}
- Overall avg turnover: ${turnoverData.overall_avg_turnover_min} minutes

Provide 3-4 specific, actionable recommendations for improving efficiency.`;

  let narrative = '';
  let source: 'llm' | 'template' | 'hybrid' = 'template';

  try {
    // Call LLM for enhanced analysis
    const llmResponse = await generateInsight({
      hospital_id,
      module: 'ot',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 400,
      temperature: 0.7,
      triggered_by: 'cron',
    });

    if (llmResponse && typeof llmResponse === 'object' && 'content' in llmResponse) {
      narrative = llmResponse.content;
      source = 'llm';
    }
  } catch (error) {
    console.warn('OT LLM analysis failed, using template fallback:', error);
    source = 'template';
  }

  // Template fallback
  if (!narrative) {
    const cancellationRate = stats.total_procedures > 0 ? ((stats.cancelled_count / stats.total_procedures) * 100).toFixed(1) : 0;
    narrative = `OT Efficiency Analysis (7-day period):

The operating theatre completed ${stats.completed_count} of ${stats.total_procedures} scheduled procedures (${cancellationRate}% cancellation rate), with an average delay of ${stats.avg_delay_min} minutes.

Top performing room shows ${turnoverData.rooms[0]?.utilization_pct || 0}% utilization with ${turnoverData.overall_avg_turnover_min}-minute average turnover time.

Key recommendations:
1. Standardize turnover protocols to reduce variability (current range: ${Math.min(...turnoverData.rooms.map((r: any) => r.avg_turnover_min))} - ${Math.max(...turnoverData.rooms.map((r: any) => r.avg_turnover_min))} minutes)
2. Implement buffer time in schedules to accommodate ${stats.avg_delay_min > 0 ? 'chronic delays' : 'schedule drift'}
3. Review cancellation drivers and implement pre-operative verification checklists
4. Consolidate procedures by type to optimize staff and equipment allocation`;
  }

  // Build insight card
  const card = buildOTCard(hospital_id, {
    severity: 'info',
    category: 'report',
    title: 'Weekly OT Efficiency Report',
    body: narrative.substring(0, 200) + '...',
    explanation: `This report synthesizes OT scheduling data from the past 7 days to identify efficiency opportunities and operational bottlenecks.`,
    data_sources: ['ot_schedules', 'ot_rooms'],
    suggested_action: 'Review full report and scheduling trends',
    action_url: '/admin/ot/efficiency-report',
  });

  // Insert card
  await insertOTCard(card);

  return {
    narrative,
    metrics: {
      total_procedures: stats.total_procedures,
      completed: stats.completed_count,
      cancelled: stats.cancelled_count,
      cancellation_rate_pct: stats.total_procedures > 0 ? ((stats.cancelled_count / stats.total_procedures) * 100).toFixed(1) : 0,
      avg_delay_min: stats.avg_delay_min,
      avg_turnover_min: turnoverData.overall_avg_turnover_min,
      top_procedures: procTypes.map((p: any) => p.procedure_type),
      top_rooms: turnoverData.rooms.slice(0, 3),
    },
    source,
    card,
  };
}
