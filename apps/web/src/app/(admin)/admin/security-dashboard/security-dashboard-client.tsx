'use client';

import { useState, useEffect } from 'react';

interface SecurityFinding {
  id: string;
  finding_id: string;
  category: string;
  severity: string;
  title: string;
  remediation_status: string;
}

interface RateLimitEvent {
  ip_address: string;
  endpoint: string;
  action_taken: string;
  blocked_at: string;
}

interface PiiAccessLog {
  id: string;
  user_id: string;
  access_type: string;
  created_at: string;
}

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error?.json?.message || json.error?.message || 'Request failed');
  return json.result?.data?.json;
}

export default function SecurityDashboardClient() {
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [rateLimitSummary, setRateLimitSummary] = useState<any>(null);
  const [piiLogs, setPiiLogs] = useState<PiiAccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [findingsData, rateLimitData, piiData] = await Promise.all([
        trpcQuery('hardening.listSecurityFindings', { limit: 50 }),
        trpcQuery('hardening.getRateLimitSummary', { hours_back: 24 }),
        trpcQuery('hardening.listPiiAccessLog', { days_back: 1, limit: 50 }),
      ]);
      setFindings(findingsData.findings || []);
      setRateLimitSummary(rateLimitData);
      setPiiLogs(piiData.logs || []);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await trpcMutate('hardening.updateFindingStatus', { id, status });
      loadData();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  }

  const severityColor: Record<string, string> = {
    critical: 'color: #7f1d1d; background: #fee2e2;',
    high: 'color: #7c2d12; background: #fed7aa;',
    medium: 'color: #713f12; background: #fef08a;',
    low: 'color: #0c4a6e; background: #bfdbfe;',
    info: 'color: #374151; background: #f3f4f6;',
  };

  const statusColor: Record<string, string> = {
    open: 'color: #7f1d1d; background: #fee2e2;',
    in_progress: 'color: #713f12; background: #fef08a;',
    resolved: 'color: #166534; background: #dcfce7;',
    accepted_risk: 'color: #0c4a6e; background: #bfdbfe;',
    false_positive: 'color: #374151; background: #f3f4f6;',
  };

  const openCount = findings.filter(f => f.remediation_status === 'open').length;
  const blockCount = rateLimitSummary?.top_ips?.length || 0;
  const piiAccessCount = piiLogs.length;

  if (loading) return <div className="p-4">Loading...</div>;

  const parseStyleString = (styleStr: string) => {
    const style: Record<string, string> = {};
    styleStr.split(';').forEach(rule => {
      const [prop, value] = rule.split(':').map(s => s.trim());
      if (prop && value) {
        style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
    });
    return style;
  };

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>Open Findings</h3>
          <div style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>{openCount}</div>
          <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Critical & High severity</p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>Rate Limit Blocks (24h)</h3>
          <div style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>{blockCount}</div>
          <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Unique IP addresses blocked</p>
        </div>

        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>PII Access (24h)</h3>
          <div style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>{piiAccessCount}</div>
          <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Unmasking events logged</p>
        </div>
      </div>

      {/* Security Findings Table */}
      <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>Security Findings</h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>Audit findings from security assessments</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Finding ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Title</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Severity</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {findings.slice(0, 10).map(finding => (
                <tr key={finding.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{finding.finding_id}</td>
                  <td style={{ padding: '0.5rem' }}>{finding.title}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', ...parseStyleString(severityColor[finding.severity] || '') }}>
                      {finding.severity}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', ...parseStyleString(statusColor[finding.remediation_status] || '') }}>
                      {finding.remediation_status}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <select
                      value={finding.remediation_status}
                      onChange={(e) => updateStatus(finding.id, e.target.value)}
                      style={{ fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', padding: '0.25rem 0.5rem' }}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="accepted_risk">Accepted Risk</option>
                      <option value="false_positive">False Positive</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rate Limit Events */}
      {rateLimitSummary && (
        <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>Rate Limit Events (24h)</h3>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>Top blocked IP addresses and endpoints</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            <div>
              <h4 style={{ fontWeight: '600', fontSize: '0.875rem', marginBottom: '0.75rem' }}>Top IPs</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rateLimitSummary.top_ips?.slice(0, 5).map((ip: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', padding: '0.5rem', background: '#f9fafb', borderRadius: '0.25rem' }}>
                    <span style={{ fontFamily: 'monospace' }}>{ip.ip_address}</span>
                    <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{ip.count} hits</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 style={{ fontWeight: '600', fontSize: '0.875rem', marginBottom: '0.75rem' }}>Top Endpoints</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rateLimitSummary.top_endpoints?.slice(0, 5).map((ep: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', padding: '0.5rem', background: '#f9fafb', borderRadius: '0.25rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.endpoint}</span>
                    <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{ep.count} hits</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PII Access Log */}
      <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', background: '#fff' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.25rem' }}>PII Access Audit (24h)</h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>All unmasking and sensitive data access events</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Timestamp</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>User</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Access Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: '600' }}>Resource</th>
              </tr>
            </thead>
            <tbody>
              {piiLogs.slice(0, 10).map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{log.user_id.slice(0, 8)}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', fontSize: '0.75rem' }}>{log.access_type}</span>
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>Sensitive Data Access</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
