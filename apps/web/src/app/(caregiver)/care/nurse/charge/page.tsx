import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ChargeNurseClient from './charge-nurse-client';

const CHARGE_ROLES = ['charge_nurse', 'nursing_supervisor', 'hospital_admin', 'admin', 'super_admin'];

export default async function ChargeNursePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (!CHARGE_ROLES.includes(user.role)) {
    return (
      <div style={{ maxWidth: '480px', margin: '80px auto', textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
          Charge Nurse Access Required
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px', lineHeight: '1.5' }}>
          Patient assignments are managed by the Charge Nurse or Nursing Supervisor.
          Your current role ({user.role.replace(/_/g, ' ')}) does not have access to this page.
        </p>
        <Link
          href="/care/nurse"
          style={{
            display: 'inline-block', padding: '10px 24px', borderRadius: '8px',
            background: '#3b82f6', color: '#fff', fontSize: '14px', fontWeight: '600',
            textDecoration: 'none',
          }}
        >
          ← Back to Nurse Home
        </Link>
      </div>
    );
  }

  return <ChargeNurseClient userId={user.sub} userRole={user.role} userName={user.name} />;
}
