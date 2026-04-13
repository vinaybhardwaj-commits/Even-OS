'use client';

import { useState, useEffect } from 'react';

interface Feedback {
  id: string;
  patient_id: string | null;
  encounter_id: string | null;
  feedback_type: string;
  department: string | null;
  clinician_name: string | null;
  rating_score: number | null;
  nps_score: number | null;
  feedback_text: string | null;
  is_anonymous: boolean;
  department_response: string | null;
  responded_by: string | null;
  escalated: boolean;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Summary {
  avg_csat_rating: number;
  avg_nps_score: number;
  total_feedback: number;
  feedback_by_type: Array<{ type: string; count: number }>;
  escalations_pending: number;
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

export default function PatientFeedbackClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterDept, setFilterDept] = useState('');
  const [filterEscalated, setFilterEscalated] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');

  const limit = 20;

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryData, feedbackData] = await Promise.all([
        trpcQuery('getFeedbackSummary'),
        trpcQuery('listFeedback', {
          feedback_type: filterType || undefined,
          department: filterDept || undefined,
          escalated: filterEscalated === 'true' ? true : filterEscalated === 'false' ? false : undefined,
          page,
          limit,
        }),
      ]);

      setSummary(summaryData);
      setFeedback(feedbackData.feedback);
      setTotal(feedbackData.total);
    } catch (error) {
      console.error('Error loading feedback:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterType, filterDept, filterEscalated, page]);

  const handleRespond = async (id: string) => {
    if (!responseText.trim()) return;

    try {
      await trpcMutate('respondToFeedback', {
        id,
        response: responseText,
      });

      setRespondingId(null);
      setResponseText('');
      await loadData();
    } catch (error) {
      console.error('Error responding to feedback:', error);
    }
  };

  if (loading && !summary) {
    return <div className="text-center py-12 text-gray-600">Loading feedback data...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Avg CSAT</p>
          <p className="text-3xl font-bold mt-2">{summary?.avg_csat_rating.toFixed(2) || '—'}</p>
          <p className="text-xs text-gray-500 mt-1">out of 5</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">NPS Score</p>
          <p className="text-3xl font-bold mt-2">{summary?.avg_nps_score.toFixed(1) || '—'}</p>
          <p className="text-xs text-gray-500 mt-1">out of 10</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Total Feedback</p>
          <p className="text-3xl font-bold mt-2">{summary?.total_feedback || 0}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Escalations</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{summary?.escalations_pending || 0}</p>
          <p className="text-xs text-gray-500 mt-1">pending</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Types</option>
            <option value="csat">CSAT</option>
            <option value="nps">NPS</option>
            <option value="department">Department</option>
            <option value="anonymous">Anonymous</option>
          </select>

          <input
            type="text"
            placeholder="Department"
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />

          <select
            value={filterEscalated}
            onChange={(e) => setFilterEscalated(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All</option>
            <option value="true">Escalated</option>
            <option value="false">Not Escalated</option>
          </select>
        </div>
      </div>

      {/* Feedback Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Feedback Entries</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Department</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Rating</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Feedback</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <span className="inline-block px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                      {item.feedback_type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-600">{item.department || '—'}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {item.rating_score ? `${item.rating_score}/5` : item.nps_score ? `${item.nps_score}/10` : '—'}
                  </td>
                  <td className="py-3 px-4 text-gray-600 max-w-xs truncate">
                    {item.feedback_text || '—'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {item.escalated && <span className="text-red-600 font-bold">⚠</span>}
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        item.department_response
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {item.department_response ? 'Responded' : 'Pending'}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {!item.department_response && (
                      <button
                        onClick={() => setRespondingId(item.id)}
                        className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                      >
                        Respond
                      </button>
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

      {/* Response Modal */}
      {respondingId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Respond to Feedback</h3>
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            placeholder="Type your response here..."
            className="w-full h-32 p-3 border border-gray-300 rounded-md font-mono text-sm"
          />
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => {
                setRespondingId(null);
                setResponseText('');
              }}
              className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleRespond(respondingId)}
              disabled={!responseText.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Submit Response
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
