'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

const statusStyle: Record<string, string> = {
  stored: 'bg-green-50 text-green-700',
  parsed: 'bg-blue-50 text-blue-700',
  validated: 'bg-blue-50 text-blue-700',
  received: 'bg-gray-50 text-gray-600',
  error: 'bg-red-50 text-red-700',
  duplicate_skipped: 'bg-amber-50 text-amber-700',
};

export function Hl7MessagesClient() {
  const [messages, setMessages] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [filters, setFilters] = useState({ message_type: '', direction: '', status: '' });
  const [page, setPage] = useState(0);
  const limit = 50;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const input: any = { limit, offset: page * limit };
      if (filters.message_type) input.message_type = filters.message_type;
      if (filters.direction) input.direction = filters.direction;
      if (filters.status) input.status = filters.status;
      const data = await trpcQuery('integrations.listHl7Messages', input);
      setMessages(data?.messages || []);
      setTotal(data?.total || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadDetail = async (id: string) => {
    try {
      const detail = await trpcQuery('integrations.getHl7Message', { id });
      setSelected(detail);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Link href="/admin" className="hover:text-gray-700">Admin</Link>
              <span>/</span>
              <Link href="/admin/integrations" className="hover:text-gray-700">Integrations</Link>
              <span>/</span>
              <span className="text-gray-900">HL7 Messages</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">HL7 Message Viewer</h1>
            <p className="text-sm text-gray-500">Inspect raw and parsed HL7 messages, debug errors, track duplicates</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
            {error}
            <button onClick={() => setError('')} className="ml-2 hover:underline">dismiss</button>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white border rounded-2xl p-4 mb-6">
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={filters.message_type} onChange={e => { setFilters(f => ({ ...f, message_type: e.target.value })); setPage(0); }}
                className="border rounded-lg px-3 py-2 text-sm">
                <option value="">All</option>
                <option value="ORM">ORM</option>
                <option value="ORU">ORU</option>
                <option value="ADT">ADT</option>
                <option value="SIU">SIU</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Direction</label>
              <select value={filters.direction} onChange={e => { setFilters(f => ({ ...f, direction: e.target.value })); setPage(0); }}
                className="border rounded-lg px-3 py-2 text-sm">
                <option value="">All</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(0); }}
                className="border rounded-lg px-3 py-2 text-sm">
                <option value="">All</option>
                <option value="received">Received</option>
                <option value="parsed">Parsed</option>
                <option value="stored">Stored</option>
                <option value="error">Error</option>
                <option value="duplicate_skipped">Duplicate</option>
              </select>
            </div>
            <button onClick={() => { setFilters({ message_type: '', direction: '', status: '' }); setPage(0); }}
              className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">Clear</button>
          </div>
        </div>

        {/* Messages Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No HL7 messages found.</div>
            <p className="text-sm text-gray-400">Messages will appear here once the HL7 framework processes inbound/outbound messages.</p>
          </div>
        ) : (
          <>
            <div className="bg-white border rounded-2xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Control ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Dir</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Patient</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {messages.map((msg: any) => (
                    <tr key={msg.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadDetail(msg.id)}>
                      <td className="px-4 py-3 font-mono text-xs">{msg.message_control_id}</td>
                      <td className="px-4 py-3 font-medium">{msg.message_type}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${msg.direction === 'inbound' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                          {msg.direction === 'inbound' ? '↓ In' : '↑ Out'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle[msg.status] || 'bg-gray-50 text-gray-600'}`}>
                          {msg.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{msg.patient_uhid || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{msg.source_system}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{new Date(msg.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50">Prev</button>
                <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}
                  className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50">Next</button>
              </div>
            </div>
          </>
        )}

        {/* Detail Panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
            <div className="bg-white rounded-2xl w-[720px] max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Message: {selected.message_control_id}</h3>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
                <div><span className="text-gray-500">Type:</span> <span className="font-medium">{selected.message_type}</span></div>
                <div><span className="text-gray-500">Direction:</span> <span className="font-medium">{selected.direction}</span></div>
                <div><span className="text-gray-500">Status:</span> <span className="font-medium">{selected.status}</span></div>
                <div><span className="text-gray-500">Source:</span> <span className="font-medium">{selected.source_system}</span></div>
                <div><span className="text-gray-500">Patient:</span> <span className="font-medium">{selected.patient_uhid || '—'}</span></div>
                <div><span className="text-gray-500">Duplicate:</span> <span className="font-medium">{selected.is_duplicate ? 'Yes' : 'No'}</span></div>
              </div>
              {selected.processing_error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 mb-4">
                  <span className="font-medium">Error:</span> {selected.processing_error}
                </div>
              )}
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Parsed Segments</h4>
                <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-x-auto max-h-48">
                  {JSON.stringify(selected.parsed_segments, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-500 mb-2">Raw Message</h4>
                <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs overflow-x-auto max-h-48 font-mono">
                  {selected.raw_message}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
