/**
 * Template AI — Qwen-powered template generation + smart defaults
 *
 * Uses the existing LLM client (Qwen 2.5 14B via Ollama + Cloudflare Tunnel)
 * to generate template structures and fill contextual defaults.
 */

import { generateInsight } from './llm-client';

// ============================================================
// TEMPLATE GENERATION — Create full template from description
// ============================================================

const GENERATION_SYSTEM_PROMPT = `You are a clinical template designer for an Indian hospital.
Generate structured clinical document templates in JSON format.

RULES:
- Output ONLY valid JSON — no markdown, no explanation, no backticks
- Each field needs: id (uuid format), type, label, order, required (boolean)
- Field types: text, textarea, checkbox, checkbox_group, dropdown, numeric, date, time, datetime, signature, medication_list, vitals_grid, icd_picker, procedure_picker, drug_picker, patient_data_auto, section_header, divider
- Auto-populate sources: patient.name, patient.uhid, patient.age, patient.gender, patient.allergies, encounter.chief_complaint, encounter.primary_diagnosis, encounter.admission_date, encounter.attending_doctor, vitals.latest, labs.recent, meds.active, meds.discharge, problems.active, procedures.performed, io.balance_24h
- Always start with a patient_data_auto field for patient name
- Always end with a signature field
- Use section_header to group related fields
- Mark clinically critical fields as required
- Include ai_hint for free-text fields to guide future AI auto-fill
- For dropdowns/checkbox_groups, provide clinically appropriate options

OUTPUT FORMAT:
{
  "name": "Template Name",
  "description": "Brief description",
  "category": "discharge|operative|handoff|admission|assessment|consent|nursing|progress|consultation|referral|custom",
  "fields": [
    { "id": "uuid", "type": "field_type", "label": "Field Label", "order": 1, "required": true, ... }
  ]
}`;

export async function generateTemplate(params: {
  description: string;
  hospital_id: string;
  user_id: string;
}): Promise<{ name: string; description: string; category: string; fields: any[] } | null> {
  const result = await generateInsight({
    hospital_id: params.hospital_id,
    module: 'template_management',
    system_prompt: GENERATION_SYSTEM_PROMPT,
    user_prompt: `Generate a clinical template for: ${params.description}`,
    max_tokens: 2000,
    temperature: 0.4,
    triggered_by: 'template',
    user_id: params.user_id,
  });

  if (!result?.content) return null;

  try {
    // Parse JSON from response (handle possible wrapping)
    let content = result.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const parsed = JSON.parse(content);

    // Validate minimal structure
    if (!parsed.fields || !Array.isArray(parsed.fields)) return null;

    // Ensure all fields have IDs
    parsed.fields = parsed.fields.map((f: any, i: number) => ({
      ...f,
      id: f.id || crypto.randomUUID(),
      order: f.order || i + 1,
    }));

    return {
      name: parsed.name || 'AI-Generated Template',
      description: parsed.description || '',
      category: parsed.category || 'custom',
      fields: parsed.fields,
    };
  } catch {
    return null;
  }
}

// ============================================================
// SMART DEFAULTS — Fill template fields from patient context
// ============================================================

const SMART_DEFAULTS_SYSTEM_PROMPT = `You are a clinical documentation assistant at an Indian hospital.
Given patient context (vitals, labs, diagnosis, medications) and a template field with an AI hint,
generate appropriate default text for that field.

RULES:
- Output ONLY the field value — no explanation, no formatting markers
- Be clinically accurate and concise
- Use standard medical terminology
- Include relevant data points from the provided context
- For assessment fields: mention clinical trends (improving/stable/worsening)
- For plan fields: list actionable items
- Keep free-text defaults under 200 words`;

export async function generateSmartDefaults(params: {
  fields: Array<{ id: string; type: string; label: string; ai_hint?: string }>;
  patientContext: {
    vitals?: any[];
    labs?: any[];
    activeOrders?: any[];
    problems?: any[];
    allergies?: any[];
    recentNotes?: any[];
    diagnosis?: string;
    chief_complaint?: string;
  };
  hospital_id: string;
  user_id: string;
}): Promise<Record<string, string>> {
  const defaults: Record<string, string> = {};

  // Only generate for free-text fields with AI hints
  const aiFields = params.fields.filter(f =>
    (f.type === 'textarea' || f.type === 'text') && f.ai_hint
  );

  if (aiFields.length === 0) return defaults;

  // Build patient context summary
  const contextLines: string[] = [];
  if (params.patientContext.diagnosis) contextLines.push(`Diagnosis: ${params.patientContext.diagnosis}`);
  if (params.patientContext.chief_complaint) contextLines.push(`Chief Complaint: ${params.patientContext.chief_complaint}`);
  if (params.patientContext.vitals?.length) {
    const vStrs = params.patientContext.vitals.slice(0, 6).map(v =>
      `${(v.observation_type || '').replace('vital_', '')}: ${v.value_quantity || v.value_text}${v.unit ? ' ' + v.unit : ''}`
    );
    contextLines.push(`Latest Vitals: ${vStrs.join(', ')}`);
  }
  if (params.patientContext.labs?.length) {
    const lStrs = params.patientContext.labs.slice(0, 5).map(l =>
      `${l.test_code || l.test_name}: ${l.result_value || 'pending'}${l.is_abnormal ? '↑' : ''}`
    );
    contextLines.push(`Recent Labs: ${lStrs.join(', ')}`);
  }
  if (params.patientContext.activeOrders?.length) {
    contextLines.push(`Active Meds: ${params.patientContext.activeOrders.slice(0, 5).map((m: any) => m.drug_name).join(', ')}`);
  }
  if (params.patientContext.problems?.length) {
    contextLines.push(`Active Problems: ${params.patientContext.problems.slice(0, 5).map((p: any) => p.code_display || p.condition_name).join(', ')}`);
  }

  const contextSummary = contextLines.join('\n');

  // Generate defaults for each AI field (batch into single LLM call)
  const fieldDescs = aiFields.map(f => `Field "${f.label}" (hint: ${f.ai_hint})`).join('\n');

  const result = await generateInsight({
    hospital_id: params.hospital_id,
    module: 'template_management',
    system_prompt: SMART_DEFAULTS_SYSTEM_PROMPT,
    user_prompt: `Patient Context:\n${contextSummary}\n\nGenerate defaults for these fields (output JSON with field labels as keys):\n${fieldDescs}`,
    max_tokens: 1500,
    temperature: 0.5,
    triggered_by: 'template',
    user_id: params.user_id,
  });

  if (!result?.content) return defaults;

  try {
    let content = result.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const parsed = JSON.parse(content);

    // Map parsed values back to field IDs
    for (const f of aiFields) {
      const val = parsed[f.label] || parsed[f.id];
      if (val && typeof val === 'string') {
        defaults[f.id] = val;
      }
    }
  } catch {
    // If JSON parse fails, try to use the raw text for the first field
    if (aiFields.length === 1 && result.content) {
      defaults[aiFields[0].id] = result.content.trim();
    }
  }

  return defaults;
}
