'use client';

import { useState, useEffect } from 'react';

interface Payment {
  id: string;
  bill_id: string | null;
  patient_id: string;
  amount: string;
  payment_method: string;
  payment_reference: string | null;
  gateway_reference: string | null;
  gateway_provider: string;
  status: string;
  failure_reason: string | null;
  receipt_url: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

interface Summary {
  total_collected: string;
  by_method: Array<{ method: string; count: number; total: string }>;
  success_rate: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/patientPortal.${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export default function PatientPaymentsClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);

  const limit = 20;

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryData, paymentsData] = await Promise.all([
        trpcQuery('getPaymentSummary'),
        trpcQuery('listPayments', {
          patient_id: '00000000-0000-0000-0000-000000000000',
          page,
          limit,
        }),
      ]);

      setSummary(summaryData);
      setPayments(paymentsData.payments);
      setTotal(paymentsData.total);
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'initiated':
        return 'bg-gray-100 text-gray-800';
      case 'refunded':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatAmount = (amount: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseFloat(amount));
  };

  if (loading && !summary) {
    return <div className="text-center py-12 text-gray-600">Loading payment data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Total Collected</p>
          <p className="text-3xl font-bold mt-2">{formatAmount(summary?.total_collected || '0')}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Success Rate</p>
          <p className="text-3xl font-bold mt-2">{summary?.success_rate || '0'}%</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Payment Methods</p>
          <div className="space-y-1 mt-2">
            {summary?.by_method.slice(0, 2).map((method) => (
              <div key={method.method} className="text-sm">
                <span className="font-medium capitalize">{method.method}:</span>
                <span className="text-gray-600 ml-2">{method.count} payments</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Payment Transactions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Patient ID</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Amount</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Method</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Gateway Ref</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono text-xs text-gray-600">
                    {payment.patient_id.substring(0, 8)}...
                  </td>
                  <td className="py-3 px-4 font-semibold">
                    {formatAmount(payment.amount)}
                  </td>
                  <td className="py-3 px-4 text-gray-600 capitalize">
                    {payment.payment_method}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(payment.status)}`}>
                      {payment.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-600">
                    {payment.gateway_reference ? payment.gateway_reference.substring(0, 12) : '—'}
                  </td>
                  <td className="py-3 px-4 text-gray-600">
                    {new Date(payment.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => {
                        setDetailId(payment.id);
                        setDetailPayment(payment);
                      }}
                      className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex justify-between items-center mt-6">
          <p className="text-sm text-gray-600">
            Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              disabled={page * limit >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {detailId && detailPayment && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Payment Details</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Amount</p>
                <p className="text-lg font-semibold mt-1">{formatAmount(detailPayment.amount)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Status</p>
                <p className="mt-2">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(detailPayment.status)}`}>
                    {detailPayment.status}
                  </span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Payment Method</p>
                <p className="font-medium mt-1 capitalize">{detailPayment.payment_method}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Provider</p>
                <p className="font-medium mt-1">{detailPayment.gateway_provider}</p>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-600">Gateway Reference</p>
              <p className="font-mono text-sm break-all mt-1">{detailPayment.gateway_reference || '—'}</p>
            </div>

            <div>
              <p className="text-sm text-gray-600">Payment Reference</p>
              <p className="font-mono text-sm break-all mt-1">{detailPayment.payment_reference || '—'}</p>
            </div>

            {detailPayment.failure_reason && (
              <div className="p-3 bg-red-50 rounded-md border border-red-200">
                <p className="text-sm text-gray-600">Failure Reason</p>
                <p className="text-sm text-red-700 mt-1">{detailPayment.failure_reason}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
              <div>
                <p>Created</p>
                <p>{new Date(detailPayment.created_at).toLocaleString('en-IN')}</p>
              </div>
              {detailPayment.completed_at && (
                <div>
                  <p>Completed</p>
                  <p>{new Date(detailPayment.completed_at).toLocaleString('en-IN')}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setDetailId(null)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
