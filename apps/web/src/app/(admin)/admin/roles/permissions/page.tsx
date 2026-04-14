import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import PermissionDesigner from './permission-designer';

export default async function PermissionDesignerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const adminRoles = ['super_admin', 'hospital_admin'];
  if (!adminRoles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-sm border">
          <h2 className="text-xl font-bold text-red-700">Access Denied</h2>
          <p className="text-gray-500 mt-2">Admin permissions required.</p>
        </div>
      </div>
    );
  }

  return <PermissionDesigner />;
}
