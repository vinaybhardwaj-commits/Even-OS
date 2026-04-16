import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeEvent } from '@/lib/event-log';
import { onVitalsRecorded } from '@/lib/chat/auto-events';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// TYPE DEFINITIONS & VALIDATORS
// ============================================================

const observationTypeEnum = z.enum([
  'vital_temperature', 'vital_pulse', 'vital_bp_systolic', 'vital_bp_diastolic',
  'vital_spo2', 'vital_rr', 'vital_pain_score', 'vital_weight', 'vital_height', 'vital_bmi',
  'intake_iv', 'intake_oral', 'output_urine', 'output_drain', 'output_emesis',
]);

const ioTypeEnum = z.enum(['intake_iv', 'intake_oral', 'output_urine', 'output_drain', 'output_emesis']);

const alertSeverityEnum = z.enum(['warning', 'critical']);

// ============================================================
// NEWS2 HELPER: Calculate NEWS2 Score from Vital Observations
// ============================================================

interface NEWS2Input {
  temperature?: number;
  systolic_bp?: number;
  spo2?: number;
  pulse?: number;
  rr?: number;
}

interface NEWS2Result {
  temperature_score: number;
  systolic_score: number;
  spo2_score: number;
  pulse_score: number;
  rr_score: number;
  total_score: number;
  risk_level: 'low' | 'medium' | 'high';
}

function calculateNEWS2(vitals: NEWS2Input): NEWS2Result {
  let temp_score = 0;
  let sys_score = 0;
  let spo2_score = 0;
  let pulse_score = 0;
  let rr_score = 0;

  // Temperature scoring
  if (vitals.temperature !== undefined) {
    if (vitals.temperature <= 35.0) temp_score = 3;
    else if (vitals.temperature <= 36.0) temp_score = 1;
    else if (vitals.temperature <= 38.0) temp_score = 0;
    else if (vitals.temperature <= 39.0) temp_score = 1;
    else temp_score = 2;
  }

  // Systolic BP scoring
  if (vitals.systolic_bp !== undefined) {
    if (vitals.systolic_bp <= 90) sys_score = 3;
    else if (vitals.systolic_bp <= 100) sys_score = 2;
    else if (vitals.systolic_bp <= 110) sys_score = 1;
    else if (vitals.systolic_bp <= 219) sys_score = 0;
    else sys_score = 3;
  }

  // SpO2 scoring
  if (vitals.spo2 !== undefined) {
    if (vitals.spo2 <= 91) spo2_score = 3;
    else if (vitals.spo2 <= 93) spo2_score = 2;
    else if (vitals.spo2 <= 95) spo2_score = 1;
    else spo2_score = 0;
  }

  // Pulse scoring
  if (vitals.pulse !== undefined) {
    if (vitals.pulse <= 40) pulse_score = 3;
    else if (vitals.pulse <= 50) pulse_score = 1;
    else if (vitals.pulse <= 90) pulse_score = 0;
    else if (vitals.pulse <= 110) pulse_score = 1;
    else if (vitals.pulse <= 130) pulse_score = 2;
    else pulse_score = 3;
  }

  // Respiratory Rate scoring
  if (vitals.rr !== undefined) {
    if (vitals.rr <= 8) rr_score = 3;
    else if (vitals.rr <= 11) rr_score = 1;
    else if (vitals.rr <= 20) rr_score = 0;
    else if (vitals.rr <= 24) rr_score = 2;
    else rr_score = 3;
  }

  const total_score = temp_score + sys_score + spo2_score + pulse_score + rr_score;

  let risk_level: 'low' | 'medium' | 'high';
  if (total_score <= 4) risk_level = 'low';
  else if (total_score <= 6) risk_level = 'medium';
  else risk_level = 'high';

  return {
    temperature_score: temp_score,
    systolic_score: sys_score,
    spo2_score: spo2_score,
    pulse_score: pulse_score,
    rr_score: rr_score,
    total_score,
    risk_level,
  };
}

// ============================================================
// ALERT CHECKING HELPER
// ============================================================

interface VitalAlert {
  observation_type: string;
  value: number;
  unit: string;
  threshold: number;
  direction: 'above' | 'below';
}

function checkVitalThresholds(vitals: Record<string, number | undefined>): VitalAlert[] {
  const alerts: VitalAlert[] = [];

  if (vitals.temperature !== undefined) {
    if (vitals.temperature > 39) alerts.push({ observation_type: 'vital_temperature', value: vitals.temperature, unit: '°C', threshold: 39, direction: 'above' });
    if (vitals.temperature < 35) alerts.push({ observation_type: 'vital_temperature', value: vitals.temperature, unit: '°C', threshold: 35, direction: 'below' });
  }

  if (vitals.spo2 !== undefined) {
    if (vitals.spo2 < 90) alerts.push({ observation_type: 'vital_spo2', value: vitals.spo2, unit: '%', threshold: 90, direction: 'below' });
  }

  if (vitals.bp_systolic !== undefined) {
    if (vitals.bp_systolic > 180) alerts.push({ observation_type: 'vital_bp_systolic', value: vitals.bp_systolic, unit: 'mmHg', threshold: 180, direction: 'above' });
    if (vitals.bp_systolic < 90) alerts.push({ observation_type: 'vital_bp_systolic', value: vitals.bp_systolic, unit: 'mmHg', threshold: 90, direction: 'below' });
  }

  if (vitals.rr !== undefined) {
    if (vitals.rr > 30) alerts.push({ observation_type: 'vital_rr', value: vitals.rr, unit: 'breaths/min', threshold: 30, direction: 'above' });
  }

  if (vitals.pulse !== undefined) {
    if (vitals.pulse > 120) alerts.push({ observation_type: 'vital_pulse', value: vitals.pulse, unit: 'bpm', threshold: 120, direction: 'above' });
  }

  return alerts;
}

// ============================================================
// TRPC ROUTER
// ============================================================

export const observationsRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. CREATE VITALS (mutation)
  // ─────────────────────────────────────────────────────────
  createVitals: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      effective_datetime: z.string().datetime(),
      temperature: z.number().optional(),
      pulse: z.number().int().optional(),
      bp_systolic: z.number().int().optional(),
      bp_diastolic: z.number().int().optional(),
      spo2: z.number().optional(),
      rr: z.number().int().optional(),
      pain_score: z.number().int().min(0).max(10).optional(),
      weight: z.number().optional(),
      height: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;
        const insertedObs: any[] = [];
        let bmiValue: number | null = null;
        let bmiObsId: string | null = null;

        // 1. Insert each vital as separate observation row
        const vitalsMap: Record<string, { type: string; value: number; unit: string }> = {};

        if (input.temperature !== undefined) {
          vitalsMap['temperature'] = { type: 'vital_temperature', value: input.temperature, unit: '°C' };
        }
        if (input.pulse !== undefined) {
          vitalsMap['pulse'] = { type: 'vital_pulse', value: input.pulse, unit: 'bpm' };
        }
        if (input.bp_systolic !== undefined) {
          vitalsMap['bp_systolic'] = { type: 'vital_bp_systolic', value: input.bp_systolic, unit: 'mmHg' };
        }
        if (input.bp_diastolic !== undefined) {
          vitalsMap['bp_diastolic'] = { type: 'vital_bp_diastolic', value: input.bp_diastolic, unit: 'mmHg' };
        }
        if (input.spo2 !== undefined) {
          vitalsMap['spo2'] = { type: 'vital_spo2', value: input.spo2, unit: '%' };
        }
        if (input.rr !== undefined) {
          vitalsMap['rr'] = { type: 'vital_rr', value: input.rr, unit: 'breaths/min' };
        }
        if (input.pain_score !== undefined) {
          vitalsMap['pain_score'] = { type: 'vital_pain_score', value: input.pain_score, unit: 'score' };
        }
        if (input.weight !== undefined) {
          vitalsMap['weight'] = { type: 'vital_weight', value: input.weight, unit: 'kg' };
        }
        if (input.height !== undefined) {
          vitalsMap['height'] = { type: 'vital_height', value: input.height, unit: 'cm' };
        }

        // Insert each vital
        for (const [key, vital] of Object.entries(vitalsMap)) {
          const result = await getSql()`
            INSERT INTO observations (
              hospital_id,
              patient_id,
              encounter_id,
              observation_type,
              status,
              value_quantity,
              unit,
              effective_datetime,
              recorded_by,
              created_at
            )
            VALUES (
              ${hospitalId},
              ${input.patient_id},
              ${input.encounter_id},
              ${vital.type}::"observation_type",
              'final',
              ${vital.value},
              ${vital.unit},
              ${input.effective_datetime},
              ${userId},
              NOW()
            )
            RETURNING id, observation_type, value_quantity, unit;
          `;

          const rows = result as any[];
          if (rows && rows.length > 0) {
            insertedObs.push(rows[0]);
          }
        }

        // 2. Auto-calculate BMI if both weight and height provided
        if (input.weight !== undefined && input.height !== undefined && input.height > 0) {
          bmiValue = input.weight / ((input.height / 100) ** 2);
          const bmiResult = await getSql()`
            INSERT INTO observations (
              hospital_id,
              patient_id,
              encounter_id,
              observation_type,
              status,
              value_quantity,
              unit,
              effective_datetime,
              recorded_by,
              created_at
            )
            VALUES (
              ${hospitalId},
              ${input.patient_id},
              ${input.encounter_id},
              'vital_bmi'::"observation_type",
              'final',
              ${bmiValue},
              'kg/m²',
              ${input.effective_datetime},
              ${userId},
              NOW()
            )
            RETURNING id;
          `;

          const bmiRows = bmiResult as any[];
          if (bmiRows && bmiRows.length > 0) {
            bmiObsId = bmiRows[0].id;
            insertedObs.push({ id: bmiObsId, observation_type: 'vital_bmi', value_quantity: bmiValue, unit: 'kg/m²' });
          }
        }

        // 3. Calculate NEWS2 score and insert
        const news2Input: NEWS2Input = {
          temperature: input.temperature,
          systolic_bp: input.bp_systolic,
          spo2: input.spo2,
          pulse: input.pulse,
          rr: input.rr,
        };

        const news2 = calculateNEWS2(news2Input);

        // Find observation IDs for NEWS2 source tracking (use first inserted obs IDs)
        const tempObs = insertedObs.find(o => o.observation_type === 'vital_temperature');
        const sysObs = insertedObs.find(o => o.observation_type === 'vital_bp_systolic');
        const spo2Obs = insertedObs.find(o => o.observation_type === 'vital_spo2');
        const pulseObs = insertedObs.find(o => o.observation_type === 'vital_pulse');
        const rrObs = insertedObs.find(o => o.observation_type === 'vital_rr');

        const newsResult = await getSql()`
          INSERT INTO news2_scores (
            hospital_id,
            patient_id,
            encounter_id,
            temperature_score,
            systolic_score,
            diastolic_score,
            spo2_score,
            pulse_score,
            rr_score,
            avpu_score,
            total_score,
            risk_level,
            temperature_obs_id,
            systolic_obs_id,
            spo2_obs_id,
            pulse_obs_id,
            rr_obs_id,
            calculated_at,
            calculated_by
          )
          VALUES (
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            ${news2.temperature_score},
            ${news2.systolic_score},
            0,
            ${news2.spo2_score},
            ${news2.pulse_score},
            ${news2.rr_score},
            0,
            ${news2.total_score},
            ${news2.risk_level}::"news2_risk_level",
            ${tempObs?.id || null},
            ${sysObs?.id || null},
            ${spo2Obs?.id || null},
            ${pulseObs?.id || null},
            ${rrObs?.id || null},
            NOW(),
            ${userId}
          )
          RETURNING id, total_score, risk_level;
        `;

        const newsRows = newsResult as any[];
        const news2Score = newsRows?.[0];

        // 4. Check for vital alerts
        const alerts = checkVitalThresholds({
          temperature: input.temperature,
          bp_systolic: input.bp_systolic,
          spo2: input.spo2,
          pulse: input.pulse,
          rr: input.rr,
        });

        // Insert alert for high NEWS2 if applicable
        if (news2.risk_level === 'high') {
          alerts.push({
            observation_type: 'news2_high',
            value: news2.total_score,
            unit: 'score',
            threshold: 7,
            direction: 'above',
          });
        }

        // Insert all alerts
        for (const alert of alerts) {
          const obsId = insertedObs.find(o => o.observation_type === alert.observation_type)?.id || null;
          const severity = alert.observation_type === 'news2_high' ? 'critical' : (alert.direction === 'above' ? 'warning' : 'critical');
          const message = `${alert.observation_type} ${alert.direction} threshold: ${alert.value} ${alert.unit} (threshold: ${alert.threshold})`;

          await getSql()`
            INSERT INTO clinical_alert_logs (
              hospital_id,
              patient_id,
              encounter_id,
              alert_type,
              observation_id,
              threshold_value,
              actual_value,
              unit,
              severity,
              message,
              created_at
            )
            VALUES (
              ${hospitalId},
              ${input.patient_id},
              ${input.encounter_id},
              ${alert.observation_type}::"observation_type",
              ${obsId},
              ${alert.threshold},
              ${alert.value},
              ${alert.unit},
              ${severity}::"alert_severity",
              ${message},
              NOW()
            );
          `;
        }

        // Log event for main vitals set (fire-and-forget)
        try {
          if (insertedObs.length > 0) {
            await writeEvent({
              hospital_id: hospitalId,
              resource_type: 'observation',
              resource_id: insertedObs[0].id,
              event_type: 'created',
              data: {
                patient_id: input.patient_id,
                encounter_id: input.encounter_id,
                effective_datetime: input.effective_datetime,
                temperature: input.temperature || null,
                pulse: input.pulse || null,
                bp_systolic: input.bp_systolic || null,
                bp_diastolic: input.bp_diastolic || null,
                spo2: input.spo2 || null,
                rr: input.rr || null,
                pain_score: input.pain_score || null,
                weight: input.weight || null,
                height: input.height || null,
                observation_count: insertedObs.length,
              },
              actor_id: userId,
              actor_email: ctx.user.email,
            });
          }
        } catch (error) {
          console.error('Failed to write event log for vitals creation:', error);
        }

        // OC.4b: Post vitals event to patient channel (fire-and-forget)
        if (input.encounter_id) {
          const parts: string[] = [];
          if (input.bp_systolic && input.bp_diastolic) parts.push(`BP ${input.bp_systolic}/${input.bp_diastolic}`);
          if (input.pulse) parts.push(`HR ${input.pulse}`);
          if (input.spo2) parts.push(`SpO2 ${input.spo2}%`);
          if (input.temperature) parts.push(`Temp ${input.temperature}°F`);
          if (input.rr) parts.push(`RR ${input.rr}`);
          onVitalsRecorded({
            encounter_id: input.encounter_id,
            hospital_id: ctx.user.hospital_id,
            vitals_summary: parts.join(', ') || 'recorded',
            news2_score: news2Score?.total_score ?? null,
            news2_risk: news2Score?.risk_level ?? null,
            recorded_by: ctx.user.name,
          }).catch(() => {});
        }

        return {
          success: true,
          vitals: insertedObs,
          news2: news2Score,
          alerts_created: alerts.length,
        };
      } catch (error) {
        console.error('createVitals error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create vitals: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 2. LIST VITALS (query)
  // ─────────────────────────────────────────────────────────
  listVitals: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
      start_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const query = getSql()`
          SELECT
            id,
            observation_type,
            value_quantity,
            unit,
            effective_datetime,
            status,
            created_at
          FROM observations
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            AND observation_type LIKE 'vital_%'
            ${input.encounter_id ? getSql()`AND encounter_id = ${input.encounter_id}` : getSql()``}
            ${input.start_date ? getSql()`AND effective_datetime >= ${input.start_date}` : getSql()``}
            ${input.end_date ? getSql()`AND effective_datetime <= ${input.end_date}` : getSql()``}
          ORDER BY effective_datetime DESC
          LIMIT ${input.limit}
          OFFSET ${input.offset};
        `;

        const rows = (await query) as any[];
        return {
          success: true,
          vitals: rows || [],
          count: rows?.length || 0,
        };
      } catch (error) {
        console.error('listVitals error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list vitals',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 3. GET TREND (query) — Time-series for charting
  // ─────────────────────────────────────────────────────────
  getTrend: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      observation_type: z.string(),
      days: z.number().int().min(1).max(365).default(7),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - input.days);

        const rows = (await getSql()`
          SELECT
            effective_datetime,
            value_quantity,
            unit
          FROM observations
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            AND observation_type = ${input.observation_type}::"observation_type"
            AND effective_datetime >= ${daysAgo.toISOString()}
          ORDER BY effective_datetime ASC;
        `) as any[];

        return {
          success: true,
          trend: rows || [],
          observation_type: input.observation_type,
          days: input.days,
        };
      } catch (error) {
        console.error('getTrend error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get trend data',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 4. GET LATEST VITALS (query)
  // ─────────────────────────────────────────────────────────
  getLatestVitals: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Fetch latest observation for each vital type
        const query = getSql()`
          WITH ranked_vitals AS (
            SELECT
              observation_type,
              value_quantity,
              unit,
              effective_datetime,
              ROW_NUMBER() OVER (PARTITION BY observation_type ORDER BY effective_datetime DESC) as rn
            FROM observations
            WHERE hospital_id = ${hospitalId}
              AND patient_id = ${input.patient_id}
              AND observation_type LIKE 'vital_%'
              ${input.encounter_id ? getSql()`AND encounter_id = ${input.encounter_id}` : getSql()``}
          )
          SELECT
            observation_type,
            value_quantity,
            unit,
            effective_datetime
          FROM ranked_vitals
          WHERE rn = 1
          ORDER BY effective_datetime DESC;
        `;

        const rows = (await query) as any[];

        // Transform to object keyed by vital type
        const vitals: Record<string, any> = {
          temperature: null,
          pulse: null,
          bp_systolic: null,
          bp_diastolic: null,
          spo2: null,
          rr: null,
          pain_score: null,
          weight: null,
          height: null,
          bmi: null,
        };

        rows?.forEach((row: any) => {
          const typeKey = row.observation_type.replace('vital_', '');
          vitals[typeKey] = {
            value: row.value_quantity,
            unit: row.unit,
            recorded_at: row.effective_datetime,
          };
        });

        return {
          success: true,
          vitals,
        };
      } catch (error) {
        console.error('getLatestVitals error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get latest vitals',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 5. CHECK ALERTS (query)
  // ─────────────────────────────────────────────────────────
  checkAlerts: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        const rows = (await getSql()`
          SELECT
            id,
            alert_type,
            severity,
            message,
            actual_value,
            unit,
            threshold_value,
            created_at,
            acknowledged_at,
            acknowledged_by_user_id
          FROM clinical_alert_logs
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            ${input.encounter_id ? getSql()`AND encounter_id = ${input.encounter_id}` : getSql()``}
            AND acknowledged_at IS NULL
          ORDER BY
            CASE severity WHEN 'critical' THEN 0 ELSE 1 END ASC,
            created_at DESC;
        `) as any[];

        return {
          success: true,
          alerts: rows || [],
          unacknowledged_count: rows?.length || 0,
        };
      } catch (error) {
        console.error('checkAlerts error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check alerts',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 6. ACKNOWLEDGE ALERT (mutation)
  // ─────────────────────────────────────────────────────────
  acknowledgeAlert: protectedProcedure
    .input(z.object({
      alert_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const rows = (await getSql()`
          UPDATE clinical_alert_logs
          SET
            acknowledged_by_user_id = ${userId},
            acknowledged_at = NOW()
          WHERE id = ${input.alert_id}
            AND hospital_id = ${hospitalId}
          RETURNING id, acknowledged_at;
        `) as any[];

        if (!rows || rows.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Alert not found',
          });
        }

        return {
          success: true,
          acknowledged_at: rows[0].acknowledged_at,
        };
      } catch (error) {
        console.error('acknowledgeAlert error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to acknowledge alert',
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 7. CREATE INTAKE/OUTPUT (mutation)
  // ─────────────────────────────────────────────────────────
  createIntakeOutput: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      observation_type: ioTypeEnum,
      value_quantity: z.number().min(0),
      effective_datetime: z.string().datetime(),
      io_color: z.string().max(30).optional(),
      io_clarity: z.string().max(30).optional(),
      io_notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;
        const userId = ctx.user.sub;

        const rows = (await getSql()`
          INSERT INTO observations (
            hospital_id,
            patient_id,
            encounter_id,
            observation_type,
            status,
            value_quantity,
            unit,
            effective_datetime,
            io_color,
            io_clarity,
            io_notes,
            recorded_by,
            created_at
          )
          VALUES (
            ${hospitalId},
            ${input.patient_id},
            ${input.encounter_id},
            ${input.observation_type}::"observation_type",
            'final',
            ${input.value_quantity},
            'ml',
            ${input.effective_datetime},
            ${input.io_color || null},
            ${input.io_clarity || null},
            ${input.io_notes || null},
            ${userId},
            NOW()
          )
          RETURNING id, observation_type, value_quantity, effective_datetime;
        `) as any[];

        if (!rows || rows.length === 0) {
          throw new Error('Failed to create intake/output record');
        }

        // Log event (fire-and-forget)
        try {
          await writeEvent({
            hospital_id: hospitalId,
            resource_type: 'observation',
            resource_id: rows[0].id,
            event_type: 'created',
            data: {
              patient_id: input.patient_id,
              encounter_id: input.encounter_id,
              observation_type: input.observation_type,
              value_quantity: input.value_quantity,
              unit: 'ml',
              effective_datetime: input.effective_datetime,
              io_color: input.io_color || null,
              io_clarity: input.io_clarity || null,
              io_notes: input.io_notes || null,
            },
            actor_id: userId,
            actor_email: ctx.user.email,
          });
        } catch (error) {
          console.error('Failed to write event log for intake/output creation:', error);
        }

        return {
          success: true,
          io_record: rows[0],
        };
      } catch (error) {
        console.error('createIntakeOutput error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create intake/output: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  // ─────────────────────────────────────────────────────────
  // 8. GET INTAKE/OUTPUT BALANCE (query)
  // ─────────────────────────────────────────────────────────
  getIntakeOutputBalance: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      date: z.string().datetime().optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const hospitalId = ctx.user.hospital_id;

        // Default to today if no date provided
        const targetDate = input.date ? new Date(input.date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        // Fetch intake and output records
        const entries = (await getSql()`
          SELECT
            id,
            observation_type,
            value_quantity,
            unit,
            effective_datetime,
            io_color,
            io_clarity,
            io_notes
          FROM observations
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}
            AND encounter_id = ${input.encounter_id}
            AND (observation_type LIKE 'intake_%' OR observation_type LIKE 'output_%')
            AND effective_datetime >= ${startOfDay.toISOString()}
            AND effective_datetime <= ${endOfDay.toISOString()}
          ORDER BY effective_datetime ASC;
        `) as any[];

        let totalIntake = 0;
        let totalOutput = 0;

        entries?.forEach((entry: any) => {
          if (entry.observation_type.startsWith('intake_')) {
            totalIntake += entry.value_quantity;
          } else if (entry.observation_type.startsWith('output_')) {
            totalOutput += entry.value_quantity;
          }
        });

        const balance = totalIntake - totalOutput;

        return {
          success: true,
          total_intake_ml: totalIntake,
          total_output_ml: totalOutput,
          balance_ml: balance,
          entries: entries || [],
          date: targetDate.toISOString().split('T')[0],
        };
      } catch (error) {
        console.error('getIntakeOutputBalance error:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get intake/output balance',
        });
      }
    }),
});
