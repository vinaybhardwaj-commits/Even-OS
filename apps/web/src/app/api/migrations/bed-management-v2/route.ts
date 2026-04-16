import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/migrations/bed-management-v2
 *
 * BM.1 — Bed Management System v2 Migration
 *
 * 1. Adds new enums: ward_type, room_type, room_tag
 * 2. Adds new bed_status enum values: terminal_cleaning, maintenance
 * 3. Adds new columns to locations: ward_type, room_type, floor_number, room_tag, infrastructure_flags
 * 4. Creates bed_structure_audit table for structural change logging
 * 5. Deactivates old demo locations
 * 6. Seeds actual EHRC Race Course Road layout:
 *    - 1F: General Ward (3 semi-private, 6 private, 1 suite) = 13 beds
 *    - 2F: General Ward (3 semi-private, 6 private, 1 suite) = 13 beds
 *    - 3F: ICU (5 beds), NICU (2 beds), PACU (4 beds) = 11 beds
 *    - 4F: General Ward (3 semi-private, 6 private, 1 suite) = 13 beds + Dialysis (3 beds) = 16 beds
 *    Total: 53 beds in 44 rooms across 6 wards on 4 floors
 *
 * Safe to run multiple times — uses IF NOT EXISTS and ON CONFLICT.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC';
    const results: string[] = [];

    // ─── STEP 1: NEW ENUMS ──────────────────────────────────────
    await sql(`DO $$ BEGIN CREATE TYPE ward_type AS ENUM ('general','icu','nicu','pacu','dialysis','day_care','maternity','step_down'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await sql(`DO $$ BEGIN CREATE TYPE room_type AS ENUM ('private','semi_private','suite','icu_room','nicu_room','pacu_bay','dialysis_station','general'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    await sql(`DO $$ BEGIN CREATE TYPE room_tag AS ENUM ('none','day_care','maternity','isolation'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    results.push('✅ Created new enums: ward_type, room_type, room_tag');

    // ─── STEP 2: ADD BED STATUS ENUM VALUES ─────────────────────
    // Postgres ALTER TYPE ADD VALUE is idempotent if we check first
    const existingBedStatuses = await sql(`SELECT unnest(enum_range(NULL::bed_status))::text as val`);
    const currentStatuses = existingBedStatuses.map((r: any) => r.val);

    if (!currentStatuses.includes('terminal_cleaning')) {
      await sql(`ALTER TYPE bed_status ADD VALUE 'terminal_cleaning'`);
      results.push('✅ Added terminal_cleaning to bed_status enum');
    }
    if (!currentStatuses.includes('maintenance')) {
      await sql(`ALTER TYPE bed_status ADD VALUE 'maintenance'`);
      results.push('✅ Added maintenance to bed_status enum');
    }

    // ─── STEP 3: ADD COLUMNS TO LOCATIONS ───────────────────────
    const addColumnIfMissing = async (col: string, typeDef: string) => {
      const exists = await sql(`SELECT 1 FROM information_schema.columns WHERE table_name='locations' AND column_name=$1`, [col]);
      if (exists.length === 0) {
        await sql(`ALTER TABLE locations ADD COLUMN ${col} ${typeDef}`);
        return true;
      }
      return false;
    };

    if (await addColumnIfMissing('ward_type', 'ward_type')) results.push('✅ Added ward_type column');
    if (await addColumnIfMissing('room_type', 'room_type')) results.push('✅ Added room_type column');
    if (await addColumnIfMissing('floor_number', 'INTEGER')) results.push('✅ Added floor_number column');
    if (await addColumnIfMissing('room_tag', "room_tag DEFAULT 'none'")) results.push('✅ Added room_tag column');
    if (await addColumnIfMissing('infrastructure_flags', 'JSONB')) results.push('✅ Added infrastructure_flags column');

    // ─── STEP 4: BED STRUCTURE AUDIT TABLE ──────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS bed_structure_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      old_values JSONB,
      new_values JSONB,
      performed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reason TEXT
    )`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_bed_struct_audit_hospital ON bed_structure_audit(hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_bed_struct_audit_entity ON bed_structure_audit(entity_type, entity_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_bed_struct_audit_at ON bed_structure_audit(performed_at DESC)`);
    results.push('✅ Created bed_structure_audit table');

    // ─── STEP 5: DEACTIVATE OLD DEMO LOCATIONS ─────────────────
    // Mark all existing wards/beds as inactive (they're demo data)
    // Preserve encounters by keeping the locations — just inactive
    const deactivated = await sql(`
      UPDATE locations SET status = 'inactive'
      WHERE hospital_id = $1
        AND status = 'active'
        AND location_type IN ('ward', 'bed')
        AND code LIKE 'GEN-%'
      RETURNING id
    `, [hospitalId]);
    results.push(`✅ Deactivated ${deactivated.length} old demo locations`);

    // ─── STEP 6: SEED EHRC FLOOR STRUCTURE ──────────────────────
    // First ensure hospital-level location exists
    await sql(`
      INSERT INTO locations (hospital_id, location_type, code, name, capacity, status)
      VALUES ($1, 'hospital', 'EHRC', 'Even Hospital Race Course Road', 53, 'active')
      ON CONFLICT (code, hospital_id) DO UPDATE SET capacity = 53, status = 'active'
    `, [hospitalId]);

    const hospitalLoc = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND location_type = 'hospital' AND code = 'EHRC' LIMIT 1`, [hospitalId]);
    const hospitalLocId = hospitalLoc[0].id;

    // Create floors
    const floors = [
      { code: 'FLOOR-1', name: '1st Floor', number: 1 },
      { code: 'FLOOR-2', name: '2nd Floor', number: 2 },
      { code: 'FLOOR-3', name: '3rd Floor', number: 3 },
      { code: 'FLOOR-4', name: '4th Floor', number: 4 },
    ];

    const floorIds: Record<number, string> = {};
    for (const f of floors) {
      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, floor_number, status)
        VALUES ($1, 'floor', $2, $3, $4, $5, 'active')
        ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, hospitalLocId, f.code, f.name, f.number]);

      const row = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, f.code]);
      floorIds[f.number] = row[0].id;
    }
    results.push('✅ Created 4 floor locations');

    // ─── HELPER: Create a general ward on a floor ───────────────
    async function createGeneralWard(floorNum: number, floorId: string) {
      const wardCode = `GW-${floorNum}F`;
      const wardName = `General Ward ${floorNum}F`;

      // Create ward
      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, ward_type, capacity, floor_number, status)
        VALUES ($1, 'ward', $2, $3, $4, 'general', 13, $5, 'active')
        ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, ward_type = 'general', capacity = 13, floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, floorId, wardCode, wardName, floorNum]);

      const wardRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, wardCode]);
      const wardId = wardRow[0].id;

      let roomNum = 1;

      // 3 semi-private rooms (2 beds each)
      for (let i = 0; i < 3; i++) {
        const roomCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
        const roomName = `Room ${roomCode}`;

        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, status)
          VALUES ($1, 'room', $2, $3, $4, 'semi_private', 2, $5, 'active')
          ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, room_type = 'semi_private', capacity = 2, floor_number = $5, parent_location_id = $2, status = 'active'
        `, [hospitalId, wardId, roomCode, roomName, floorNum]);

        const roomRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, roomCode]);
        const roomId = roomRow[0].id;

        // Create 2 beds (A and B)
        for (const suffix of ['A', 'B']) {
          const bedCode = `${roomCode}${suffix}`;
          const bedName = `Bed ${bedCode}`;
          await sql(`
            INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, status)
            VALUES ($1, 'bed', $2, $3, $4, 'available', $5, 'active')
            ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, parent_location_id = $2, status = 'active'
          `, [hospitalId, roomId, bedCode, bedName, floorNum]);
        }
        roomNum++;
      }

      // 6 private rooms (1 bed each)
      for (let i = 0; i < 6; i++) {
        const roomCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
        const roomName = `Room ${roomCode}`;

        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, status)
          VALUES ($1, 'room', $2, $3, $4, 'private', 1, $5, 'active')
          ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, room_type = 'private', capacity = 1, floor_number = $5, parent_location_id = $2, status = 'active'
        `, [hospitalId, wardId, roomCode, roomName, floorNum]);

        const roomRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, roomCode]);
        const roomId = roomRow[0].id;

        const bedCode = roomCode; // Private rooms: bed code = room code
        const bedName = `Bed ${bedCode}`;
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, status)
          VALUES ($1, 'bed', $2, $3, $4, 'available', $5, 'active')
          ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, parent_location_id = $2, status = 'active'
        `, [hospitalId, roomId, bedCode, bedName, floorNum]);

        roomNum++;
      }

      // 1 suite (1 bed)
      const suiteCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
      const suiteName = `Suite ${suiteCode}`;

      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, status)
        VALUES ($1, 'room', $2, $3, $4, 'suite', 1, $5, 'active')
        ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, room_type = 'suite', capacity = 1, floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, wardId, suiteCode, suiteName, floorNum]);

      const suiteRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, suiteCode]);
      const suiteId = suiteRow[0].id;

      const suiteBedCode = suiteCode;
      const suiteBedName = `Suite ${suiteBedCode}`;
      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, status)
        VALUES ($1, 'bed', $2, $3, $4, 'available', $5, 'active')
        ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, suiteId, suiteBedCode, suiteBedName, floorNum]);

      return wardId;
    }

    // ─── HELPER: Create a specialty ward ────────────────────────
    async function createSpecialtyWard(
      floorId: string,
      floorNum: number,
      wardCode: string,
      wardName: string,
      wardType: string,
      roomType: string,
      bedCount: number,
      infraFlags: Record<string, any>,
    ) {
      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, ward_type, capacity, floor_number, infrastructure_flags, status)
        VALUES ($1, 'ward', $2, $3, $4, $5::ward_type, $6, $7, $8::jsonb, 'active')
        ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, ward_type = $5::ward_type, capacity = $6, floor_number = $7, infrastructure_flags = $8::jsonb, parent_location_id = $2, status = 'active'
      `, [hospitalId, floorId, wardCode, wardName, wardType, bedCount, floorNum, JSON.stringify(infraFlags)]);

      const wardRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, wardCode]);
      const wardId = wardRow[0].id;

      for (let i = 1; i <= bedCount; i++) {
        const roomCode = `${wardCode}-${String(i).padStart(2, '0')}`;
        const roomName = `${wardName} Room ${i}`;

        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, infrastructure_flags, status)
          VALUES ($1, 'room', $2, $3, $4, $5::room_type, 1, $6, $7::jsonb, 'active')
          ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, room_type = $5::room_type, capacity = 1, floor_number = $6, infrastructure_flags = $7::jsonb, parent_location_id = $2, status = 'active'
        `, [hospitalId, wardId, roomCode, roomName, roomType, floorNum, JSON.stringify(infraFlags)]);

        const roomRow = await sql(`SELECT id FROM locations WHERE hospital_id = $1 AND code = $2 LIMIT 1`, [hospitalId, roomCode]);
        const roomId = roomRow[0].id;

        const bedCode = roomCode; // 1 bed per specialty room
        const bedName = `${wardName} Bed ${i}`;
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, infrastructure_flags, status)
          VALUES ($1, 'bed', $2, $3, $4, 'available', $5, $6::jsonb, 'active')
          ON CONFLICT (code, hospital_id) DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, infrastructure_flags = $6::jsonb, parent_location_id = $2, status = 'active'
        `, [hospitalId, roomId, bedCode, bedName, floorNum, JSON.stringify(infraFlags)]);
      }

      return wardId;
    }

    // ─── SEED GENERAL WARDS (1F, 2F, 4F) ────────────────────────
    await createGeneralWard(1, floorIds[1]);
    results.push('✅ Seeded General Ward 1F: 10 rooms, 13 beds');

    await createGeneralWard(2, floorIds[2]);
    results.push('✅ Seeded General Ward 2F: 10 rooms, 13 beds');

    await createGeneralWard(4, floorIds[4]);
    results.push('✅ Seeded General Ward 4F: 10 rooms, 13 beds');

    // ─── SEED 3RD FLOOR SPECIALTY WARDS ─────────────────────────
    const icuInfra = { ventilator: true, cardiac_monitor: true, central_line: true, arterial_line: true, isolation_capable: true };
    await createSpecialtyWard(floorIds[3], 3, 'ICU', 'Intensive Care Unit', 'icu', 'icu_room', 5, icuInfra);
    results.push('✅ Seeded ICU: 5 rooms, 5 beds');

    const nicuInfra = { incubator: true, phototherapy: true, cardiac_monitor: true, ventilator: true, cpap: true };
    await createSpecialtyWard(floorIds[3], 3, 'NICU', 'Neonatal ICU', 'nicu', 'nicu_room', 2, nicuInfra);
    results.push('✅ Seeded NICU: 2 rooms, 2 beds');

    const pacuInfra = { cardiac_monitor: true, oxygen: true, suction: true, warming_blanket: true };
    await createSpecialtyWard(floorIds[3], 3, 'PACU', 'Post-Anaesthesia Care Unit', 'pacu', 'pacu_bay', 4, pacuInfra);
    results.push('✅ Seeded PACU: 4 rooms, 4 beds');

    // ─── SEED 4TH FLOOR DIALYSIS ────────────────────────────────
    const dialysisInfra = { dialysis_machine: true, water_treatment: true, cardiac_monitor: true };
    await createSpecialtyWard(floorIds[4], 4, 'DIALYSIS', 'Dialysis Unit', 'dialysis', 'dialysis_station', 3, dialysisInfra);
    results.push('✅ Seeded Dialysis: 3 rooms, 3 beds');

    // ─── STEP 7: VERIFY COUNTS ──────────────────────────────────
    const counts = await sql(`
      SELECT
        location_type,
        count(*)::int as cnt
      FROM locations
      WHERE hospital_id = $1 AND status = 'active'
      GROUP BY location_type
      ORDER BY location_type
    `, [hospitalId]);

    const countMap: Record<string, number> = {};
    for (const r of counts) countMap[r.location_type] = r.cnt;
    results.push(`✅ Verification — Active locations: ${JSON.stringify(countMap)}`);

    // Verify bed count
    const bedCount = await sql(`
      SELECT count(*)::int as cnt FROM locations
      WHERE hospital_id = $1 AND status = 'active' AND location_type = 'bed'
    `, [hospitalId]);
    const totalBeds = bedCount[0].cnt;

    if (totalBeds !== 53) {
      results.push(`⚠️ Expected 53 beds, found ${totalBeds}`);
    } else {
      results.push('✅ Confirmed: 53 active beds');
    }

    // ─── STEP 8: REASSIGN EXISTING ENCOUNTERS TO NEW BEDS ──────
    // Any active encounters on old demo beds need to be freed
    // (The demo beds are now inactive, but encounters still reference them)
    const staleEncounters = await sql(`
      SELECT e.id, e.current_location_id, l.code as old_bed_code
      FROM encounters e
      JOIN locations l ON e.current_location_id = l.id
      WHERE e.hospital_id = $1
        AND e.status = 'in-progress'
        AND l.status = 'inactive'
    `, [hospitalId]);

    if (staleEncounters.length > 0) {
      // Get available beds to reassign
      const availableBeds = await sql(`
        SELECT id, code FROM locations
        WHERE hospital_id = $1 AND status = 'active' AND location_type = 'bed' AND bed_status = 'available'
        ORDER BY code LIMIT $2
      `, [hospitalId, staleEncounters.length]);

      for (let i = 0; i < Math.min(staleEncounters.length, availableBeds.length); i++) {
        const enc = staleEncounters[i];
        const newBed = availableBeds[i];

        // Update encounter location
        await sql(`UPDATE encounters SET current_location_id = $1 WHERE id = $2`, [newBed.id, enc.id]);

        // Release old bed assignment
        await sql(`
          UPDATE bed_assignments SET released_at = now(), reason_released = 'transfer'
          WHERE encounter_id = $1 AND released_at IS NULL
        `, [enc.id]);

        // Create new bed assignment
        await sql(`
          INSERT INTO bed_assignments (hospital_id, location_id, encounter_id, assigned_at)
          VALUES ($1, $2, $3, now())
        `, [hospitalId, newBed.id, enc.id]);

        // Mark new bed as occupied
        await sql(`UPDATE locations SET bed_status = 'occupied' WHERE id = $1`, [newBed.id]);

        results.push(`✅ Migrated encounter ${enc.id.slice(0, 8)} from ${enc.old_bed_code} → ${newBed.code}`);
      }

      if (staleEncounters.length > availableBeds.length) {
        results.push(`⚠️ ${staleEncounters.length - availableBeds.length} encounters could not be reassigned (not enough beds)`);
      }
    } else {
      results.push('✅ No stale encounters to migrate');
    }

    return NextResponse.json({
      success: true,
      message: 'BM.1 Migration complete — EHRC bed layout seeded',
      steps: results,
      summary: {
        floors: 4,
        wards: 6,
        rooms: countMap['room'] || 0,
        beds: totalBeds,
        encounters_migrated: staleEncounters.length,
      },
    });

  } catch (error: any) {
    console.error('BM.1 migration error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
