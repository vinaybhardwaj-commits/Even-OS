import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * POST /api/migrations/bed-management-v2-rebuild
 *
 * BM.1 — Corrected re-seed after unique-index collision bug.
 *
 * Problem (from first run):
 * - Unique index on (code, hospital_id) rejected beds whose code matched their room code
 *   (e.g., private room 1-04 + bed 1-04 → only 1 row, not 2).
 * - Only semi-private beds (1-01A, 1-01B …) survived; all private/suite/specialty beds failed
 *   silently via ON CONFLICT DO UPDATE that mutated the room row.
 * - Legacy demo locations not matching `code LIKE 'GEN-%'` (F1, PVT, ICU-06..08, PVT-01..08)
 *   were left active.
 *
 * Fix:
 * 1. Swap unique index to (code, hospital_id, location_type) — allows room + bed to share a code.
 * 2. Detach and release any active encounter/bed_assignment pointing at corrupted or legacy beds.
 * 3. Hard-delete the handful of corrupted rows that can't be repaired cleanly.
 * 4. Deactivate every non-hospital active location, old or new (clean slate).
 * 5. Re-seed the correct EHRC layout.
 * 6. Re-assign all orphaned active encounters to newly created beds.
 */
export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC';
    const steps: string[] = [];

    // ─── STEP 1: SWAP UNIQUE INDEX ──────────────────────────────
    await sql(`DROP INDEX IF EXISTS idx_locations_code_hospital`);
    await sql(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_code_hospital_type
      ON locations (code, hospital_id, location_type)
    `);
    steps.push('✅ Swapped unique index: (code, hospital_id) → (code, hospital_id, location_type)');

    // ─── STEP 2: DETACH ALL ACTIVE ENCOUNTERS FROM BED LOCATIONS ──────
    // Collect all encounter IDs that are currently occupying any bed (we'll reassign them later)
    const activeEncounterRows = await sql(`
      SELECT e.id, e.current_location_id, l.code as old_bed_code
      FROM encounters e
      JOIN locations l ON e.current_location_id = l.id
      WHERE e.hospital_id = $1
        AND e.status = 'in-progress'
        AND l.location_type = 'bed'
    `, [hospitalId]);

    steps.push(`✅ Found ${activeEncounterRows.length} active encounters holding beds`);

    // Release all their bed_assignments (we'll recreate)
    if (activeEncounterRows.length > 0) {
      const encIds = activeEncounterRows.map((e: any) => e.id);
      await sql(`
        UPDATE bed_assignments
        SET released_at = now(), reason_released = 'transfer'
        WHERE encounter_id = ANY($1::uuid[]) AND released_at IS NULL
      `, [encIds]);
      await sql(`
        UPDATE encounters
        SET current_location_id = NULL
        WHERE id = ANY($1::uuid[])
      `, [encIds]);
      steps.push(`✅ Released ${activeEncounterRows.length} bed assignments and detached encounters`);
    }

    // ─── STEP 3: QUARANTINE CORRUPTED / LEGACY ROWS ─────────────────
    // We can't hard-delete because many tables FK to locations.id with ON DELETE RESTRICT
    // (patient_assignments, encounters, bed_assignments, bed_status_history, etc.).
    // Instead: rename the stale rows' code (so new seed inserts don't collide) and deactivate.
    // The new unique index is (code, hospital_id, location_type), so renaming gets them
    // out of the way for fresh inserts.

    // Mark any patient_assignments whose status='active' as 'completed' so the nursing UI
    // doesn't render stale rows — and so those rows won't block later status updates.
    await sql(`
      UPDATE patient_assignments pa
      SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE pa.hospital_id = $1
        AND pa.status = 'active'
        AND EXISTS (
          SELECT 1 FROM locations l
          WHERE l.id = pa.ward_id
            AND (
              l.location_type <> 'ward'
              OR l.code IN ('PVT')
              OR l.parent_location_id = l.id
            )
        )
    `, [hospitalId]);
    steps.push('✅ Closed stale active patient_assignments pointing at legacy/corrupted wards');

    // Self-referential beds (ICU-01..05 from first run)
    const selfRefBeds = await sql(`
      SELECT id, code FROM locations
      WHERE hospital_id = $1
        AND location_type = 'bed'
        AND parent_location_id = id
    `, [hospitalId]);

    if (selfRefBeds.length > 0) {
      // Release any bed_assignments (status_history is fine to leave)
      const ids = selfRefBeds.map((r: any) => r.id);
      await sql(`
        UPDATE bed_assignments SET released_at = now(), reason_released = 'transfer'
        WHERE location_id = ANY($1::uuid[]) AND released_at IS NULL
      `, [ids]);
      // Rename code to ZOMBIE-<oldcode>-<uuid-suffix> and deactivate
      await sql(`
        UPDATE locations
        SET code = 'ZOMBIE-' || code || '-' || substring(id::text, 1, 8),
            status = 'inactive',
            parent_location_id = NULL
        WHERE id = ANY($1::uuid[])
      `, [ids]);
      steps.push(`✅ Quarantined ${selfRefBeds.length} self-referential corrupted beds`);
    }

    // Legacy demo ICU-06..08, PVT-* beds — rename + deactivate
    const legacyBedIds = await sql(`
      SELECT id, code FROM locations
      WHERE hospital_id = $1
        AND location_type = 'bed'
        AND (code LIKE 'PVT-%' OR code IN ('ICU-06','ICU-07','ICU-08'))
    `, [hospitalId]);

    if (legacyBedIds.length > 0) {
      const ids = legacyBedIds.map((r: any) => r.id);
      await sql(`
        UPDATE bed_assignments SET released_at = now(), reason_released = 'transfer'
        WHERE location_id = ANY($1::uuid[]) AND released_at IS NULL
      `, [ids]);
      await sql(`
        UPDATE locations
        SET code = 'ZOMBIE-' || code || '-' || substring(id::text, 1, 8),
            status = 'inactive',
            parent_location_id = NULL
        WHERE id = ANY($1::uuid[])
      `, [ids]);
      steps.push(`✅ Quarantined ${legacyBedIds.length} legacy beds`);
    }

    // Legacy PVT ward and F1 floor — rename + deactivate (keep IDs intact for FK integrity)
    const legacyParents = await sql(`
      SELECT id, code FROM locations
      WHERE hospital_id = $1 AND code IN ('PVT','F1')
    `, [hospitalId]);

    if (legacyParents.length > 0) {
      const ids = legacyParents.map((p: any) => p.id);
      await sql(`
        UPDATE locations
        SET code = 'ZOMBIE-' || code || '-' || substring(id::text, 1, 8),
            status = 'inactive'
        WHERE id = ANY($1::uuid[])
      `, [ids]);
      steps.push(`✅ Quarantined legacy parents: ${legacyParents.map((p: any) => p.code).join(', ')}`);
    }

    // ─── STEP 4: DEACTIVATE REMAINING NON-HOSPITAL LOCATIONS ─────────
    // This gives us a clean slate before re-seeding
    const deactivated = await sql(`
      UPDATE locations
      SET status = 'inactive'
      WHERE hospital_id = $1
        AND status = 'active'
        AND location_type <> 'hospital'
      RETURNING id
    `, [hospitalId]);
    steps.push(`✅ Deactivated ${deactivated.length} remaining non-hospital locations`);

    // ─── STEP 5: RE-SEED EHRC LAYOUT ─────────────────────────────────

    // Ensure hospital location exists
    await sql(`
      INSERT INTO locations (hospital_id, location_type, code, name, capacity, status)
      VALUES ($1, 'hospital', 'EHRC', 'Even Hospital Race Course Road', 53, 'active')
      ON CONFLICT (code, hospital_id, location_type) DO UPDATE SET capacity = 53, status = 'active'
    `, [hospitalId]);
    const hospRow = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND location_type='hospital' AND code='EHRC'`, [hospitalId]);
    const hospitalLocId = hospRow[0].id;

    // Floors
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
        ON CONFLICT (code, hospital_id, location_type)
        DO UPDATE SET name = $4, floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, hospitalLocId, f.code, f.name, f.number]);
      const r = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND code=$2 AND location_type='floor'`, [hospitalId, f.code]);
      floorIds[f.number] = r[0].id;
    }
    steps.push('✅ Seeded 4 floors');

    // ─── Helper: create a general ward on a floor ────────────────
    async function createGeneralWard(floorNum: number, floorId: string) {
      const wardCode = `GW-${floorNum}F`;
      await sql(`
        INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, ward_type, capacity, floor_number, status)
        VALUES ($1, 'ward', $2, $3, $4, 'general', 13, $5, 'active')
        ON CONFLICT (code, hospital_id, location_type)
        DO UPDATE SET name = $4, ward_type = 'general', capacity = 13, floor_number = $5, parent_location_id = $2, status = 'active'
      `, [hospitalId, floorId, wardCode, `General Ward ${floorNum}F`, floorNum]);
      const w = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND code=$2 AND location_type='ward'`, [hospitalId, wardCode]);
      const wardId = w[0].id;

      let roomNum = 1;

      const upsertRoom = async (roomCode: string, roomType: string, capacity: number) => {
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, status)
          VALUES ($1, 'room', $2, $3, $4, $5::room_type, $6, $7, 'active')
          ON CONFLICT (code, hospital_id, location_type)
          DO UPDATE SET name = $4, room_type = $5::room_type, capacity = $6, floor_number = $7, parent_location_id = $2, status = 'active'
        `, [hospitalId, wardId, roomCode, `Room ${roomCode}`, roomType, capacity, floorNum]);
        const r = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND code=$2 AND location_type='room'`, [hospitalId, roomCode]);
        return r[0].id;
      };

      const upsertBed = async (parentRoomId: string, bedCode: string, bedName: string) => {
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, status)
          VALUES ($1, 'bed', $2, $3, $4, 'available', $5, 'active')
          ON CONFLICT (code, hospital_id, location_type)
          DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, parent_location_id = $2, status = 'active'
        `, [hospitalId, parentRoomId, bedCode, bedName, floorNum]);
      };

      let createdRooms = 0, createdBeds = 0;

      // 3 semi-private rooms (2 beds each)
      for (let i = 0; i < 3; i++) {
        const roomCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
        const roomId = await upsertRoom(roomCode, 'semi_private', 2);
        createdRooms++;
        for (const suffix of ['A', 'B']) {
          await upsertBed(roomId, `${roomCode}${suffix}`, `Bed ${roomCode}${suffix}`);
          createdBeds++;
        }
        roomNum++;
      }

      // 6 private rooms (1 bed each) — bed code == room code, now allowed by new unique index
      for (let i = 0; i < 6; i++) {
        const roomCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
        const roomId = await upsertRoom(roomCode, 'private', 1);
        createdRooms++;
        await upsertBed(roomId, roomCode, `Bed ${roomCode}`);
        createdBeds++;
        roomNum++;
      }

      // 1 suite (1 bed) — bed code == room code
      const suiteCode = `${floorNum}-${String(roomNum).padStart(2, '0')}`;
      const suiteRoomId = await upsertRoom(suiteCode, 'suite', 1);
      createdRooms++;
      await upsertBed(suiteRoomId, suiteCode, `Suite ${suiteCode}`);
      createdBeds++;

      return { createdRooms, createdBeds };
    }

    // ─── Helper: specialty ward ──────────────────────────────────
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
        ON CONFLICT (code, hospital_id, location_type)
        DO UPDATE SET name = $4, ward_type = $5::ward_type, capacity = $6, floor_number = $7, infrastructure_flags = $8::jsonb, parent_location_id = $2, status = 'active'
      `, [hospitalId, floorId, wardCode, wardName, wardType, bedCount, floorNum, JSON.stringify(infraFlags)]);
      const w = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND code=$2 AND location_type='ward'`, [hospitalId, wardCode]);
      const wardId = w[0].id;

      let createdRooms = 0, createdBeds = 0;
      for (let i = 1; i <= bedCount; i++) {
        const roomCode = `${wardCode}-${String(i).padStart(2, '0')}`;
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, room_type, capacity, floor_number, infrastructure_flags, status)
          VALUES ($1, 'room', $2, $3, $4, $5::room_type, 1, $6, $7::jsonb, 'active')
          ON CONFLICT (code, hospital_id, location_type)
          DO UPDATE SET name = $4, room_type = $5::room_type, capacity = 1, floor_number = $6, infrastructure_flags = $7::jsonb, parent_location_id = $2, status = 'active'
        `, [hospitalId, wardId, roomCode, `${wardName} Room ${i}`, roomType, floorNum, JSON.stringify(infraFlags)]);
        const r = await sql(`SELECT id FROM locations WHERE hospital_id=$1 AND code=$2 AND location_type='room'`, [hospitalId, roomCode]);
        const roomId = r[0].id;
        createdRooms++;

        // Bed code = room code (e.g., ICU-01 bed under ICU-01 room)
        await sql(`
          INSERT INTO locations (hospital_id, location_type, parent_location_id, code, name, bed_status, floor_number, infrastructure_flags, status)
          VALUES ($1, 'bed', $2, $3, $4, 'available', $5, $6::jsonb, 'active')
          ON CONFLICT (code, hospital_id, location_type)
          DO UPDATE SET name = $4, bed_status = 'available', floor_number = $5, infrastructure_flags = $6::jsonb, parent_location_id = $2, status = 'active'
        `, [hospitalId, roomId, roomCode, `${wardName} Bed ${i}`, floorNum, JSON.stringify(infraFlags)]);
        createdBeds++;
      }
      return { createdRooms, createdBeds };
    }

    // Seed general wards
    const gw1 = await createGeneralWard(1, floorIds[1]);
    steps.push(`✅ GW-1F: ${gw1.createdRooms} rooms, ${gw1.createdBeds} beds`);
    const gw2 = await createGeneralWard(2, floorIds[2]);
    steps.push(`✅ GW-2F: ${gw2.createdRooms} rooms, ${gw2.createdBeds} beds`);
    const gw4 = await createGeneralWard(4, floorIds[4]);
    steps.push(`✅ GW-4F: ${gw4.createdRooms} rooms, ${gw4.createdBeds} beds`);

    // Seed specialty wards
    const icu = await createSpecialtyWard(floorIds[3], 3, 'ICU', 'Intensive Care Unit', 'icu', 'icu_room', 5,
      { ventilator: true, cardiac_monitor: true, central_line: true, arterial_line: true, isolation_capable: true });
    steps.push(`✅ ICU: ${icu.createdRooms} rooms, ${icu.createdBeds} beds`);

    const nicu = await createSpecialtyWard(floorIds[3], 3, 'NICU', 'Neonatal ICU', 'nicu', 'nicu_room', 2,
      { incubator: true, phototherapy: true, cardiac_monitor: true, ventilator: true, cpap: true });
    steps.push(`✅ NICU: ${nicu.createdRooms} rooms, ${nicu.createdBeds} beds`);

    const pacu = await createSpecialtyWard(floorIds[3], 3, 'PACU', 'Post-Anaesthesia Care Unit', 'pacu', 'pacu_bay', 4,
      { cardiac_monitor: true, oxygen: true, suction: true, warming_blanket: true });
    steps.push(`✅ PACU: ${pacu.createdRooms} rooms, ${pacu.createdBeds} beds`);

    const dialysis = await createSpecialtyWard(floorIds[4], 4, 'DIALYSIS', 'Dialysis Unit', 'dialysis', 'dialysis_station', 3,
      { dialysis_machine: true, water_treatment: true, cardiac_monitor: true });
    steps.push(`✅ Dialysis: ${dialysis.createdRooms} rooms, ${dialysis.createdBeds} beds`);

    // ─── STEP 6: VERIFY COUNTS ───────────────────────────────────────
    const counts = await sql(`
      SELECT location_type, count(*)::int as cnt
      FROM locations
      WHERE hospital_id = $1 AND status = 'active'
      GROUP BY location_type
      ORDER BY location_type
    `, [hospitalId]);
    const countMap: Record<string, number> = {};
    for (const r of counts) countMap[r.location_type] = r.cnt;

    const bedCountRow = await sql(`
      SELECT count(*)::int as cnt FROM locations
      WHERE hospital_id=$1 AND status='active' AND location_type='bed'
    `, [hospitalId]);
    const totalBeds = bedCountRow[0].cnt;
    steps.push(`✅ Verification — Active locations: ${JSON.stringify(countMap)}`);
    steps.push(totalBeds === 53 ? '✅ Confirmed: 53 active beds' : `⚠️ Expected 53 beds, found ${totalBeds}`);

    // ─── STEP 7: RE-ASSIGN ORPHANED ENCOUNTERS TO NEW BEDS ───────────
    const orphanedEncounters = await sql(`
      SELECT id FROM encounters
      WHERE hospital_id = $1
        AND status = 'in-progress'
        AND current_location_id IS NULL
      ORDER BY admission_at NULLS LAST, created_at
    `, [hospitalId]);

    if (orphanedEncounters.length > 0) {
      const availableBeds = await sql(`
        SELECT id, code FROM locations
        WHERE hospital_id=$1 AND status='active' AND location_type='bed' AND bed_status='available'
        ORDER BY code
        LIMIT $2
      `, [hospitalId, orphanedEncounters.length]);

      let reassigned = 0;
      for (let i = 0; i < Math.min(orphanedEncounters.length, availableBeds.length); i++) {
        const enc = orphanedEncounters[i];
        const bed = availableBeds[i];
        await sql(`UPDATE encounters SET current_location_id=$1 WHERE id=$2`, [bed.id, enc.id]);
        await sql(`INSERT INTO bed_assignments (hospital_id, location_id, encounter_id, assigned_at) VALUES ($1,$2,$3,now())`,
          [hospitalId, bed.id, enc.id]);
        await sql(`UPDATE locations SET bed_status='occupied' WHERE id=$1`, [bed.id]);
        reassigned++;
      }
      steps.push(`✅ Re-assigned ${reassigned} orphaned encounters to new beds`);
      if (orphanedEncounters.length > availableBeds.length) {
        steps.push(`⚠️ ${orphanedEncounters.length - availableBeds.length} encounters left unassigned (not enough beds)`);
      }
    } else {
      steps.push('✅ No orphaned encounters');
    }

    return NextResponse.json({
      success: true,
      message: 'BM.1 Rebuild complete',
      steps,
      summary: {
        floors: countMap['floor'] || 0,
        wards: countMap['ward'] || 0,
        rooms: countMap['room'] || 0,
        beds: totalBeds,
      },
    });
  } catch (error: any) {
    console.error('BM.1 rebuild error:', error);
    return NextResponse.json({ success: false, error: error.message, stack: error.stack }, { status: 500 });
  }
}
