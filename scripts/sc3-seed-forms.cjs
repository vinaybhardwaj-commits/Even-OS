/**
 * SC.3 — Form Engine Seed Script
 * Seeds 28 form definitions: 15 slash command forms + 13 Rounds-ported forms
 * Run: node scripts/sc3-seed-forms.mjs
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/**
 * Field type reference (23 types):
 * text, textarea, number, currency, date, time, dropdown, radio, multi_select,
 * toggle, rating, traffic_light, file, repeater, person_picker, computed,
 * icd_picker, drug_picker, procedure_picker, vitals_grid, patient_data_auto,
 * signature, section_header
 */

async function seed() {
  console.log('SC.3 — Seeding form definitions...\n');

  // Get super_admin user ID
  const [admin] = await sql`
    SELECT id FROM users
    WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles)
    LIMIT 1
  `;

  if (!admin) {
    console.error('ERROR: No super_admin user found for EHRC');
    process.exit(1);
  }

  const createdBy = admin.id;
  console.log(`✓ Using super_admin: ${createdBy}\n`);

  const forms = [
    // ========================================================================
    // SECTION A: SLASH COMMAND FORMS (15 forms)
    // ========================================================================

    // 1. /vitals — Log Vitals (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Log Vitals',
      slug: 'vitals_form',
      description: 'Record patient vital signs at bedside',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['nurse', 'senior_nurse', 'ot_nurse'],
      applicable_encounter_types: ['ipd', 'emergency'],
      slash_command: '/vitals',
      slash_role_action_map: {
        nurse: { action: 'Log Vitals' },
        senior_nurse: { action: 'Log Vitals' },
        ot_nurse: { action: 'Log Vitals' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'observations.createVitals',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          description: 'Auto-populated patient information',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
              prefill: {},
            },
          ],
        },
        {
          id: 'vitals_section',
          label: 'Vital Signs',
          description: 'Current vital measurements',
          fields: [
            {
              id: 'temperature',
              label: 'Temperature (°C)',
              type: 'number',
              required: true,
              placeholder: '36.5',
              validation: { min: 35, max: 42 },
            },
            {
              id: 'pulse',
              label: 'Pulse (bpm)',
              type: 'number',
              required: true,
              placeholder: '72',
              validation: { min: 40, max: 200 },
            },
            {
              id: 'systolic_bp',
              label: 'Systolic BP (mmHg)',
              type: 'number',
              required: true,
              placeholder: '120',
              validation: { min: 60, max: 250 },
            },
            {
              id: 'diastolic_bp',
              label: 'Diastolic BP (mmHg)',
              type: 'number',
              required: true,
              placeholder: '80',
              validation: { min: 30, max: 150 },
            },
            {
              id: 'respiratory_rate',
              label: 'Respiratory Rate (breaths/min)',
              type: 'number',
              required: true,
              placeholder: '16',
              validation: { min: 8, max: 60 },
            },
            {
              id: 'spo2',
              label: 'SpO2 (%)',
              type: 'number',
              required: true,
              placeholder: '98',
              validation: { min: 70, max: 100 },
            },
            {
              id: 'blood_glucose',
              label: 'Blood Glucose (mg/dL)',
              type: 'number',
              required: false,
              placeholder: '120',
              validation: { min: 40, max: 600 },
            },
          ],
        },
        {
          id: 'notes_section',
          label: 'Notes',
          fields: [
            {
              id: 'clinical_notes',
              label: 'Clinical Observations',
              type: 'textarea',
              required: false,
              placeholder: 'Any abnormalities or patient concerns',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 2. /meds — Order Medication (Doctor), Administer Med (Nurse), Dispense (Pharmacy)
    {
      hospital_id: 'EHRC',
      name: 'Order Medication',
      slug: 'medication_order_form',
      description: 'Create medication order for patient',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant', 'surgeon', 'anaesthetist'],
      applicable_encounter_types: ['ipd', 'emergency', 'day_care'],
      slash_command: '/meds',
      slash_role_action_map: {
        resident: { action: 'Order Medication' },
        senior_resident: { action: 'Order Medication' },
        hospitalist: { action: 'Order Medication' },
        visiting_consultant: { action: 'Order Medication' },
        surgeon: { action: 'Order Medication' },
        anaesthetist: { action: 'Order Medication' },
      },
      layout: 'wizard',
      submission_target: 'his_router',
      submit_endpoint: 'medicationOrders.createMedicationOrder',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'drug_section',
          label: 'Drug Selection',
          fields: [
            {
              id: 'drug_id',
              label: 'Drug',
              type: 'drug_picker',
              required: true,
              placeholder: 'Search drug name or ID',
            },
            {
              id: 'drug_strength',
              label: 'Strength',
              type: 'text',
              required: true,
              placeholder: 'e.g., 500mg, 20mcg',
            },
            {
              id: 'drug_form',
              label: 'Form',
              type: 'dropdown',
              required: true,
              options: ['tablet', 'capsule', 'injection', 'infusion', 'syrup', 'inhaler', 'topical', 'other'],
            },
          ],
        },
        {
          id: 'dosing_section',
          label: 'Dosing',
          fields: [
            {
              id: 'dose_quantity',
              label: 'Dose',
              type: 'number',
              required: true,
              placeholder: '1',
              validation: { min: 0 },
            },
            {
              id: 'dose_unit',
              label: 'Unit',
              type: 'dropdown',
              required: true,
              options: ['mg', 'mcg', 'g', 'ml', 'units', 'tabs', 'amps', 'vials'],
            },
            {
              id: 'route',
              label: 'Route',
              type: 'dropdown',
              required: true,
              options: ['oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'rectal', 'transdermal'],
            },
            {
              id: 'frequency',
              label: 'Frequency',
              type: 'dropdown',
              required: true,
              options: ['once', 'bd', 'tds', 'qid', 'q4h', 'q6h', 'q8h', 'q12h', 'stat', 'sos'],
            },
          ],
        },
        {
          id: 'duration_section',
          label: 'Duration',
          fields: [
            {
              id: 'start_date',
              label: 'Start Date',
              type: 'date',
              required: true,
            },
            {
              id: 'duration_days',
              label: 'Duration (days)',
              type: 'number',
              required: false,
              placeholder: '5',
              validation: { min: 1, max: 365 },
            },
            {
              id: 'end_date',
              label: 'End Date (if known)',
              type: 'date',
              required: false,
            },
          ],
        },
        {
          id: 'instructions_section',
          label: 'Instructions',
          fields: [
            {
              id: 'special_instructions',
              label: 'Special Instructions',
              type: 'textarea',
              required: false,
              placeholder: 'e.g., Take with food, before meals, with milk',
            },
            {
              id: 'indications',
              label: 'Indications',
              type: 'textarea',
              required: false,
              placeholder: 'Why is this medication being prescribed?',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 3. /labs — Order Lab Test (Doctor/Nurse), Enter Results (Lab Tech)
    {
      hospital_id: 'EHRC',
      name: 'Order Lab Test',
      slug: 'lab_order_form',
      description: 'Create laboratory test order',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant', 'nurse', 'senior_nurse'],
      applicable_encounter_types: ['ipd', 'emergency', 'opd', 'day_care'],
      slash_command: '/labs',
      slash_role_action_map: {
        resident: { action: 'Order Lab' },
        senior_resident: { action: 'Order Lab' },
        hospitalist: { action: 'Order Lab' },
        visiting_consultant: { action: 'Order Lab' },
        nurse: { action: 'Order Lab' },
        senior_nurse: { action: 'Order Lab' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'labRadiology.createLabOrder',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'test_section',
          label: 'Test Selection',
          fields: [
            {
              id: 'test_panel',
              label: 'Test Panel',
              type: 'dropdown',
              required: true,
              options: ['cbc', 'lft', 'rft', 'coagulation', 'glucose', 'lipid_profile', 'thyroid', 'cardiac_markers', 'blood_culture', 'urinalysis', 'stool_routine', 'custom'],
            },
            {
              id: 'specific_tests',
              label: 'Specific Tests (if custom)',
              type: 'multi_select',
              required: false,
              options: ['hemoglobin', 'wbc', 'platelet', 'albumin', 'bilirubin', 'alt', 'ast', 'glucose', 'creatinine', 'urea'],
            },
          ],
        },
        {
          id: 'urgency_section',
          label: 'Urgency',
          fields: [
            {
              id: 'urgency',
              label: 'Test Urgency',
              type: 'radio',
              required: true,
              options: ['routine', 'urgent', 'stat'],
            },
            {
              id: 'specimen_type',
              label: 'Specimen Type',
              type: 'dropdown',
              required: true,
              options: ['blood', 'urine', 'stool', 'sputum', 'csf', 'tissue', 'body_fluid'],
            },
          ],
        },
        {
          id: 'notes_section',
          label: 'Clinical Notes',
          fields: [
            {
              id: 'clinical_indication',
              label: 'Clinical Indication',
              type: 'textarea',
              required: false,
              placeholder: 'Reason for test',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 4. /notes — SOAP Note (Doctor) / Nursing Assessment (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Clinical Notes',
      slug: 'clinical_notes_form',
      description: 'Document clinical observations and assessments',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant', 'nurse', 'senior_nurse', 'charge_nurse'],
      applicable_encounter_types: ['ipd', 'emergency', 'opd', 'day_care'],
      slash_command: '/notes',
      slash_role_action_map: {
        resident: { action: 'Write Note' },
        senior_resident: { action: 'Write Note' },
        hospitalist: { action: 'Write Note' },
        visiting_consultant: { action: 'Write Note' },
        nurse: { action: 'Write Note' },
        senior_nurse: { action: 'Write Note' },
        charge_nurse: { action: 'Write Note' },
      },
      layout: 'scroll',
      submission_target: 'clinical_template',
      template_slug: 'soap-note',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'soap_section',
          label: 'SOAP Note',
          fields: [
            {
              id: 'subjective',
              label: 'Subjective',
              type: 'textarea',
              required: true,
              placeholder: 'Chief complaint and patient history',
            },
            {
              id: 'objective',
              label: 'Objective',
              type: 'textarea',
              required: true,
              placeholder: 'Physical exam findings, vital signs, lab results',
            },
            {
              id: 'assessment',
              label: 'Assessment',
              type: 'textarea',
              required: true,
              placeholder: 'Diagnosis and clinical impressions',
            },
            {
              id: 'plan',
              label: 'Plan',
              type: 'textarea',
              required: true,
              placeholder: 'Treatment plan and follow-up',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 5. /consult — Request Consultation
    {
      hospital_id: 'EHRC',
      name: 'Request Consultation',
      slug: 'consultation_request_form',
      description: 'Request specialist consultation',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant'],
      applicable_encounter_types: ['ipd', 'emergency', 'day_care'],
      slash_command: '/consult',
      slash_role_action_map: {
        resident: { action: 'Request Consult' },
        senior_resident: { action: 'Request Consult' },
        hospitalist: { action: 'Request Consult' },
        visiting_consultant: { action: 'Request Consult' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'serviceRequests.createServiceRequest',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'specialist_section',
          label: 'Specialist Required',
          fields: [
            {
              id: 'specialty',
              label: 'Specialty',
              type: 'dropdown',
              required: true,
              options: ['cardiology', 'neurology', 'pulmonology', 'gastroenterology', 'nephrology', 'endocrinology', 'infectious_disease', 'psychiatry', 'surgery', 'orthopedics'],
            },
            {
              id: 'specific_consultant',
              label: 'Preferred Consultant (if any)',
              type: 'person_picker',
              required: false,
              placeholder: 'Select specialist',
            },
          ],
        },
        {
          id: 'reason_section',
          label: 'Reason for Consultation',
          fields: [
            {
              id: 'clinical_question',
              label: 'Clinical Question',
              type: 'textarea',
              required: true,
              placeholder: 'What is the specific clinical question?',
            },
            {
              id: 'relevant_history',
              label: 'Relevant History',
              type: 'textarea',
              required: false,
              placeholder: 'Key clinical information for specialist',
            },
          ],
        },
        {
          id: 'urgency_section',
          label: 'Urgency',
          fields: [
            {
              id: 'urgency',
              label: 'Urgency',
              type: 'radio',
              required: true,
              options: ['routine', 'urgent', 'stat'],
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 6. /handoff — SBAR Handoff (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Shift Handoff',
      slug: 'shift_handoff_form',
      description: 'Document shift-to-shift nursing handoff using SBAR',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor'],
      applicable_encounter_types: ['ipd'],
      slash_command: '/handoff',
      slash_role_action_map: {
        nurse: { action: 'Handoff' },
        senior_nurse: { action: 'Handoff' },
        charge_nurse: { action: 'Handoff' },
        nursing_supervisor: { action: 'Handoff' },
      },
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'situation_section',
          label: 'Situation',
          description: 'Current clinical status',
          fields: [
            {
              id: 'current_status',
              label: 'Current Status',
              type: 'textarea',
              required: true,
              placeholder: 'Patient presentation, diagnosis, admission reason',
            },
            {
              id: 'recent_changes',
              label: 'Recent Changes',
              type: 'textarea',
              required: false,
              placeholder: 'Any changes since admission',
            },
          ],
        },
        {
          id: 'background_section',
          label: 'Background',
          fields: [
            {
              id: 'relevant_history',
              label: 'Relevant Medical History',
              type: 'textarea',
              required: false,
              placeholder: 'Co-morbidities, allergies, relevant past medical history',
            },
          ],
        },
        {
          id: 'assessment_section',
          label: 'Assessment',
          fields: [
            {
              id: 'current_assessment',
              label: 'Current Assessment',
              type: 'textarea',
              required: true,
              placeholder: 'Your assessment of patient condition',
            },
          ],
        },
        {
          id: 'recommendation_section',
          label: 'Recommendation',
          fields: [
            {
              id: 'key_actions',
              label: 'Key Actions for Next Shift',
              type: 'textarea',
              required: true,
              placeholder: 'Priorities and action items for incoming shift',
            },
            {
              id: 'critical_alerts',
              label: 'Critical Alerts',
              type: 'textarea',
              required: false,
              placeholder: 'Any critical information incoming shift must know',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 7. /escalate — Escalation Report
    {
      hospital_id: 'EHRC',
      name: 'Escalation Report',
      slug: 'escalation_report_form',
      description: 'Report clinical or operational escalation',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: false,
      applicable_roles: ['nurse', 'senior_nurse', 'charge_nurse', 'nursing_supervisor', 'resident', 'senior_resident'],
      slash_command: '/escalate',
      slash_role_action_map: {
        nurse: { action: 'Escalate' },
        senior_nurse: { action: 'Escalate' },
        charge_nurse: { action: 'Escalate' },
        nursing_supervisor: { action: 'Escalate' },
        resident: { action: 'Escalate' },
        senior_resident: { action: 'Escalate' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'incidentReporting.reportIncident',
      sections: [
        {
          id: 'incident_section',
          label: 'Incident Details',
          fields: [
            {
              id: 'incident_type',
              label: 'Incident Type',
              type: 'dropdown',
              required: true,
              options: ['patient_safety', 'clinical_deterioration', 'equipment_failure', 'staffing_issue', 'infection_control', 'other'],
            },
            {
              id: 'severity',
              label: 'Severity',
              type: 'traffic_light',
              required: true,
            },
            {
              id: 'description',
              label: 'Description',
              type: 'textarea',
              required: true,
              placeholder: 'What happened and why is escalation needed?',
            },
          ],
        },
        {
          id: 'escalation_section',
          label: 'Escalation',
          fields: [
            {
              id: 'escalate_to',
              label: 'Escalate To',
              type: 'person_picker',
              required: true,
              placeholder: 'Select supervisor/manager',
            },
            {
              id: 'immediate_action_required',
              label: 'Immediate Action Required',
              type: 'toggle',
              required: true,
              default_value: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 8. /discharge — Discharge (Doctor), Discharge Checklist (Nurse), Final Settlement (Billing)
    {
      hospital_id: 'EHRC',
      name: 'Discharge',
      slug: 'discharge_form',
      description: 'Process patient discharge',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant', 'nurse', 'senior_nurse', 'billing_manager', 'billing_executive'],
      applicable_encounter_types: ['ipd', 'day_care'],
      slash_command: '/discharge',
      slash_role_action_map: {
        resident: { action: 'Discharge' },
        senior_resident: { action: 'Discharge' },
        hospitalist: { action: 'Discharge' },
        visiting_consultant: { action: 'Discharge' },
        nurse: { action: 'Discharge' },
        senior_nurse: { action: 'Discharge' },
        billing_manager: { action: 'Settlement' },
        billing_executive: { action: 'Settlement' },
      },
      layout: 'wizard',
      submission_target: 'clinical_template',
      template_slug: 'discharge-summary',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'discharge_summary_section',
          label: 'Discharge Summary',
          fields: [
            {
              id: 'admission_diagnosis',
              label: 'Admission Diagnosis',
              type: 'text',
              required: true,
            },
            {
              id: 'final_diagnosis',
              label: 'Final Diagnosis',
              type: 'textarea',
              required: true,
            },
            {
              id: 'treatment_summary',
              label: 'Treatment Summary',
              type: 'textarea',
              required: true,
              placeholder: 'Procedures, surgeries, medications during stay',
            },
          ],
        },
        {
          id: 'discharge_medications_section',
          label: 'Discharge Medications',
          fields: [
            {
              id: 'discharge_medications',
              label: 'Medications at Discharge',
              type: 'repeater',
              required: false,
            },
          ],
        },
        {
          id: 'followup_section',
          label: 'Follow-up',
          fields: [
            {
              id: 'followup_instructions',
              label: 'Follow-up Instructions',
              type: 'textarea',
              required: true,
              placeholder: 'Activity restrictions, diet, return precautions',
            },
            {
              id: 'followup_appointment',
              label: 'Follow-up Appointment',
              type: 'date',
              required: false,
            },
          ],
        },
        {
          id: 'discharge_ready_section',
          label: 'Discharge Readiness',
          fields: [
            {
              id: 'nursing_checklist_complete',
              label: 'Nursing Discharge Checklist Complete',
              type: 'toggle',
              required: true,
            },
            {
              id: 'patient_educated',
              label: 'Patient Educated on Post-Discharge Care',
              type: 'toggle',
              required: true,
            },
            {
              id: 'valuables_collected',
              label: 'Valuables Collected',
              type: 'toggle',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 9. /billing — Add Charge (Billing)
    {
      hospital_id: 'EHRC',
      name: 'Add Charge',
      slug: 'add_charge_form',
      description: 'Add billable item to patient account',
      category: 'administrative',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['billing_manager', 'billing_executive', 'nursing_supervisor'],
      applicable_encounter_types: ['ipd', 'opd', 'emergency', 'day_care'],
      slash_command: '/billing',
      slash_role_action_map: {
        billing_manager: { action: 'Add Charge' },
        billing_executive: { action: 'Add Charge' },
        nursing_supervisor: { action: 'Add Charge' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'billing.addLineItem',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'charge_section',
          label: 'Charge Item',
          fields: [
            {
              id: 'charge_type',
              label: 'Charge Type',
              type: 'dropdown',
              required: true,
              options: ['procedure', 'consultation', 'investigation', 'medication', 'room_charge', 'supplies', 'special_service'],
            },
            {
              id: 'item_code',
              label: 'Item Code',
              type: 'text',
              required: true,
              placeholder: 'Charge master code',
            },
            {
              id: 'item_description',
              label: 'Description',
              type: 'text',
              required: true,
            },
          ],
        },
        {
          id: 'amount_section',
          label: 'Amount',
          fields: [
            {
              id: 'quantity',
              label: 'Quantity',
              type: 'number',
              required: true,
              placeholder: '1',
              validation: { min: 0 },
            },
            {
              id: 'unit_price',
              label: 'Unit Price',
              type: 'currency',
              required: true,
              placeholder: 'Rupees',
            },
            {
              id: 'total_amount',
              label: 'Total Amount',
              type: 'computed',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 10. /transfer — Initiate Transfer (Doctor), Transfer Checklist (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Initiate Transfer',
      slug: 'transfer_form',
      description: 'Initiate bed transfer or facility transfer',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'nurse', 'senior_nurse', 'charge_nurse', 'ipd_coordinator'],
      applicable_encounter_types: ['ipd'],
      slash_command: '/transfer',
      slash_role_action_map: {
        resident: { action: 'Transfer' },
        senior_resident: { action: 'Transfer' },
        hospitalist: { action: 'Transfer' },
        nurse: { action: 'Transfer' },
        senior_nurse: { action: 'Transfer' },
        charge_nurse: { action: 'Transfer' },
        ipd_coordinator: { action: 'Transfer' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'transfer_section',
          label: 'Transfer Details',
          fields: [
            {
              id: 'transfer_type',
              label: 'Transfer Type',
              type: 'dropdown',
              required: true,
              options: ['bed_transfer', 'ward_transfer', 'facility_transfer', 'icu_admission'],
            },
            {
              id: 'destination',
              label: 'Destination',
              type: 'text',
              required: true,
              placeholder: 'Destination ward/facility',
            },
            {
              id: 'transfer_reason',
              label: 'Reason for Transfer',
              type: 'textarea',
              required: true,
            },
          ],
        },
        {
          id: 'readiness_section',
          label: 'Readiness for Transfer',
          fields: [
            {
              id: 'patient_stable',
              label: 'Patient Stable for Transfer',
              type: 'toggle',
              required: true,
            },
            {
              id: 'monitoring_required',
              label: 'Continuous Monitoring Required',
              type: 'toggle',
              required: false,
              default_value: false,
            },
            {
              id: 'special_equipment',
              label: 'Special Equipment/Supplies Needed',
              type: 'textarea',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 11. /fc — Financial Counselling
    {
      hospital_id: 'EHRC',
      name: 'Financial Counselling',
      slug: 'financial_counselling_form',
      description: 'Conduct financial counselling and estimate hospital costs',
      category: 'administrative',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['customer_care', 'billing_manager', 'billing_executive', 'insurance_coordinator'],
      applicable_encounter_types: ['ipd', 'opd', 'emergency'],
      slash_command: '/fc',
      slash_role_action_map: {
        customer_care: { action: 'Counsell' },
        billing_manager: { action: 'Counsell' },
        billing_executive: { action: 'Counsell' },
        insurance_coordinator: { action: 'Counsell' },
      },
      layout: 'wizard',
      submission_target: 'form_submissions',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient Information',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
            {
              id: 'contact_number',
              label: 'Contact Number',
              type: 'text',
              required: true,
              placeholder: '+91-XXXXXXXXXX',
            },
          ],
        },
        {
          id: 'clinical_section',
          label: 'Clinical Details',
          fields: [
            {
              id: 'primary_diagnosis',
              label: 'Primary Diagnosis',
              type: 'icd_picker',
              required: true,
            },
            {
              id: 'planned_procedures',
              label: 'Planned Procedures',
              type: 'multi_select',
              required: false,
            },
            {
              id: 'estimated_los',
              label: 'Estimated Length of Stay (days)',
              type: 'number',
              required: true,
              placeholder: '5',
            },
          ],
        },
        {
          id: 'payment_section',
          label: 'Payment Profile',
          fields: [
            {
              id: 'payment_mode',
              label: 'Payment Mode',
              type: 'dropdown',
              required: true,
              options: ['self_pay', 'insurance', 'employer', 'government', 'ngo', 'mixed'],
            },
            {
              id: 'savings_capacity',
              label: 'Financial Capacity',
              type: 'radio',
              required: true,
              options: ['high', 'medium', 'low', 'very_low'],
            },
          ],
        },
        {
          id: 'insurance_section',
          label: 'Insurance Details',
          fields: [
            {
              id: 'has_insurance',
              label: 'Has Health Insurance',
              type: 'toggle',
              required: true,
            },
            {
              id: 'insurance_provider',
              label: 'Insurance Provider',
              type: 'text',
              required: false,
              placeholder: 'Insurance company name',
              conditions: [{ field: 'has_insurance', operator: 'equals', value: true }],
            },
            {
              id: 'policy_number',
              label: 'Policy Number',
              type: 'text',
              required: false,
              conditions: [{ field: 'has_insurance', operator: 'equals', value: true }],
            },
          ],
        },
        {
          id: 'cost_section',
          label: 'Cost Estimation',
          fields: [
            {
              id: 'room_rent',
              label: 'Room Rent (per day)',
              type: 'currency',
              required: true,
            },
            {
              id: 'estimated_procedures_cost',
              label: 'Estimated Procedure Cost',
              type: 'currency',
              required: false,
            },
            {
              id: 'estimated_investigations_cost',
              label: 'Estimated Investigation Cost',
              type: 'currency',
              required: false,
            },
            {
              id: 'estimated_total',
              label: 'Estimated Total Cost',
              type: 'computed',
              required: false,
            },
          ],
        },
        {
          id: 'counselling_section',
          label: 'Counselling Notes',
          fields: [
            {
              id: 'discussed_items',
              label: 'Items Discussed',
              type: 'textarea',
              required: true,
              placeholder: 'What was discussed with patient/family',
            },
            {
              id: 'patient_concerns',
              label: 'Patient/Family Concerns',
              type: 'textarea',
              required: false,
            },
            {
              id: 'agreed_payment_plan',
              label: 'Agreed Payment Plan',
              type: 'textarea',
              required: false,
            },
          ],
        },
        {
          id: 'signoff_section',
          label: 'Counsellor Sign-off',
          fields: [
            {
              id: 'counsellor_name',
              label: 'Counsellor Name',
              type: 'text',
              required: true,
            },
            {
              id: 'counsellor_signature',
              label: 'Signature',
              type: 'signature',
              required: true,
            },
            {
              id: 'patient_acknowledgement',
              label: 'Patient/Family Acknowledged Information',
              type: 'toggle',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 12. /incident — Incident Report
    {
      hospital_id: 'EHRC',
      name: 'Incident Report',
      slug: 'incident_report_form',
      description: 'Report adverse events and incidents',
      category: 'administrative',
      version: 1,
      status: 'active',
      requires_patient: false,
      applicable_roles: ['nurse', 'senior_nurse', 'charge_nurse', 'resident', 'senior_resident', 'hospitalist'],
      slash_command: '/incident',
      slash_role_action_map: {
        nurse: { action: 'Report' },
        senior_nurse: { action: 'Report' },
        charge_nurse: { action: 'Report' },
        resident: { action: 'Report' },
        senior_resident: { action: 'Report' },
        hospitalist: { action: 'Report' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      submit_endpoint: 'incidentReporting.reportIncident',
      sections: [
        {
          id: 'incident_info_section',
          label: 'Incident Information',
          fields: [
            {
              id: 'incident_date',
              label: 'Date & Time of Incident',
              type: 'date',
              required: true,
            },
            {
              id: 'incident_time',
              label: 'Time',
              type: 'time',
              required: true,
            },
            {
              id: 'incident_type',
              label: 'Type of Incident',
              type: 'dropdown',
              required: true,
              options: ['fall', 'medication_error', 'infection', 'equipment_malfunction', 'patient_safety', 'staff_injury', 'other'],
            },
            {
              id: 'location',
              label: 'Location',
              type: 'text',
              required: true,
              placeholder: 'Ward, room, or area',
            },
          ],
        },
        {
          id: 'description_section',
          label: 'Incident Description',
          fields: [
            {
              id: 'what_happened',
              label: 'What Happened',
              type: 'textarea',
              required: true,
              placeholder: 'Detailed description of incident',
            },
            {
              id: 'contributing_factors',
              label: 'Contributing Factors',
              type: 'textarea',
              required: false,
            },
          ],
        },
        {
          id: 'outcome_section',
          label: 'Outcome',
          fields: [
            {
              id: 'severity',
              label: 'Severity',
              type: 'traffic_light',
              required: true,
            },
            {
              id: 'immediate_actions_taken',
              label: 'Immediate Actions Taken',
              type: 'textarea',
              required: true,
            },
          ],
        },
        {
          id: 'reporter_section',
          label: 'Reporter',
          fields: [
            {
              id: 'reporter_name',
              label: 'Reporter Name',
              type: 'text',
              required: true,
            },
            {
              id: 'department',
              label: 'Department',
              type: 'text',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 13. /consent — Procedure Consent (Doctor), Consent Witness (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Informed Consent',
      slug: 'informed_consent_form',
      description: 'Document informed consent for procedures',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'visiting_consultant', 'surgeon', 'nurse', 'senior_nurse'],
      applicable_encounter_types: ['ipd', 'opd', 'day_care'],
      slash_command: '/consent',
      slash_role_action_map: {
        resident: { action: 'Consent' },
        senior_resident: { action: 'Consent' },
        hospitalist: { action: 'Consent' },
        visiting_consultant: { action: 'Consent' },
        surgeon: { action: 'Consent' },
        nurse: { action: 'Witness' },
        senior_nurse: { action: 'Witness' },
      },
      layout: 'scroll',
      submission_target: 'clinical_template',
      template_slug: 'procedure-consent',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'procedure_section',
          label: 'Procedure Details',
          fields: [
            {
              id: 'procedure_name',
              label: 'Procedure Name',
              type: 'procedure_picker',
              required: true,
            },
            {
              id: 'procedure_indication',
              label: 'Indication',
              type: 'textarea',
              required: true,
              placeholder: 'Why this procedure is needed',
            },
            {
              id: 'risks_discussed',
              label: 'Risks Discussed',
              type: 'textarea',
              required: true,
              placeholder: 'Risks and complications discussed with patient',
            },
            {
              id: 'benefits_discussed',
              label: 'Benefits Discussed',
              type: 'textarea',
              required: true,
              placeholder: 'Expected benefits',
            },
            {
              id: 'alternatives_discussed',
              label: 'Alternatives Discussed',
              type: 'textarea',
              required: false,
              placeholder: 'Alternative treatments if any',
            },
          ],
        },
        {
          id: 'consent_section',
          label: 'Consent',
          fields: [
            {
              id: 'patient_understands',
              label: 'Patient Confirms Understanding',
              type: 'toggle',
              required: true,
            },
            {
              id: 'patient_agrees',
              label: 'Patient Consents to Procedure',
              type: 'toggle',
              required: true,
            },
            {
              id: 'patient_signature',
              label: 'Patient Signature',
              type: 'signature',
              required: true,
            },
          ],
        },
        {
          id: 'witness_section',
          label: 'Witness',
          fields: [
            {
              id: 'witness_name',
              label: 'Witness Name',
              type: 'text',
              required: true,
            },
            {
              id: 'witness_signature',
              label: 'Witness Signature',
              type: 'signature',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 14. /diet — Order Diet (Doctor), Update Diet (Nurse)
    {
      hospital_id: 'EHRC',
      name: 'Diet Order',
      slug: 'diet_order_form',
      description: 'Create or update patient diet prescription',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['resident', 'senior_resident', 'hospitalist', 'nurse', 'senior_nurse', 'dietary_staff'],
      applicable_encounter_types: ['ipd', 'day_care'],
      slash_command: '/diet',
      slash_role_action_map: {
        resident: { action: 'Order Diet' },
        senior_resident: { action: 'Order Diet' },
        hospitalist: { action: 'Order Diet' },
        nurse: { action: 'Update Diet' },
        senior_nurse: { action: 'Update Diet' },
        dietary_staff: { action: 'Prepare' },
      },
      layout: 'auto',
      submission_target: 'his_router',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'diet_section',
          label: 'Diet Prescription',
          fields: [
            {
              id: 'diet_type',
              label: 'Diet Type',
              type: 'dropdown',
              required: true,
              options: ['regular', 'soft', 'liquid', 'clear_liquid', 'diabetic', 'renal', 'cardiac', 'low_sodium', 'gluten_free', 'high_protein', 'low_fat'],
            },
            {
              id: 'calories_per_day',
              label: 'Calories per Day',
              type: 'number',
              required: false,
              placeholder: '2000',
            },
            {
              id: 'protein_grams',
              label: 'Protein (g)',
              type: 'number',
              required: false,
              placeholder: '60',
            },
          ],
        },
        {
          id: 'restrictions_section',
          label: 'Restrictions & Allergies',
          fields: [
            {
              id: 'food_allergies',
              label: 'Food Allergies',
              type: 'multi_select',
              required: false,
              options: ['peanuts', 'shellfish', 'dairy', 'gluten', 'eggs', 'tree_nuts', 'fish', 'soy'],
            },
            {
              id: 'food_restrictions',
              label: 'Food Restrictions (Religious/Cultural)',
              type: 'textarea',
              required: false,
            },
          ],
        },
        {
          id: 'preferences_section',
          label: 'Preferences',
          fields: [
            {
              id: 'meal_preferences',
              label: 'Meal Preferences',
              type: 'textarea',
              required: false,
              placeholder: 'Patient preferences, likes/dislikes',
            },
            {
              id: 'npo_status',
              label: 'NPO (Nothing by Mouth)',
              type: 'toggle',
              required: false,
              default_value: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // 15. /alert — Raise Clinical Alert (Nurse), Acknowledge Alert (Doctor)
    {
      hospital_id: 'EHRC',
      name: 'Clinical Alert',
      slug: 'clinical_alert_form',
      description: 'Raise clinical alert for physician review',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['nurse', 'senior_nurse', 'charge_nurse', 'resident', 'senior_resident', 'hospitalist'],
      applicable_encounter_types: ['ipd', 'emergency'],
      slash_command: '/alert',
      slash_role_action_map: {
        nurse: { action: 'Raise Alert' },
        senior_nurse: { action: 'Raise Alert' },
        charge_nurse: { action: 'Raise Alert' },
        resident: { action: 'Acknowledge' },
        senior_resident: { action: 'Acknowledge' },
        hospitalist: { action: 'Acknowledge' },
      },
      layout: 'auto',
      submission_target: 'form_submissions',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'alert_section',
          label: 'Alert Details',
          fields: [
            {
              id: 'alert_type',
              label: 'Alert Type',
              type: 'dropdown',
              required: true,
              options: ['abnormal_vitals', 'lab_critical', 'allergy', 'sepsis_risk', 'fall_risk', 'medication_concern', 'other'],
            },
            {
              id: 'severity',
              label: 'Severity',
              type: 'traffic_light',
              required: true,
            },
            {
              id: 'alert_message',
              label: 'Alert Message',
              type: 'textarea',
              required: true,
              placeholder: 'Detailed clinical concern',
            },
            {
              id: 'data_supporting_alert',
              label: 'Supporting Data',
              type: 'textarea',
              required: true,
              placeholder: 'Lab values, vitals, findings',
            },
          ],
        },
        {
          id: 'action_section',
          label: 'Recommended Action',
          fields: [
            {
              id: 'recommended_action',
              label: 'Recommended Action',
              type: 'textarea',
              required: true,
              placeholder: 'Suggest what should be done',
            },
            {
              id: 'alert_to',
              label: 'Alert Assigned To',
              type: 'person_picker',
              required: true,
              placeholder: 'Select responsible physician',
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // ========================================================================
    // SECTION B: ROUNDS-PORTED FORMS (13 forms)
    // ========================================================================

    // B1. Marketing CC Handoff
    {
      hospital_id: 'EHRC',
      name: 'Marketing to Clinical Handoff',
      slug: 'marketing_cc_handoff',
      description: 'Marketing team handoff to Clinical Coordinator',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['marketing', 'ipd_coordinator'],
      applicable_encounter_types: ['ipd', 'opd', 'emergency'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient Information',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'lead_details_section',
          label: 'Lead Details',
          fields: [
            {
              id: 'source_of_referral',
              label: 'Source of Referral',
              type: 'dropdown',
              required: true,
              options: ['referral_doctor', 'existing_patient', 'web', 'social_media', 'phone', 'direct_walk_in', 'other'],
            },
            {
              id: 'referral_doctor',
              label: 'Referral Doctor (if applicable)',
              type: 'text',
              required: false,
            },
          ],
        },
        {
          id: 'requirements_section',
          label: 'Clinical Requirements',
          fields: [
            {
              id: 'chief_complaint',
              label: 'Chief Complaint',
              type: 'text',
              required: true,
            },
            {
              id: 'preliminary_diagnosis',
              label: 'Preliminary Diagnosis',
              type: 'text',
              required: false,
            },
            {
              id: 'urgency',
              label: 'Urgency',
              type: 'radio',
              required: true,
              options: ['routine', 'urgent', 'emergency'],
            },
          ],
        },
        {
          id: 'handoff_section',
          label: 'Handoff Notes',
          fields: [
            {
              id: 'handoff_notes',
              label: 'Key Information for CC',
              type: 'textarea',
              required: true,
              placeholder: 'Patient expectations, special needs, VIP status if any',
            },
            {
              id: 'preferred_floor',
              label: 'Preferred Floor/Ward',
              type: 'text',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B2. Pre-Admission Patient Education
    {
      hospital_id: 'EHRC',
      name: 'Pre-Admission Patient Education',
      slug: 'admission_advice',
      description: 'Pre-admission counselling and patient education',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['customer_care', 'ipd_coordinator', 'front_office'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'education_section',
          label: 'Pre-Admission Education',
          fields: [
            {
              id: 'admitted_for',
              label: 'Reason for Admission',
              type: 'text',
              required: true,
            },
            {
              id: 'expected_los',
              label: 'Expected Length of Stay',
              type: 'text',
              required: true,
              placeholder: '3-5 days',
            },
            {
              id: 'pre_admission_investigations',
              label: 'Pre-Admission Investigations Required',
              type: 'toggle',
              required: true,
            },
            {
              id: 'investigations_list',
              label: 'List of Investigations',
              type: 'textarea',
              required: false,
              conditions: [{ field: 'pre_admission_investigations', operator: 'equals', value: true }],
            },
          ],
        },
        {
          id: 'checklist_section',
          label: 'Pre-Admission Checklist',
          fields: [
            {
              id: 'documents_required',
              label: 'Documents Required',
              type: 'multi_select',
              required: true,
              options: ['id_proof', 'insurance_card', 'previous_records', 'discharge_summary', 'imaging_reports'],
            },
            {
              id: 'what_to_bring',
              label: 'What to Bring',
              type: 'textarea',
              required: true,
              placeholder: 'Personal items, comfort items, medications',
            },
            {
              id: 'nil_by_mouth',
              label: 'Nil by Mouth Instructions Given',
              type: 'toggle',
              required: false,
              default_value: false,
            },
          ],
        },
        {
          id: 'contact_section',
          label: 'Contact Information',
          fields: [
            {
              id: 'emergency_contact',
              label: 'Emergency Contact Number',
              type: 'text',
              required: true,
              placeholder: '+91-XXXXXXXXXX',
            },
            {
              id: 'hospital_contact',
              label: 'Hospital Contact Given',
              type: 'toggle',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B3. OT Billing Clearance
    {
      hospital_id: 'EHRC',
      name: 'OT Billing Clearance',
      slug: 'ot_billing_clearance',
      description: 'Pre-operative billing clearance',
      category: 'administrative',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['ot_coordinator', 'billing_manager', 'billing_executive'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'procedure_section',
          label: 'Procedure Details',
          fields: [
            {
              id: 'scheduled_procedure',
              label: 'Scheduled Procedure',
              type: 'text',
              required: true,
            },
            {
              id: 'ot_date',
              label: 'OT Date & Time',
              type: 'date',
              required: true,
            },
          ],
        },
        {
          id: 'billing_section',
          label: 'Billing Status',
          fields: [
            {
              id: 'deposit_status',
              label: 'Deposit Status',
              type: 'dropdown',
              required: true,
              options: ['confirmed', 'pending', 'partial', 'waived'],
            },
            {
              id: 'deposit_amount',
              label: 'Deposit Amount',
              type: 'currency',
              required: false,
            },
            {
              id: 'insurance_pre_auth',
              label: 'Insurance Pre-auth Confirmed',
              type: 'toggle',
              required: false,
            },
            {
              id: 'billing_approved',
              label: 'Billing Approved for OT',
              type: 'toggle',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B4. Hospital Admission Checklist
    {
      hospital_id: 'EHRC',
      name: 'Admission Checklist',
      slug: 'admission_checklist',
      description: 'Comprehensive admission checklist',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['ipd_coordinator', 'front_office', 'nurse', 'senior_nurse'],
      applicable_encounter_types: ['ipd', 'emergency'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'documentation_section',
          label: 'Documentation',
          fields: [
            {
              id: 'id_verified',
              label: 'ID Verified',
              type: 'toggle',
              required: true,
            },
            {
              id: 'insurance_verified',
              label: 'Insurance Card Verified',
              type: 'toggle',
              required: false,
            },
            {
              id: 'consent_forms_signed',
              label: 'Consent Forms Signed',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'orientation_section',
          label: 'Patient Orientation',
          fields: [
            {
              id: 'room_orientation_done',
              label: 'Room Orientation Done',
              type: 'toggle',
              required: true,
            },
            {
              id: 'call_bell_explained',
              label: 'Call Bell Explained',
              type: 'toggle',
              required: true,
            },
            {
              id: 'facilities_explained',
              label: 'Facilities Explained (TV, AC, Bathroom)',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'nursing_section',
          label: 'Nursing Care',
          fields: [
            {
              id: 'baseline_vitals_recorded',
              label: 'Baseline Vitals Recorded',
              type: 'toggle',
              required: true,
            },
            {
              id: 'allergies_documented',
              label: 'Allergies Documented',
              type: 'toggle',
              required: true,
            },
            {
              id: 'medications_reconciled',
              label: 'Medications Reconciled',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'valuables_section',
          label: 'Valuables & Belongings',
          fields: [
            {
              id: 'valuables_secured',
              label: 'Valuables Secured',
              type: 'toggle',
              required: true,
            },
            {
              id: 'inventory_list',
              label: 'Belongings Inventory Completed',
              type: 'toggle',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B5. Pre-Op Nursing Checklist
    {
      hospital_id: 'EHRC',
      name: 'Pre-Op Nursing Checklist',
      slug: 'pre_op_nursing_checklist',
      description: 'Pre-operative nursing assessment and checklist',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['ot_nurse', 'ot_coordinator', 'senior_nurse', 'charge_nurse'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'preop_assessment_section',
          label: 'Pre-Op Assessment',
          fields: [
            {
              id: 'scheduled_surgery',
              label: 'Scheduled Surgery',
              type: 'text',
              required: true,
            },
            {
              id: 'surgery_time',
              label: 'Surgery Time',
              type: 'time',
              required: true,
            },
            {
              id: 'patient_fasting',
              label: 'Patient Fasting Status Confirmed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'nil_by_mouth_hours',
              label: 'Hours of Fasting',
              type: 'number',
              required: false,
              placeholder: '6',
            },
          ],
        },
        {
          id: 'premedication_section',
          label: 'Pre-Medication',
          fields: [
            {
              id: 'premedication_given',
              label: 'Pre-medication Given',
              type: 'toggle',
              required: true,
            },
            {
              id: 'premedication_time',
              label: 'Time Given',
              type: 'time',
              required: false,
              conditions: [{ field: 'premedication_given', operator: 'equals', value: true }],
            },
          ],
        },
        {
          id: 'preparations_section',
          label: 'Physical Preparations',
          fields: [
            {
              id: 'jewelry_removed',
              label: 'Jewelry/Accessories Removed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'dentures_removed',
              label: 'Dentures/Prosthetics Removed',
              type: 'toggle',
              required: false,
            },
            {
              id: 'makeup_removed',
              label: 'Makeup/Nail Polish Removed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'urinary_catheter',
              label: 'Urinary Catheter Placed',
              type: 'toggle',
              required: false,
            },
            {
              id: 'preop_shave_done',
              label: 'Pre-op Shave Done',
              type: 'toggle',
              required: false,
            },
          ],
        },
        {
          id: 'documents_section',
          label: 'Documentation',
          fields: [
            {
              id: 'consent_signed',
              label: 'Informed Consent Signed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'chart_with_patient',
              label: 'Complete Chart with Patient',
              type: 'toggle',
              required: true,
            },
            {
              id: 'lab_reports_available',
              label: 'Lab Reports Available',
              type: 'toggle',
              required: true,
            },
            {
              id: 'imaging_reports_available',
              label: 'Imaging Reports Available',
              type: 'toggle',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B6. WHO Safety Checklist
    {
      hospital_id: 'EHRC',
      name: 'WHO Surgical Safety Checklist',
      slug: 'who_safety_checklist',
      description: 'WHO Surgical Safety Checklist (sign-in, time-out, sign-out)',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['ot_nurse', 'ot_coordinator', 'surgeon', 'anaesthetist'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'signin_section',
          label: 'Sign In (Before Anesthesia)',
          fields: [
            {
              id: 'patient_identity_confirmed',
              label: 'Patient Identity Confirmed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'site_marking_done',
              label: 'Site Marking Done',
              type: 'toggle',
              required: true,
            },
            {
              id: 'consent_available',
              label: 'Consent Available',
              type: 'toggle',
              required: true,
            },
            {
              id: 'anesthesia_checked',
              label: 'Anesthesia Machine & Meds Checked',
              type: 'toggle',
              required: true,
            },
            {
              id: 'pulse_oximeter_applied',
              label: 'Pulse Oximeter Applied',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'timeout_section',
          label: 'Time Out (Before Incision)',
          fields: [
            {
              id: 'team_introductions',
              label: 'Team Introductions Done',
              type: 'toggle',
              required: true,
            },
            {
              id: 'procedure_confirmed',
              label: 'Patient Name, Procedure & Site Confirmed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'relevant_imaging_displayed',
              label: 'Relevant Imaging Displayed',
              type: 'toggle',
              required: false,
            },
            {
              id: 'antibiotics_administered',
              label: 'Antibiotic Prophylaxis Given',
              type: 'toggle',
              required: true,
            },
            {
              id: 'vte_prophylaxis',
              label: 'VTE Prophylaxis Confirmed',
              type: 'toggle',
              required: false,
            },
          ],
        },
        {
          id: 'signout_section',
          label: 'Sign Out (Before Patient Leaves OT)',
          fields: [
            {
              id: 'procedure_name_recorded',
              label: 'Procedure Name Recorded',
              type: 'toggle',
              required: true,
            },
            {
              id: 'swab_count_correct',
              label: 'Swab Count Correct',
              type: 'toggle',
              required: true,
            },
            {
              id: 'instrument_count_correct',
              label: 'Instrument Count Correct',
              type: 'toggle',
              required: true,
            },
            {
              id: 'needle_count_correct',
              label: 'Needle Count Correct',
              type: 'toggle',
              required: true,
            },
            {
              id: 'specimen_labeled',
              label: 'All Specimens Labeled',
              type: 'toggle',
              required: false,
            },
            {
              id: 'equipment_issues',
              label: 'Equipment Issues Reported',
              type: 'toggle',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B7. Pre-Anesthesia Clearance
    {
      hospital_id: 'EHRC',
      name: 'Pre-Anesthesia Clearance',
      slug: 'pac_clearance',
      description: 'Pre-anesthesia assessment and clearance',
      category: 'clinical',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['anaesthetist', 'senior_resident', 'resident'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'medical_history_section',
          label: 'Medical History',
          fields: [
            {
              id: 'relevant_diseases',
              label: 'Relevant Diseases',
              type: 'textarea',
              required: true,
              placeholder: 'HTN, DM, CAD, asthma, etc.',
            },
            {
              id: 'previous_anesthesia',
              label: 'Previous Anesthesia Experience',
              type: 'textarea',
              required: false,
              placeholder: 'Any complications or reactions',
            },
            {
              id: 'allergies',
              label: 'Drug Allergies',
              type: 'textarea',
              required: false,
            },
          ],
        },
        {
          id: 'airway_section',
          label: 'Airway Assessment',
          fields: [
            {
              id: 'mouth_opening',
              label: 'Mouth Opening (cm)',
              type: 'number',
              required: true,
              placeholder: '4',
              validation: { min: 1, max: 8 },
            },
            {
              id: 'dentition',
              label: 'Dentition',
              type: 'dropdown',
              required: true,
              options: ['normal', 'poor', 'dentures', 'missing_teeth'],
            },
            {
              id: 'mallampati_grade',
              label: 'Mallampati Grade',
              type: 'dropdown',
              required: true,
              options: ['i', 'ii', 'iii', 'iv'],
            },
            {
              id: 'thyromental_distance',
              label: 'Thyromental Distance (cm)',
              type: 'number',
              required: true,
              placeholder: '6',
            },
          ],
        },
        {
          id: 'asa_section',
          label: 'ASA Classification',
          fields: [
            {
              id: 'asa_class',
              label: 'ASA Class',
              type: 'radio',
              required: true,
              options: ['i', 'ii', 'iii', 'iv', 'v'],
            },
          ],
        },
        {
          id: 'vitals_section',
          label: 'Vital Signs',
          fields: [
            {
              id: 'preop_vitals',
              label: 'Pre-op Vitals',
              type: 'vitals_grid',
              required: true,
            },
          ],
        },
        {
          id: 'clearance_section',
          label: 'Clearance',
          fields: [
            {
              id: 'anesthesia_clearance',
              label: 'Anesthesia Clearance',
              type: 'toggle',
              required: true,
            },
            {
              id: 'conditions_for_clearance',
              label: 'Conditions/Precautions if Any',
              type: 'textarea',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B8. Discharge Readiness
    {
      hospital_id: 'EHRC',
      name: 'Discharge Readiness',
      slug: 'discharge_readiness',
      description: 'Assess patient readiness for discharge',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['nurse', 'senior_nurse', 'charge_nurse', 'resident', 'senior_resident', 'hospitalist'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'clinical_section',
          label: 'Clinical Readiness',
          fields: [
            {
              id: 'vital_signs_stable',
              label: 'Vital Signs Stable',
              type: 'toggle',
              required: true,
            },
            {
              id: 'temperature_normal',
              label: 'Temperature Normal (Afebrile)',
              type: 'toggle',
              required: true,
            },
            {
              id: 'pain_controlled',
              label: 'Pain Controlled',
              type: 'toggle',
              required: true,
            },
            {
              id: 'no_active_bleeding',
              label: 'No Active Bleeding/Wound Issues',
              type: 'toggle',
              required: true,
            },
            {
              id: 'mobility_adequate',
              label: 'Mobility Adequate',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'functional_section',
          label: 'Functional Status',
          fields: [
            {
              id: 'eating_drinking',
              label: 'Tolerating Oral Intake',
              type: 'toggle',
              required: true,
            },
            {
              id: 'bowel_movement',
              label: 'Bowel Movement Passed',
              type: 'toggle',
              required: false,
            },
            {
              id: 'urination_normal',
              label: 'Urination Normal',
              type: 'toggle',
              required: true,
            },
            {
              id: 'can_perform_adl',
              label: 'Can Perform ADL Independently',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'social_section',
          label: 'Social/Support',
          fields: [
            {
              id: 'has_caregiver',
              label: 'Has Caregiver at Home',
              type: 'toggle',
              required: true,
            },
            {
              id: 'understands_instructions',
              label: 'Patient Understands Discharge Instructions',
              type: 'toggle',
              required: true,
            },
            {
              id: 'has_medications',
              label: 'Has Discharge Medications',
              type: 'toggle',
              required: true,
            },
          ],
        },
        {
          id: 'discharge_clearance_section',
          label: 'Discharge Clearance',
          fields: [
            {
              id: 'ready_for_discharge',
              label: 'Ready for Discharge',
              type: 'toggle',
              required: true,
            },
            {
              id: 'barriers_if_not_ready',
              label: 'Barriers to Discharge (if not ready)',
              type: 'textarea',
              required: false,
              conditions: [{ field: 'ready_for_discharge', operator: 'equals', value: false }],
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B9. Post-Discharge Follow-up
    {
      hospital_id: 'EHRC',
      name: 'Post-Discharge Follow-up',
      slug: 'post_discharge_followup',
      description: 'Post-discharge patient satisfaction and follow-up',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: true,
      applicable_roles: ['customer_care', 'front_office', 'nursing_supervisor'],
      applicable_encounter_types: ['ipd', 'day_care'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'patient_section',
          label: 'Patient',
          fields: [
            {
              id: 'patient_id',
              label: 'Patient',
              type: 'patient_data_auto',
              required: true,
            },
          ],
        },
        {
          id: 'status_section',
          label: 'Current Status',
          fields: [
            {
              id: 'recovery_status',
              label: 'Recovery Status',
              type: 'dropdown',
              required: true,
              options: ['excellent', 'good', 'fair', 'poor'],
            },
            {
              id: 'any_complications',
              label: 'Any Complications Since Discharge',
              type: 'toggle',
              required: true,
            },
            {
              id: 'complications_details',
              label: 'Details of Complications',
              type: 'textarea',
              required: false,
              conditions: [{ field: 'any_complications', operator: 'equals', value: true }],
            },
          ],
        },
        {
          id: 'adherence_section',
          label: 'Treatment Adherence',
          fields: [
            {
              id: 'taking_medications',
              label: 'Taking Medications as Prescribed',
              type: 'toggle',
              required: true,
            },
            {
              id: 'following_diet',
              label: 'Following Prescribed Diet',
              type: 'toggle',
              required: false,
            },
            {
              id: 'activity_restrictions',
              label: 'Following Activity Restrictions',
              type: 'toggle',
              required: false,
            },
          ],
        },
        {
          id: 'satisfaction_section',
          label: 'Satisfaction Ratings',
          fields: [
            {
              id: 'doctor_satisfaction',
              label: 'Doctor & Medical Care',
              type: 'rating',
              required: true,
              validation: { min: 1, max: 5 },
            },
            {
              id: 'nursing_satisfaction',
              label: 'Nursing Care',
              type: 'rating',
              required: true,
              validation: { min: 1, max: 5 },
            },
            {
              id: 'facility_satisfaction',
              label: 'Hospital Facilities',
              type: 'rating',
              required: true,
              validation: { min: 1, max: 5 },
            },
            {
              id: 'billing_transparency',
              label: 'Billing & Cost Transparency',
              type: 'rating',
              required: true,
              validation: { min: 1, max: 5 },
            },
          ],
        },
        {
          id: 'feedback_section',
          label: 'Feedback & Comments',
          fields: [
            {
              id: 'positive_feedback',
              label: 'What Went Well',
              type: 'textarea',
              required: false,
            },
            {
              id: 'areas_for_improvement',
              label: 'Areas for Improvement',
              type: 'textarea',
              required: false,
            },
            {
              id: 'would_recommend',
              label: 'Would Recommend Hospital',
              type: 'toggle',
              required: true,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B10. Daily Department Update
    {
      hospital_id: 'EHRC',
      name: 'Daily Department Update',
      slug: 'daily_department_update',
      description: 'Daily department KPI and operational update',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: false,
      applicable_roles: ['department_head', 'nursing_supervisor', 'nursing_manager', 'senior_resident'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'date_section',
          label: 'Date & Department',
          fields: [
            {
              id: 'report_date',
              label: 'Report Date',
              type: 'date',
              required: true,
            },
            {
              id: 'department',
              label: 'Department',
              type: 'dropdown',
              required: true,
              options: ['nursing', 'pharmacy', 'lab', 'radiology', 'ot', 'icu', 'medical', 'surgical', 'pediatrics', 'obstetrics'],
            },
          ],
        },
        {
          id: 'kpi_section',
          label: 'KPIs',
          fields: [
            {
              id: 'bed_occupancy',
              label: 'Bed Occupancy %',
              type: 'number',
              required: true,
              placeholder: '85',
              validation: { min: 0, max: 100 },
            },
            {
              id: 'patient_admissions',
              label: 'New Admissions Today',
              type: 'number',
              required: true,
              placeholder: '5',
              validation: { min: 0 },
            },
            {
              id: 'discharges',
              label: 'Discharges Today',
              type: 'number',
              required: true,
              placeholder: '3',
              validation: { min: 0 },
            },
          ],
        },
        {
          id: 'staffing_section',
          label: 'Staffing Status',
          fields: [
            {
              id: 'staff_strength',
              label: 'Actual Staff Strength (vs Required)',
              type: 'text',
              required: true,
              placeholder: '12/12, 8/8',
            },
            {
              id: 'absentees',
              label: 'Absentees',
              type: 'number',
              required: false,
              placeholder: '0',
            },
            {
              id: 'staffing_issues',
              label: 'Staffing Issues',
              type: 'toggle',
              required: false,
            },
          ],
        },
        {
          id: 'issues_section',
          label: 'Issues & Concerns',
          fields: [
            {
              id: 'critical_incidents',
              label: 'Any Critical Incidents',
              type: 'toggle',
              required: true,
            },
            {
              id: 'incidents_details',
              label: 'Details',
              type: 'textarea',
              required: false,
              conditions: [{ field: 'critical_incidents', operator: 'equals', value: true }],
            },
            {
              id: 'resource_issues',
              label: 'Resource/Equipment Issues',
              type: 'textarea',
              required: false,
              placeholder: 'Equipment breakdown, supply shortage',
            },
          ],
        },
        {
          id: 'summary_section',
          label: 'Summary & Priorities',
          fields: [
            {
              id: 'key_highlights',
              label: 'Key Highlights',
              type: 'textarea',
              required: false,
            },
            {
              id: 'next_day_priorities',
              label: 'Priorities for Next Day',
              type: 'textarea',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },

    // B11. Surgery Posting
    {
      hospital_id: 'EHRC',
      name: 'Surgery Posting',
      slug: 'surgery_posting',
      description: 'Daily surgery posting and schedule',
      category: 'operational',
      version: 1,
      status: 'active',
      requires_patient: false,
      applicable_roles: ['ot_coordinator', 'surgeon', 'ot_nurse'],
      layout: 'auto',
      submission_target: 'form_submissions',
      ported_from: 'rounds',
      sections: [
        {
          id: 'date_section',
          label: 'Date & OT',
          fields: [
            {
              id: 'surgery_date',
              label: 'Surgery Date',
              type: 'date',
              required: true,
            },
            {
              id: 'ot_number',
              label: 'OT Number',
              type: 'dropdown',
              required: true,
              options: ['ot_1', 'ot_2', 'ot_3', 'ot_4', 'ot_5'],
            },
            {
              id: 'start_time',
              label: 'Start Time',
              type: 'time',
              required: true,
            },
          ],
        },
        {
          id: 'surgeon_section',
          label: 'Surgeon Information',
          fields: [
            {
              id: 'surgeon_name',
              label: 'Surgeon Name',
              type: 'text',
              required: true,
            },
            {
              id: 'anesthetist',
              label: 'Anesthetist',
              type: 'person_picker',
              required: true,
            },
          ],
        },
        {
          id: 'patient_section',
          label: 'Patient Information',
          fields: [
            {
              id: 'patient_name',
              label: 'Patient Name',
              type: 'text',
              required: true,
            },
            {
              id: 'patient_mrn',
              label: 'MRN',
              type: 'text',
              required: true,
            },
            {
              id: 'patient_age',
              label: 'Age',
              type: 'number',
              required: true,
              validation: { min: 0, max: 120 },
            },
          ],
        },
        {
          id: 'procedure_section',
          label: 'Procedure Details',
          fields: [
            {
              id: 'procedure_name',
              label: 'Procedure Name',
              type: 'text',
              required: true,
            },
            {
              id: 'side',
              label: 'Side (if applicable)',
              type: 'dropdown',
              required: false,
              options: ['left', 'right', 'bilateral', 'na'],
            },
          ],
        },
        {
          id: 'team_section',
          label: 'Surgical Team',
          fields: [
            {
              id: 'scrub_nurse',
              label: 'Scrub Nurse',
              type: 'person_picker',
              required: true,
            },
            {
              id: 'assistant',
              label: 'Surgical Assistant',
              type: 'text',
              required: false,
            },
          ],
        },
        {
          id: 'equipment_section',
          label: 'Equipment & Special Requirements',
          fields: [
            {
              id: 'special_equipment',
              label: 'Special Equipment Needed',
              type: 'textarea',
              required: false,
              placeholder: 'Microscope, laparoscopy, etc.',
            },
            {
              id: 'blood_bank_alert',
              label: 'Blood Bank Alert Required',
              type: 'toggle',
              required: false,
            },
          ],
        },
      ],
      created_by: createdBy,
    },
  ];

  console.log(`Seeding ${forms.length} form definitions...`);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const form of forms) {
    try {
      const result = await sql`
        INSERT INTO form_definitions (
          hospital_id, name, slug, description, category, version, status,
          requires_patient, applicable_roles, applicable_encounter_types,
          role_field_visibility, slash_command, slash_role_action_map,
          layout, submission_target, submit_endpoint, template_slug,
          submit_transform, source_url, ported_from, sections, created_by
        ) VALUES (
          ${form.hospital_id},
          ${form.name},
          ${form.slug},
          ${form.description || null},
          ${form.category},
          ${form.version},
          ${form.status},
          ${form.requires_patient},
          ${JSON.stringify(form.applicable_roles)},
          ${JSON.stringify(form.applicable_encounter_types || [])},
          ${form.role_field_visibility ? JSON.stringify(form.role_field_visibility) : null},
          ${form.slash_command || null},
          ${form.slash_role_action_map ? JSON.stringify(form.slash_role_action_map) : null},
          ${form.layout},
          ${form.submission_target},
          ${form.submit_endpoint || null},
          ${form.template_slug || null},
          ${form.submit_transform || null},
          ${form.source_url || null},
          ${form.ported_from || null},
          ${JSON.stringify(form.sections)},
          ${form.created_by}
        )
        ON CONFLICT (hospital_id, slug, version) DO NOTHING
      `;

      if (result.count > 0) {
        insertedCount++;
        console.log(`   ✓ ${form.name} (${form.slug})`);
      } else {
        skippedCount++;
        console.log(`   ~ ${form.name} (already exists)`);
      }
    } catch (err) {
      console.error(`   ✗ ${form.name}: ${err.message}`);
    }
  }

  // Verify
  const [count] = await sql`
    SELECT COUNT(*) as count FROM form_definitions
    WHERE hospital_id = 'EHRC'
  `;

  console.log(`\n✅ Seed complete!`);
  console.log(`   Inserted: ${insertedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Total forms in database: ${count.count}`);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
