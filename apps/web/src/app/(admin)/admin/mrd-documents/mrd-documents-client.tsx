'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Document = {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  document_type: string;
  status: string;
  scanned_at: string | null;
  ocr_confidence: string | null;
  created_at: string;
  blob_url: string | null;
  ocr_text: string | null;
  uploaded_by: string | null;
};

type Stats = {
  countByType: Array<{ type: string; count: number }>;
  ocrProcessed: number;
  ocrTotal: number;
};

type ClassificationItem = {
  id: string;
  document_reference_id: string;
  patient_id: string;
  detected_class: string;
  detected_class_confidence: string | null;
  status: string;
  created_at: string;
};

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

async function trpcMutate(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data;
}

export function MrdDocumentsClient() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [stats, setStats] = useState<Stats>({ countByType: [], ocrProcessed: 0, ocrTotal: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [patientIdFilter, setPatientIdFilter] = useState('');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('current');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [tab, setTab] = useState<'documents' | 'classification'>('documents');
  const [classificationQueue, setClassificationQueue] = useState<ClassificationItem[]>([]);
  const searchTimeout = useRef<NodeJS.Timeout>();

  const pageSize = 25;

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const input: any = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        status: statusFilter,
      };
      if (patientIdFilter) input.patient_id = patientIdFilter;
      if (documentTypeFilter) input.document_type = documentTypeFilter;

      const [docData, statsData] = await Promise.all([
        trpcQuery('mrdDocuments.listDocuments', input),
        trpcQuery('mrdDocuments.getDocumentStats', {}),
      ]);

      setDocuments(docData.items);
      setTotal(docData.total);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, patientIdFilter, documentTypeFilter]);

  const fetchClassificationQueue = useCallback(async () => {
    try {
      const data = await trpcQuery('mrdDocuments.listClassificationQueue', { status: 'pending', limit: 100 });
      setClassificationQueue(data.items);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (tab === 'classification') {
      fetchClassificationQueue();
    }
  }, [tab, fetchClassificationQueue]);

  const handlePatientFilterChange = (val: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPatientIdFilter(val);
      setPage(1);
    }, 300);
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    setError('');
    setSuccess('');
    try {
      await trpcMutate('mrdDocuments.deleteDocument', {
        id: docId,
        deletion_reason: 'User initiated deletion',
      });
      setSuccess('Document deleted');
      fetchDocuments();
      setShowDetailModal(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApproveClassification = async (classId: string, approvedClass: string, approvedUhid: string) => {
    setError('');
    setSuccess('');
    try {
      await trpcMutate('mrdDocuments.approveClassification', {
        id: classId,
        approved_class: approvedClass,
        approved_uhid: approvedUhid,
      });
      setSuccess('Classification approved');
      fetchClassificationQueue();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRejectClassification = async (classId: string) => {
    const notes = prompt('Reason for rejection:');
    if (!notes) return;
    setError('');
    setSuccess('');
    try {
      await trpcMutate('mrdDocuments.rejectClassification', {
        id: classId,
        reviewer_notes: notes,
      });
      setSuccess('Classification rejected');
      fetchClassificationQueue();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      {/* TABS */}
      <div className="flex gap-4 border-b">
        <button
          onClick={() => setTab('documents')}
          className={`px-4 py-2 font-medium ${tab === 'documents' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
        >
          Documents
        </button>
        <button
          onClick={() => setTab('classification')}
          className={`px-4 py-2 font-medium ${tab === 'classification' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
        >
          Classification Queue
        </button>
      </div>

      {/* ALERTS */}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 rounded p-3 text-green-700 text-sm">{success}</div>}

      {/* DOCUMENTS TAB */}
      {tab === 'documents' && (
        <div className="space-y-6">
          {/* STATS */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm text-gray-600">Total Documents</div>
              <div className="text-2xl font-bold">{total}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm text-gray-600">Pending Classification</div>
              <div className="text-2xl font-bold">{classificationQueue.filter(x => x.status === 'pending').length}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm text-gray-600">OCR Processed</div>
              <div className="text-2xl font-bold">{stats.ocrProcessed} / {stats.ocrTotal}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-sm text-gray-600">Top Type</div>
              <div className="text-lg font-bold">{stats.countByType.length > 0 ? stats.countByType[0].type : 'N/A'}</div>
            </div>
          </div>

          {/* FILTERS */}
          <div className="grid grid-cols-4 gap-4">
            <input
              type="text"
              placeholder="Patient UHID"
              value={patientIdFilter}
              onChange={(e) => handlePatientFilterChange(e.target.value)}
              className="px-3 py-2 border rounded text-sm"
            />
            <select
              value={documentTypeFilter}
              onChange={(e) => {
                setDocumentTypeFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border rounded text-sm"
            >
              <option value="">All Types</option>
              {stats.countByType.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.type} ({t.count})
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border rounded text-sm"
            >
              <option value="all">All Status</option>
              <option value="current">Current</option>
              <option value="superseded">Superseded</option>
              <option value="deleted">Deleted</option>
            </select>
            <div className="text-sm text-gray-600 py-2">
              {total > 0 ? `Showing ${((page - 1) * pageSize) + 1} - ${Math.min(page * pageSize, total)} of ${total}` : 'No documents'}
            </div>
          </div>

          {/* TABLE */}
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No documents found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Patient ID</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Scanned</th>
                    <th className="px-4 py-2 text-left">OCR Conf</th>
                    <th className="px-4 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{doc.document_type}</td>
                      <td className="px-4 py-2 text-gray-600">{doc.patient_id.slice(0, 8)}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-1 rounded ${doc.status === 'current' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {doc.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{doc.scanned_at ? new Date(doc.scanned_at).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-2 text-xs">{doc.ocr_confidence ? `${Math.round(parseFloat(doc.ocr_confidence) * 100)}%` : '-'}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => {
                            setSelectedDoc(doc);
                            setShowDetailModal(true);
                          }}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* PAGINATION */}
          {total > pageSize && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Prev
              </button>
              <span className="px-3 py-1">Page {page} of {Math.ceil(total / pageSize)}</span>
              <button
                onClick={() => setPage(Math.min(Math.ceil(total / pageSize), page + 1))}
                disabled={page >= Math.ceil(total / pageSize)}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* CLASSIFICATION TAB */}
      {tab === 'classification' && (
        <div className="space-y-4">
          {classificationQueue.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No pending classifications</div>
          ) : (
            <div className="space-y-3">
              {classificationQueue.map((item) => (
                <div key={item.id} className="border rounded p-4 space-y-3 bg-yellow-50">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">Doc ID: {item.document_reference_id.slice(0, 8)}</div>
                      <div className="text-sm text-gray-600">Detected: {item.detected_class} ({item.detected_class_confidence ? `${Math.round(parseFloat(item.detected_class_confidence) * 100)}%` : '?'})</div>
                      <div className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">{item.status}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveClassification(item.id, item.detected_class || '', '')}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectClassification(item.id)}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DETAIL MODAL */}
      {showDetailModal && selectedDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-start">
              <h3 className="font-bold text-lg">{selectedDoc.document_type}</h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                X
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-600">ID</div>
                <div className="font-mono text-xs">{selectedDoc.id}</div>
              </div>
              <div>
                <div className="text-gray-600">Patient ID</div>
                <div className="font-mono text-xs">{selectedDoc.patient_id}</div>
              </div>
              <div>
                <div className="text-gray-600">Status</div>
                <div>{selectedDoc.status}</div>
              </div>
              <div>
                <div className="text-gray-600">OCR Confidence</div>
                <div>{selectedDoc.ocr_confidence ? `${Math.round(parseFloat(selectedDoc.ocr_confidence) * 100)}%` : 'Not processed'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-gray-600 text-sm font-medium mb-2">Created</div>
                <div>{new Date(selectedDoc.created_at).toLocaleString()}</div>
              </div>
            </div>

            {selectedDoc.ocr_text && (
              <div>
                <div className="text-gray-600 text-sm font-medium mb-2">OCR Text</div>
                <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {selectedDoc.ocr_text.slice(0, 500)}
                  {selectedDoc.ocr_text.length > 500 && '...'}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              {selectedDoc.status === 'current' && (
                <button
                  onClick={() => handleDeleteDocument(selectedDoc.id)}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Delete
                </button>
              )}
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
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
