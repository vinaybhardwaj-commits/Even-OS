'use client';

import { useState, useEffect } from 'react';

interface PreAdmissionForm {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  form_type: string;
  form_data: Record<string, any>;
  form_version: number;
  signed_by: string | null;
  signed_at: string | null;
  consent_acknowledged: boolean;
  status: string;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MedicationRefillRequest {
  id: string;
  patient_id: string;
  medication_name: string;
  medication_dose: string | null;
  medication_frequency: string | null;
  prescription_id: string | null;
  status: string;
  pharmacy_feedback: string | null;
  pickup_location: string | null;
  pickup_ready_at: string | null;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/patientPortal.${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/patientPortal.${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export default function PatientServicesClient() {
  const [activeTab, setActiveTab] = useState<'forms' | 'refills'>('forms');
  const [forms, setForms] = useState<PreAdmissionForm[]>([]);
  const [refills, setRefills] = useState<MedicationRefillRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [refillStatus, setRefillStatus] = useState<string | null>(null);
  const [refillPage, setRefillPage] = useState(1);
  const [refillTotal, setRefillTotal] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewLocation, setReviewLocation] = useState('');

  const limit = 20;

  const loadForms = async () => {
    setLoading(true);
    try {
      const formsData = await trpcQuery('listForms', {
        patient_id: '00000000-0000-0000-0000-000000000000',
        status: formStatus || undefined,
      });
      setForms(formsData || []);
    } catch (error) {
      console.error('Error loading forms:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRefills = async () => {
    setLoading(true);
    try {
      const refillsData = await trpcQuery('listRefillRequests', {
        status: refillStatus || undefined,
        page: refillPage,
        limit,
      });
      setRefills(refillsData.refills || []);
      setRefillTotal(refillsData.total || 0);
    } catch (error) {
      console.error('Error loading refills:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'forms') {
      loadForms();
    } else {
      loadRefills();
    }
  }, [activeTab, formStatus, refillStatus, refillPage]);

  const handleVerifyForm = async (id: string) => {
    try {
      await trpcMutate('verifyForm', { id });
      loadForms();
    } catch (error) {
      console.error('Error verifying form:', error);
    }
  };

  const handleReviewRefill = async (status: 'approved' | 'denied') => {
    if (!reviewId) return;
    try {
      await trpcMutate('reviewRefill', {
        id: reviewId,
        status,
        pharmacy_feedback: reviewFeedback || undefined,
        pickup_location: reviewLocation || undefined,
      });
      setReviewId(null);
      setReviewFeedback('');
      setReviewLocation('');
      loadRefills();
    } catch (error) {
      console.error('Error reviewing refill:', error);
    }
  };

  const getFormStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'submitted':
        return 'bg-yellow-100 text-yellow-800';
      case 'verified':
        return 'bg-green-100 text-green-800';
      case 'expired':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getRefillStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'requested':
        return 'bg-gray-100 text-gray-800';
      case 'pharmacy_review':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'denied':
        return 'bg-red-100 text-red-800';
      case 'picked_up':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading && forms.length === 0 && refills.length === 0) {
    return <div className="text-center py-12 text-gray-600">Loading patient services...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('forms')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'forms'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Pre-Admission Forms
          </button>
          <button
            onClick={() => setActiveTab('refills')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'refills'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Medication Refills
          </button>
        </div>
      </div>

      {/* Forms Tab */}
      {activeTab === 'forms' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Pre-Admission Forms</h3>

          {/* Status Filter */}
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-700 block mb-2">Filter by Status</label>
            <select
              value={formStatus || ''}
              onChange={(e) => setFormStatus(e.target.value || null)}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="verified">Verified</option>
              <option value="expired">Expired</option>
            </select>
          </div>

          {/* Forms Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Patient ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Form Type</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Signed</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Created</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((form) => (
                  <tr key={form.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">
                      {form.patient_id.substring(0, 8)}...
                    </td>
                    <td className="py-3 px-4 capitalize">{form.form_type.replace(/_/g, ' ')}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${getFormStatusBadgeClass(
                          form.status
                        )}`}
                      >
                        {form.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {form.signed_by
                        ? new Date(form.signed_at || '').toLocaleDateString('en-IN')
                        : 'Not signed'}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(form.created_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-3 px-4">
                      {form.status === 'submitted' && (
                        <button
                          onClick={() => handleVerifyForm(form.id)}
                          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                        >
                          Verify
                        </button>
                      )}
                      {form.status !== 'submitted' && (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {forms.length === 0 && (
            <div className="text-center py-6 text-gray-500">No forms found</div>
          )}
        </div>
      )}

      {/* Refills Tab */}
      {activeTab === 'refills' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Medication Refills</h3>

          {/* Status Filter */}
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-700 block mb-2">Filter by Status</label>
            <select
              value={refillStatus || ''}
              onChange={(e) => {
                setRefillStatus(e.target.value || null);
                setRefillPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded text-sm"
            >
              <option value="">All Status</option>
              <option value="requested">Requested</option>
              <option value="pharmacy_review">In Review</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="picked_up">Picked Up</option>
            </select>
          </div>

          {/* Refills Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Patient ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Medication</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Dose</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Requested</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {refills.map((refill) => (
                  <tr key={refill.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">
                      {refill.patient_id.substring(0, 8)}...
                    </td>
                    <td className="py-3 px-4 font-medium">{refill.medication_name}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {refill.medication_dose || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${getRefillStatusBadgeClass(
                          refill.status
                        )}`}
                      >
                        {refill.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(refill.requested_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-3 px-4">
                      {refill.status === 'pharmacy_review' && (
                        <button
                          onClick={() => {
                            setReviewId(refill.id);
                            setReviewFeedback(refill.pharmacy_feedback || '');
                            setReviewLocation(refill.pickup_location || '');
                          }}
                          className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                        >
                          Review
                        </button>
                      )}
                      {refill.status !== 'pharmacy_review' && (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-6">
            <p className="text-sm text-gray-600">
              Showing {(refillPage - 1) * limit + 1} to {Math.min(refillPage * limit, refillTotal)}{' '}
              of {refillTotal}
            </p>
            <div className="flex gap-2">
              <button
                disabled={refillPage === 1}
                onClick={() => setRefillPage((p) => p - 1)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                disabled={refillPage * limit >= refillTotal}
                onClick={() => setRefillPage((p) => p + 1)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>

          {refills.length === 0 && (
            <div className="text-center py-6 text-gray-500">No refill requests found</div>
          )}
        </div>
      )}

      {/* Review Refill Modal */}
      {reviewId && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Review Medication Refill</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Pharmacy Feedback
              </label>
              <textarea
                value={reviewFeedback}
                onChange={(e) => setReviewFeedback(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                rows={4}
                placeholder="Enter feedback for the patient..."
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Pickup Location
              </label>
              <input
                type="text"
                value={reviewLocation}
                onChange={(e) => setReviewLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                placeholder="Enter pickup location..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReviewId(null);
                  setReviewFeedback('');
                  setReviewLocation('');
                }}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReviewRefill('denied')}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              >
                Deny
              </button>
              <button
                onClick={() => handleReviewRefill('approved')}
                className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
