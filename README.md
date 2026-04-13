# Even OS — Unified Hospital Operating System

**Even OS** is a full-stack hospital operating system built to replace KareXpert across Even Healthcare hospitals. It covers 17 operational modules — from patient registration and clinical documentation through billing, pharmacy, lab, OT management, quality assurance, and executive dashboards — plus a planned AI intelligence layer (Module 18).

**Live:** https://even-os.vercel.app  
**Stack:** Next.js 14.2 · TypeScript · Tailwind CSS · tRPC · Drizzle ORM · Neon PostgreSQL  
**Deployment:** Vercel Pro (auto-deploy on push to `main`)

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm
- A Neon serverless PostgreSQL database

### Local Development

```bash
# Clone the repo
git clone https://github.com/vinaybhardwaj-commits/Even-OS.git
cd Even-OS

# Install dependencies
npm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env.local
# Edit .env.local with your Neon DATABASE_URL, JWT_SECRET, etc.

# Run migrations (creates all 170 tables)
# POST to each migration endpoint with x-admin-key header after starting the dev server

# Start development server
cd apps/web
npx next dev -p 3000
```

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string (with `?sslmode=require`) |
| `JWT_SECRET` | Secret for HS256 JWT signing |
| `ENCRYPTION_KEY` | 32-character key for field-level encryption |
| `ADMIN_KEY` | Admin API key for migrations and background jobs |
| `NEXT_PUBLIC_APP_URL` | Application URL (e.g. `http://localhost:3000`) |
| `NODE_ENV` | `development` or `production` |

For Even AI (Module 18, not yet wired):

| Variable | Description |
|---|---|
| `LLM_BASE_URL` | Cloudflare Tunnel URL to Ollama (e.g. `https://<tunnel>.trycloudflare.com/v1`) |
| `LLM_API_KEY` | API key for Ollama (default: `ollama`) |

---

## Architecture

### Monorepo Structure

Even OS uses Turborepo with a single Next.js application:

```
Even-OS/
├── apps/
│   └── web/                          # Main Next.js application
│       ├── src/
│       │   ├── app/
│       │   │   ├── (admin)/admin/    # 64 admin pages
│       │   │   ├── (auth)/           # Login, password reset, device verification
│       │   │   └── api/
│       │   │       ├── trpc/[trpc]/  # tRPC handler
│       │   │       ├── migrations/   # 5 migration routes
│       │   │       └── health/       # Health check endpoint
│       │   ├── components/           # React components
│       │   ├── lib/
│       │   │   ├── auth/             # JWT, session management, RBAC
│       │   │   ├── db.ts             # Neon lazy singleton
│       │   │   ├── email/            # Resend email client
│       │   │   └── trpc-helpers.ts   # trpcQuery / trpcMutate fetch helpers
│       │   └── server/
│       │       ├── routers/          # 51 tRPC routers (735 endpoints)
│       │       └── trpc.ts           # tRPC init + procedure definitions
│       └── drizzle/
│           └── schema/               # 31 schema files (170 tables)
├── packages/                         # Shared packages (if any)
├── turbo.json                        # Turborepo configuration
└── package.json
```

### Authentication

Even OS uses a stateless JWT authentication system:

- **Cookie:** `even_session` (HttpOnly, Secure, SameSite=Lax)
- **Algorithm:** HS256 via the `jose` library
- **JWT Payload:** `{ sub, hospital_id, role, email, name, department?, iat, exp }`
- **Session timeouts:** 8 hours (clinical roles), 12 hours (default), 24 hours (executive)
- **No database lookup per request** — `getCurrentUser()` in `src/lib/auth/session.ts` reads the cookie and verifies the JWT cryptographically
- **Shared auth:** 27 users migrated from Rounds with PIN-to-password flow

#### tRPC Procedures

| Procedure | Access Level |
|---|---|
| `publicProcedure` | No auth required |
| `protectedProcedure` | Any authenticated user |
| `adminProcedure` | `super_admin` or `hospital_admin` role |
| `departmentProcedure` | Auto-filters by user's department |

### Database

- **Provider:** Neon serverless PostgreSQL (`@neondatabase/serverless`)
- **ORM:** Drizzle ORM for schema definitions; raw SQL via `getSql()` for older routers
- **Connection:** Lazy-initialized singleton via `getSql()` in `src/lib/db.ts` — prevents build-time crashes
- **Multi-tenancy:** Every tenant-scoped table has a `hospital_id` column; all queries filter by `ctx.user.hospital_id`

#### Critical Column Conventions

| Table | Column | Note |
|---|---|---|
| `patients` | `name_full` | NOT `patient_name`, NOT `first_name`/`last_name` |
| `users` | `full_name` | NOT `user_full_name`, NOT `name` |
| `patients` | `dob` | NOT `date_of_birth` |

#### Query Patterns

```typescript
// Drizzle ORM (newer routers)
import { db } from '@/lib/db';
import { patients } from '@db/schema';
const result = await db.select().from(patients).where(eq(patients.hospital_id, hospitalId));

// Raw SQL — tagged template (static queries only)
const result = await getSql()`SELECT * FROM patients WHERE hospital_id = ${hospitalId}`;

// Raw SQL — function call (dynamic/conditional queries)
let query = `SELECT * FROM patients WHERE hospital_id = $1`;
const params: any[] = [hospitalId];
let idx = 2;
if (input?.name) {
  query += ` AND name_full ILIKE $${idx}`;
  params.push(`%${input.name}%`);
  idx++;
}
const result = await getSql()(query, params);
```

> **Important:** Never use conditional string interpolation inside tagged template literals — empty strings become SQL parameters and break the query. Use the function-call syntax for any query with conditional WHERE clauses.

### UI Framework

- **AdminShell:** Wrapper component with a 48px HealthBar at top + collapsible sidebar + content area
- **AdminLayout:** Requires a `breadcrumbs` prop — incorrect props break the Vercel build
- **Pages:** All admin pages go in `src/app/(admin)/admin/[page-name]/page.tsx`
- **Client helpers:** `trpcQuery` and `trpcMutate` are fetch-based helpers (not tRPC React client)

### Deployment

- **Platform:** Vercel Pro with auto-deploy on push to `main`
- **Function timeout:** 60 seconds (Pro tier)
- **Environment variables:** Set in Vercel dashboard (`.env.local` is NOT committed)
- **Turbo.json:** Declares env vars to suppress Vercel warnings

---

## Modules

Even OS is organized into 17 completed modules plus a planned AI layer. Each module maps to one or more tRPC routers and admin pages.

### Phase A — Foundations

#### Module 1: Identity & Access (S0–S1)

RBAC engine with roles, permissions, and role-permission mappings. Device trust with fingerprinting and verification codes. Password management including reset via email (Resend). Break-glass emergency access with full audit logging. Login attempt tracking.

**Routers:** `auth`, `users`, `profile`  
**Pages:** `/admin/users`, `/admin/roles`, `/admin/login-attempts`  
**Tables:** 18 (users, roles, permissions, role_permissions, trusted_devices, verification_codes, login_attempts, etc.)

#### Module 2: Master Data (S2a–S2c)

Charge Master for procedure codes, pricing, and GST with bulk CSV import. Drug Master for medication catalog with generic names, strengths, and routes. Order set templates for common clinical scenarios. Consent templates (surgical, anaesthesia, blood, general). Discharge summary templates. GST rate configuration per billing category. Multi-level approval hierarchies by amount. 100 NABH indicators seeded from 5th edition.

**Routers:** `chargeMaster`, `drugMaster`, `orderSets`, `consentTemplates`, `dischargeTemplates`, `gstRates`, `approvalHierarchies`, `nabhIndicators`  
**Pages:** `/admin/charge-master`, `/admin/drug-master`, `/admin/order-sets`, `/admin/consent-templates`, `/admin/discharge-templates`, `/admin/gst-rates`, `/admin/approval-hierarchies`, `/admin/nabh-indicators`

### Phase B — Clinical Core

#### Module 3: Patient Registry (S3a–S3c)

19-table patient data model with 23 enums. 5-step registration wizard (demographics → contact → insurance → emergency → review). Atomic UHID generation using sequences (collision-proof). Deduplication engine with trigram similarity scoring — live checks during registration (phone exact + name fuzzy) and an admin queue to review, merge, or dismiss duplicates. Bed board with color-coded status grid (40 beds seeded). Wristband print queue with barcode generation.

**Routers:** `patient`, `dedup`, `bed`, `wristband`  
**Pages:** `/admin/patients`, `/admin/patients/register`, `/admin/dedup`, `/admin/bed-board`, `/admin/wristbands`

#### Module 4: Encounters (S4a–S4d)

4-step admission wizard (patient → encounter type → bed → checklist). Pre-authorization gate blocks admission without insurance pre-auth. Admission checklist with mandatory items. Transfer workflow (bed-to-bed, ward-to-ward with audit trail). Discharge workflow (order → clearance → summary → exit) with milestone tracker and administrative force-discharge override. LeadSquared CRM integration with bidirectional sync and conflict resolution. Clinical orders (lab, radiology, procedure, referral) with stage-based forms.

**Routers:** `encounter`, `lsq`, `clinicalOrders`, `billing`, `clinicalForms`  
**Pages:** `/admin/admissions`, `/admin/transfers`, `/admin/discharge`, `/admin/orders`, `/admin/consents`, `/admin/lsq-sync`

#### Module 5: EMR (S5a–S5d)

Problem list with ICD-10 codes. Allergy/intolerance registry with severity tracking. Observations including vitals, nursing assessments, and I/O. NEWS2 early warning scoring with auto-calculation. Clinical alert system. SOAP notes, progress notes, consultation notes, and nursing notes. Co-signature queue (nurse → attending sign-off chain). Procedures registry with operative notes. Medico-Legal Case (MLC) forms. CPOE with medication orders, drug-drug interaction checking, allergy checks, and dose-range validation. Service requests for lab, radiology, and referrals. Diet and nursing orders. DAG-based care pathway templates with milestone tracking, escalation engine, and variance logging.

**Routers:** `conditions`, `allergies`, `observations`, `clinicalNotes`, `procedures`, `medicationOrders`, `carePathways`  
**Pages:** `/admin/problem-list`, `/admin/allergies`, `/admin/vitals`, `/admin/clinical-notes`, `/admin/medication-orders`, `/admin/care-pathways`, `/admin/emar`

### Phase C — Revenue Cycle

#### Module 6: Billing & Insurance (S6a–S6c)

Billing accounts per encounter with deposit management. Package applications with component breakdown. Automated room charge logging. Pre-authorization requests with TPA routing. Enhancement requests for additional coverage. TPA deduction tracking and categorization. Claim settlement workflow. Refund request workflow with tiered approvals. Invoice generation with GST calculation. Payment tracking across cash, card, UPI, and insurance. Revenue analytics dashboard.

**Routers:** `billingAccounts`, `insuranceClaims`, `refundRevenue`  
**Pages:** `/admin/billing`, `/admin/billing-v2`, `/admin/insurance-claims`, `/admin/revenue-dashboard`

### Phase D — Ancillary Services

#### Module 7: Pharmacy (S7a)

Vendor management. Inventory tracking with reorder alerts. Dispensing records linked to medication orders. Narcotics register with witness tracking. Purchase orders and goods received notes. Stock alerts for low stock, expiry, and consumption anomalies.

**Router:** `pharmacy`  
**Page:** `/admin/pharmacy`  
**Tables:** 8

#### Module 8: Lab & Radiology (S7b + L.1–L.8)

Lab panels and components. Lab order → specimen → results workflow. Radiology orders and reports with PACS integration stubs. LOINC code support. Extended with 8 sub-phases: critical value communication workflow, lab worklist with auto-critical alerts and barcode lookup, test catalog with accession numbers, lab reports and outsourced lab tracking, culture & sensitivity and histopathology, blood bank (inventory, crossmatch, transfusion reactions), QC with Levey-Jennings charts (Westgard multi-rule, sigma metrics), and HL7 analyzer (adapters, message routing, dead letter queue).

**Routers:** `labRadiology`, `criticalValues`, `testCatalog`, `labReports`, `cultureHistopath`, `bloodBank`, `qcLeveyJennings`, `hl7Analyzer`  
**Pages:** `/admin/lab-radiology`, `/admin/critical-values`, `/admin/lab-worklist`, `/admin/test-catalog`, `/admin/lab-reports`, `/admin/culture-histopath`, `/admin/blood-bank`, `/admin/qc-levey-jennings`, `/admin/hl7-analyzer`, `/admin/hl7-messages`

#### Module 9: OT Management (S7c)

OT room management. Surgery scheduling with duration estimation. WHO Surgical Safety Checklist (all 3 phases). Anesthesia records. Equipment tracking. Turnover time logging.

**Router:** `otManagement`  
**Page:** `/admin/ot-management`  
**Tables:** 6

### Phase E — Quality & Safety

#### Module 10: Incident Reporting (S8a)

Adverse event reporting. Medication error tracking. Fall tracking. Quality indicator definitions and value recording. Incident categorization with severity scoring.

**Router:** `incidentReporting`  
**Page:** `/admin/incident-reporting`

#### Module 11: Root Cause Analysis (S8b)

Root cause investigations. Fishbone (Ishikawa) diagram factors. Five-Why analysis chains. CAPA (Corrective & Preventive Actions). Effectiveness reviews.

**Router:** `rca`  
**Page:** `/admin/rca`

#### Module 12: Infection Control (S8c)

Hospital-acquired infection (HAI) tracking. Antibiotic stewardship with approval workflows. Antibiogram results and resistance pattern analysis.

**Router:** `infectionSurveillance`  
**Page:** `/admin/infection-surveillance`

#### Module 13: Safety & Compliance (S8d)

Safety rounds with templates and findings. Clinical audits. Sewa complaints integration. NABH indicator tracking against 5th edition standards.

**Router:** `safetyAudits`  
**Pages:** `/admin/safety-audits`, `/admin/compliance`

### Phase F — Visibility & Hardening

#### Module 14: Dashboards (S12)

Four-tier dashboard hierarchy: Wall View (Tier 1, for lobby/nurse station displays), MOD Dashboard (Tier 2, Manager on Duty), GM Dashboard (Tier 3, General Manager), CEO Dashboard (Tier 4, executive overview). KPI definition engine with configurable alert rules and thresholds. Alert queue for triggered KPI alerts.

**Router:** `dashboards`  
**Pages:** `/admin/wall-view`, `/admin/mod-dashboard`, `/admin/gm-dashboard`, `/admin/ceo-dashboard`, `/admin/kpi-definitions`, `/admin/alert-queue`  
**Tables:** 9

#### Module 15: Integrations (S15)

10 integration endpoint stubs (ABDM, HL7 FHIR, LeadSquared, Azure Speech, etc.). Message log with correlation tracking. Event bus subscriptions. LeadSquared sync dashboard.

**Router:** `integrations`  
**Pages:** `/admin/integrations`, `/admin/lsq-sync`, `/admin/hl7-messages`, `/admin/event-bus`

#### Module 16: Hardening (S16)

Security findings tracker. Rate limit event logging. PII access audit log. Disaster recovery drill records. Performance baselines. Compliance checklist (23 items seeded: OWASP + NABH + DPDP). System health snapshots.

**Router:** `hardening`  
**Pages:** `/admin/security-dashboard`, `/admin/compliance`, `/admin/dr-performance`

#### Module 17: Patient Portal (S14) & MRD (S17)

Patient preferences and delegated users. Patient feedback collection. Patient payments. Pre-admission forms. Medication refill requests. Post-discharge task tracking. Portal audit log. Document references with retention rules. AI-based document classification queue. OCR results storage. Media objects and embeddings.

**Routers:** `patientPortal`, `mrdDocuments`  
**Pages:** `/admin/patient-feedback`, `/admin/patient-payments`, `/admin/patient-services`, `/admin/mrd-documents`, `/admin/retention-rules`

---

## Module 18: Even AI (Planned)

A background-only LLM intelligence layer that reads from all 170+ existing tables and writes to its own 8 tables. Every suggestion is read-only advisory with full explainability. Uses Qwen 2.5 14B via Ollama + Cloudflare Tunnel with a template-engine fallback when the LLM is offline.

**4 headline features:** Claim Outcome Predictor, Real-Time Bed Intelligence, AI Quality Auditor, and Morning Briefing Generator.

Full PRD at `even-os-prd/18_Even_AI/` (README.md, schema.md, api.md, ui.md).

---

## Database Schema

170 tables across 31 Drizzle schema files:

| File | Module | Key Tables |
|---|---|---|
| `00-foundations.ts` | Auth & RBAC | users, roles, permissions, role_permissions, trusted_devices, verification_codes, login_attempts |
| `01-master-data.ts` | Master Data | charge_items, drug_master, order_sets, consent_templates, discharge_templates, gst_rates, approval_hierarchies, nabh_indicators |
| `03-registration.ts` | Patient Registry | patients, patient_contacts, patient_insurance, emergency_contacts, potential_duplicates |
| `04-clinical.ts` | EMR Foundation | conditions, allergies, observations, news2_scores, clinical_alerts |
| `05-emr.ts` | EMR Extended | emr_clinical data tables |
| `06-notes.ts` | Documentation | clinical_notes, procedures, mlc_forms, patient_documents |
| `07-cpoe.ts` | CPOE | medication_orders, cds_rules, service_requests, diet_orders, nursing_orders |
| `08-pathways.ts` | Care Pathways | pathway_templates, pathway_nodes, pathway_edges, care_plans, milestones, escalations, variances |
| `09-billing.ts` | Billing | billing_accounts, deposits, charge_items, packages, room_charges, billing_config |
| `10-insurance.ts` | Insurance | preauth_requests, enhancement_requests, tpa_deductions, claim_settlements |
| `11-refunds.ts` | Revenue | refund_requests, invoices, payments |
| `12-pharmacy.ts` | Pharmacy | vendors, pharmacy_inventory, dispensing_records, narcotics_register, purchase_orders, grn, stock_alerts |
| `13-lab-radiology.ts` | Lab & Radiology | lab_panels, lab_orders, specimens, lab_results, radiology_orders, radiology_reports |
| `14-ot-management.ts` | OT | ot_rooms, surgeries, who_checklist, anesthesia_records, equipment, turnover_logs |
| `15-quality.ts` | Incidents | incidents, adverse_events, medication_errors, falls, quality_indicators, quality_values |
| `16-rca.ts` | RCA | investigations, fishbone_factors, five_why_chains, capa_actions, effectiveness_reviews |
| `17-infection-surveillance.ts` | Infection Control | hai_cases, antibiotic_approvals, antibiotic_usage, antibiogram_results |
| `18-safety-audits.ts` | Safety | safety_rounds, round_findings, clinical_audits, sewa_complaints |
| `19-critical-values.ts` | Lab Extensions | critical_value_communications |
| `20-test-catalog.ts` | Lab Extensions | test_catalog, accession_sequences |
| `21-lab-reports.ts` | Lab Extensions | lab_reports, outsourced_labs |
| `22-culture-histopath.ts` | Lab Extensions | cultures, sensitivities, histopathology |
| `23-blood-bank.ts` | Lab Extensions | blood_inventory, crossmatch_requests, transfusion_reactions |
| `24-qc-levey-jennings.ts` | Lab Extensions | qc_lots, qc_results, lj_rules, sigma_metrics |
| `25-hl7-analyzer.ts` | Lab Extensions | hl7_adapters, hl7_messages, dead_letters |
| `26-dashboards.ts` | Dashboards | kpi_definitions, kpi_values, alert_rules, alert_queue, dashboard_configs |
| `27-integrations.ts` | Integrations | integration_endpoints, message_log, event_subscriptions |
| `28-mrd-documents.ts` | MRD | mrd_document_references, mrd_retention_rules, mrd_classification_queue, mrd_ocr_results, mrd_media_objects |
| `29-hardening.ts` | Security | security_findings, rate_limit_events, pii_access_log, dr_drills, performance_baselines, compliance_checklist_items, system_health_snapshots |
| `30-patient-portal.ts` | Patient Portal | patient_preferences, delegated_users, patient_feedback, patient_payments, preadmission_forms, medication_refills, post_discharge_tasks, portal_audit_log |

---

## tRPC Router Reference

51 routers providing 735 endpoints:

| Router | Module | Approximate Endpoints |
|---|---|---|
| `auth` | Authentication | Login, logout, verify, refresh |
| `users` | User Management | CRUD, role assignment, suspend, delete |
| `profile` | User Profile | View/update own profile, change password |
| `chargeMaster` | Master Data | Procedure codes, pricing, bulk import |
| `drugMaster` | Master Data | Drug catalog, generics, strengths |
| `orderSets` | Clinical Templates | Bundled order templates |
| `consentTemplates` | Clinical Templates | Consent form templates |
| `dischargeTemplates` | Clinical Templates | Discharge summary formats |
| `gstRates` | Governance | Tax rate configuration |
| `approvalHierarchies` | Governance | Multi-level approval chains |
| `nabhIndicators` | Governance | NABH 5th edition indicators |
| `patient` | Registration | 5-step wizard, search, stats |
| `dedup` | Deduplication | Duplicate detection, merge, dismiss |
| `bed` | Bed Management | Bed grid, status updates |
| `wristband` | Wristbands | Print queue, barcode generation |
| `encounter` | Encounters | Admission, discharge milestones |
| `lsq` | CRM Integration | LeadSquared sync engine |
| `clinicalOrders` | Orders | Lab, radiology, procedure, referral |
| `billing` | Billing Foundation | Stage forms, encounter charges |
| `billingAccounts` | Billing | Accounts, deposits, packages, room charges |
| `clinicalForms` | Forms | Clinical form data |
| `conditions` | EMR | Problem list, ICD-10 |
| `allergies` | EMR | Allergy registry |
| `observations` | EMR | Vitals, assessments, NEWS2 |
| `clinicalNotes` | Documentation | SOAP, progress, consultation notes |
| `procedures` | Documentation | Operative notes, MLC |
| `medicationOrders` | CPOE | Medication orders, CDS checks |
| `carePathways` | Care Pathways | DAG templates, milestones |
| `insuranceClaims` | Insurance | Pre-auth, enhancement, settlement |
| `refundRevenue` | Revenue | Refunds, invoices, analytics |
| `pharmacy` | Pharmacy | Vendors, inventory, dispensing, narcotics |
| `labRadiology` | Lab & Radiology | Panels, orders, results |
| `otManagement` | OT | Scheduling, WHO checklist, anesthesia |
| `incidentReporting` | Quality | Adverse events, med errors, falls |
| `rca` | RCA | Fishbone, five-why, CAPA |
| `infectionSurveillance` | Infection Control | HAI, antibiotic stewardship |
| `safetyAudits` | Safety | Rounds, audits, complaints |
| `criticalValues` | Lab Extensions | Critical value communication |
| `testCatalog` | Lab Extensions | Test catalog, accession numbers |
| `labReports` | Lab Extensions | Reports, outsourced labs |
| `cultureHistopath` | Lab Extensions | Culture, sensitivity, histopath |
| `bloodBank` | Lab Extensions | Inventory, crossmatch, transfusions |
| `qcLeveyJennings` | Lab Extensions | QC, Westgard rules, LJ charts |
| `hl7Analyzer` | Lab Extensions | HL7 adapters, routing, dead letters |
| `drizzleTest` | Dev | Drizzle ORM test router |
| `dashboards` | Dashboards | KPIs, alerts, wall/MOD/GM/CEO views |
| `integrations` | Integrations | Endpoint stubs, message log, event bus |
| `mrdDocuments` | MRD | Documents, retention, classification, OCR |
| `hardening` | Security | Findings, compliance, DR, performance |
| `patientPortal` | Patient Portal | Feedback, payments, pre-admission, refills |

---

## Admin Pages

64 pages under `/admin/`:

| Page | Module |
|---|---|
| `/admin/admissions` | Encounters |
| `/admin/alert-queue` | Dashboards |
| `/admin/allergies` | EMR |
| `/admin/approval-hierarchies` | Governance |
| `/admin/bed-board` | Bed Management |
| `/admin/billing` | Billing |
| `/admin/billing-v2` | Billing (updated) |
| `/admin/blood-bank` | Lab Extensions |
| `/admin/care-pathways` | Care Pathways |
| `/admin/ceo-dashboard` | Dashboards (Tier 4) |
| `/admin/charge-master` | Master Data |
| `/admin/clinical-notes` | Documentation |
| `/admin/compliance` | Safety / Hardening |
| `/admin/consent-templates` | Clinical Templates |
| `/admin/consents` | Encounters |
| `/admin/critical-values` | Lab Extensions |
| `/admin/culture-histopath` | Lab Extensions |
| `/admin/dedup` | Deduplication |
| `/admin/discharge` | Encounters |
| `/admin/discharge-templates` | Clinical Templates |
| `/admin/dr-performance` | Hardening |
| `/admin/drug-master` | Master Data |
| `/admin/emar` | CPOE |
| `/admin/event-bus` | Integrations |
| `/admin/gm-dashboard` | Dashboards (Tier 3) |
| `/admin/gst-rates` | Governance |
| `/admin/hl7-analyzer` | Lab Extensions |
| `/admin/hl7-messages` | Integrations |
| `/admin/incident-reporting` | Quality |
| `/admin/infection-surveillance` | Infection Control |
| `/admin/insurance-claims` | Insurance |
| `/admin/integrations` | Integrations |
| `/admin/kpi-definitions` | Dashboards |
| `/admin/lab-radiology` | Lab & Radiology |
| `/admin/lab-reports` | Lab Extensions |
| `/admin/lab-worklist` | Lab Extensions |
| `/admin/login-attempts` | Auth |
| `/admin/lsq-sync` | CRM Integration |
| `/admin/medication-orders` | CPOE |
| `/admin/mod-dashboard` | Dashboards (Tier 2) |
| `/admin/mrd-documents` | MRD |
| `/admin/nabh-indicators` | Governance |
| `/admin/order-sets` | Clinical Templates |
| `/admin/orders` | Clinical Orders |
| `/admin/ot-management` | OT |
| `/admin/patient-feedback` | Patient Portal |
| `/admin/patient-payments` | Patient Portal |
| `/admin/patient-services` | Patient Portal |
| `/admin/patients` | Registration |
| `/admin/patients/register` | Registration |
| `/admin/pharmacy` | Pharmacy |
| `/admin/problem-list` | EMR |
| `/admin/qc-levey-jennings` | Lab Extensions |
| `/admin/rca` | RCA |
| `/admin/retention-rules` | MRD |
| `/admin/revenue-dashboard` | Revenue |
| `/admin/roles` | RBAC |
| `/admin/safety-audits` | Safety |
| `/admin/security-dashboard` | Hardening |
| `/admin/test-catalog` | Lab Extensions |
| `/admin/transfers` | Encounters |
| `/admin/users` | User Management |
| `/admin/vitals` | EMR |
| `/admin/wall-view` | Dashboards (Tier 1) |
| `/admin/wristbands` | Bed Management |

---

## API Endpoints

### tRPC

All tRPC endpoints are accessed via `/api/trpc/<router>.<procedure>`.

**GET queries with input:**
```
GET /api/trpc/patient.list?input=%7B%22json%22%3A%7B%7D%7D
```
(URL-encoded `{"json":{}}`)

**Mutations:**
```
POST /api/trpc/patient.create
Content-Type: application/json
Cookie: even_session=<JWT>

{"json":{"name_full":"John Doe","phone":"9876543210",...}}
```

### REST Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | None | Health check |
| `/api/migrations/dashboards` | POST | `x-admin-key` | Run dashboard migration |
| `/api/migrations/hardening` | POST | `x-admin-key` | Run hardening migration |
| `/api/migrations/integrations` | POST | `x-admin-key` | Run integrations migration |
| `/api/migrations/mrd-documents` | POST | `x-admin-key` | Run MRD migration |
| `/api/migrations/patient-portal` | POST | `x-admin-key` | Run patient portal migration |

---

## Testing an Endpoint

```bash
# 1. Generate a JWT token
cd apps/web && node -e "
const { SignJWT } = require('jose');
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
new SignJWT({
  sub: '00000000-0000-0000-0000-000000000001',
  hospital_id: '00000000-0000-0000-0000-000000000001',
  role: 'super_admin',
  email: 'dev@even.in',
  name: 'Dev',
  department: 'admin'
})
.setProtectedHeader({ alg: 'HS256' })
.setIssuedAt()
.setExpirationTime('24h')
.sign(secret)
.then(t => console.log(t));
"

# 2. Start the dev server
npx next dev -p 3000

# 3. Test an endpoint
TOKEN="<paste token from step 1>"
INPUT=$(python3 -c "import urllib.parse; print(urllib.parse.quote('{\"json\":{}}'))")
curl -s -b "even_session=$TOKEN" "http://localhost:3000/api/trpc/pharmacy.listVendors?input=$INPUT"
```

---

## Build History

57 commits across 6 build phases:

| Phase | Sprints | What Was Built |
|---|---|---|
| **A: Foundations** | S0–S2c | Scaffold, auth, RBAC, master data, templates, governance |
| **B: Clinical Core** | S3a–S5d | Patient registry, encounters, EMR, CPOE, care pathways |
| **C: Revenue** | S6a–S6c | Billing, insurance claims, revenue intelligence |
| **D: Ancillary** | S7a–S7c, L.1–L.8 | Pharmacy, lab/radiology, OT, 8 lab extensions |
| **E: Quality** | S8a–S8d | Incidents, RCA, infection control, safety/compliance |
| **F: Visibility** | S12, S14–S17 | Dashboards, patient portal, integrations, hardening, MRD |

Full commit-by-commit history is available in `EVEN-OS-BUILD-HISTORY.md`.

---

## Project Stats

| Metric | Count |
|---|---|
| Database tables | 170 |
| tRPC routers | 51 |
| tRPC endpoints | 735 |
| Admin pages | 64 |
| Drizzle schema files | 31 |
| Migration routes | 5 |
| Git commits | 57 |
| Auth pages | 5 |

---

## License

Proprietary — Even Healthcare Pvt. Ltd.
