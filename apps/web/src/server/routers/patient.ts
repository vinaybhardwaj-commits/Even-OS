import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  patients, coverages, relatedPersons, mpiRecords, mpiLinks, uhidSequences, patientsAudit,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, ilike, or } from 'drizzle-orm';

const genderValues = ['male', 'female', 'other', 'unknown'] as const;
const bloodGroupValues = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
const patientCategoryValues = ['even_capitated', 'insured', 'cash'] as const;
const sourceTypeValues = ['self', 'doctor', 'lsq_lead', 'walk_in', 'b2b_referral'] as const;

export const patientRouter = router({

  // ─── REGISTER ──────────────────────────────────────────────
  register: protectedProcedure
    .input(z.object({
      name_given: z.string().min(1).max(100),
      name_family: z.string().min(1).max(100),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      gender: z.enum(genderValues),
      phone: z.string().regex(/^\d{10}$/),
      email: z.string().email().optional(),
      address_street: z.string().max(200).optional(),
      address_city: z.string().max(100).optional(),
      address_state: z.string().max(100).optional(),
      address_pincode: z.string().regex(/^\d{6}$/).optional(),
      blood_group: z.enum(bloodGroupValues).optional(),
      patient_category: z.enum(patientCategoryValues).default('cash'),
      source_type: z.enum(sourceTypeValues).optional(),
      emergency_contact_name: z.string().max(100).optional(),
      emergency_contact_phone: z.string().regex(/^\d{10}$/).optional(),
      emergency_contact_relationship: z.string().max(50).optional(),
      policy_number: z.string().max(100).optional(),
      insurer_name: z.string().max(100).optional(),
      tpa_name: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // 1. Phone duplicate check
      const existing = await db.select({ id: patients.id, uhid: patients.uhid })
        .from(patients)
        .where(and(
          eq(patients.phone, input.phone),
          eq(patients.hospital_id, hospitalId),
          eq(patients.status, 'active'),
        ))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Patient with this phone already exists (UHID: ${existing[0].uhid})`,
        });
      }

      // 2. Generate UHID atomically
      // Ensure sequence row exists
      const seqRows = await db.select().from(uhidSequences)
        .where(eq(uhidSequences.hospital_id, hospitalId))
        .limit(1);

      if (seqRows.length === 0) {
        await db.insert(uhidSequences).values({
          hospital_id: hospitalId,
          site_code: 'RCR',
          next_value: 1,
        });
      }

      // Atomic increment
      const seqResult = await db.execute(
        sql`UPDATE uhid_sequences SET next_value = next_value + 1
            WHERE hospital_id = ${hospitalId}
            RETURNING next_value - 1 as current_value, site_code`
      );
      const row = (seqResult as any).rows?.[0] || (seqResult as any)[0];
      const currentValue = Number(row?.current_value ?? 1);
      const siteCode = row?.site_code ?? 'RCR';
      const uhid = `EVEN-${siteCode}-${String(currentValue).padStart(6, '0')}`;

      // 3. Insert patient
      const nameFull = `${input.name_given} ${input.name_family}`;
      const [newPatient] = await db.insert(patients).values({
        hospital_id: hospitalId,
        uhid,
        name_given: input.name_given,
        name_family: input.name_family,
        name_full: nameFull,
        name_unaccent: nameFull.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        phone: input.phone,
        email: input.email || null,
        address_street: input.address_street || null,
        address_city: input.address_city || null,
        address_state: input.address_state || null,
        address_pincode: input.address_pincode || null,
        dob: input.dob ? new Date(input.dob) : null,
        gender: input.gender,
        blood_group: input.blood_group || 'unknown',
        patient_category: input.patient_category,
        source_type: input.source_type || null,
        created_by_user_id: ctx.user.sub,
        updated_by_user_id: ctx.user.sub,
      }).returning();

      // 4. Insurance coverage
      if (input.patient_category !== 'cash' && (input.policy_number || input.insurer_name)) {
        await db.insert(coverages).values({
          hospital_id: hospitalId,
          patient_id: newPatient.id,
          coverage_type: input.patient_category === 'even_capitated' ? 'capitated' : 'insured',
          policy_number: input.policy_number || null,
          insurer_name: input.insurer_name || null,
          tpa_name: input.tpa_name || null,
          status: 'active',
          created_by_user_id: ctx.user.sub,
        });
      }

      // 5. Emergency contact
      if (input.emergency_contact_name) {
        await db.insert(relatedPersons).values({
          hospital_id: hospitalId,
          patient_id: newPatient.id,
          relationship: 'emergency_contact',
          name_full: input.emergency_contact_name,
          telecom_phone: input.emergency_contact_phone || null,
          created_by_user_id: ctx.user.sub,
        });
      }

      // 6. MPI record + link
      const [mpiRecord] = await db.insert(mpiRecords).values({}).returning();
      await db.insert(mpiLinks).values({
        hospital_id: hospitalId,
        mpi_record_id: mpiRecord.id,
        patient_id: newPatient.id,
        uhid,
        confidence: '1.0',
        method: 'initial_registration',
        status: 'active',
      });

      // 7. Audit
      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'patients',
        row_id: newPatient.id,
        new_values: { uhid, name: nameFull, phone: input.phone },
      });

      return { patient_id: newPatient.id, uhid, name: nameFull };
    }),

  // ─── GET ───────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [patient] = await db.select().from(patients)
        .where(and(eq(patients.id, input.id as any), eq(patients.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!patient) throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });

      const patientCoverages = await db.select().from(coverages)
        .where(eq(coverages.patient_id, input.id as any));
      const contacts = await db.select().from(relatedPersons)
        .where(eq(relatedPersons.patient_id, input.id as any));

      return { ...patient, coverages: patientCoverages, contacts };
    }),

  // ─── SEARCH ────────────────────────────────────────────────
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const q = input.query.trim();

      const conditions: any[] = [eq(patients.hospital_id, hospitalId)];

      if (/^EVEN-[A-Z]+-\d{6}$/.test(q)) {
        conditions.push(eq(patients.uhid, q));
      } else if (/^\d{10}$/.test(q)) {
        conditions.push(eq(patients.phone, q));
      } else {
        conditions.push(or(
          ilike(patients.name_full, `%${q}%`),
          ilike(patients.uhid, `%${q}%`),
        )!);
      }

      return db.select({
        id: patients.id,
        uhid: patients.uhid,
        name_full: patients.name_full,
        phone: patients.phone,
        dob: patients.dob,
        gender: patients.gender,
        blood_group: patients.blood_group,
        patient_category: patients.patient_category,
        status: patients.status,
        created_at: patients.created_at,
      })
        .from(patients)
        .where(and(...conditions))
        .orderBy(desc(patients.created_at))
        .limit(input.limit);
    }),

  // ─── UPDATE ────────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name_given: z.string().min(1).max(100).optional(),
      name_family: z.string().min(1).max(100).optional(),
      phone: z.string().regex(/^\d{10}$/).optional(),
      email: z.string().email().nullable().optional(),
      address_street: z.string().max(200).optional(),
      address_city: z.string().max(100).optional(),
      address_state: z.string().max(100).optional(),
      address_pincode: z.string().regex(/^\d{6}$/).optional(),
      blood_group: z.enum(bloodGroupValues).optional(),
      patient_category: z.enum(patientCategoryValues).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [old] = await db.select().from(patients)
        .where(and(eq(patients.id, id as any), eq(patients.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!old) throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });

      const setValues: Record<string, any> = { updated_at: new Date(), updated_by_user_id: ctx.user.sub };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) setValues[key] = val;
      }

      if (updates.name_given || updates.name_family) {
        const g = updates.name_given || old.name_given;
        const f = updates.name_family || old.name_family;
        setValues.name_full = `${g} ${f}`;
        setValues.name_unaccent = `${g} ${f}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }

      const [updated] = await db.update(patients)
        .set(setValues)
        .where(eq(patients.id, id as any))
        .returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'patients',
        row_id: id, old_values: old as any, new_values: updated as any,
      });

      return updated;
    }),

  // ─── LIST ──────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
      status: z.string().optional(),
      patient_category: z.string().optional(),
      search: z.string().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { page, pageSize, status, patient_category, search } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(patients.hospital_id, ctx.user.hospital_id)];
      if (status) conditions.push(eq(patients.status, status as any));
      if (patient_category) conditions.push(eq(patients.patient_category, patient_category as any));
      if (search) {
        conditions.push(or(
          ilike(patients.name_full, `%${search}%`),
          ilike(patients.phone, `%${search}%`),
          ilike(patients.uhid, `%${search}%`),
        )!);
      }

      const where = and(...conditions);
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(patients).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select().from(patients)
        .where(where)
        .orderBy(desc(patients.created_at))
        .limit(pageSize).offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── STATS ─────────────────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const [totals] = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) FILTER (WHERE status = 'active')`,
    }).from(patients).where(eq(patients.hospital_id, hospitalId));

    const catCounts = await db.select({
      category: patients.patient_category,
      count: sql<number>`count(*)`,
    }).from(patients)
      .where(eq(patients.hospital_id, hospitalId))
      .groupBy(patients.patient_category);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [todayCount] = await db.select({ count: sql<number>`count(*)` })
      .from(patients)
      .where(and(eq(patients.hospital_id, hospitalId), sql`${patients.created_at} >= ${today}`));

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const [weekCount] = await db.select({ count: sql<number>`count(*)` })
      .from(patients)
      .where(and(eq(patients.hospital_id, hospitalId), sql`${patients.created_at} >= ${weekAgo}`));

    return {
      total: Number(totals?.total ?? 0),
      active: Number(totals?.active ?? 0),
      by_category: catCounts.map(r => ({ category: r.category, count: Number(r.count) })),
      registered_today: Number(todayCount?.count ?? 0),
      registered_this_week: Number(weekCount?.count ?? 0),
    };
  }),
});
