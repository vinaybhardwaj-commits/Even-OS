import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import PatientPaymentsClient from './patient-payments-client';

export const metadata = {
  title: 'Patient Payments - Even OS',
  description: 'Monitor and manage patient payment transactions',
};

export default async function PatientPaymentsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  if (user.role !== 'super_admin' && user.role !== 'hospital_admin') {
    redirect('/dashboard');
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-blue-900 text-white p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Patient Payment Monitor</h1>
            <p className="text-blue-200">Track and manage patient payments</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-blue-200">Logged in as</p>
            <p className="font-medium">{user.name || 'User'}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        <PatientPaymentsClient />
      </div>
    </div>
  );
}
