import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CaregiverShell from '@/components/caregiver/CaregiverShell';

/**
 * Caregiver Layout — wraps all /care/* routes.
 * Provides: light clinical theme, 48px top bar, shift context,
 * role-based navigation, phone-first responsive design.
 *
 * Completely separate from AdminLayout — no shared imports.
 */
export default async function CaregiverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <CaregiverShell user={{
      name: user.name,
      role: user.role,
      department: user.department || '',
      email: user.email,
    }}>
      {children}
    </CaregiverShell>
  );
}
