import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

/**
 * GET /api/migrations/bed-management-v2-inspect
 *
 * Diagnostic endpoint — inspects the current state of the locations table
 * to figure out why BM.1 migration came up short of expected 53 beds.
 */
export async function GET(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hospitalId = 'EHRC';

    // Counts by type and status
    const counts = await sql(`
      SELECT location_type, status, count(*)::int as cnt
      FROM locations
      WHERE hospital_id = $1
      GROUP BY location_type, status
      ORDER BY location_type, status
    `, [hospitalId]);

    // All active floors
    const floors = await sql(`
      SELECT id, code, name, floor_number, parent_location_id
      FROM locations
      WHERE hospital_id = $1 AND location_type = 'floor' AND status = 'active'
      ORDER BY floor_number NULLS LAST, code
    `, [hospitalId]);

    // All active wards
    const wards = await sql(`
      SELECT l.id, l.code, l.name, l.ward_type, l.capacity, l.floor_number,
             l.parent_location_id, p.code as parent_code
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.hospital_id = $1 AND l.location_type = 'ward' AND l.status = 'active'
      ORDER BY l.floor_number NULLS LAST, l.code
    `, [hospitalId]);

    // All active rooms grouped by ward
    const rooms = await sql(`
      SELECT l.id, l.code, l.name, l.room_type, l.capacity, l.floor_number,
             l.parent_location_id, p.code as parent_code
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.hospital_id = $1 AND l.location_type = 'room' AND l.status = 'active'
      ORDER BY l.floor_number NULLS LAST, l.code
    `, [hospitalId]);

    // All active beds
    const beds = await sql(`
      SELECT l.id, l.code, l.name, l.bed_status, l.floor_number,
             l.parent_location_id, p.code as parent_room
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.hospital_id = $1 AND l.location_type = 'bed' AND l.status = 'active'
      ORDER BY l.floor_number NULLS LAST, l.code
    `, [hospitalId]);

    // Room count per ward (to find which wards are short)
    const roomsPerWard = await sql(`
      SELECT w.code as ward_code, w.name as ward_name, w.capacity,
             count(r.id)::int as rooms_actual,
             count(CASE WHEN r.room_type = 'semi_private' THEN 1 END)::int as semi_private,
             count(CASE WHEN r.room_type = 'private' THEN 1 END)::int as private,
             count(CASE WHEN r.room_type = 'suite' THEN 1 END)::int as suite,
             count(CASE WHEN r.room_type NOT IN ('semi_private','private','suite') OR r.room_type IS NULL THEN 1 END)::int as other
      FROM locations w
      LEFT JOIN locations r ON r.parent_location_id = w.id AND r.status = 'active' AND r.location_type = 'room'
      WHERE w.hospital_id = $1 AND w.location_type = 'ward' AND w.status = 'active'
      GROUP BY w.id, w.code, w.name, w.capacity
      ORDER BY w.code
    `, [hospitalId]);

    // Bed count per room
    const bedsPerRoom = await sql(`
      SELECT r.code as room_code, r.room_type, r.capacity,
             count(b.id)::int as beds_actual
      FROM locations r
      LEFT JOIN locations b ON b.parent_location_id = r.id AND b.status = 'active' AND b.location_type = 'bed'
      WHERE r.hospital_id = $1 AND r.location_type = 'room' AND r.status = 'active'
      GROUP BY r.id, r.code, r.room_type, r.capacity
      ORDER BY r.code
    `, [hospitalId]);

    // Any duplicate codes among active locations?
    const dupes = await sql(`
      SELECT code, location_type, count(*)::int as cnt
      FROM locations
      WHERE hospital_id = $1 AND status = 'active'
      GROUP BY code, location_type
      HAVING count(*) > 1
    `, [hospitalId]);

    // Check for any orphaned beds (no parent or inactive parent)
    const orphanBeds = await sql(`
      SELECT l.code, l.bed_status, p.code as parent, p.status as parent_status, p.location_type as parent_type
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.hospital_id = $1 AND l.location_type = 'bed' AND l.status = 'active'
        AND (p.id IS NULL OR p.status <> 'active' OR p.location_type <> 'room')
    `, [hospitalId]);

    return NextResponse.json({
      counts_by_type_status: counts,
      floors,
      wards,
      rooms_per_ward: roomsPerWard,
      beds_per_room: bedsPerRoom,
      room_count: rooms.length,
      bed_count: beds.length,
      duplicate_codes: dupes,
      orphan_beds: orphanBeds,
    });
  } catch (error: any) {
    console.error('Inspect error:', error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
