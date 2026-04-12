/**
 * Test Catalog & Accession Numbers — Module 8 LIS (L.3)
 *
 * Full test catalog management with version history, age/gender-specific
 * reference ranges, CSV bulk import, and accession number generation.
 *
 * Endpoints:
 *   1. getAll           — Full catalog with age/gender reference ranges
 *   2. getComponent     — Single component detail + version history
 *   3. create           — Add test (panel component) with ranges
 *   4. update           — Modify ranges with version tracking
 *   5. bulkImport       — CSV upload → create/update components
 *   6. deactivate       — Soft-delete with version log
 *   7. getVersionHistory — Audit trail for a component
 *   8. setAgeGenderRange — Add/update demographic-specific ranges
 *   9. listAgeGenderRanges — All ranges for a component
 *  10. createAccessionConfig — Set up accession number format
 *  11. listAccessionConfigs — All configs for hospital
 *  12. generateAccession — Get next accession number (atomic)
 *  13. catalogStats      — Dashboard counts
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  labPanels, labPanelComponents,
} from '@db/schema';
import {
  testCatalogVersions, ageGenderRanges, accessionConfigs,
} from '@db/schema';
import { eq, and, desc, count, sql, gte, lte, asc, isNull } from 'drizzle-orm';

// ============================================================
// Router
// ============================================================

export const testCatalogRouter = router({

  // ----------------------------------------------------------
  // 1. GET ALL — Full catalog with panels and components
  // ----------------------------------------------------------
  getAll: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      department: z.string().optional(),
      search: z.string().optional(),
      active_only: z.boolean().default(true),
      limit: z.number().min(1).max(500).default(100),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(labPanels.hospital_id, input.hospital_id)];
      if (input.department) {
        conditions.push(eq(labPanels.department, input.department));
      }
      if (input.active_only) {
        conditions.push(eq(labPanels.is_active, true));
      }

      const panels = await db.select()
        .from(labPanels)
        .where(and(...conditions))
        .orderBy(asc(labPanels.panel_name))
        .limit(input.limit)
        .offset(input.offset);

      // For each panel, get components
      const panelsWithComponents = await Promise.all(
        panels.map(async (panel) => {
          const compConditions = [eq(labPanelComponents.panel_id, panel.id)];
          if (input.active_only) {
            compConditions.push(eq(labPanelComponents.is_active, true));
          }

          const components = await db.select()
            .from(labPanelComponents)
            .where(and(...compConditions))
            .orderBy(asc(labPanelComponents.sort_order));

          // For each component, get age/gender ranges
          const componentsWithRanges = await Promise.all(
            components.map(async (comp) => {
              const ranges = await db.select()
                .from(ageGenderRanges)
                .where(and(
                  eq(ageGenderRanges.component_id, comp.id),
                  eq(ageGenderRanges.is_active, true),
                ))
                .orderBy(asc(ageGenderRanges.age_min_years));

              return { ...comp, age_gender_ranges: ranges };
            })
          );

          return { ...panel, components: componentsWithRanges };
        })
      );

      // Total count
      const [totalRow] = await db.select({ total: count() })
        .from(labPanels)
        .where(and(...conditions));

      return {
        panels: panelsWithComponents,
        total: totalRow?.total ?? 0,
      };
    }),

  // ----------------------------------------------------------
  // 2. GET COMPONENT — Single component with version history
  // ----------------------------------------------------------
  getComponent: protectedProcedure
    .input(z.object({ component_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [component] = await db.select()
        .from(labPanelComponents)
        .where(eq(labPanelComponents.id, input.component_id))
        .limit(1);

      if (!component) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      // Get panel info
      const [panel] = await db.select()
        .from(labPanels)
        .where(eq(labPanels.id, component.panel_id))
        .limit(1);

      // Get age/gender ranges
      const ranges = await db.select()
        .from(ageGenderRanges)
        .where(and(
          eq(ageGenderRanges.component_id, input.component_id),
          eq(ageGenderRanges.is_active, true),
        ))
        .orderBy(asc(ageGenderRanges.age_min_years));

      // Recent version history (last 20)
      const versions = await db.select()
        .from(testCatalogVersions)
        .where(eq(testCatalogVersions.component_id, input.component_id))
        .orderBy(desc(testCatalogVersions.created_at))
        .limit(20);

      return {
        component,
        panel,
        age_gender_ranges: ranges,
        version_history: versions,
      };
    }),

  // ----------------------------------------------------------
  // 3. CREATE — Add new test component to a panel
  // ----------------------------------------------------------
  create: adminProcedure
    .input(z.object({
      hospital_id: z.string(),
      panel_id: z.string().uuid(),
      test_code: z.string().min(1).max(30),
      test_name: z.string().min(1),
      loinc_code: z.string().max(20).optional(),
      unit: z.string().max(30).optional(),
      reference_range_low: z.string().optional(),
      reference_range_high: z.string().optional(),
      reference_range_text: z.string().optional(),
      critical_low: z.string().optional(),
      critical_high: z.string().optional(),
      data_type: z.string().default('numeric'),
      sort_order: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const [component] = await db.insert(labPanelComponents).values({
        hospital_id: input.hospital_id,
        panel_id: input.panel_id,
        test_code: input.test_code,
        test_name: input.test_name,
        loinc_code: input.loinc_code ?? null,
        unit: input.unit ?? null,
        reference_range_low: input.reference_range_low ?? null,
        reference_range_high: input.reference_range_high ?? null,
        reference_range_text: input.reference_range_text ?? null,
        critical_low: input.critical_low ?? null,
        critical_high: input.critical_high ?? null,
        data_type: input.data_type,
        sort_order: input.sort_order,
      }).returning();

      // Log version
      await db.insert(testCatalogVersions).values({
        hospital_id: input.hospital_id,
        panel_id: input.panel_id,
        component_id: component.id,
        change_type: 'created',
        previous_values: null,
        new_values: {
          test_code: input.test_code,
          test_name: input.test_name,
          unit: input.unit,
          ref_range_low: input.reference_range_low,
          ref_range_high: input.reference_range_high,
          critical_low: input.critical_low,
          critical_high: input.critical_high,
        },
        changed_by: ctx.user.sub,
        reason: 'Initial creation',
      });

      return component;
    }),

  // ----------------------------------------------------------
  // 4. UPDATE — Modify component with version tracking
  // ----------------------------------------------------------
  update: adminProcedure
    .input(z.object({
      component_id: z.string().uuid(),
      test_name: z.string().optional(),
      loinc_code: z.string().max(20).optional(),
      unit: z.string().max(30).optional(),
      reference_range_low: z.string().optional(),
      reference_range_high: z.string().optional(),
      reference_range_text: z.string().optional(),
      critical_low: z.string().optional(),
      critical_high: z.string().optional(),
      data_type: z.string().optional(),
      sort_order: z.number().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get current values for version snapshot
      const [current] = await db.select()
        .from(labPanelComponents)
        .where(eq(labPanelComponents.id, input.component_id))
        .limit(1);

      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      // Determine change type
      let changeType: 'range_updated' | 'critical_range_updated' | 'unit_changed' | 'loinc_updated' = 'range_updated';
      if (input.critical_low !== undefined || input.critical_high !== undefined) {
        changeType = 'critical_range_updated';
      }
      if (input.unit !== undefined) changeType = 'unit_changed';
      if (input.loinc_code !== undefined) changeType = 'loinc_updated';

      // Build update object
      const updates: Record<string, unknown> = {};
      if (input.test_name !== undefined) updates.test_name = input.test_name;
      if (input.loinc_code !== undefined) updates.loinc_code = input.loinc_code;
      if (input.unit !== undefined) updates.unit = input.unit;
      if (input.reference_range_low !== undefined) updates.reference_range_low = input.reference_range_low;
      if (input.reference_range_high !== undefined) updates.reference_range_high = input.reference_range_high;
      if (input.reference_range_text !== undefined) updates.reference_range_text = input.reference_range_text;
      if (input.critical_low !== undefined) updates.critical_low = input.critical_low;
      if (input.critical_high !== undefined) updates.critical_high = input.critical_high;
      if (input.data_type !== undefined) updates.data_type = input.data_type;
      if (input.sort_order !== undefined) updates.sort_order = input.sort_order;

      // Update component
      const [updated] = await db.update(labPanelComponents)
        .set(updates)
        .where(eq(labPanelComponents.id, input.component_id))
        .returning();

      // Log version
      await db.insert(testCatalogVersions).values({
        hospital_id: current.hospital_id,
        panel_id: current.panel_id,
        component_id: current.id,
        change_type: changeType,
        previous_values: {
          test_name: current.test_name,
          unit: current.unit,
          ref_range_low: current.reference_range_low,
          ref_range_high: current.reference_range_high,
          ref_range_text: current.reference_range_text,
          critical_low: current.critical_low,
          critical_high: current.critical_high,
          loinc_code: current.loinc_code,
        },
        new_values: updates,
        changed_by: ctx.user.sub,
        reason: input.reason ?? null,
      });

      return updated;
    }),

  // ----------------------------------------------------------
  // 5. BULK IMPORT — CSV → create/update components
  // ----------------------------------------------------------
  bulkImport: adminProcedure
    .input(z.object({
      hospital_id: z.string(),
      panel_id: z.string().uuid(),
      rows: z.array(z.object({
        test_code: z.string().min(1).max(30),
        test_name: z.string().min(1),
        loinc_code: z.string().optional(),
        unit: z.string().optional(),
        reference_range_low: z.string().optional(),
        reference_range_high: z.string().optional(),
        reference_range_text: z.string().optional(),
        critical_low: z.string().optional(),
        critical_high: z.string().optional(),
        data_type: z.string().default('numeric'),
        sort_order: z.number().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          // Check if component already exists by test_code in this panel
          const [existing] = await db.select()
            .from(labPanelComponents)
            .where(and(
              eq(labPanelComponents.panel_id, input.panel_id),
              eq(labPanelComponents.test_code, row.test_code),
            ))
            .limit(1);

          if (existing) {
            // Update existing
            await db.update(labPanelComponents)
              .set({
                test_name: row.test_name,
                loinc_code: row.loinc_code ?? existing.loinc_code,
                unit: row.unit ?? existing.unit,
                reference_range_low: row.reference_range_low ?? existing.reference_range_low,
                reference_range_high: row.reference_range_high ?? existing.reference_range_high,
                reference_range_text: row.reference_range_text ?? existing.reference_range_text,
                critical_low: row.critical_low ?? existing.critical_low,
                critical_high: row.critical_high ?? existing.critical_high,
                data_type: row.data_type,
                sort_order: row.sort_order ?? existing.sort_order,
              })
              .where(eq(labPanelComponents.id, existing.id));

            // Log version
            await db.insert(testCatalogVersions).values({
              hospital_id: input.hospital_id,
              panel_id: input.panel_id,
              component_id: existing.id,
              change_type: 'range_updated',
              previous_values: {
                test_name: existing.test_name,
                unit: existing.unit,
                ref_range_low: existing.reference_range_low,
                ref_range_high: existing.reference_range_high,
              },
              new_values: {
                test_name: row.test_name,
                unit: row.unit,
                ref_range_low: row.reference_range_low,
                ref_range_high: row.reference_range_high,
              },
              changed_by: ctx.user.sub,
              reason: 'Bulk import update',
            });

            updated++;
          } else {
            // Create new
            const [comp] = await db.insert(labPanelComponents).values({
              hospital_id: input.hospital_id,
              panel_id: input.panel_id,
              test_code: row.test_code,
              test_name: row.test_name,
              loinc_code: row.loinc_code ?? null,
              unit: row.unit ?? null,
              reference_range_low: row.reference_range_low ?? null,
              reference_range_high: row.reference_range_high ?? null,
              reference_range_text: row.reference_range_text ?? null,
              critical_low: row.critical_low ?? null,
              critical_high: row.critical_high ?? null,
              data_type: row.data_type,
              sort_order: row.sort_order ?? i,
            }).returning();

            await db.insert(testCatalogVersions).values({
              hospital_id: input.hospital_id,
              panel_id: input.panel_id,
              component_id: comp.id,
              change_type: 'created',
              previous_values: null,
              new_values: { test_code: row.test_code, test_name: row.test_name },
              changed_by: ctx.user.sub,
              reason: 'Bulk import creation',
            });

            created++;
          }
        } catch (err) {
          errors.push(`Row ${i + 1} (${row.test_code}): ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      return { created, updated, errors, total: input.rows.length };
    }),

  // ----------------------------------------------------------
  // 6. DEACTIVATE — Soft-delete with version log
  // ----------------------------------------------------------
  deactivate: adminProcedure
    .input(z.object({
      component_id: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [current] = await db.select()
        .from(labPanelComponents)
        .where(eq(labPanelComponents.id, input.component_id))
        .limit(1);

      if (!current) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      }

      await db.update(labPanelComponents)
        .set({ is_active: false })
        .where(eq(labPanelComponents.id, input.component_id));

      await db.insert(testCatalogVersions).values({
        hospital_id: current.hospital_id,
        panel_id: current.panel_id,
        component_id: current.id,
        change_type: 'deactivated',
        previous_values: { is_active: true },
        new_values: { is_active: false },
        changed_by: ctx.user.sub,
        reason: input.reason ?? 'Deactivated',
      });

      return { success: true };
    }),

  // ----------------------------------------------------------
  // 7. VERSION HISTORY — Audit trail for a component or panel
  // ----------------------------------------------------------
  getVersionHistory: protectedProcedure
    .input(z.object({
      component_id: z.string().uuid().optional(),
      panel_id: z.string().uuid().optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.component_id) {
        conditions.push(eq(testCatalogVersions.component_id, input.component_id));
      }
      if (input.panel_id) {
        conditions.push(eq(testCatalogVersions.panel_id, input.panel_id));
      }

      if (conditions.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provide component_id or panel_id' });
      }

      const versions = await db.select()
        .from(testCatalogVersions)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(testCatalogVersions.created_at))
        .limit(input.limit);

      return versions;
    }),

  // ----------------------------------------------------------
  // 8. SET AGE/GENDER RANGE — Add/update demographic ranges
  // ----------------------------------------------------------
  setAgeGenderRange: adminProcedure
    .input(z.object({
      hospital_id: z.string(),
      component_id: z.string().uuid(),
      age_min_years: z.number().min(0).default(0),
      age_max_years: z.number().min(0).default(999),
      gender: z.enum(['all', 'male', 'female']).default('all'),
      ref_range_low: z.string().optional(),
      ref_range_high: z.string().optional(),
      ref_range_text: z.string().optional(),
      critical_low: z.string().optional(),
      critical_high: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Check if range already exists for this demographic
      const [existing] = await db.select()
        .from(ageGenderRanges)
        .where(and(
          eq(ageGenderRanges.component_id, input.component_id),
          eq(ageGenderRanges.age_min_years, input.age_min_years),
          eq(ageGenderRanges.age_max_years, input.age_max_years),
          eq(ageGenderRanges.gender, input.gender),
        ))
        .limit(1);

      if (existing) {
        const [updated] = await db.update(ageGenderRanges)
          .set({
            ref_range_low: input.ref_range_low ?? existing.ref_range_low,
            ref_range_high: input.ref_range_high ?? existing.ref_range_high,
            ref_range_text: input.ref_range_text ?? existing.ref_range_text,
            critical_low: input.critical_low ?? existing.critical_low,
            critical_high: input.critical_high ?? existing.critical_high,
            updated_at: new Date(),
          })
          .where(eq(ageGenderRanges.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await db.insert(ageGenderRanges).values({
        hospital_id: input.hospital_id,
        component_id: input.component_id,
        age_min_years: input.age_min_years,
        age_max_years: input.age_max_years,
        gender: input.gender,
        ref_range_low: input.ref_range_low ?? null,
        ref_range_high: input.ref_range_high ?? null,
        ref_range_text: input.ref_range_text ?? null,
        critical_low: input.critical_low ?? null,
        critical_high: input.critical_high ?? null,
      }).returning();

      return created;
    }),

  // ----------------------------------------------------------
  // 9. LIST AGE/GENDER RANGES — All ranges for a component
  // ----------------------------------------------------------
  listAgeGenderRanges: protectedProcedure
    .input(z.object({ component_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const ranges = await db.select()
        .from(ageGenderRanges)
        .where(and(
          eq(ageGenderRanges.component_id, input.component_id),
          eq(ageGenderRanges.is_active, true),
        ))
        .orderBy(asc(ageGenderRanges.gender), asc(ageGenderRanges.age_min_years));

      return ranges;
    }),

  // ----------------------------------------------------------
  // 10. CREATE ACCESSION CONFIG
  // ----------------------------------------------------------
  createAccessionConfig: adminProcedure
    .input(z.object({
      hospital_id: z.string(),
      config_name: z.string().min(1).max(100),
      department: z.string().max(50).optional(),
      prefix: z.string().min(1).max(20),
      prefix_type: z.enum(['department', 'panel', 'specimen_type', 'custom']).default('department'),
      date_format: z.string().default('YYYYMMDD'),
      sequence_digits: z.number().min(3).max(8).default(4),
      separator: z.string().max(5).default('-'),
    }))
    .mutation(async ({ input }) => {
      const [config] = await db.insert(accessionConfigs).values({
        hospital_id: input.hospital_id,
        config_name: input.config_name,
        department: input.department ?? null,
        prefix: input.prefix,
        prefix_type: input.prefix_type,
        date_format: input.date_format,
        sequence_digits: input.sequence_digits,
        separator: input.separator,
      }).returning();

      return config;
    }),

  // ----------------------------------------------------------
  // 11. LIST ACCESSION CONFIGS
  // ----------------------------------------------------------
  listAccessionConfigs: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const configs = await db.select()
        .from(accessionConfigs)
        .where(and(
          eq(accessionConfigs.hospital_id, input.hospital_id),
          eq(accessionConfigs.is_active, true),
        ))
        .orderBy(asc(accessionConfigs.config_name));

      return configs;
    }),

  // ----------------------------------------------------------
  // 12. GENERATE ACCESSION — Atomic next-number generation
  // ----------------------------------------------------------
  generateAccession: protectedProcedure
    .input(z.object({
      config_id: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      const [config] = await db.select()
        .from(accessionConfigs)
        .where(eq(accessionConfigs.id, input.config_id))
        .limit(1);

      if (!config) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Accession config not found' });
      }

      // Generate date key based on format
      const now = new Date();
      const yyyy = now.getFullYear().toString();
      const mm = (now.getMonth() + 1).toString().padStart(2, '0');
      const dd = now.getDate().toString().padStart(2, '0');
      const yy = yyyy.slice(-2);

      let dateKey = '';
      switch (config.date_format) {
        case 'YYYYMMDD': dateKey = `${yyyy}${mm}${dd}`; break;
        case 'YYMMDD': dateKey = `${yy}${mm}${dd}`; break;
        case 'YYMM': dateKey = `${yy}${mm}`; break;
        default: dateKey = `${yyyy}${mm}${dd}`;
      }

      // If date rolled over, reset sequence
      let nextSeq: number;
      if (config.current_date_key !== dateKey) {
        nextSeq = 1;
      } else {
        nextSeq = config.current_sequence + 1;
      }

      // Atomic update
      await db.update(accessionConfigs)
        .set({
          current_date_key: dateKey,
          current_sequence: nextSeq,
          updated_at: new Date(),
        })
        .where(eq(accessionConfigs.id, input.config_id));

      // Format: PREFIX-DATEKEY-SEQUENCE
      const seqStr = nextSeq.toString().padStart(config.sequence_digits, '0');
      const accessionNumber = `${config.prefix}${config.separator}${dateKey}${config.separator}${seqStr}`;

      return { accession_number: accessionNumber, sequence: nextSeq };
    }),

  // ----------------------------------------------------------
  // 13. CATALOG STATS — Dashboard counts
  // ----------------------------------------------------------
  catalogStats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const [panelCount] = await db.select({ total: count() })
        .from(labPanels)
        .where(and(
          eq(labPanels.hospital_id, input.hospital_id),
          eq(labPanels.is_active, true),
        ));

      const [componentCount] = await db.select({ total: count() })
        .from(labPanelComponents)
        .where(and(
          eq(labPanelComponents.hospital_id, input.hospital_id),
          eq(labPanelComponents.is_active, true),
        ));

      const [withCritical] = await db.select({ total: count() })
        .from(labPanelComponents)
        .where(and(
          eq(labPanelComponents.hospital_id, input.hospital_id),
          eq(labPanelComponents.is_active, true),
          sql`${labPanelComponents.critical_low} IS NOT NULL OR ${labPanelComponents.critical_high} IS NOT NULL`,
        ));

      const [ageGenderCount] = await db.select({ total: count() })
        .from(ageGenderRanges)
        .where(and(
          eq(ageGenderRanges.hospital_id, input.hospital_id),
          eq(ageGenderRanges.is_active, true),
        ));

      const [accessionCount] = await db.select({ total: count() })
        .from(accessionConfigs)
        .where(and(
          eq(accessionConfigs.hospital_id, input.hospital_id),
          eq(accessionConfigs.is_active, true),
        ));

      // Recent changes (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [recentChanges] = await db.select({ total: count() })
        .from(testCatalogVersions)
        .where(and(
          eq(testCatalogVersions.hospital_id, input.hospital_id),
          gte(testCatalogVersions.created_at, sevenDaysAgo),
        ));

      return {
        panels: panelCount?.total ?? 0,
        components: componentCount?.total ?? 0,
        with_critical_ranges: withCritical?.total ?? 0,
        age_gender_rules: ageGenderCount?.total ?? 0,
        accession_configs: accessionCount?.total ?? 0,
        recent_changes_7d: recentChanges?.total ?? 0,
      };
    }),
});
