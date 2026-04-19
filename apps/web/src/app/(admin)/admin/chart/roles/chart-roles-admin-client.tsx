'use client';

/**
 * PC.3.3.C — Chart Roles Admin
 *
 * Super-admin editor for chart_permission_matrix. Left list shows every
 * (role, hospital_id) row, right pane shows the editor for the selected
 * row, bottom pane shows recent audit activity for the selected role.
 *
 * Tabs editor: checklist of the 14 known chart tab ids.
 * overview_layout + action_bar_preset: one-string-per-line textareas —
 *   simpler than per-row controls and matches the JSON-style editors we
 *   already ship in /admin/calculators.
 * sensitive_fields / allowed_write_actions: comma-separated input.
 *
 * Preview-as-role is explicitly deferred to PC.3.4 — it requires
 * threading a role override through server-side auth resolution, which
 * is out of scope for a CRUD editor.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types (mirror chartMatrix router) ─────────────────────────
type MatrixRow = {
  id: string;
  role: string;
  role_tag: string | null;
  hospital_id: string;
  tabs: string[];
  overview_layout: string[] | unknown;
  action_bar_preset: { primary?: string[]; secondary?: string[] } | unknown;
  sensitive_fields: string[];
  allowed_write_actions: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
};

type ViewRow = {
  id: string; patient_id: string; field_name: string; tab_id: string | null;
  user_id: string | null; user_role: string; access_reason: string | null; created_at: string;
};
type EditRow = {
  id: string; patient_id: string; action: string; resource_type: string; resource_id: string | null;
  user_id: string | null; user_role: string; payload_summary: unknown; created_at: string;
};
type AdminEditRow = {
  id: string; action: string; resource_type: string; resource_id: string | null;
  user_id: string | null; user_role: string;
  payload_summary: { role?: string; changed_keys?: string[] } & Record<string, unknown>;
  created_at: string;
};

// ─── tRPC fetch helpers (match /admin/calculators pattern) ─────
async function trpcQuery(path: string, input?: unknown) {
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
async function trpcMutate(path: string, input?: unknown) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

// ─── Helpers ───────────────────────────────────────────────────
function toLines(arr: unknown): string {
  if (Array.isArray(arr)) return (arr as string[]).join('\n');
  return '';
}
function fromLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
}
function toCsv(arr: unknown): string {
  if (Array.isArray(arr)) return (arr as string[]).join(', ');
  return '';
}
function fromCsv(s: string): string[] {
  return s.split(/[,\s]+/).map((x) => x.trim()).filter((x) => x.length > 0);
}
function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
}

// ─── PC.3.4.E types ───────────────────────────────────────────
type VersionRow = {
  id: string;
  matrix_id: string;
  hospital_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  changed_keys: string[];
  change_note: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_role: string | null;
  created_at: string;
};

// ─── Component ─────────────────────────────────────────────────
export function ChartRolesAdminClient() {
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [knownTabIds, setKnownTabIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Editor local state (buffered until Save is pressed)
  const [tabs, setTabs] = useState<string[]>([]);
  const [overviewText, setOverviewText] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [secondaryText, setSecondaryText] = useState('');
  const [sensitiveText, setSensitiveText] = useState('');
  const [writeActionsText, setWriteActionsText] = useState('');
  const [description, setDescription] = useState('');

  // Activity panel
  const [activity, setActivity] = useState<{ views: ViewRow[]; edits: EditRow[]; adminEdits: AdminEditRow[] } | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // PC.3.4 Track E — versions panel + diff viewer
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | 'current' | null>(null);
  const [diffPayload, setDiffPayload] = useState<{ a: any; b: any } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [changeNote, setChangeNote] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await trpcQuery('chartMatrix.list')) as {
        rows: MatrixRow[];
        knownTabIds: string[];
      };
      setRows(res.rows);
      setKnownTabIds(res.knownTabIds);
      if (res.rows[0] && !selectedId) setSelectedId(res.rows[0].id);
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // Sync editor state when selected row changes
  useEffect(() => {
    if (!selected) return;
    setTabs(selected.tabs ?? []);
    setOverviewText(toLines(selected.overview_layout));
    const ab = (selected.action_bar_preset as { primary?: string[]; secondary?: string[] }) || {};
    setPrimaryText(toLines(ab.primary ?? []));
    setSecondaryText(toLines(ab.secondary ?? []));
    setSensitiveText(toCsv(selected.sensitive_fields ?? []));
    setWriteActionsText(toLines(selected.allowed_write_actions ?? []));
    setDescription(selected.description ?? '');
    setSaveMsg(null);
  }, [selected]);

  // Fetch activity when role changes
  useEffect(() => {
    if (!selected) { setActivity(null); setVersions(null); return; }
    let cancelled = false;
    setActivityLoading(true);
    trpcQuery('chartMatrix.recentActivity', { role: selected.role, matrixId: selected.id, limit: 25 })
      .then((res) => { if (!cancelled) setActivity(res as { views: ViewRow[]; edits: EditRow[]; adminEdits: AdminEditRow[] }); })
      .catch(() => { if (!cancelled) setActivity({ views: [], edits: [], adminEdits: [] }); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });

    // PC.3.4.E — fetch version timeline for this matrix row
    setVersionsLoading(true);
    trpcQuery('chartMatrix.listVersions', { matrixId: selected.id, limit: 50 })
      .then((res) => { if (!cancelled) setVersions(((res as any)?.versions ?? []) as VersionRow[]); })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.role.toLowerCase().includes(q) ||
        r.hospital_id.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const toggleTab = (tab: string) => {
    setTabs((prev) => (prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]));
  };

  const onPreviewAsRole = async () => {
    if (!selected) return;
    setPreviewing(true);
    setPreviewMsg(null);
    try {
      await trpcMutate('previewRole.set', {
        role: selected.role,
        role_tag: selected.role_tag ?? null,
        hospital_id: selected.hospital_id,
      });
      setPreviewMsg('Preview active — reloading…');
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 500);
    } catch (e: any) {
      setPreviewMsg(e?.message ?? 'Preview failed.');
      setPreviewing(false);
    }
  };

  const onSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const body = {
        id: selected.id,
        tabs,
        overview_layout: fromLines(overviewText),
        action_bar_preset: {
          primary: fromLines(primaryText),
          secondary: fromLines(secondaryText),
        },
        sensitive_fields: fromCsv(sensitiveText),
        allowed_write_actions: fromLines(writeActionsText),
        description: description.trim() === '' ? null : description,
        change_note: changeNote.trim() === '' ? null : changeNote.trim(),
      };
      await trpcMutate('chartMatrix.update', body);
      await fetchList();
      setChangeNote('');
      // Re-fetch version timeline (Track E)
      try {
        const vres = await trpcQuery('chartMatrix.listVersions', { matrixId: selected.id, limit: 50 });
        setVersions(((vres as any)?.versions ?? []) as VersionRow[]);
      } catch {
        /* non-fatal */
      }
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // PC.3.4.E — openDiff drawer
  const openDiff = async (a: number, b: number | 'current') => {
    if (!selected) return;
    setDiffA(a);
    setDiffB(b);
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffPayload(null);
    try {
      const res = await trpcQuery('chartMatrix.getVersionDiff', {
        matrixId: selected.id,
        versionA: a,
        versionB: b,
      });
      setDiffPayload(res as { a: any; b: any });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('version diff failed', e);
      setDiffPayload(null);
    } finally {
      setDiffLoading(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - 80px)', background: '#fafbfc' }}>
      {/* ─── LEFT LIST ─── */}
      <div style={{ width: 340, borderRight: '1px solid #e4e7eb', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4e7eb' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#002054', marginBottom: 4 }}>
            Chart role matrix
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4 }}>
            Per-(role × hospital) patient chart config. Seeded by{' '}
            <code style={{ fontSize: 10 }}>/api/migrations/chart-role-model</code>.
          </div>
          <input
            type="text"
            placeholder="Filter role / hospital / description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginTop: 10, width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Loading…</div>}
          {!loading && filteredRows.length === 0 && (
            <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>No rows matched.</div>
          )}
          {filteredRows.map((r) => {
            const active = selectedId === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  border: 'none',
                  background: active ? '#eef2ff' : 'transparent',
                  borderBottom: '1px solid #f1f3f5',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                  {r.role}
                  {r.role_tag ? <span style={{ fontWeight: 400, color: '#6b7280' }}> · {r.role_tag}</span> : null}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {r.hospital_id} · tabs {r.tabs?.length ?? 0} · sens {r.sensitive_fields?.length ?? 0}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── RIGHT EDITOR ─── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {err && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
            {err}
          </div>
        )}
        {!selected && !loading && (
          <div style={{ color: '#6b7280', fontSize: 14 }}>Select a role on the left to edit its chart config.</div>
        )}
        {selected && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#002054' }}>
                  {selected.role}
                  {selected.role_tag && <span style={{ fontWeight: 400, color: '#6b7280' }}> · {selected.role_tag}</span>}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Hospital: <code>{selected.hospital_id}</code> · updated {fmtDate(selected.updated_at)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {saveMsg && <div style={{ fontSize: 12, color: '#059669' }}>{saveMsg}</div>}
                {previewMsg && <div style={{ fontSize: 12, color: '#b45309' }}>{previewMsg}</div>}
                <button
                  onClick={onPreviewAsRole}
                  disabled={previewing || saving}
                  title="Log in as super_admin, then view the chart as this role. Cookie-based, 1hr."
                  style={{
                    padding: '8px 14px',
                    background: '#fffbeb',
                    color: '#92400e',
                    border: '1px solid #fbbf24',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: previewing ? 'default' : 'pointer',
                    opacity: previewing ? 0.5 : 1,
                  }}
                >
                  {previewing ? 'Starting…' : 'Preview as this role'}
                </button>
                <button
                  onClick={onSave}
                  disabled={saving}
                  style={{
                    padding: '8px 18px',
                    background: '#002054',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
                placeholder="Admin-facing description of this role chart."
              />
            </div>

            {/* Tabs */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                Visible tabs ({tabs.length} / {knownTabIds.length})
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
                {knownTabIds.map((t) => {
                  const on = tabs.includes(t);
                  return (
                    <label
                      key={t}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        border: '1px solid ' + (on ? '#002054' : '#d1d5db'),
                        borderRadius: 6,
                        background: on ? '#eef2ff' : '#fff',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleTab(t)}
                        style={{ margin: 0 }}
                      />
                      <span style={{ color: on ? '#002054' : '#374151' }}>{t}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Two-column: action bar + write actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Action bar — primary (one slug per line)
                </label>
                <textarea
                  value={primaryText}
                  onChange={(e) => setPrimaryText(e.target.value)}
                  rows={5}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}
                />
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    Action bar — secondary (one slug per line)
                  </label>
                  <textarea
                    value={secondaryText}
                    onChange={(e) => setSecondaryText(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}
                  />
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
                  Slugs must match entries in <code>useChartAction.ts → CHART_ACTIONS</code>.
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Allowed write actions (one per line)
                </label>
                <textarea
                  value={writeActionsText}
                  onChange={(e) => setWriteActionsText(e.target.value)}
                  rows={8}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}
                />
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
                  Forward-looking. SC.* routers will gate writes on this list.
                </div>
              </div>
            </div>

            {/* Overview layout */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Overview layout — ordered card ids (one per line)
              </label>
              <textarea
                value={overviewText}
                onChange={(e) => setOverviewText(e.target.value)}
                rows={5}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}
              />
            </div>

            {/* Sensitive fields */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Sensitive fields (comma-separated)
              </label>
              <input
                type="text"
                value={sensitiveText}
                onChange={(e) => setSensitiveText(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace' }}
                placeholder="diagnosis, notes_snippet, mlc_reason"
              />
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
                Field names redacted by <code>SensitiveText</code>. Must match the writer-side keys.
              </div>
            </div>

            {/* ─── ACTIVITY ─── */}
            <div style={{ borderTop: '1px solid #e4e7eb', paddingTop: 16, marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#002054', marginBottom: 10 }}>
                Recent activity for <code>{selected.role}</code>
              </div>
              {activityLoading && <div style={{ fontSize: 12, color: '#6b7280' }}>Loading activity…</div>}
              {activity && !activityLoading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <ActivityPanel title={`Sensitive field views (${activity.views.length})`}>
                    {activity.views.length === 0 && <Empty label="No redacted views in this window." />}
                    {activity.views.map((v) => (
                      <ActivityRow
                        key={v.id}
                        left={`${v.field_name}${v.tab_id ? ` · ${v.tab_id}` : ''}`}
                        right={fmtDate(v.created_at)}
                        sub={v.access_reason || v.patient_id}
                      />
                    ))}
                  </ActivityPanel>
                  <ActivityPanel title={`Chart edits (${activity.edits.length})`}>
                    {activity.edits.length === 0 && <Empty label="No chart edits in this window." />}
                    {activity.edits.map((e) => (
                      <ActivityRow
                        key={e.id}
                        left={`${e.action} · ${e.resource_type}`}
                        right={fmtDate(e.created_at)}
                        sub={e.patient_id}
                      />
                    ))}
                  </ActivityPanel>
                </div>
              )}
              {activity && !activityLoading && (
                <div style={{ marginTop: 14 }}>
                  <ActivityPanel title={`Admin edits to this preset (${activity.adminEdits.length})`}>
                    {activity.adminEdits.length === 0 && <Empty label="No admin edits to this preset yet." />}
                    {activity.adminEdits.map((a) => {
                      const keys = Array.isArray(a.payload_summary?.changed_keys)
                        ? (a.payload_summary.changed_keys as string[]).join(', ')
                        : '';
                      return (
                        <ActivityRow
                          key={a.id}
                          left={`${a.action}${keys ? ` · ${keys}` : ''}`}
                          right={fmtDate(a.created_at)}
                          sub={`by ${a.user_role}${a.user_id ? ` (${a.user_id.slice(0, 8)}…)` : ''}`}
                        />
                      );
                    })}
                  </ActivityPanel>
                </div>
              )}
            </div>

            {/* ─── PC.3.4.E VERSIONS TIMELINE ─── */}
            <div style={{ borderTop: '1px solid #e4e7eb', paddingTop: 16, marginTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#002054', marginBottom: 10 }}>
                Version history for <code>{selected.role}</code>
              </div>
              {versionsLoading && <div style={{ fontSize: 12, color: '#6b7280' }}>Loading versions…</div>}
              {versions && !versionsLoading && versions.length === 0 && (
                <Empty label="No version snapshots yet — next save creates v1." />
              )}
              {versions && versions.length > 0 && (
                <div style={{ border: '1px solid #e4e7eb', borderRadius: 6, background: '#fff' }}>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {versions.map((v, i) => {
                      const isLatest = i === 0;
                      const prev = versions[i + 1];
                      return (
                        <div key={v.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f7f7f7' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#111827' }}>
                            <span style={{ fontWeight: 600 }}>
                              v{v.version_number}
                              {isLatest ? ' · latest' : ''}
                              {' · '}
                              {v.changed_keys.length === 0
                                ? <em style={{ color: '#9ca3af' }}>no keys changed</em>
                                : v.changed_keys.join(', ')}
                            </span>
                            <span style={{ color: '#6b7280', flexShrink: 0 }}>{fmtDate(v.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                            by {v.changed_by_name ?? v.changed_by_role ?? 'unknown'}
                            {v.change_note ? ` — "${v.change_note}"` : ''}
                          </div>
                          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => openDiff(v.version_number, 'current')}
                              style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#374151' }}
                            >
                              Diff vs current
                            </button>
                            {prev && (
                              <button
                                type="button"
                                onClick={() => openDiff(prev.version_number, v.version_number)}
                                style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', color: '#374151' }}
                              >
                                Diff vs v{prev.version_number}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── PC.3.4.E DIFF DRAWER ─── */}
      {diffOpen && (
        <div
          onClick={() => setDiffOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 720, maxWidth: '92vw', height: '100%', background: '#fff', boxShadow: '-6px 0 24px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e4e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#002054' }}>
                  Diff — v{diffA} vs {diffB === 'current' ? 'current' : `v${diffB}`}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{selected?.role} · {selected?.hospital_id}</div>
              </div>
              <button
                onClick={() => setDiffOpen(false)}
                style={{ fontSize: 12, padding: '6px 10px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
              >Close</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {diffLoading && <div style={{ fontSize: 12, color: '#6b7280' }}>Loading diff…</div>}
              {!diffLoading && diffPayload && (
                <DiffView a={diffPayload.a} b={diffPayload.b} />
              )}
              {!diffLoading && !diffPayload && (
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Diff could not be loaded.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────
function ActivityPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e4e7eb', borderRadius: 6, background: '#fff' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f3f5', fontSize: 12, fontWeight: 600, color: '#374151' }}>
        {title}
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}
function ActivityRow({ left, right, sub }: { left: string; right: string; sub?: string }) {
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #f7f7f7' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#111827' }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{left}</span>
        <span style={{ color: '#6b7280', flexShrink: 0 }}>{right}</span>
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </div>
      )}
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div style={{ padding: 16, fontSize: 12, color: '#9ca3af' }}>{label}</div>;
}

// ─── PC.3.4.E DiffView ──────────────────────────────────────────
function DiffView({ a, b }: { a: any; b: any }) {
  const aSnap = (a?.snapshot ?? {}) as Record<string, unknown>;
  const bSnap = (b?.snapshot ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(aSnap), ...Object.keys(bSnap)])).sort();
  const eq = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '(empty)';
    if (Array.isArray(v)) return v.length === 0 ? '(empty)' : v.join('\n');
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
        <strong>A</strong> v{a?.version_number} · {a?.changed_by_name ?? a?.changed_by_role ?? 'unknown'}
        {a?.change_note ? ` — "${a.change_note}"` : ''}
        {'  →  '}
        <strong>B</strong> {b?.version_number === 'current' ? 'current' : `v${b?.version_number}`}
        {b?.changed_by_name ? ` · ${b.changed_by_name}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 8, fontSize: 11 }}>
        <div style={{ fontWeight: 700, color: '#111827' }}>Field</div>
        <div style={{ fontWeight: 700, color: '#111827' }}>A</div>
        <div style={{ fontWeight: 700, color: '#111827' }}>B</div>
        {keys.map((k) => {
          const same = eq(aSnap[k], bSnap[k]);
          return (
            <React.Fragment key={k}>
              <div style={{ fontFamily: 'ui-monospace, SF Mono, monospace', color: same ? '#9ca3af' : '#002054', paddingTop: 6 }}>{k}</div>
              <pre style={{ background: same ? '#fafbfc' : '#fff7ed', padding: 6, borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{fmt(aSnap[k])}</pre>
              <pre style={{ background: same ? '#fafbfc' : '#ecfdf5', padding: 6, borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap', margin: 0 }}>{fmt(bSnap[k])}</pre>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
