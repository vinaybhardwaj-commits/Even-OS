'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── TYPES ────────────────────────────────────────────────────
interface User {
  sub: string;
  hospital_id: string;
  role: string;
  email: string;
  name: string;
}

interface CarePathwayTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  node_count: number;
  expected_los_days: number;
  expected_cost: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  nodes?: CarePathwayNode[];
}

interface CarePathwayNode {
  id: string;
  template_id: string;
  node_key: string;
  node_type: string;
  name: string;
  timing_expression: string;
  timing_offset_hours: number;
  responsible_role: string;
  auto_fire: boolean;
  is_required: boolean;
  sort_order: number;
}

interface CarePathwayPlan {
  id: string;
  patient_id: string;
  template_id: string;
  patient_name: string;
  template_name: string;
  activated_at: string;
  milestone_total: number;
  milestone_completed: number;
  overdue_count: number;
  status: 'active' | 'completed' | 'paused';
  milestones?: CarePathwayMilestone[];
}

interface CarePathwayMilestone {
  id: string;
  plan_id: string;
  name: string;
  type: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'overdue' | 'skipped';
  due_datetime: string;
  responsible_role: string;
  completed_at?: string;
  skipped_at?: string;
  skip_reason?: string;
}

interface Escalation {
  id: string;
  patient_id: string;
  milestone_id: string;
  patient_name: string;
  milestone_name: string;
  overdue_hours: number;
  level: 'level_1' | 'level_2' | 'level_3';
  status: 'triggered' | 'acknowledged' | 'resolved';
  triggered_at: string;
  acknowledged_at?: string;
  resolved_at?: string;
}

interface Variance {
  id: string;
  plan_id: string;
  milestone_id: string;
  patient_name: string;
  milestone_name: string;
  variance_type: string;
  severity: 'low' | 'medium' | 'high';
  delay_hours: number;
  reason: string;
  documented_by: string;
  documented_at: string;
}

// ─── FORMATTING HELPERS ────────────────────────────────────────
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getHoursOverdue(dueDateTime: string): number {
  const now = new Date();
  const due = new Date(dueDateTime);
  const diff = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60)));
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    active: 'bg-green-100 text-green-800',
    archived: 'bg-red-100 text-red-800',
    'not_started': 'bg-gray-100 text-gray-800',
    'in_progress': 'bg-blue-100 text-blue-800',
    'completed': 'bg-green-100 text-green-800',
    'overdue': 'bg-red-100 text-red-800',
    'skipped': 'bg-yellow-100 text-yellow-800',
    'triggered': 'bg-red-100 text-red-800',
    'acknowledged': 'bg-orange-100 text-orange-800',
    'resolved': 'bg-green-100 text-green-800',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    'not_started': '&#x23F0;',
    'in_progress': '&#x26A1;',
    'completed': '&#x2705;',
    'overdue': '&#x26A0;',
    'skipped': '&#x23F9;',
  };
  return icons[status] || '&#x1F4CB;';
}

function formatMilestoneProgress(completed: number, total: number): string {
  if (total === 0) return '0%';
  return Math.round((completed / total) * 100) + '%';
}

// ─── STAT CARDS ────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  color: 'blue' | 'green' | 'red' | 'orange' | 'gray' | 'yellow';
}

function StatCard({ label, value, color }: StatCardProps) {
  const bgColors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    orange: 'bg-orange-50 border-orange-200',
    gray: 'bg-gray-50 border-gray-200',
    yellow: 'bg-yellow-50 border-yellow-200',
  };
  const textColors: Record<string, string> = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    red: 'text-red-700',
    orange: 'text-orange-700',
    gray: 'text-gray-700',
    yellow: 'text-yellow-700',
  };
  return (
    <div className={`border rounded-lg p-4 ${bgColors[color]}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColors[color]}`}>{value}</p>
    </div>
  );
}

// ─── TAB 1: TEMPLATES ──────────────────────────────────────────
interface TemplatesTabProps {
  user: User;
}

function TemplatesTab({ user }: TemplatesTabProps) {
  const [templates, setTemplates] = useState<CarePathwayTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    category: 'Orthopedics',
    expected_los_days: 0,
    expected_cost: 0,
  });
  const [expandedNodeForm, setExpandedNodeForm] = useState<string | null>(null);
  const [newNode, setNewNode] = useState({
    node_key: '',
    node_type: 'assessment',
    name: '',
    timing_expression: 'on_admission',
    timing_offset_hours: 0,
    responsible_role: 'nurse',
    auto_fire: false,
    is_required: false,
    sort_order: 0,
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/trpc/carePathways.listTemplates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { status: 'all' } }),
      });
      const data = await response.json();
      setTemplates(data.result?.data?.json || []);
      setError(null);
    } catch (err) {
      setError('Failed to load templates');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateTemplate = async () => {
    try {
      const response = await fetch('/api/trpc/carePathways.createTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            name: newTemplate.name,
            description: newTemplate.description,
            category: newTemplate.category,
            expected_los_days: newTemplate.expected_los_days,
            expected_cost: newTemplate.expected_cost,
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data) {
        setTemplates([...templates, data.result.data.json]);
        setShowNewForm(false);
        setNewTemplate({
          name: '',
          description: '',
          category: 'Orthopedics',
          expected_los_days: 0,
          expected_cost: 0,
        });
      }
    } catch (err) {
      console.error('Failed to create template', err);
    }
  };

  const handleAddNode = async (templateId: string) => {
    try {
      const response = await fetch('/api/trpc/carePathways.addNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            template_id: templateId,
            ...newNode,
          },
        }),
      });
      const data = await response.json();
      if (data.result?.data) {
        loadTemplates();
        setExpandedNodeForm(null);
        setNewNode({
          node_key: '',
          node_type: 'assessment',
          name: '',
          timing_expression: 'on_admission',
          timing_offset_hours: 0,
          responsible_role: 'nurse',
          auto_fire: false,
          is_required: false,
          sort_order: 0,
        });
      }
    } catch (err) {
      console.error('Failed to add node', err);
    }
  };

  const handlePublish = async (templateId: string) => {
    try {
      await fetch('/api/trpc/carePathways.updateTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: { id: templateId, status: 'active' },
        }),
      });
      loadTemplates();
    } catch (err) {
      console.error('Failed to publish', err);
    }
  };

  const handleArchive = async (templateId: string) => {
    try {
      await fetch('/api/trpc/carePathways.updateTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: { id: templateId, status: 'archived' },
        }),
      });
      loadTemplates();
    } catch (err) {
      console.error('Failed to archive', err);
    }
  };

  const stats = {
    active: templates.filter((t) => t.status === 'active').length,
    draft: templates.filter((t) => t.status === 'draft').length,
    archived: templates.filter((t) => t.status === 'archived').length,
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-600">Loading templates...</div>;
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Templates" value={stats.active} color="green" />
        <StatCard label="Draft" value={stats.draft} color="blue" />
        <StatCard label="Archived" value={stats.archived} color="red" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-4 text-red-700">{error}</div>}

      <div className="mb-6 flex justify-between items-center">
        <h3 className="text-lg font-semibold">Care Pathway Templates</h3>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {showNewForm ? 'Cancel' : '+ New Template'}
        </button>
      </div>

      {showNewForm && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
          <h4 className="font-semibold mb-4">Create New Template</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Template Name"
              value={newTemplate.name}
              onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
              className="border border-gray-300 rounded px-3 py-2"
            />
            <input
              type="text"
              placeholder="Description"
              value={newTemplate.description}
              onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
              className="border border-gray-300 rounded px-3 py-2"
            />
            <select
              value={newTemplate.category}
              onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}
              className="border border-gray-300 rounded px-3 py-2"
            >
              <option>Orthopedics</option>
              <option>General Surgery</option>
              <option>Cardiology</option>
              <option>Neurology</option>
              <option>Obstetrics</option>
              <option>ICU</option>
              <option>Other</option>
            </select>
            <input
              type="number"
              placeholder="Expected LOS (days)"
              value={newTemplate.expected_los_days}
              onChange={(e) => setNewTemplate({ ...newTemplate, expected_los_days: parseInt(e.target.value) })}
              className="border border-gray-300 rounded px-3 py-2"
            />
            <input
              type="number"
              placeholder="Expected Cost"
              value={newTemplate.expected_cost}
              onChange={(e) => setNewTemplate({ ...newTemplate, expected_cost: parseFloat(e.target.value) })}
              className="border border-gray-300 rounded px-3 py-2"
            />
            <button
              onClick={handleCreateTemplate}
              className="col-span-1 md:col-span-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Create Template
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {templates.map((template) => (
          <div key={template.id} className="border border-gray-200 rounded">
            <div
              className="bg-gray-50 p-4 cursor-pointer hover:bg-gray-100 flex justify-between items-center"
              onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}
            >
              <div className="flex-1">
                <p className="font-semibold">{template.name}</p>
                <p className="text-sm text-gray-600">{template.description}</p>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-gray-600">Category: {template.category}</span>
                  <span className="text-gray-600">Nodes: {template.node_count}</span>
                  <span className="text-gray-600">LOS: {template.expected_los_days}d</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded text-sm font-medium ${getStatusColor(template.status)}`}>
                  {template.status}
                </span>
                <span className="text-gray-600">v{template.version}</span>
              </div>
            </div>

            {expandedId === template.id && (
              <div className="bg-white p-4 border-t border-gray-200">
                <h5 className="font-semibold mb-3">Nodes ({template.nodes?.length || 0})</h5>
                {template.nodes && template.nodes.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {template.nodes.map((node) => (
                      <div key={node.id} className="bg-gray-50 p-3 rounded text-sm border border-gray-200">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium">{node.name}</p>
                            <p className="text-gray-600">
                              Type: {node.node_type} | Timing: {node.timing_expression} +{node.timing_offset_hours}h
                            </p>
                            <p className="text-gray-600">
                              Role: {node.responsible_role}
                              {node.is_required && ' | &#x2705; Required'}
                              {node.auto_fire && ' | Auto-fire'}
                            </p>
                          </div>
                          <span className="text-gray-600">#{node.sort_order}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 mb-4">No nodes yet</p>
                )}

                {expandedNodeForm === template.id ? (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <h6 className="font-semibold mb-3 text-sm">Add Node</h6>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <input
                        type="text"
                        placeholder="Node Key"
                        value={newNode.node_key}
                        onChange={(e) => setNewNode({ ...newNode, node_key: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                      <select
                        value={newNode.node_type}
                        onChange={(e) => setNewNode({ ...newNode, node_type: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option>assessment</option>
                        <option>intervention</option>
                        <option>education</option>
                        <option>consultation</option>
                        <option>discharge</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Name"
                        value={newNode.name}
                        onChange={(e) => setNewNode({ ...newNode, name: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                      <select
                        value={newNode.timing_expression}
                        onChange={(e) => setNewNode({ ...newNode, timing_expression: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="on_admission">On Admission</option>
                        <option value="post_surgery">Post Surgery</option>
                        <option value="post_op_day">Post Op Day</option>
                        <option value="discharge">Discharge</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Offset (hours)"
                        value={newNode.timing_offset_hours}
                        onChange={(e) => setNewNode({ ...newNode, timing_offset_hours: parseInt(e.target.value) })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                      <select
                        value={newNode.responsible_role}
                        onChange={(e) => setNewNode({ ...newNode, responsible_role: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value="nurse">Nurse</option>
                        <option value="doctor">Doctor</option>
                        <option value="physio">Physio</option>
                        <option value="nutritionist">Nutritionist</option>
                      </select>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={newNode.auto_fire}
                          onChange={(e) => setNewNode({ ...newNode, auto_fire: e.target.checked })}
                        />
                        Auto-fire
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={newNode.is_required}
                          onChange={(e) => setNewNode({ ...newNode, is_required: e.target.checked })}
                        />
                        Required
                      </label>
                      <button
                        onClick={() => handleAddNode(template.id)}
                        className="col-span-1 md:col-span-2 bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                      >
                        Add Node
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setExpandedNodeForm(template.id)}
                    className="text-blue-600 text-sm mb-4 hover:underline"
                  >
                    + Add Node
                  </button>
                )}

                <div className="flex gap-2">
                  {template.status === 'draft' && (
                    <button
                      onClick={() => handlePublish(template.id)}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                    >
                      Publish
                    </button>
                  )}
                  {template.status !== 'archived' && (
                    <button
                      onClick={() => handleArchive(template.id)}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TAB 2: ACTIVE CARE PLANS ──────────────────────────────────
interface ActivePlansTabProps {
  user: User;
}

function ActivePlansTab({ user }: ActivePlansTabProps) {
  const [plans, setPlans] = useState<CarePathwayPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showActivateForm, setShowActivateForm] = useState(false);

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/trpc/carePathways.listPlans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { status: 'active' } }),
      });
      const data = await response.json();
      setPlans(data.result?.data?.json || []);
    } catch (err) {
      console.error('Failed to load plans', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMilestoneAction = async (milestoneId: string, action: 'start' | 'complete' | 'skip', reason?: string) => {
    try {
      await fetch('/api/trpc/carePathways.updateMilestone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: { id: milestoneId, status: action === 'complete' ? 'completed' : action === 'skip' ? 'skipped' : 'in_progress', skip_reason: reason },
        }),
      });
      loadPlans();
    } catch (err) {
      console.error('Failed to update milestone', err);
    }
  };

  const filteredPlans = plans.filter((p) => p.patient_name.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) {
    return <div className="p-6 text-center text-gray-600">Loading care plans...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Search patient name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2"
          />
          <button
            onClick={() => setShowActivateForm(!showActivateForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            {showActivateForm ? 'Cancel' : '+ Activate Pathway'}
          </button>
        </div>
      </div>

      {showActivateForm && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
          <h4 className="font-semibold mb-4">Activate Care Pathway</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input type="text" placeholder="Select Patient" className="border border-gray-300 rounded px-3 py-2" />
            <select className="border border-gray-300 rounded px-3 py-2">
              <option>Select Template</option>
            </select>
            <input type="text" placeholder="Team Members (comma-separated)" className="border border-gray-300 rounded px-3 py-2 col-span-1 md:col-span-2" />
            <button className="col-span-1 md:col-span-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
              Activate
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filteredPlans.map((plan) => (
          <div key={plan.id} className="border border-gray-200 rounded">
            <div
              className="bg-gray-50 p-4 cursor-pointer hover:bg-gray-100"
              onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-semibold">{plan.patient_name}</p>
                  <p className="text-sm text-gray-600">{plan.template_name}</p>
                  <div className="mt-2">
                    <div className="w-full bg-gray-300 rounded h-2">
                      <div
                        className="bg-green-600 h-2 rounded"
                        style={{ width: formatMilestoneProgress(plan.milestone_completed, plan.milestone_total) }}
                      />
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      {plan.milestone_completed}/{plan.milestone_total} milestones
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {plan.overdue_count > 0 && (
                    <span className="bg-red-100 text-red-800 px-3 py-1 rounded text-sm font-medium">
                      {plan.overdue_count} overdue
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded text-sm font-medium ${getStatusColor(plan.status)}`}>{plan.status}</span>
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-2">Activated: {formatDate(plan.activated_at)}</p>
            </div>

            {expandedId === plan.id && plan.milestones && (
              <div className="bg-white p-4 border-t border-gray-200">
                <h5 className="font-semibold mb-4">Milestone Timeline</h5>
                <div className="space-y-3">
                  {plan.milestones.map((m, idx) => {
                    const hoursOverdue = getHoursOverdue(m.due_datetime);
                    return (
                      <div key={m.id} className="relative pl-8 pb-6">
                        <div className="absolute left-0 top-0 w-4 h-4 rounded-full bg-blue-600 border-2 border-white"></div>
                        {idx < plan.milestones!.length - 1 && <div className="absolute left-2 top-4 w-0.5 h-12 bg-gray-300"></div>}

                        <div className="bg-gray-50 p-3 rounded border border-gray-200">
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex-1">
                              <p className="font-medium">{m.name}</p>
                              <p className="text-sm text-gray-600">Role: {m.responsible_role}</p>
                              <p className="text-xs text-gray-600 mt-1">Due: {formatDateTime(m.due_datetime)}</p>
                              {hoursOverdue > 0 && <p className="text-xs text-red-600 mt-1">&#x26A0; {hoursOverdue}h overdue</p>}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <span className={`px-3 py-1 rounded text-xs font-medium ${getStatusColor(m.status)}`}>
                                {m.status}
                              </span>
                            </div>
                          </div>

                          {m.status === 'not_started' && (
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => handleMilestoneAction(m.id, 'start')}
                                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                              >
                                Start
                              </button>
                              <button
                                onClick={() => handleMilestoneAction(m.id, 'skip')}
                                className="text-xs bg-yellow-600 text-white px-2 py-1 rounded hover:bg-yellow-700"
                              >
                                Skip
                              </button>
                            </div>
                          )}
                          {m.status === 'in_progress' && (
                            <button
                              onClick={() => handleMilestoneAction(m.id, 'complete')}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 mt-3"
                            >
                              Complete
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
        ))}
      </div>
    </div>
  );
}

// ─── TAB 3: ESCALATIONS ───────────────────────────────────────
interface EscalationsTabProps {
  user: User;
}

function EscalationsTab({ user }: EscalationsTabProps) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadEscalations();
    const interval = setInterval(() => {
      setRefreshing(true);
      loadEscalations();
      setRefreshing(false);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadEscalations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/trpc/carePathways.listEscalations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { status: 'triggered' } }),
      });
      const data = await response.json();
      const esc = (data.result?.data?.json || []) as Escalation[];
      setEscalations(esc.sort((a, b) => b.overdue_hours - a.overdue_hours));
    } catch (err) {
      console.error('Failed to load escalations', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAcknowledge = async (escalationId: string) => {
    try {
      await fetch('/api/trpc/carePathways.updateEscalation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { id: escalationId, status: 'acknowledged' } }),
      });
      loadEscalations();
    } catch (err) {
      console.error('Failed to acknowledge', err);
    }
  };

  const handleResolve = async (escalationId: string, notes: string) => {
    try {
      await fetch('/api/trpc/carePathways.updateEscalation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { id: escalationId, status: 'resolved', notes } }),
      });
      loadEscalations();
    } catch (err) {
      console.error('Failed to resolve', err);
    }
  };

  const stats = {
    total: escalations.length,
    unacknowledged: escalations.filter((e) => e.status === 'triggered').length,
    level1: escalations.filter((e) => e.level === 'level_1').length,
    level2: escalations.filter((e) => e.level === 'level_2').length,
    level3: escalations.filter((e) => e.level === 'level_3').length,
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-600">Loading escalations...</div>;
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Triggered" value={stats.total} color="red" />
        <StatCard label="Unacknowledged" value={stats.unacknowledged} color="orange" />
        <StatCard label="Level 1" value={stats.level1} color="yellow" />
        <StatCard label="Level 2" value={stats.level2} color="orange" />
        <StatCard label="Level 3" value={stats.level3} color="red" />
      </div>

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Escalation Queue</h3>
        <button
          onClick={() => loadEscalations()}
          className={`text-sm px-3 py-1 rounded border ${refreshing ? 'border-blue-600 text-blue-600' : 'border-gray-300 text-gray-600'}`}
        >
          {refreshing ? '&#x23F3; Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2">Patient</th>
              <th className="text-left px-4 py-2">Milestone</th>
              <th className="text-left px-4 py-2">Overdue</th>
              <th className="text-left px-4 py-2">Level</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {escalations.map((esc) => (
              <tr key={esc.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{esc.patient_name}</td>
                <td className="px-4 py-2">{esc.milestone_name}</td>
                <td className="px-4 py-2">
                  <span className="text-red-600 font-medium">{esc.overdue_hours}h</span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      esc.level === 'level_3' ? 'bg-red-100 text-red-800' : esc.level === 'level_2' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {esc.level}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(esc.status)}`}>{esc.status}</span>
                </td>
                <td className="px-4 py-2 flex gap-2">
                  {esc.status === 'triggered' && (
                    <button
                      onClick={() => handleAcknowledge(esc.id)}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Acknowledge
                    </button>
                  )}
                  {esc.status !== 'resolved' && (
                    <button
                      onClick={() => handleResolve(esc.id, 'Resolved')}
                      className="text-green-600 text-xs hover:underline"
                    >
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {escalations.length === 0 && <p className="text-center text-gray-600 mt-6">No escalations</p>}
    </div>
  );
}

// ─── TAB 4: VARIANCES ────────────────────────────────────────
interface VariancesTabProps {
  user: User;
}

function VariancesTab({ user }: VariancesTabProps) {
  const [variances, setVariances] = useState<Variance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');

  useEffect(() => {
    loadVariances();
  }, [filterType, filterSeverity]);

  const loadVariances = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/trpc/carePathways.listVariances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            type: filterType === 'all' ? undefined : filterType,
            severity: filterSeverity === 'all' ? undefined : filterSeverity,
          },
        }),
      });
      const data = await response.json();
      setVariances(data.result?.data?.json || []);
    } catch (err) {
      console.error('Failed to load variances', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity]);

  const typeBreakdown = variances.reduce(
    (acc, v) => {
      acc[v.variance_type] = (acc[v.variance_type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const avgDelay = variances.length > 0 ? Math.round(variances.reduce((sum, v) => sum + v.delay_hours, 0) / variances.length) : 0;

  if (loading) {
    return <div className="p-6 text-center text-gray-600">Loading variances...</div>;
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Variances" value={variances.length} color="orange" />
        <StatCard label="By Type" value={Object.keys(typeBreakdown).length} color="blue" />
        <StatCard label="Avg Delay" value={`${avgDelay}h`} color="gray" />
      </div>

      <div className="mb-6 flex gap-4">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="all">All Types</option>
          <option value="delay">Delay</option>
          <option value="skipped">Skipped</option>
          <option value="modified">Modified</option>
          <option value="other">Other</option>
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2"
        >
          <option value="all">All Severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2">Patient</th>
              <th className="text-left px-4 py-2">Milestone</th>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Severity</th>
              <th className="text-left px-4 py-2">Delay (h)</th>
              <th className="text-left px-4 py-2">Reason</th>
              <th className="text-left px-4 py-2">Documented By</th>
            </tr>
          </thead>
          <tbody>
            {variances.map((v) => (
              <tr key={v.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{v.patient_name}</td>
                <td className="px-4 py-2">{v.milestone_name}</td>
                <td className="px-4 py-2 text-xs">{v.variance_type}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      v.severity === 'high' ? 'bg-red-100 text-red-800' : v.severity === 'medium' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {v.severity}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium">{v.delay_hours}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{v.reason}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{v.documented_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {variances.length === 0 && <p className="text-center text-gray-600 mt-6">No variances</p>}
    </div>
  );
}

// ─── TAB 5: REPORTS ───────────────────────────────────────────
interface ReportsTabProps {
  user: User;
}

function ReportsTab({ user }: ReportsTabProps) {
  const [reportData, setReportData] = useState({
    activeTemplates: 0,
    activePlans: 0,
    overdueCount: 0,
    completionRate: 0,
  });
  const [overdueMilestones, setOverdueMilestones] = useState<any[]>([]);
  const [varianceReport, setVarianceReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/trpc/carePathways.generateReport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: {} }),
      });
      const data = await response.json();
      const report = data.result?.data?.json || {};
      setReportData(report.stats || {});
      setOverdueMilestones(report.overdueMilestones || []);
      setVarianceReport(report.varianceReport || []);
    } catch (err) {
      console.error('Failed to load reports', err);
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div className="p-6 text-center text-gray-600">Loading reports...</div>;
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Templates" value={reportData.activeTemplates} color="green" />
        <StatCard label="Active Plans" value={reportData.activePlans} color="blue" />
        <StatCard label="Overdue Milestones" value={reportData.overdueCount} color="red" />
        <StatCard label="Completion Rate" value={`${reportData.completionRate}%`} color="orange" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold mb-4">Overdue Milestones</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2">Patient</th>
                  <th className="text-left px-4 py-2">Milestone</th>
                  <th className="text-left px-4 py-2">Due</th>
                  <th className="text-left px-4 py-2">Hours Over</th>
                </tr>
              </thead>
              <tbody>
                {overdueMilestones.slice(0, 10).map((m) => (
                  <tr key={m.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-sm">{m.patient_name}</td>
                    <td className="px-4 py-2 text-sm">{m.milestone_name}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{formatDate(m.due_datetime)}</td>
                    <td className="px-4 py-2 font-medium text-red-600">{m.hours_overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-4">Variance Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2">Milestone Type</th>
                  <th className="text-left px-4 py-2">Count</th>
                  <th className="text-left px-4 py-2">Avg Delay (h)</th>
                </tr>
              </thead>
              <tbody>
                {varianceReport.slice(0, 10).map((v) => (
                  <tr key={v.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-sm">{v.milestone_name}</td>
                    <td className="px-4 py-2 text-sm">{v.count}</td>
                    <td className="px-4 py-2 font-medium">{v.avg_delay.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN CLIENT COMPONENT ────────────────────────────────────
interface CarePathwaysClientProps {
  user: User;
}

export function CarePathwaysClient({ user }: CarePathwaysClientProps) {
  const [activeTab, setActiveTab] = useState<'templates' | 'plans' | 'escalations' | 'variances' | 'reports'>('templates');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold">Care Pathways</h1>
          <p className="text-gray-600 mt-2">Manage care pathways, templates, and milestone tracking</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="px-6 flex gap-8 overflow-x-auto">
            {[
              { id: 'templates', label: '&#x1F4CB; Templates' },
              { id: 'plans', label: '&#x23F0; Active Plans' },
              { id: 'escalations', label: '&#x1F6A8; Escalations' },
              { id: 'variances', label: '&#x26A0; Variances' },
              { id: 'reports', label: '&#x1F4CA; Reports' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-4 border-b-2 font-medium whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
                dangerouslySetInnerHTML={{ __html: tab.label }}
              />
            ))}
          </div>
        </div>

        {activeTab === 'templates' && <TemplatesTab user={user} />}
        {activeTab === 'plans' && <ActivePlansTab user={user} />}
        {activeTab === 'escalations' && <EscalationsTab user={user} />}
        {activeTab === 'variances' && <VariancesTab user={user} />}
        {activeTab === 'reports' && <ReportsTab user={user} />}
      </div>
    </div>
  );
}
