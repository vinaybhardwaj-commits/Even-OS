import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { locations, bedStatusHistory, bedAssignments, bedStructureAudit, encounters, patients } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';

const bedStatusValues = ['available', 'occupied', 'reserved', 'blocked', 'housekeeping', 'terminal_cleaning', 'maintenance'] as const;

export const bedRouter = router({

  // ─── FLOOR-BASED BED BOARD (v2 — 3-tier hierarchy) ────────
  // Returns: floors → wards → rooms → beds with occupancy data
  board: protectedProcedure
    .input(z.object({
      floor_number: z.number().optional(), // Filter to specific floor
      ward_code: z.string().optional(),    // Filter to specific ward (backwards compat)
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Build floor filter
      const floorFilter = input.floor_number
        ? sql`AND f.floor_number = ${input.floor_number}`
        : sql``;
      const wardFilter = input.ward_code
        ? sql`AND w.code = ${input.ward_code}`
        : sql``;

      const result = await db.execute(sql`
        WITH bed_occupants AS (
          SELECT
            ba.location_id,
            ba.encounter_id,
            e.patient_id,
            p.uhid,
            p.name_full as patient_name,
            p.gender,
            e.encounter_class,
            e.admission_at,
            e.preliminary_diagnosis_icd10 as diagnosis,
            e.chief_complaint,
            e.expected_los_days,
            e.journey_type
          FROM bed_assignments ba
          JOIN encounters e ON ba.encounter_id = e.id
          JOIN patients p ON e.patient_id = p.id
          WHERE ba.released_at IS NULL
            AND ba.hospital_id = ${hospitalId}
        ),
        terminal_cleaning_started AS (
          SELECT DISTINCT ON (location_id)
            location_id,
            changed_at as started_at
          FROM bed_status_history
          WHERE hospital_id = ${hospitalId}
            AND status = 'terminal_cleaning'
          ORDER BY location_id, changed_at DESC
        )
        SELECT
          f.id as floor_id,
          f.code as floor_code,
          f.name as floor_name,
          f.floor_number,
          w.id as ward_id,
          w.code as ward_code,
          w.name as ward_name,
          w.ward_type,
          w.capacity as ward_capacity,
          w.infrastructure_flags as ward_infra,
          r.id as room_id,
          r.code as room_code,
          r.name as room_name,
          r.room_type,
          r.room_tag,
          r.capacity as room_capacity,
          r.infrastructure_flags as room_infra,
          b.id as bed_id,
          b.code as bed_code,
          b.name as bed_name,
          b.bed_status,
          bo.patient_id,
          bo.uhid as patient_uhid,
          bo.patient_name,
          bo.gender as patient_gender,
          bo.encounter_id,
          bo.encounter_class,
          bo.admission_at,
          bo.diagnosis,
          bo.chief_complaint,
          bo.expected_los_days,
          bo.journey_type,
          tc.started_at as terminal_cleaning_started_at
        FROM locations f
        JOIN locations w ON w.parent_location_id = f.id AND w.location_type = 'ward' AND w.status = 'active'
        JOIN locations r ON r.parent_location_id = w.id AND r.location_type = 'room' AND r.status = 'active'
        JOIN locations b ON b.parent_location_id = r.id AND b.location_type = 'bed' AND b.status = 'active'
        LEFT JOIN bed_occupants bo ON bo.location_id = b.id
        LEFT JOIN terminal_cleaning_started tc ON tc.location_id = b.id AND b.bed_status = 'terminal_cleaning'
        WHERE f.location_type = 'floor'
          AND f.hospital_id = ${hospitalId}
          AND f.status = 'active'
          ${floorFilter}
          ${wardFilter}
        ORDER BY f.floor_number, w.code, r.code, b.code
      `);

      const rows = (result as any).rows || result;

      // Organize into nested structure: floors → wards → rooms → beds
      type Bed = {
        id: string; code: string; name: string; bed_status: string;
        patient_id?: string; patient_uhid?: string; patient_name?: string; patient_gender?: string;
        encounter_id?: string; encounter_class?: string; admission_at?: string;
        diagnosis?: string; chief_complaint?: string; expected_los_days?: number; journey_type?: string;
        terminal_cleaning_started_at?: string;
      };
      type Room = {
        id: string; code: string; name: string; room_type: string; room_tag: string;
        capacity: number; infrastructure_flags: any; beds: Bed[];
      };
      type Ward = {
        id: string; code: string; name: string; ward_type: string;
        capacity: number; infrastructure_flags: any; rooms: Room[];
      };
      type Floor = {
        id: string; code: string; name: string; floor_number: number;
        wards: Ward[];
      };

      const floorMap = new Map<string, Floor>();

      for (const row of rows) {
        // Get or create floor
        if (!floorMap.has(row.floor_id)) {
          floorMap.set(row.floor_id, {
            id: row.floor_id, code: row.floor_code, name: row.floor_name,
            floor_number: row.floor_number, wards: [],
          });
        }
        const floor = floorMap.get(row.floor_id)!;

        // Get or create ward
        let ward = floor.wards.find(w => w.id === row.ward_id);
        if (!ward) {
          ward = {
            id: row.ward_id, code: row.ward_code, name: row.ward_name,
            ward_type: row.ward_type, capacity: row.ward_capacity,
            infrastructure_flags: row.ward_infra, rooms: [],
          };
          floor.wards.push(ward);
        }

        // Get or create room
        let room = ward.rooms.find(r => r.id === row.room_id);
        if (!room) {
          room = {
            id: row.room_id, code: row.room_code, name: row.room_name,
            room_type: row.room_type, room_tag: row.room_tag || 'none',
            capacity: row.room_capacity || 1,
            infrastructure_flags: row.room_infra, beds: [],
          };
          ward.rooms.push(room);
        }

        // Add bed
        room.beds.push({
          id: row.bed_id, code: row.bed_code, name: row.bed_name,
          bed_status: row.bed_status,
          patient_id: row.patient_id || undefined,
          patient_uhid: row.patient_uhid || undefined,
          patient_name: row.patient_name || undefined,
          patient_gender: row.patient_gender || undefined,
          encounter_id: row.encounter_id || undefined,
          encounter_class: row.encounter_class || undefined,
          admission_at: row.admission_at || undefined,
          diagnosis: row.chief_complaint || row.diagnosis || undefined,
          chief_complaint: row.chief_complaint || undefined,
          expected_los_days: row.expected_los_days || undefined,
          journey_type: row.journey_type || undefined,
          terminal_cleaning_started_at: row.terminal_cleaning_started_at || undefined,
        });
      }

      return { floors: Array.from(floorMap.values()) };
    }),

  // ─── BED STATS (summary counts — global + per floor) ──────
  stats: protectedProcedure
    .input(z.object({
      floor_number: z.number().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const floorFilter = input.floor_number != null
        ? sql`AND floor_number = ${input.floor_number}`
        : sql``;

      // Global stats
      const globalResult = await db.execute(sql`
        SELECT bed_status, count(*)::int as count
        FROM locations
        WHERE location_type = 'bed' AND hospital_id = ${hospitalId} AND status = 'active'
        GROUP BY bed_status
      `);
      const globalRows = (globalResult as any).rows || globalResult;
      const global: Record<string, number> = {
        available: 0, occupied: 0, reserved: 0, blocked: 0,
        housekeeping: 0, terminal_cleaning: 0, maintenance: 0,
      };
      for (const r of globalRows) global[r.bed_status] = Number(r.count);
      const globalTotal = Object.values(global).reduce((a, b) => a + b, 0);

      // Floor-specific stats (if requested)
      let floor: Record<string, number> | null = null;
      let floorTotal = 0;
      if (input.floor_number != null) {
        const floorResult = await db.execute(sql`
          SELECT bed_status, count(*)::int as count
          FROM locations
          WHERE location_type = 'bed' AND hospital_id = ${hospitalId} AND status = 'active'
            AND floor_number = ${input.floor_number}
          GROUP BY bed_status
        `);
        const floorRows = (floorResult as any).rows || floorResult;
        floor = { available: 0, occupied: 0, reserved: 0, blocked: 0, housekeeping: 0, terminal_cleaning: 0, maintenance: 0 };
        for (const r of floorRows) floor[r.bed_status] = Number(r.count);
        floorTotal = Object.values(floor).reduce((a, b) => a + b, 0);
      }

      // Ward-level breakdown
      const wardResult = await db.execute(sql`
        SELECT
          w.code as ward_code,
          w.name as ward_name,
          w.ward_type,
          w.floor_number,
          b.bed_status,
          count(*)::int as count
        FROM locations w
        JOIN locations r ON r.parent_location_id = w.id AND r.location_type = 'room' AND r.status = 'active'
        JOIN locations b ON b.parent_location_id = r.id AND b.location_type = 'bed' AND b.status = 'active'
        WHERE w.location_type = 'ward' AND w.hospital_id = ${hospitalId} AND w.status = 'active'
          ${floorFilter}
        GROUP BY w.code, w.name, w.ward_type, w.floor_number, b.bed_status
        ORDER BY w.floor_number, w.code
      `);

      const wardRows = (wardResult as any).rows || wardResult;
      const wardStats: Record<string, { ward_code: string; ward_name: string; ward_type: string; floor_number: number; total: number; available: number; occupied: number; }> = {};
      for (const r of wardRows) {
        if (!wardStats[r.ward_code]) {
          wardStats[r.ward_code] = {
            ward_code: r.ward_code, ward_name: r.ward_name, ward_type: r.ward_type,
            floor_number: r.floor_number, total: 0, available: 0, occupied: 0,
          };
        }
        const ws = wardStats[r.ward_code];
        ws.total += r.count;
        if (r.bed_status === 'available') ws.available += r.count;
        if (r.bed_status === 'occupied') ws.occupied += r.count;
      }

      return {
        global: { ...global, total: globalTotal },
        floor: floor ? { ...floor, total: floorTotal } : null,
        wards: Object.values(wardStats),
      };
    }),

  // ─── UPDATE BED STATUS ─────────────────────────────────────
  updateStatus: protectedProcedure
    .input(z.object({
      bed_id: z.string().uuid(),
      status: z.enum(bedStatusValues),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [bed] = await db.select().from(locations)
        .where(and(
          eq(locations.id, input.bed_id as any),
          eq(locations.hospital_id, hospitalId),
          eq(locations.location_type, 'bed'),
        ))
        .limit(1);

      if (!bed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bed not found' });

      // Can't manually set to 'occupied' — that happens via bed assignment
      if (input.status === 'occupied') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Beds are marked occupied via admission, not manual status change' });
      }

      const oldStatus = bed.bed_status;

      await db.update(locations)
        .set({ bed_status: input.status })
        .where(eq(locations.id, input.bed_id as any));

      await db.insert(bedStatusHistory).values({
        hospital_id: hospitalId,
        location_id: input.bed_id,
        status: input.status,
        reason: input.reason || `Changed from ${oldStatus} to ${input.status}`,
        changed_by_user_id: ctx.user.sub,
      });

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'locations',
        row_id: input.bed_id,
        old_values: { bed_status: oldStatus },
        new_values: { bed_status: input.status },
      });

      return { success: true, bed_id: input.bed_id, old_status: oldStatus, new_status: input.status };
    }),

  // ─── TAG ROOM (Day Care / Maternity / Isolation) ───────────
  tagRoom: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      tag: z.enum(['none', 'day_care', 'maternity', 'isolation']),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const [room] = await db.select().from(locations)
        .where(and(
          eq(locations.id, input.room_id as any),
          eq(locations.hospital_id, hospitalId),
          eq(locations.location_type, 'room'),
        ))
        .limit(1);

      if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Room not found' });

      const oldTag = room.room_tag;

      await db.update(locations)
        .set({ room_tag: input.tag } as any)
        .where(eq(locations.id, input.room_id as any));

      await db.insert(bedStructureAudit).values({
        hospital_id: hospitalId,
        action: 'room_tag_changed',
        entity_type: 'room',
        entity_id: input.room_id,
        old_values: { room_tag: oldTag },
        new_values: { room_tag: input.tag },
        performed_by_user_id: ctx.user.sub,
        reason: input.reason || `Tag changed: ${oldTag} → ${input.tag}`,
      });

      return { success: true, room_id: input.room_id, old_tag: oldTag, new_tag: input.tag };
    }),

  // ─── LIST FLOORS ───────────────────────────────────────────
  listFloors: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.execute(sql`
      SELECT
        f.id, f.code, f.name, f.floor_number,
        count(DISTINCT b.id)::int as total_beds,
        count(DISTINCT CASE WHEN b.bed_status = 'available' THEN b.id END)::int as available_beds,
        count(DISTINCT CASE WHEN b.bed_status = 'occupied' THEN b.id END)::int as occupied_beds
      FROM locations f
      JOIN locations w ON w.parent_location_id = f.id AND w.location_type = 'ward' AND w.status = 'active'
      JOIN locations r ON r.parent_location_id = w.id AND r.location_type = 'room' AND r.status = 'active'
      JOIN locations b ON b.parent_location_id = r.id AND b.location_type = 'bed' AND b.status = 'active'
      WHERE f.location_type = 'floor'
        AND f.hospital_id = ${ctx.user.hospital_id}
        AND f.status = 'active'
      GROUP BY f.id, f.code, f.name, f.floor_number
      ORDER BY f.floor_number
    `);
    const rows = (result as any).rows || result;
    return rows;
  }),

  // ─── LIST WARDS ────────────────────────────────────────────
  listWards: protectedProcedure
    .input(z.object({
      floor_number: z.number().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const floorFilter = input.floor_number != null
        ? sql`AND w.floor_number = ${input.floor_number}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          w.id, w.code, w.name, w.ward_type, w.capacity, w.floor_number,
          w.infrastructure_flags
        FROM locations w
        WHERE w.location_type = 'ward'
          AND w.hospital_id = ${ctx.user.hospital_id}
          AND w.status = 'active'
          ${floorFilter}
        ORDER BY w.floor_number, w.code
      `);
      const rows = (result as any).rows || result;
      return rows;
    }),

  // ─── BED HISTORY ───────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({
      bed_id: z.string().uuid(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      return db.select()
        .from(bedStatusHistory)
        .where(and(
          eq(bedStatusHistory.location_id, input.bed_id as any),
          eq(bedStatusHistory.hospital_id, ctx.user.hospital_id),
        ))
        .orderBy(desc(bedStatusHistory.changed_at))
        .limit(input.limit);
    }),

  // ─── STRUCTURE AUDIT LOG ───────────────────────────────────
  structureAudit: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      return db.select()
        .from(bedStructureAudit)
        .where(eq(bedStructureAudit.hospital_id, ctx.user.hospital_id))
        .orderBy(desc(bedStructureAudit.performed_at))
        .limit(input.limit);
    }),

  // ─── ADMIN: ADD ROOM ───────────────────────────────────────
  addRoom: protectedProcedure
    .input(z.object({
      ward_id: z.string().uuid(),
      room_code: z.string().min(1).max(20),
      room_name: z.string().min(1).max(100),
      room_type: z.enum(['private', 'semi_private', 'suite', 'icu_room', 'nicu_room', 'pacu_bay', 'dialysis_station', 'general']),
      floor_number: z.number(),
      infrastructure_flags: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Verify caller is admin
      const role = ctx.user.role || '';
      const isAdmin = ['super_admin', 'hospital_admin', 'gm'].includes(role);
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can add rooms' });

      // Verify ward exists
      const [ward] = await db.select().from(locations)
        .where(and(eq(locations.id, input.ward_id as any), eq(locations.hospital_id, hospitalId), eq(locations.location_type, 'ward')))
        .limit(1);
      if (!ward) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ward not found' });

      const capacity = input.room_type === 'semi_private' ? 2 : 1;

      // Create room
      const [newRoom] = await db.insert(locations).values({
        hospital_id: hospitalId,
        location_type: 'room',
        parent_location_id: input.ward_id,
        code: input.room_code,
        name: input.room_name,
        room_type: input.room_type,
        capacity,
        floor_number: input.floor_number,
        infrastructure_flags: input.infrastructure_flags || null,
        status: 'active',
      } as any).returning();

      // Create beds based on room type
      const bedCodes = input.room_type === 'semi_private'
        ? [`${input.room_code}A`, `${input.room_code}B`]
        : [input.room_code];

      for (const bedCode of bedCodes) {
        await db.insert(locations).values({
          hospital_id: hospitalId,
          location_type: 'bed',
          parent_location_id: newRoom.id,
          code: bedCode,
          name: `Bed ${bedCode}`,
          bed_status: 'available',
          floor_number: input.floor_number,
          infrastructure_flags: input.infrastructure_flags || null,
          status: 'active',
        } as any);
      }

      // Update ward capacity
      const bedCountResult = await db.execute(sql`
        SELECT count(*)::int as cnt FROM locations
        WHERE location_type = 'bed' AND status = 'active'
          AND parent_location_id IN (
            SELECT id FROM locations WHERE parent_location_id = ${ward.id} AND location_type = 'room' AND status = 'active'
          )
      `);
      const newCapacity = ((bedCountResult as any).rows || bedCountResult)[0].cnt;
      await db.update(locations).set({ capacity: newCapacity }).where(eq(locations.id, ward.id));

      // Audit log
      await db.insert(bedStructureAudit).values({
        hospital_id: hospitalId,
        action: 'room_added',
        entity_type: 'room',
        entity_id: newRoom.id,
        new_values: { room_code: input.room_code, room_type: input.room_type, beds: bedCodes },
        performed_by_user_id: ctx.user.sub,
        reason: `Added ${input.room_type} room ${input.room_code} with ${bedCodes.length} bed(s)`,
      });

      return { success: true, room_id: newRoom.id, beds_created: bedCodes.length };
    }),

  // ─── ADMIN: DECOMMISSION ROOM ──────────────────────────────
  decommissionRoom: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      reason: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const role = ctx.user.role || '';
      const isAdmin = ['super_admin', 'hospital_admin', 'gm'].includes(role);
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can decommission rooms' });

      // Check no occupied beds
      const occupiedBeds = await db.execute(sql`
        SELECT count(*)::int as cnt FROM locations
        WHERE parent_location_id = ${input.room_id} AND location_type = 'bed' AND bed_status = 'occupied' AND status = 'active'
      `);
      const occupiedCount = ((occupiedBeds as any).rows || occupiedBeds)[0].cnt;
      if (occupiedCount > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot decommission room — ${occupiedCount} bed(s) still occupied` });
      }

      // Deactivate room and its beds
      await db.execute(sql`
        UPDATE locations SET status = 'inactive' WHERE parent_location_id = ${input.room_id} AND location_type = 'bed'
      `);
      await db.update(locations).set({ status: 'inactive' } as any).where(eq(locations.id, input.room_id as any));

      // Audit log
      await db.insert(bedStructureAudit).values({
        hospital_id: hospitalId,
        action: 'room_decommissioned',
        entity_type: 'room',
        entity_id: input.room_id,
        performed_by_user_id: ctx.user.sub,
        reason: input.reason,
      });

      return { success: true };
    }),

  // ─── ADMIN: CONVERT ROOM TYPE ──────────────────────────────
  convertRoom: protectedProcedure
    .input(z.object({
      room_id: z.string().uuid(),
      new_room_type: z.enum(['private', 'semi_private', 'suite']),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const role = ctx.user.role || '';
      const isAdmin = ['super_admin', 'hospital_admin', 'gm'].includes(role);
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can convert rooms' });

      const [room] = await db.select().from(locations)
        .where(and(eq(locations.id, input.room_id as any), eq(locations.hospital_id, hospitalId), eq(locations.location_type, 'room')))
        .limit(1);
      if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Room not found' });

      // Check no occupied beds
      const occupiedBeds = await db.execute(sql`
        SELECT count(*)::int as cnt FROM locations
        WHERE parent_location_id = ${input.room_id} AND location_type = 'bed' AND bed_status = 'occupied' AND status = 'active'
      `);
      if (((occupiedBeds as any).rows || occupiedBeds)[0].cnt > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot convert room with occupied beds' });
      }

      const oldType = room.room_type;
      const newCapacity = input.new_room_type === 'semi_private' ? 2 : 1;

      // Get current active beds in this room
      const currentBeds = await db.execute(sql`
        SELECT id, code FROM locations WHERE parent_location_id = ${input.room_id} AND location_type = 'bed' AND status = 'active' ORDER BY code
      `);
      const currentBedRows = (currentBeds as any).rows || currentBeds;

      if (input.new_room_type === 'semi_private' && currentBedRows.length === 1) {
        // Converting from private/suite to semi-private: add a B bed
        const existingBed = currentBedRows[0];
        const newBedCode = room.code + 'B';
        // Rename existing bed to have A suffix if it doesn't already
        if (!existingBed.code.endsWith('A')) {
          await db.execute(sql`UPDATE locations SET code = ${room.code + 'A'}, name = ${'Bed ' + room.code + 'A'} WHERE id = ${existingBed.id}`);
        }
        // Create B bed
        await db.insert(locations).values({
          hospital_id: hospitalId,
          location_type: 'bed',
          parent_location_id: input.room_id,
          code: newBedCode,
          name: `Bed ${newBedCode}`,
          bed_status: 'available',
          floor_number: room.floor_number,
          status: 'active',
        } as any);
      } else if (input.new_room_type !== 'semi_private' && currentBedRows.length === 2) {
        // Converting from semi-private to private/suite: deactivate B bed
        const bBed = currentBedRows.find((b: any) => b.code.endsWith('B'));
        if (bBed) {
          await db.update(locations).set({ status: 'inactive' } as any).where(eq(locations.id, bBed.id));
        }
        // Rename A bed to room code
        const aBed = currentBedRows.find((b: any) => b.code.endsWith('A'));
        if (aBed) {
          await db.execute(sql`UPDATE locations SET code = ${room.code}, name = ${'Bed ' + room.code} WHERE id = ${aBed.id}`);
        }
      }

      // Update room type and capacity
      await db.update(locations)
        .set({ room_type: input.new_room_type, capacity: newCapacity } as any)
        .where(eq(locations.id, input.room_id as any));

      // Audit log
      await db.insert(bedStructureAudit).values({
        hospital_id: hospitalId,
        action: 'room_converted',
        entity_type: 'room',
        entity_id: input.room_id,
        old_values: { room_type: oldType },
        new_values: { room_type: input.new_room_type },
        performed_by_user_id: ctx.user.sub,
        reason: input.reason || `Converted ${oldType} → ${input.new_room_type}`,
      });

      return { success: true, old_type: oldType, new_type: input.new_room_type };
    }),

  // ─── ADMIN: ADD WARD ───────────────────────────────────────
  addWard: protectedProcedure
    .input(z.object({
      floor_number: z.number(),
      ward_code: z.string().min(1).max(20),
      ward_name: z.string().min(1).max(100),
      ward_type: z.enum(['general', 'icu', 'nicu', 'pacu', 'dialysis', 'day_care', 'maternity', 'step_down']),
      infrastructure_flags: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const role = ctx.user.role || '';
      const isAdmin = ['super_admin', 'hospital_admin', 'gm'].includes(role);
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can add wards' });

      // Find floor
      const floorResult = await db.execute(sql`
        SELECT id FROM locations WHERE hospital_id = ${hospitalId} AND location_type = 'floor'
          AND floor_number = ${input.floor_number} AND status = 'active' LIMIT 1
      `);
      const floorRows = (floorResult as any).rows || floorResult;
      if (floorRows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: `Floor ${input.floor_number} not found` });

      const [newWard] = await db.insert(locations).values({
        hospital_id: hospitalId,
        location_type: 'ward',
        parent_location_id: floorRows[0].id,
        code: input.ward_code,
        name: input.ward_name,
        ward_type: input.ward_type,
        capacity: 0,
        floor_number: input.floor_number,
        infrastructure_flags: input.infrastructure_flags || null,
        status: 'active',
      } as any).returning();

      await db.insert(bedStructureAudit).values({
        hospital_id: hospitalId,
        action: 'ward_created',
        entity_type: 'ward',
        entity_id: newWard.id,
        new_values: { ward_code: input.ward_code, ward_type: input.ward_type, floor: input.floor_number },
        performed_by_user_id: ctx.user.sub,
        reason: `Created ${input.ward_type} ward: ${input.ward_name}`,
      });

      return { success: true, ward_id: newWard.id };
    }),

  // ═══════════════════════════════════════════════════════════
  // BM.3 — OPERATIONAL FLOWS (Assign / Transfer / Discharge)
  // ═══════════════════════════════════════════════════════════

  // ─── ADMISSION QUEUE (patients ready to be admitted) ───────
  // Returns recent active patients with no currently active encounter.
  admissionQueue: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const searchClause = input.search && input.search.trim().length >= 2
        ? sql`AND (
            p.name_full ILIKE ${'%' + input.search.trim() + '%'}
            OR p.uhid ILIKE ${'%' + input.search.trim() + '%'}
            OR p.phone = ${input.search.trim()}
          )`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          p.id, p.uhid, p.name_full, p.phone, p.gender, p.dob,
          p.blood_group, p.patient_category, p.created_at
        FROM patients p
        WHERE p.hospital_id = ${hospitalId}
          AND p.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM encounters e
            WHERE e.patient_id = p.id
              AND e.hospital_id = ${hospitalId}
              AND e.status = 'in-progress'
          )
          ${searchClause}
        ORDER BY p.created_at DESC
        LIMIT ${input.limit}
      `);
      return (result as any).rows || result;
    }),

  // ─── AVAILABLE BEDS FOR TRANSFER ───────────────────────────
  // Returns all available beds (optionally excluding current bed).
  availableBedsForTransfer: protectedProcedure
    .input(z.object({
      exclude_bed_id: z.string().uuid().optional(),
      floor_number: z.number().optional(),
      ward_code: z.string().optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const excludeClause = input.exclude_bed_id
        ? sql`AND b.id != ${input.exclude_bed_id}`
        : sql``;
      const floorClause = input.floor_number != null
        ? sql`AND f.floor_number = ${input.floor_number}`
        : sql``;
      const wardClause = input.ward_code
        ? sql`AND w.code = ${input.ward_code}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          b.id as bed_id, b.code as bed_code, b.name as bed_name, b.bed_status,
          r.id as room_id, r.code as room_code, r.room_type, r.room_tag,
          w.id as ward_id, w.code as ward_code, w.name as ward_name, w.ward_type,
          f.id as floor_id, f.name as floor_name, f.floor_number
        FROM locations b
        JOIN locations r ON b.parent_location_id = r.id AND r.status = 'active'
        JOIN locations w ON r.parent_location_id = w.id AND w.status = 'active'
        JOIN locations f ON w.parent_location_id = f.id AND f.status = 'active'
        WHERE b.hospital_id = ${hospitalId}
          AND b.location_type = 'bed'
          AND b.status = 'active'
          AND b.bed_status IN ('available', 'reserved')
          ${excludeClause}
          ${floorClause}
          ${wardClause}
        ORDER BY f.floor_number, w.code, r.code, b.code
        LIMIT ${input.limit}
      `);
      return (result as any).rows || result;
    }),

  // ─── ASSIGNMENT PREFLIGHT (soft validation warnings) ───────
  // Returns warnings for (bed_id, patient_id) tuple — gender mismatch,
  // isolation tag, pre-auth required but missing. All soft; caller decides.
  assignmentPreflight: protectedProcedure
    .input(z.object({
      bed_id: z.string().uuid(),
      patient_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Fetch bed + room + ward context
      const bedResult = await db.execute(sql`
        SELECT
          b.id as bed_id, b.code as bed_code, b.bed_status,
          r.id as room_id, r.code as room_code, r.room_type, r.room_tag, r.capacity as room_capacity,
          w.code as ward_code, w.name as ward_name, w.ward_type
        FROM locations b
        JOIN locations r ON b.parent_location_id = r.id
        JOIN locations w ON r.parent_location_id = w.id
        WHERE b.id = ${input.bed_id}
          AND b.hospital_id = ${hospitalId}
          AND b.location_type = 'bed'
        LIMIT 1
      `);
      const bedRow = ((bedResult as any).rows || bedResult)[0];
      if (!bedRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bed not found' });

      // Fetch patient
      const [patient] = await db.select({
        id: patients.id,
        uhid: patients.uhid,
        name_full: patients.name_full,
        gender: patients.gender,
        patient_category: patients.patient_category,
      })
        .from(patients)
        .where(and(
          eq(patients.id, input.patient_id as any),
          eq(patients.hospital_id, hospitalId),
        ))
        .limit(1);
      if (!patient) throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });

      // Check co-occupant gender (for semi-private rooms)
      let coOccupantGender: string | null = null;
      if (bedRow.room_type === 'semi_private' && bedRow.room_capacity > 1) {
        const coResult = await db.execute(sql`
          SELECT p.gender
          FROM bed_assignments ba
          JOIN encounters e ON ba.encounter_id = e.id
          JOIN patients p ON e.patient_id = p.id
          JOIN locations b ON ba.location_id = b.id
          WHERE b.parent_location_id = ${bedRow.room_id}
            AND b.id != ${input.bed_id}
            AND ba.released_at IS NULL
            AND ba.hospital_id = ${hospitalId}
          LIMIT 1
        `);
        const coRow = ((coResult as any).rows || coResult)[0];
        if (coRow) coOccupantGender = coRow.gender;
      }

      const warnings: Array<{ type: string; severity: 'warn' | 'info'; message: string }> = [];

      // Gender mismatch in semi-private
      if (coOccupantGender && patient.gender && coOccupantGender.toLowerCase() !== patient.gender.toLowerCase()) {
        warnings.push({
          type: 'gender_mismatch',
          severity: 'warn',
          message: `Co-occupant in room ${bedRow.room_code} is ${coOccupantGender}; patient is ${patient.gender}.`,
        });
      }

      // Isolation tag on room
      if (bedRow.room_tag === 'isolation') {
        warnings.push({
          type: 'isolation_room',
          severity: 'info',
          message: `Room ${bedRow.room_code} is tagged ISOLATION. Confirm patient requires isolation.`,
        });
      }

      // Pre-auth required for insured
      if (patient.patient_category === 'insured') {
        warnings.push({
          type: 'pre_auth_required',
          severity: 'warn',
          message: `Patient is insured — pre-authorization is required (admit will enforce unless overridden).`,
        });
      }

      // Bed status not available
      if (bedRow.bed_status !== 'available' && bedRow.bed_status !== 'reserved') {
        warnings.push({
          type: 'bed_not_available',
          severity: 'warn',
          message: `Bed is currently ${bedRow.bed_status}. Assignment will fail unless status is cleared.`,
        });
      }

      return {
        bed: { id: bedRow.bed_id, code: bedRow.bed_code, room_code: bedRow.room_code, ward_name: bedRow.ward_name, room_type: bedRow.room_type, room_tag: bedRow.room_tag },
        patient: { id: patient.id, uhid: patient.uhid, name_full: patient.name_full, gender: patient.gender, patient_category: patient.patient_category },
        co_occupant_gender: coOccupantGender,
        warnings,
      };
    }),

  // ─── TRANSFER PREFLIGHT (soft validation for transfer) ─────
  transferPreflight: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
      to_bed_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const encResult = await db.execute(sql`
        SELECT
          e.id, e.patient_id, e.current_location_id, e.status,
          p.uhid, p.name_full, p.gender, p.patient_category
        FROM encounters e
        JOIN patients p ON e.patient_id = p.id
        WHERE e.id = ${input.encounter_id}
          AND e.hospital_id = ${hospitalId}
        LIMIT 1
      `);
      const encRow = ((encResult as any).rows || encResult)[0];
      if (!encRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });
      if (encRow.status !== 'in-progress') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Encounter is ${encRow.status} — cannot transfer` });
      }

      // Reuse assignmentPreflight logic by calling it inline
      const bedResult = await db.execute(sql`
        SELECT
          b.id as bed_id, b.code as bed_code, b.bed_status,
          r.id as room_id, r.code as room_code, r.room_type, r.room_tag, r.capacity as room_capacity,
          w.code as ward_code, w.name as ward_name, w.ward_type
        FROM locations b
        JOIN locations r ON b.parent_location_id = r.id
        JOIN locations w ON r.parent_location_id = w.id
        WHERE b.id = ${input.to_bed_id}
          AND b.hospital_id = ${hospitalId}
          AND b.location_type = 'bed'
        LIMIT 1
      `);
      const bedRow = ((bedResult as any).rows || bedResult)[0];
      if (!bedRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Destination bed not found' });

      let coOccupantGender: string | null = null;
      if (bedRow.room_type === 'semi_private' && bedRow.room_capacity > 1) {
        const coResult = await db.execute(sql`
          SELECT p.gender
          FROM bed_assignments ba
          JOIN encounters e ON ba.encounter_id = e.id
          JOIN patients p ON e.patient_id = p.id
          JOIN locations b ON ba.location_id = b.id
          WHERE b.parent_location_id = ${bedRow.room_id}
            AND b.id != ${input.to_bed_id}
            AND ba.released_at IS NULL
            AND ba.hospital_id = ${hospitalId}
          LIMIT 1
        `);
        const coRow = ((coResult as any).rows || coResult)[0];
        if (coRow) coOccupantGender = coRow.gender;
      }

      const warnings: Array<{ type: string; severity: 'warn' | 'info'; message: string }> = [];

      if (coOccupantGender && encRow.gender && coOccupantGender.toLowerCase() !== encRow.gender.toLowerCase()) {
        warnings.push({
          type: 'gender_mismatch',
          severity: 'warn',
          message: `Co-occupant in room ${bedRow.room_code} is ${coOccupantGender}; patient is ${encRow.gender}.`,
        });
      }

      if (bedRow.room_tag === 'isolation') {
        warnings.push({
          type: 'isolation_room',
          severity: 'info',
          message: `Room ${bedRow.room_code} is tagged ISOLATION. Confirm patient requires isolation.`,
        });
      }

      if (bedRow.bed_status !== 'available' && bedRow.bed_status !== 'reserved') {
        warnings.push({
          type: 'bed_not_available',
          severity: 'warn',
          message: `Destination bed is ${bedRow.bed_status}. Transfer will fail.`,
        });
      }

      return {
        encounter: { id: encRow.id, patient_name: encRow.name_full, patient_uhid: encRow.uhid, gender: encRow.gender },
        destination_bed: { id: bedRow.bed_id, code: bedRow.bed_code, room_code: bedRow.room_code, ward_name: bedRow.ward_name },
        co_occupant_gender: coOccupantGender,
        warnings,
      };
    }),

  // ─── DISCHARGE STATUS (milestone summary for drawer) ───────
  dischargeReadiness: protectedProcedure
    .input(z.object({
      encounter_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      const milestonesResult = await db.execute(sql`
        SELECT id, milestone, sequence, completed_at, notes
        FROM discharge_milestones
        WHERE encounter_id = ${input.encounter_id}
          AND hospital_id = ${hospitalId}
        ORDER BY sequence
      `);
      const milestones = (milestonesResult as any).rows || milestonesResult;

      const orderResult = await db.execute(sql`
        SELECT id, status, reason, summary, ordered_at
        FROM discharge_orders
        WHERE encounter_id = ${input.encounter_id}
          AND hospital_id = ${hospitalId}
        ORDER BY ordered_at DESC
        LIMIT 1
      `);
      const order = ((orderResult as any).rows || orderResult)[0] || null;

      const total = milestones.length;
      const done = milestones.filter((m: any) => m.completed_at).length;

      return {
        order,
        milestones,
        total,
        done,
        all_complete: total > 0 && done === total,
      };
    }),
});
