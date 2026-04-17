/**
 * Form Engine Type Definitions
 * Comprehensive types for form definitions, fields, conditions, and submissions.
 */

// ── Field Types ────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'time'
  | 'dropdown'
  | 'radio'
  | 'multi_select'
  | 'toggle'
  | 'rating'
  | 'traffic_light'
  | 'file'
  | 'repeater'
  | 'person_picker'
  | 'computed'
  | 'icd_picker'
  | 'drug_picker'
  | 'procedure_picker'
  | 'vitals_grid'
  | 'patient_data_auto'
  | 'signature'
  | 'section_header';

// ── Conditions & Logic ─────────────────────────────────────────────────────

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in_list'
  | 'not_in_list';

export interface FieldCondition {
  id: string;
  type: 'field' | 'group';
  fieldId?: string; // For field conditions
  operator?: ConditionOperator; // For field conditions
  value?: unknown; // For field conditions
  logic?: 'AND' | 'OR'; // For group conditions
  conditions?: FieldCondition[]; // For group conditions (nested)
}

export type FieldVisibility = 'always' | 'conditional' | 'hidden';
export type FieldValidation = 'optional' | 'required' | 'custom';

// ── Field Definition ───────────────────────────────────────────────────────

export interface FormField {
  id: string;
  label: string;
  description?: string;
  type: FieldType;
  placeholder?: string;
  required: boolean;
  validation?: {
    type: FieldValidation;
    pattern?: string; // Regex
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    customMessage?: string;
  };
  visibility?: {
    type: FieldVisibility;
    condition?: FieldCondition;
  };
  roleVisibility?: {
    [role: string]: boolean; // true = visible, false = hidden for this role
  };
  defaultValue?: unknown;
  options?: Array<{
    label: string;
    value: string | number;
  }>; // For dropdown, radio, multi_select
  metadata?: {
    help?: string;
    hint?: string;
    icon?: string;
    width?: 'full' | 'half' | 'third'; // Layout hint
    [key: string]: unknown;
  };
  piping?: {
    type: 'none' | 'patient_data' | 'encounter_data' | 'custom';
    source?: string; // Patient field name, encounter field name, or custom formula
  };
}

// ── Section Definition ─────────────────────────────────────────────────────

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  instruction?: string;
  fields: FormField[];
  visibility?: {
    type: FieldVisibility;
    condition?: FieldCondition;
  };
  repeatable?: {
    enabled: boolean;
    minInstances?: number;
    maxInstances?: number;
  };
  metadata?: {
    collapsible?: boolean;
    defaultExpanded?: boolean;
    [key: string]: unknown;
  };
}

// ── Form Definition ────────────────────────────────────────────────────────

export interface FormDefinition {
  id: string;
  hospital_id: string;
  name: string;
  slug: string;
  description?: string;
  category: 'clinical' | 'operational' | 'administrative' | 'custom';
  version: number;
  status: 'draft' | 'active' | 'archived';
  sections: FormSection[];
  requires_patient: boolean;
  applicable_roles: string[]; // ['doctor', 'nurse', 'admin']
  applicable_encounter_types?: string[]; // ['IPD', 'OPD', 'ED']
  role_field_visibility?: {
    [role: string]: {
      [fieldId: string]: boolean;
    };
  };
  slash_command?: string; // e.g., '/vitals', '/handoff'
  slash_role_action_map?: {
    [role: string]: string; // role → action label (e.g., "Log Vitals", "Order Medication")
  };
  layout: 'scroll' | 'wizard' | 'auto';
  submission_target: 'form_submissions' | 'his_router' | 'clinical_template';
  submit_endpoint?: string;
  template_slug?: string;
  submit_transform?: string; // JSON schema or Jsonnet
  source_url?: string;
  ported_from?: string;
  created_by: string; // user ID
  created_at: Date;
  updated_at: Date;
}

// ── Form Submission ────────────────────────────────────────────────────────

export interface FormSubmission {
  id: string;
  hospital_id: string;
  form_definition_id: string;
  patient_id?: string;
  encounter_id?: string;
  channel_id?: string;
  message_id?: number;
  parent_submission_id?: string;
  version: number;
  form_data: Record<string, unknown>; // Key-value pairs of field responses
  form_data_hash: string; // SHA-256
  status: 'draft' | 'submitted' | 'reviewed' | 'locked' | 'voided';
  void_reason?: string;
  submitted_by: string; // user ID
  submitted_at: Date;
  reviewed_by?: string;
  reviewed_at?: Date;
  locked_by?: string;
  locked_at?: Date;
  created_at: Date;
}

// ── Form Audit Log ─────────────────────────────────────────────────────────

export interface FormAuditLogEntry {
  id: number;
  hospital_id: string;
  form_definition_id: string;
  form_submission_id?: string;
  patient_id?: string;
  action: 'form_opened' | 'form_submitted' | 'form_viewed' | 'status_changed' | 'version_created' | 'export_pdf';
  action_detail?: Record<string, unknown>;
  field_snapshot?: Record<string, unknown>;
  performed_by: string;
  performed_at: Date;
  ip_address?: string;
  user_agent?: string;
}

// ── Form Analytics Event ───────────────────────────────────────────────────

export interface FormAnalyticsEvent {
  id: number;
  hospital_id: string;
  form_definition_id: string;
  session_id: string;
  event_type: 'form_start' | 'field_focus' | 'field_blur' | 'section_enter' | 'form_submit' | 'form_abandon';
  field_id?: string;
  section_id?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  created_at: Date;
}
