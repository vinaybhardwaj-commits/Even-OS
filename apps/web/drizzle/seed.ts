import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { hospitals, users } from './schema';
import bcrypt from 'bcryptjs';

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema: { hospitals, users } });

  console.log('🌱 Seeding Even OS database...\n');

  // 1. Create hospital EHRC (Race Course Road)
  const [ehrcHospital] = await db
    .insert(hospitals)
    .values({
      name: 'Even Hospital Race Course Road',
      hospital_id: 'EHRC',
      city: 'Bangalore',
      state: 'Karnataka',
      country: 'India',
      nabh_certified: true,
      abha_enabled: false,
    })
    .returning();

  console.log(`✅ Hospital created: ${ehrcHospital.name} (${ehrcHospital.hospital_id})`);

  // 2. Create super admin for EHRC
  const passwordHash = await bcrypt.hash('EvenOS2026!', 12);

  const [admin] = await db
    .insert(users)
    .values({
      hospital_id: 'EHRC',
      email: 'admin@even.in',
      password_hash: passwordHash,
      full_name: 'System Administrator',
      roles: ['super_admin'],
      department: 'IT',
      status: 'active',
      must_change_password: true,
    })
    .returning();

  console.log(`✅ Super admin created: ${admin.email}`);
  console.log(`   Password: EvenOS2026! (must change on first login)\n`);

  // 3. Create Indiranagar hospital (greenfield)
  const [indiHospital] = await db
    .insert(hospitals)
    .values({
      name: 'Even Hospital Indiranagar',
      hospital_id: 'INDI',
      city: 'Bangalore',
      state: 'Karnataka',
      country: 'India',
      nabh_certified: false,
      abha_enabled: false,
    })
    .returning();

  console.log(`✅ Hospital created: ${indiHospital.name} (${indiHospital.hospital_id})`);

  // 4. Create hospital admin for Indiranagar
  const [indiAdmin] = await db
    .insert(users)
    .values({
      hospital_id: 'INDI',
      email: 'admin@indiranagar.even.in',
      password_hash: passwordHash,
      full_name: 'Indiranagar Hospital Administrator',
      roles: ['hospital_admin'],
      department: 'Administration',
      status: 'active',
      must_change_password: true,
    })
    .returning();

  console.log(`✅ Hospital admin created: ${indiAdmin.email}`);

  console.log('\n🎉 Seed complete!');
  console.log('   Login at http://localhost:3000/login');
  console.log('   Email: admin@even.in (EHRC)');
  console.log('   Password: EvenOS2026!\n');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
