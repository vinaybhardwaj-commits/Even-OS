# Even OS: Hospital Operating System — Architecture & User Manual

**Version:** 1.0  
**Last Updated:** 13 April 2026  
**Status:** All 18 modules complete and deployed on Vercel Pro  
**Deployment URL:** https://even-os-hospital.vercel.app  

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Module Reference](#module-reference)
5. [Database Schema Overview](#database-schema-overview)
6. [API Reference](#api-reference)
7. [Environment Variables](#environment-variables)
8. [Deployment](#deployment)
9. [Security & Compliance](#security--compliance)
10. [Development Workflow](#development-workflow)
11. [Troubleshooting](#troubleshooting)
12. [Appendix](#appendix)

---

## Project Overview

### What is Even OS?

Even OS is a comprehensive hospital operating system (HOS) built on modern cloud-native technologies. It unifies all clinical, operational, and administrative workflows for a multispecialty hospital into a single, integrated platform. Designed specifically for Indian healthcare delivery models, Even OS enables:

- **Patient intake** via LSQ CRM integration (168+ patients synced, dual-sync enabled)
- **Clinical workflows** with EMR, CPOE, care pathways, and nurse station coordination
- **Operational management** across pharmacy, lab, radiology, OT, and bed allocation
- **Financial operations** with charge master, billing, insurance claims, and revenue analytics
- **Quality & safety** via incident reporting, RCA, HAI surveillance, and NABH compliance
- **AI-powered insights** across all domains (billing, clinical, quality, operations)

### Key Statistics

| Metric | Value |
|--------|-------|
| **Monorepo Commits** | 68 |
| **Database Tables** | 170+ across 30 schema files |
| **API Routers** | 51 tRPC endpoints + 19 REST routes |
| **Total API Endpoints** | 781 |
| **Pages & Views** | 67 unique pages |
| **Components** | 140+ reusable React components |
| **Source Files** | 263 TypeScript/TSX files |
| **Lines of Code** | ~104,759 TypeScript |
| **Modules** | 18 fully functional operational modules |
| **Background Jobs** | 11 AI-powered insight generators |
| **Deployment** | Vercel Pro with auto-deploy on git push |

### Technology Stack

- **Frontend:** Next.js 14.2, React 18, TypeScript, TailwindCSS, Shadcn/ui
- **Backend:** Next.js API routes, tRPC for type-safe RPC
- **Database:** PostgreSQL via Neon (serverless HTTP driver), Drizzle ORM
- **Authentication:** JWT HS256 via jose, device fingerprinting, break-glass access
- **AI/LLM:** Azure OpenAI + Ollama fallback (Qwen 2.5 14B)
- **Real-time:** GetStream for messaging/channels
- **Monorepo:** Turborepo for build orchestration
- **Infrastructure:** Vercel Pro for hosting, GitHub for source control
- **Healthcare Standards:** HL7 v2.5 message routing, LOINC codes, NABH compliance

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **pnpm** 9.15.4 (package manager)
- **PostgreSQL** connection string (Neon recommended for dev)
- **Git** and GitHub access

### Local Development Setup

1. **Clone & install:**
   ```bash
   git clone https://github.com/vinaybhardwaj-commits/even-os.git
   cd Even-OS
   pnpm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials:
   # - DATABASE_URL (PostgreSQL connection)
   # - JWT_SECRET (≥32 chars)
   # - ENCRYPTION_KEY (exactly 32 chars)
   # - ADMIN_KEY (for /admin routes)
   # - NEXT_PUBLIC_APP_URL (http://localhost:3000 for dev)
   ```

3. **Database migration & seeding:**
   ```bash
   pnpm db:push          # Create tables via Drizzle
   pnpm db:seed          # Populate demo data (hospitals, users, charges)
   pnpm db:studio        # Open Drizzle Studio for data inspection
   ```

4. **Start development server:**
   ```bash
   pnpm dev              # Starts on http://localhost:3000
   ```

5. **Access the system:**
   - **Super Admin Login:** email `admin@even-os.local`, PIN `1234` → password flow
   - **Clinical User Login:** email `doctor@hospital.local`, PIN `5678` → password flow
   - **Dashboard:** http://localhost:3000/dashboard
   - **Admin Panel:** http://localhost:3000/admin (requires super_admin role)

### Build & Test

```bash
pnpm build             # Full build via Turborepo
pnpm lint              # TypeScript & ESLint
pnpm typecheck         # Strict type validation
pnpm format            # Prettier code formatting
```

---

## Architecture

### Three-Tier Design Flow

Even OS follows a three-tier serverless architecture optimized for low-latency clinical operations:

```
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER (Client)                            │
│  ├─ Next.js 14.2 Pages (React 18 + TailwindCSS)         │
│  ├─ Shadcn/ui component library                         │
│  ├─ GetStream chat for ward rounds                      │
│  └─ Real-time patient wristband + bed grid display      │
└──────────────────┬──────────────────────────────────────┘
                   │ (tRPC + REST APIs, JWT token in Cookie)
┌──────────────────▼──────────────────────────────────────┐
│  APPLICATION LAYER (Next.js API Routes)                 │
│  ├─ 51 tRPC Routers (type-safe RPC)                     │
│  │  ├─ Auth, User Management, Profile                   │
│  │  ├─ Patient Registry + Dedup Engine                  │
│  │  ├─ Encounters, Clinical Notes, CPOE                 │
│  │  ├─ Billing, Insurance Claims, Refunds              │
│  │  ├─ Pharmacy, Lab, Radiology, OT                     │
│  │  ├─ Quality, RCA, HAI, Safety Audits                │
│  │  └─ Dashboards, Integrations, Even AI               │
│  ├─ 19 REST Routes (health, migrations, background jobs)│
│  └─ Middleware: auth, audit logging, error handling     │
└──────────────────┬──────────────────────────────────────┘
                   │ (Drizzle ORM + SQL queries)
┌──────────────────▼──────────────────────────────────────┐
│  DATA LAYER (Neon PostgreSQL + Services)                │
│  ├─ Neon HTTP Driver (serverless connection pooling)    │
│  ├─ 170+ tables across 30 schema files                  │
│  ├─ Audit logs, event versioning, multi-tenancy         │
│  ├─ External integrations:                              │
│  │  ├─ LSQ CRM (patient sync)                           │
│  │  ├─ Azure OpenAI (LLM insights)                      │
│  │  ├─ Ollama (local fallback)                          │
│  │  ├─ Resend (email notifications)                     │
│  │  ├─ Vercel Blob (file storage)                       │
│  │  └─ HL7 message queue (interop)                      │
│  └─ Background jobs (11 AI engines via cron)            │
└─────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
Even-OS/
├── apps/
│   └── web/                          # Main Next.js 14 application
│       ├── src/
│       │   ├── app/                  # Next.js App Router (67 pages)
│       │   │   ├── (dashboard)/      # Main dashboard pages
│       │   │   ├── (clinical)/       # Clinical workflows
│       │   │   ├── (billing)/        # Financial modules
│       │   │   ├── (admin)/          # Admin panels & config
│       │   │   └── api/              # 19 REST + tRPC routes
│       │   ├── components/           # 140+ React components
│       │   │   ├── dashboard/        # KPI cards, charts
│       │   │   ├── clinical/         # EMR, CPOE, patient views
│       │   │   ├── billing/          # Charge master, invoices
│       │   │   └── admin/            # Config, audit UIs
│       │   ├── lib/                  # Core utilities & services
│       │   │   ├── auth.ts           # JWT + device management
│       │   │   ├── db.ts             # Neon HTTP driver setup
│       │   │   ├── trpc.ts           # tRPC client/server config
│       │   │   ├── ai/               # LLM insight engines
│       │   │   └── utils/            # Helpers (encrypt, format, etc.)
│       │   └── server/               # Server-only utilities
│       ├── drizzle/
│       │   └── schema/               # 30 .ts files, 170+ tables
│       │       ├── 00-foundations.ts (auth, RBAC, audit)
│       │       ├── 01-master-data.ts (charges, drugs)
│       │       ├── 03-registration.ts (patients, encounters)
│       │       ├── 04-clinical.ts   (conditions, allergies)
│       │       ├── 05-emr.ts        (observations, NEWS2)
│       │       ├── 09-billing.ts    (accounts, invoices)
│       │       ├── 12-pharmacy.ts   (inventory, dispensing)
│       │       ├── 13-lab-radiology.ts (orders, results)
│       │       ├── 15-quality.ts    (incidents, RCA, HAI)
│       │       ├── 18-safety-audits.ts (rounds, compliance)
│       │       ├── 26-dashboards.ts (KPI, MOD, CEO views)
│       │       ├── 27-integrations.ts (LSQ, HL7, events)
│       │       ├── 28-mrd-documents.ts (medical records)
│       │       └── [14 more schema files...]
│       ├── public/                   # Static assets
│       └── package.json
├── packages/
│   └── [Shared utilities if needed]
├── turbo.json                        # Turborepo orchestration
├── pnpm-workspace.yaml               # Workspace config
└── package.json                      # Root package.json

ROOT package.json scripts:
- pnpm dev              → turbo dev
- pnpm build            → turbo build
- pnpm lint             → turbo lint
- pnpm typecheck        → turbo typecheck
- pnpm db:push          → pnpm --filter @even-os/web db:push
- pnpm db:seed          → pnpm --filter @even-os/web db:seed
- pnpm db:studio        → pnpm --filter @even-os/web db:studio
```

### Key Architectural Decisions

1. **Serverless HTTP driver (Neon):** All database connections via HTTP, no persistent pools. Eliminates idle connections; scales on query volume.
2. **tRPC for type safety:** Backend procedures are type-checked end-to-end; no API docs needed. 51 routers across business domains.
3. **Drizzle ORM:** Type-safe SQL builder with relation definitions. Migrations via `db:push` from TypeScript schema.
4. **Multi-tenancy via hospital_id:** Every table has `hospital_id` foreign key; RBAC per user role (super_admin, admin, doctor, nurse, etc.).
5. **JWT + device fingerprinting:** Stateless auth. Device trust prevents unauthorized logins; break-glass for emergencies.
6. **Audit & event logs:** Every state change logged; traceable to user + timestamp. Required for NABH & ISO compliance.
7. **Background jobs via API routes:** 11 AI engines triggered by cron (morning briefing, bed intelligence, claim predictions, clinical scan, shift handoff, NABH audit, pharmacy alerts, quality monitor, etc.). Results streamed to dashboard cards.

---

## Module Reference

### Module 1: Authentication & Authorization

**Tables:** 16 (auth, RBAC, audit, device trust)  
**Endpoints:** 8 tRPC routes

- **JWT HS256 authentication** via jose library
- **Multi-role RBAC:** super_admin, admin, doctor, nurse, pharmacist, lab_tech, radiologist, billing_officer, quality_officer, ceo, mom
- **Device fingerprinting & device trust** (trusted_devices table)
- **Break-glass emergency access** (break_glass_log audit trail)
- **Login tracking** with IP + user-agent logging
- **Password reset flow** via Resend email
- **Session management** with JWT expiry + refresh tokens

**Key Files:**
- `/lib/auth.ts` — JWT creation, device fingerprinting
- `/app/api/trpc/[trpc]/route.ts` — Auth router
- `/drizzle/schema/00-foundations.ts` — Auth tables

---

### Module 2: Master Data Management

**Tables:** 10 (charge master, drug master, GST rates, approval hierarchies)  
**Endpoints:** 15 tRPC routes

- **Charge Master:** Hospital-wide procedure & service pricing with GST tiers
- **Drug Master:** LOINC-mapped medications with dosing, interactions
- **GST Rate Configuration:** Dynamic tax rates per procedure type
- **Approval Hierarchies:** Budget approval chains per department
- **Order Sets & Consent Templates:** Pre-built clinical pathways
- **Discharge Templates:** Standardized discharge summaries
- **CSV bulk import** with validation & conflict resolution

**Key Files:**
- `/routers/charge-master.ts`
- `/routers/drug-master.ts`
- `/drizzle/schema/01-master-data.ts`

---

### Module 3-4: Templates & Governance

**Tables:** 15 (order sets, consent, discharge, NABH indicators)  
**Endpoints:** 20 tRPC routes

- **Order Sets:** Clinical protocols (e.g., "AMI intake," "Post-op care")
- **Consent Templates:** Procedure-specific informed consent documents
- **Discharge Planning:** Post-discharge medication, diet, follow-up schedules
- **NABH Indicators:** 100 seeded quality metrics for accreditation compliance
- **Approval workflow** for clinical protocol changes

---

### Module 5: Patient Registry & Master

**Tables:** 22 (patients, encounters, insurance, next-of-kin)  
**Endpoints:** 18 tRPC routes

- **5-step patient intake wizard** (demographics, contact, insurance, emergency contacts, consent)
- **Unique hospital identifier (UHID)** per patient
- **Duplicate detection engine** via trigram scoring (66%+ similarity → potential duplicate alert)
- **Multi-insurance support** (primary + secondary with TPA routing)
- **LSQ CRM sync:** Real-time bidirectional sync of 168+ patient records
- **Phone normalization & validation** (Indian +91 format)
- **Consent tracking** for each encounter

**Key Files:**
- `/routers/patient.ts`
- `/routers/dedup.ts`
- `/drizzle/schema/03-registration.ts`

---

### Module 6: Bed Board & Wristbands

**Tables:** 5 (beds, bed_allocations, wristbands, print_queue)  
**Endpoints:** 10 tRPC routes

- **Bed grid display:** 40 beds with real-time occupancy + patient cards
- **Bed allocation workflow** (admission → transfer → discharge)
- **Wristband generation & printing queue** (Zebra thermal printer format)
- **Color-coded risk alerts** (fall risk, isolation, DNR, etc.)
- **Print queue management** with job history

**Key Files:**
- `/routers/bed.ts`
- `/routers/wristband.ts`

---

### Module 7: Encounters (Admissions, Transfers, Discharge)

**Tables:** 8 (encounters, encounter_milestones, encounter_checklists)  
**Endpoints:** 22 tRPC routes

- **4-step admission wizard:** Pre-auth gate → checklist → milestone tracking → bed allocation
- **Encounter lifecycle:** Admission → active → transfer → discharge → archived
- **Pre-authorization** for insurance claims validation
- **Milestone checklist:** Clinician sign-off on critical handoff points
- **Transfer workflow** (bed-to-bed, ward-to-ward with escalation)
- **Force discharge** for administrative closures
- **Encounter history** with all state changes timestamped

---

### Module 8: Electronic Medical Record (EMR)

**Tables:** 15 (clinical_notes, conditions, allergies, observations, NEWS2, procedures, documents)  
**Endpoints:** 35 tRPC routes

- **Clinical notes:** SOAP format with co-sign queue
- **Condition tracking:** ICD-10 coded diagnoses + status
- **Allergy registry:** Drug allergies with severity & reaction type
- **Vital signs & observations:** Real-time NEWS2 scoring for deterioration alerts
- **Procedure documentation:** WHO surgical checklist, operative details
- **Document management:** Scanned medical records, lab reports, imaging
- **Co-sign workflow:** Junior clinician → senior clinician approval

**Key Files:**
- `/routers/clinical-notes.ts`
- `/routers/conditions.ts`, `/routers/allergies.ts`
- `/routers/observations.ts`
- `/drizzle/schema/05-emr.ts`

---

### Module 9: Computerized Physician Order Entry (CPOE) & Care Pathways

**Tables:** 15 (medication_orders, service_requests, diet_orders, nursing_orders, care_pathways, pathway_milestones)  
**Endpoints:** 30 tRPC routes

- **Medication orders:** Dose + frequency + duration with CDS rule checking
- **Service requests:** Consults, imaging, lab orders with routing
- **Diet & nursing orders:** Pre-defined templates or free text
- **Care pathway DAGs:** Directed acyclic graph templates (e.g., "Post-op recovery")
- **Clinical Decision Support (CDS):** Rules engine flagging drug-drug interactions, allergies, contraindications
- **Order status tracking:** Pending → scheduled → active → completed → discontinued
- **Variance tracking:** Deviations from protocol with reason codes

---

### Module 10: Billing & Revenue Management

**Tables:** 14 (billing_accounts, invoices, line_items, deposits, packages, room_charges, refunds)  
**Endpoints:** 28 tRPC routes

- **Billing account creation** per admission with patient + insurance data
- **Charge transaction logging:** Every procedure/service → line item
- **Advance deposit tracking** with utilization & refund reconciliation
- **Package pricing:** Pre-negotiated bundles (e.g., "Normal delivery package")
- **Room charges:** Per-diem rates with upgrade pricing
- **Invoice generation** with GST calculation
- **Refund processing** with approval workflow
- **Revenue analytics:** Daily/monthly/yearly collection dashboards

**Key Files:**
- `/routers/billing.ts`
- `/routers/refund-revenue.ts`
- `/drizzle/schema/09-billing.ts`

---

### Module 11: Insurance Claims & Pre-authorization

**Tables:** 8 (insurance_claims, pre_auth_requests, claim_items, tpa_deductions, claim_settlements)  
**Endpoints:** 25 tRPC routes

- **Pre-authorization** before admission (auto-approved if within limits)
- **Claim creation** from billing line items + insurance mapping
- **TPA deduction** logic (co-pay, deductible, sub-limits)
- **Claim settlement** tracking (submitted → approved → paid)
- **Enhancement requests** for rejected claims
- **Claim analytics:** Approval rate, settlement time, TPA distribution

**Key Files:**
- `/routers/insurance-claims.ts`
- `/drizzle/schema/10-insurance.ts`

---

### Module 12: Pharmacy

**Tables:** 8 (vendors, inventory, dispensing_transactions, purchase_orders, narcotics_register, pharmacy_alerts)  
**Endpoints:** 30 tRPC routes

- **Vendor & purchase order management**
- **Real-time inventory tracking** with low-stock alerts
- **Medication dispensing:** Nursing orders → pharmacist validation → patient pickup
- **Narcotics register:** Controlled substance tracking (required for compliance)
- **Expiration alerts** and auto-removal from inventory
- **Stock variance reporting** with loss audit trail
- **Drug interaction checking** at order time

---

### Module 13: Laboratory & Radiology

**Tables:** 12 (test_panels, lab_orders, lab_results, specimens, imaging_orders, imaging_results, loinc_mapping, qc_levey_jennings)  
**Endpoints:** 35 tRPC routes

- **Test panel definitions:** Bundled lab tests (e.g., "Basic metabolic panel")
- **LOINC code mapping** for standardization
- **Lab order routing** to respective analyzers
- **Result entry** with reference ranges + critical value flagging
- **Specimen tracking:** Collection → processing → disposal
- **Imaging orders** (X-ray, ultrasound, CT) with radiology review queue
- **QC tracking:** Levey-Jennings charts for quality assurance
- **HL7 v2.5 message integration** from external lab/imaging systems
- **Result notification** to ordering clinician + patient portal

**Key Files:**
- `/routers/lab-radiology.ts`
- `/routers/lab-reports.ts`, `/routers/test-catalog.ts`
- `/drizzle/schema/13-lab-radiology.ts`

---

### Module 14: Operating Theatre (OT) Management

**Tables:** 6 (ot_schedules, ot_teams, anesthesia_logs, equipment_inventory, turnover_checklist)  
**Endpoints:** 28 tRPC routes

- **OT scheduling** with surgeon + anesthesiologist assignment
- **WHO surgical checklist** (sign-in, time-out, sign-out)
- **Anesthesia logs:** Agent + dosing + vitals
- **Equipment inventory & maintenance tracking**
- **Turnover checklist** between cases (cleaning, restocking)
- **Surgeon occupancy analytics** (utilization %, case duration trends)

---

### Module 15: Quality, Safety & Incident Management

**Tables:** 18 (incidents, rca_analyses, corrective_actions, culture_results, blood_bank_data, infection_surveillance, safety_rounds, audit_findings)  
**Endpoints:** 40 tRPC routes

- **Incident reporting:** Adverse events, medication errors, falls (24-hour+ escalation)
- **RCA engine:** Fishbone diagrams + 5-why analysis + CAPA tracking
- **Effectiveness reviews:** Did CAPA reduce incident recurrence?
- **HAI surveillance:** Hospital-acquired infection tracking + antibiogram
- **Antibiotic stewardship:** Resistance trends + prescriber feedback
- **Safety rounds:** Ward-level checklists + findings logging
- **Audit findings:** NABH compliance tracking + corrective action due dates
- **Complaint management:** Patient/staff complaints with root cause analysis

**Key Files:**
- `/routers/incident-reporting.ts`
- `/routers/rca.ts`
- `/routers/infection-surveillance.ts`
- `/routers/safety-audits.ts`
- `/drizzle/schema/15-quality.ts`

---

### Module 16: Dashboards (4-tier KPI System)

**Tables:** 9 (dashboard_kpis, kpi_definitions, dashboard_alerts, dashboard_snapshots)  
**Endpoints:** 17 tRPC routes

- **Wall Display:** Real-time bed occupancy + critical alerts (big-screen ward view)
- **MOD Dashboard (Matron of Duty):** Ward-level handoffs, bed status, incident alerts
- **GM Dashboard (General Manager):** Hospital-wide census, revenue, incident trends, staff performance
- **CEO Dashboard:** High-level KPIs (census, revenue, margin, quality scores, staff turnover)
- **KPI Definitions:** Dynamic rules for alert triggering (e.g., "Census > 85% = yellow")
- **Alert notifications:** Real-time push to relevant stakeholders
- **Historical snapshots:** 30-day rolling archive for trend analysis

**Key Files:**
- `/routers/dashboards.ts`
- `/drizzle/schema/26-dashboards.ts`

---

### Module 17: Integrations & Interoperability

**Tables:** 7 (hl7_messages, integration_logs, event_queue, lsq_sync_records)  
**Endpoints:** 25 tRPC routes

- **LSQ CRM bidirectional sync:** Patient creation/update sync with 168+ records live
- **HL7 v2.5 message routing:** Inbound ORM/OBX from external labs/imaging
- **Event bus architecture:** Publish-subscribe for internal workflows
- **Audit logging:** Every integration event logged for compliance
- **Error handling & retry logic:** Failed messages queued for retry
- **Admin monitoring UI:** View all integration events, retry failed messages

**Key Files:**
- `/routers/lsq.ts`
- `/routers/hl7-analyzer.ts`
- `/routers/integrations.ts`
- `/drizzle/schema/27-integrations.ts`

---

### Module 18: MRD (Medical Records Department) & Document Management

**Tables:** 7 (documents, document_versions, retention_policies, document_audit)  
**Endpoints:** 18 tRPC routes

- **Document upload & versioning:** All clinical documents (scans, PDFs) with version history
- **Retention rules:** Auto-deletion per policy (e.g., "discharge summaries after 7 years")
- **Document search:** Full-text search + metadata filtering
- **Audit trail:** Who accessed which document, when, why
- **Patient portal access:** Patients can download their discharge summaries, imaging reports

---

### Module 19: Even AI — Intelligent Insights Engine

**Tables:** 8 (ai_insight_cards, ai_audit_log, ai_request_queue, claim_predictions, claim_rubrics, nabh_readiness_scores, bed_predictions, ai_template_rules)  
**Endpoints:** 47 tRPC endpoints across 4 engine suites  
**Background Jobs:** 11 AI-powered insight generators (run on schedule via cron)

#### Overview

Even AI is a self-improving, multi-domain LLM integration layer that generates actionable insights across billing, clinical, quality, and operations domains. It uses Azure OpenAI (primary) + Ollama (fallback) for inference, with a feedback loop that tunes rubrics based on user ratings.

#### 4 "Wow Features"

1. **Claim Outcome Predictor:** Analyzes pre-auth data → predicts approval probability + likely denials → suggests mitigation strategies. Accuracy improves as claims settle.
2. **Bed Intelligence:** Real-time bed utilization forecasts. Predicts discharge timing → suggests ICU→ward transfers → optimizes bed availability.
3. **NABH Auditor:** Scans incident + safety audit data → identifies compliance gaps → suggests corrective actions → tracks CAPA effectiveness.
4. **Morning Briefing:** Executive summary of previous 24 hours (census changes, critical incidents, high-spend cases, quality metrics) pushed to GM/CEO/MOD at 6 AM.

#### 8 Database Tables

| Table | Purpose | Rows (Sample) |
|-------|---------|---------------|
| `ai_insight_cards` | Rendered insights (claim predictions, bed forecasts, NABH alerts, daily briefs) | 100s per day |
| `ai_audit_log` | Every insight + user feedback logged for model improvement | 1000s |
| `ai_request_queue` | Pending insight requests (prioritized by urgency) | 10-50 |
| `claim_predictions` | Historical claim outcome predictions + actual outcomes | 50+ per day |
| `claim_rubrics` | Scoring rules for claim approval probability (self-improving) | 30+ rules |
| `nabh_readiness_scores` | Compliance gap scores per department (updated daily) | 17 depts |
| `bed_predictions` | Discharge forecasts per bed (refreshed every 4 hours) | 40 beds |
| `ai_template_rules` | Rules for GPT prompt templates (selectable by insight type) | 25+ rules |

#### 19 Engine Files (in `/lib/ai/`)

**Billing Engines (4 files, ~700 lines):**
- `claim-prediction-engine.ts` — Analyzes claim data → predicts outcome + confidence
- `claim-rubric-engine.ts` — Self-improving rules for claim scoring (learns from settlements)
- `billing-analyzer.ts` — Daily revenue trends, high-spend cases, refund alerts
- `billing-insights-renderer.ts` — Formats claims insights into UI cards

**Clinical Engines (4 files, ~600 lines):**
- `bed-prediction-engine.ts` — Forecasts discharge timing per patient
- `clinical-analyzer.ts` — Labs/vitals trends, medication interaction alerts
- `morning-briefing-generator.ts` — Daily executive summary (census, incidents, quality)
- `clinical-insights-renderer.ts` — Formats clinical insights into cards

**Quality Engines (4 files, ~500 lines):**
- `nabh-audit-engine.ts` — Scans incidents/audits → compliance gap scores
- `quality-analyzer.ts` — RCA effectiveness, antibiotic stewardship trends
- `quality-insights-renderer.ts` — Formats quality alerts into cards
- `incident-trend-analyzer.ts` — Monthly incident patterns, escalation risk

**Operations Engines (4 files, ~400 lines):**
- `shift-handoff-generator.ts` — MOD handoff briefing (bed changes, escalations, pending orders)
- `pharmacy-alert-engine.ts` — Low-stock alerts, expiration warnings
- `operations-analyzer.ts` — Staff occupancy, equipment utilization
- `operations-insights-renderer.ts` — Formats ops insights into cards

**Utility Files (3 files, ~200 lines):**
- `prompt-templates.ts` — Standardized GPT prompts for each insight type
- `feedback-loop-engine.ts` — Collects user ratings → updates rubrics
- `insight-cache.ts` — Caches fresh insights (5-min TTL) for dashboard performance

#### 47 tRPC Endpoints (across 4 categories)

**Billing Endpoints (12):**
- `listClaimPredictions` — Get all active claim predictions
- `createClaimPrediction` — Generate new claim prediction via LLM
- `rateClaimPrediction` — User feedback (helpful/not helpful/incorrect)
- `getBillingInsights` — Daily revenue summary + high-spend alerts
- `exportBillingReport` — CSV export of billing insights
- ... (7 more)

**Clinical Endpoints (12):**
- `getBedPredictions` — All discharge forecasts
- `updateBedPrediction` — Clinician override (accelerate discharge)
- `getMorningBriefing` — Executive summary for GM/CEO
- `getClinicalInsights` — Lab/vitals trends + alerts
- ... (8 more)

**Quality Endpoints (12):**
- `getNABHReadinessScores` — Compliance gap scores per department
- `getIncidentTrends` — Month-over-month incident analysis
- `getRCAEffectiveness` — CAPA closure rates + recurrence rates
- ... (9 more)

**Operations Endpoints (11):**
- `getShiftHandoff` — MOD briefing for next shift
- `getPharmacyAlerts` — Stock + expiration alerts
- `getOperationsInsights` — Staff/equipment utilization
- ... (8 more)

#### 11 Background Jobs (triggered by cron, results → dashboard cards)

| Job | Frequency | Input | Output | Target |
|-----|-----------|-------|--------|--------|
| `morning-briefing` | 6 AM daily | Encounters, orders, incidents (24h) | Executive summary | GM/CEO/MOD |
| `bed-intelligence` | Every 4h | Patient encounters, discharge plans | Discharge forecasts | Nurse station |
| `claim-predictions` | Every 6h | New admissions, insurance data | Claim outcome probabilities | Billing |
| `clinical-scan` | Every 2h | Labs, vitals, notes | Alert on abnormal trends | Doctor |
| `shift-handoff` | 6 AM + 2 PM | Bed changes, new orders, escalations | MOD briefing | Ward staff |
| `nabh-audit` | Daily | Incidents, audits (7d window) | Compliance gap report | QA/CEO |
| `pharmacy-alerts` | Every 4h | Inventory, expiration dates | Stock + expiration warnings | Pharmacist |
| `quality-monitor` | Daily | RCA, incidents, audits (30d) | Trend analysis + alerts | Quality lead |
| `expire-cards` | Daily | All insight cards (30d+ old) | Archive old cards | Dashboard |
| `process-queue` | Every 1h | ai_request_queue | Dequeue + run LLM insights | Any |
| `feedback-loop` | Daily | User ratings (24h) | Update rubrics (if >5 samples) | AI system |

#### 10 UI Components (in `/components/ai-analysis/`)

- `ClaimPredictionCard` — Render claim outcome prediction with confidence
- `BedIntelligenceCard` — Show discharge forecast + suggested actions
- `NABHReadinessCard` — Compliance gap heatmap per department
- `MorningBriefingCard` — Executive summary panel
- `InsightFeedbackButtons` — "Helpful / Not Helpful" rating UI
- `InsightLoader` — Skeleton loading state
- `InsightChart` — Generic trend chart (line/bar/pie)
- `InsightTable` — Sortable insights list
- `AIObservatory` — Admin panel for all insights + feedback audit trail
- `InsightDetailModal` — Drill-down view with full reasoning

#### Workflow Example: Claim Prediction

1. **Trigger:** New admission created → insurance pre-auth request recorded
2. **Job:** `claim-predictions` cron fires (every 6 hours)
3. **Processing:**
   - Query pre-auth request + patient demographics + diagnosis + proposed charges
   - Pass to `claim-prediction-engine.ts` → Azure OpenAI prompt
   - Model returns: approval probability (0-100%), likely denial reasons, mitigation suggestions
   - Store result in `claim_predictions` table + `ai_insight_cards` table
4. **Display:** Billing officer sees card on `/billing/claims` page with prediction
5. **Feedback:** Officer clicks "Correct / Incorrect" after claim settles
6. **Loop:** `feedback-loop` job collects ratings → updates `claim_rubrics` table → next run uses improved rules

#### Key Technical Patterns

- **Fallback LLM:** If Azure fails, automatically retry via Ollama (Qwen 2.5 14B)
- **Request queuing:** High-load requests queued in `ai_request_queue` → processed by `process-queue` job
- **Result caching:** Insights cached for 5 minutes to prevent duplicate LLM calls
- **User feedback:** Rating system improves rubrics; only update if N>5 samples collected
- **Admin Observatory:** `/admin/ai` page shows all insights + feedback audit trail + rubric scores
- **Cost control:** Track LLM token usage per insight type; alert if costs exceed threshold

---

## Database Schema Overview

### 30 Schema Files, 170+ Tables

Even OS organizes 170+ PostgreSQL tables across 30 logical schema files in `/drizzle/schema/`. Each file groups related tables by business domain.

| Schema File | Module | Table Count | Purpose |
|-------------|--------|-------------|---------|
| `00-foundations.ts` | Auth/RBAC | 16 | Authentication, roles, permissions, audit, sessions |
| `01-master-data.ts` | Masters | 10 | Charges, drugs, GST, approvals, order sets, consent, discharge |
| `03-registration.ts` | Patient Registry | 22 | Patients, encounters, insurance, next-of-kin, LSQ sync |
| `04-clinical.ts` | EMR | 10 | Conditions, allergies, procedures |
| `05-emr.ts` | EMR | 5 | Observations, vitals, NEWS2 |
| `06-notes.ts` | EMR | 5 | Clinical notes, co-sign queue |
| `07-cpoe.ts` | CPOE | 6 | Medication orders, CDS, service requests, diet/nursing |
| `08-pathways.ts` | CPOE | 9 | Care pathways, milestones, escalation, variance |
| `09-billing.ts` | Billing | 7 | Accounts, deposits, invoices, packages, room charges |
| `10-insurance.ts` | Claims | 5 | Pre-auth, claims, items, TPA deductions, settlement |
| `11-refunds.ts` | Refunds | 2 | Refunds, transactions |
| `12-pharmacy.ts` | Pharmacy | 8 | Vendors, inventory, dispensing, POs, narcotics, alerts |
| `13-lab-radiology.ts` | Lab/Rad | 7 | Panels, orders, results, specimens, imaging, LOINC |
| `14-ot-management.ts` | OT | 6 | Schedules, teams, anesthesia, equipment, turnover |
| `15-quality.ts` | Quality | 6 | Incidents, RCA, corrections, effectiveness |
| `16-rca.ts` | RCA | 6 | RCA analyses (extended, separate from incidents) |
| `17-infection-surveillance.ts` | Infection Control | 5 | HAI, antibiogram, stewardship data |
| `18-safety-audits.ts` | Safety | 7 | Safety rounds, audits, complaints, NABH |
| `19-critical-values.ts` | Clinical | 2 | Critical lab values, notification |
| `20-test-catalog.ts` | Lab | 3 | Test definitions, LOINC mapping |
| `21-lab-reports.ts` | Lab | 2 | Report templates, formatting |
| `22-culture-histopath.ts` | Lab | 4 | Culture orders, histopath, results |
| `23-blood-bank.ts` | Lab | 3 | Blood bank inventory, transfusion |
| `24-qc-levey-jennings.ts` | Lab | 3 | QC tracking, Levey-Jennings charts |
| `25-hl7-analyzer.ts` | Integration | 3 | HL7 messages, routing, parsing |
| `26-dashboards.ts` | Dashboards | 9 | KPIs, definitions, alerts, snapshots |
| `27-integrations.ts` | Integration | 7 | Event queue, LSQ sync, audit logs |
| `28-mrd-documents.ts` | MRD | 7 | Documents, versions, retention, audit |
| `29-hardening.ts` | Security | 7 | Security logs, compliance, disaster recovery |
| `30-patient-portal.ts` | Patient Portal | 8 | Portal users, preferences, feedback, payments |

### Key Patterns Across All Tables

1. **Multi-tenancy:** `hospital_id` foreign key on every table (except global config)
2. **Audit trail:** `created_by`, `created_at`, `updated_by`, `updated_at` on every table
3. **Soft deletes:** `deleted_at` timestamp for logical deletion (GDPR compliance)
4. **Relationships:** Drizzle `relations()` define 1:1, 1:N, and N:N associations
5. **Enums:** Type-safe enumerations (e.g., `user_role`, `incident_severity`, `claim_status`)
6. **Foreign keys:** Cascading deletes where appropriate; restrict on audit tables

---

## API Reference

### 51 tRPC Routers (781 Endpoints)

All application logic is exposed via tRPC routers. Type-safe end-to-end; frontend imports types from backend.

**Router Breakdown:**
- `auth.ts` (8 endpoints) — Login, logout, password reset, device trust
- `users.ts` (6) — User CRUD, PIN reset
- `profile.ts` (3) — Get, update, change password
- `patient.ts` (18) — Patient CRUD, LSQ sync, intake wizard
- `dedup.ts` (6) — Detect, review, merge duplicates
- `encounter.ts` (22) — Admission, transfer, discharge, checklist
- `clinical-notes.ts` (8) — Create, list, edit, co-sign
- `conditions.ts` (5) — Add, list, resolve diagnoses
- `allergies.ts` (4) — Add, list, update severity
- `observations.ts` (7) — Log vitals, get trends, NEWS2 calc
- `procedures.ts` (5) — Document, list, mark complete
- `medication-orders.ts` (12) — Create, modify, discontinue, order status
- `service-requests.ts` (8) — Consults, imaging, lab orders
- `care-pathways.ts` (9) — Select, milestone tracking, variance
- `billing.ts` (14) — Accounts, invoices, deposits, room charges
- `insurance-claims.ts` (15) — Pre-auth, claims, settlements
- `refund-revenue.ts` (8) — Refunds, analytics, collections
- `charge-master.ts` (7) — List, create, update, version history
- `drug-master.ts` (6) — Search, dosing, interactions
- `pharmacy.ts` (12) — Inventory, dispensing, narcotics, POs
- `lab-radiology.ts` (15) — Order, result entry, LOINC, QC
- `lab-reports.ts` (5) — Template, generate, email
- `test-catalog.ts` (4) — List, create, versions
- `culture-histopath.ts` (6) — Order, results, interpretation
- `blood-bank.ts` (5) — Inventory, transfusion, compatibility
- `qc-levey-jennings.ts` (5) — Log QC, chart generation, alerts
- `hl7-analyzer.ts` (8) — Parse, route, queue, logs
- `bed.ts` (8) — Grid, allocate, transfer, discharge
- `wristband.ts` (4) — Generate, print queue, history
- `ot-management.ts` (12) — Schedule, WHO checklist, anesthesia
- `incident-reporting.ts` (10) — Report, list, escalate, close
- `rca.ts` (8) — Create, fishbone, 5-why, CAPA
- `infection-surveillance.ts` (7) — HAI, antibiogram, stewardship
- `safety-audits.ts` (9) — Round, audit, findings, compliance
- `critical-values.ts` (4) — Flag, notify, acknowledge
- `nabh-indicators.ts` (6) — Score, trends, compliance
- `approval-hierarchies.ts` (5) — Config, approval workflow
- `consent-templates.ts` (4) — List, create, sign
- `discharge-templates.ts` (4) — List, create, auto-populate
- `order-sets.ts` (5) — List, create, use, version
- `dashboards.ts` (17) — KPI, wall view, MOD, GM, CEO, alerts
- `integrations.ts` (12) — Event queue, event bus, audit logs
- `lsq.ts` (8) — Sync patients, bidirectional
- `mrd-documents.ts` (8) — Upload, version, search, retention
- `patient-portal.ts` (12) — Login, profile, discharge, payments
- `hardening.ts` (9) — Security logs, compliance, DR/backup
- `even-ai.ts` (47) — Claim predictions, bed intelligence, NABH auditor, morning briefing, etc.

**TOTAL: 51 routers, 781 endpoints**

### 19 REST Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/trpc/[trpc]` | POST | Main tRPC handler |
| `/api/health` | GET | Readiness check (returns status, latency_ms) |
| `/api/migrations/dashboards` | POST | Run dashboard migration |
| `/api/migrations/even-ai` | POST | Run Even AI migration |
| `/api/migrations/hardening` | POST | Run security migration |
| `/api/migrations/integrations` | POST | Run integrations migration |
| `/api/migrations/mrd-documents` | POST | Run MRD migration |
| `/api/ai/health` | GET | AI service health (Azure + Ollama status) |
| `/api/ai/jobs/morning-briefing` | POST | Trigger morning briefing job |
| `/api/ai/jobs/bed-intelligence` | POST | Trigger bed prediction job |
| `/api/ai/jobs/claim-predictions` | POST | Trigger claim outcome prediction |
| `/api/ai/jobs/clinical-scan` | POST | Trigger clinical alert scan |
| `/api/ai/jobs/shift-handoff` | POST | Trigger MOD handoff briefing |
| `/api/ai/jobs/nabh-audit` | POST | Trigger NABH compliance scan |
| `/api/ai/jobs/pharmacy-alerts` | POST | Trigger pharmacy alerts |
| `/api/ai/jobs/quality-monitor` | POST | Trigger quality trend analysis |
| `/api/ai/jobs/expire-cards` | POST | Trigger old card cleanup |
| `/api/ai/jobs/process-queue` | POST | Process queued insight requests |

---

## Environment Variables

### Required (Startup Blocking)

```env
DATABASE_URL=postgresql://user:password@region.neon.tech:5432/even_os
JWT_SECRET=your-32-character-minimum-secret-here
ENCRYPTION_KEY=your-32-character-encryption-key
ADMIN_KEY=your-admin-key-1234567890
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

### Optional (Dev Defaults Work)

```env
RESEND_API_KEY=re_test_xxxxx
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4-turbo
OLLAMA_BASE_URL=http://localhost:11434
BLOB_READ_WRITE_TOKEN=your-blob-token
```

---

## Deployment

### Local Development

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

### Production (Vercel)

- GitHub repository connected to Vercel
- Auto-deploy on git push to main
- Migrations run post-deployment via API routes

### Post-Deployment Health Check

```bash
curl https://even-os-hospital.vercel.app/api/health
# Response: { "status": "ok", "latency_ms": 45 }
```

---

## Security & Compliance

### Authentication & Authorization

- **JWT HS256:** Stateless, cookie-based authentication
- **Multi-role RBAC:** 11 predefined roles
- **Device fingerprinting:** Prevents token theft
- **Break-glass access:** Super admin can assume any user role (audit-logged)
- **MFA support:** Placeholder for TOTP-based MFA

### Data Protection

- **Encryption at rest:** AES-256-GCM for sensitive fields
- **Encryption in transit:** HTTPS/TLS 1.3
- **Audit logging:** Every state change tracked
- **Soft deletes:** Data recovery via `deleted_at` timestamp
- **HIPAA-ready:** Designed for HIPAA compliance (BAA available)
- **NABH compliance:** 100 seeded indicators tracked

---

## Development Workflow

### Git Workflow

```bash
git checkout -b feature/your-feature
git add .
git commit -m "feat: description"
git push origin feature/your-feature
# Create PR on GitHub
# Automatic Vercel preview deployment
# After merge: Automatic production deployment
```

### Database Migrations

```bash
# 1. Modify schema file
# 2. Run type check
pnpm typecheck
# 3. Push to database
pnpm db:push
# 4. Verify in Drizzle Studio
pnpm db:studio
# 5. Commit & push
git add drizzle/schema/XX.ts
git commit -m "chore: schema update"
git push
```

### Code Quality

```bash
pnpm format       # Prettier
pnpm typecheck    # TypeScript
pnpm lint         # ESLint
```

---

## Troubleshooting

### Common Issues

1. **Database Connection Error:** Verify `DATABASE_URL` in `.env.local`, check Neon whitelist
2. **JWT_SECRET not set:** Copy `.env.example`, generate secrets with `openssl rand -hex 16`
3. **TypeScript Error on build:** Clear cache `rm -rf .next`, reinstall `pnpm install --force`
4. **403 Unauthorized on /admin:** Verify user role is `super_admin`, clear cookies, log back in
5. **Drizzle Studio Failed:** Ensure `DATABASE_URL` set, run `pnpm db:studio`, open `http://local.drizzle.studio`
6. **Vercel Deployment Fails:** Check bundle size, enable code splitting, reduce background jobs
7. **Email Not Sending (Resend):** Verify API key, check Resend dashboard, add sender to verified list
8. **Azure OpenAI Timeout:** Verify credentials, fallback to Ollama, check AI logs at `/admin/ai`
9. **Bed Grid Not Updating:** Verify GetStream connection, check browser console, refresh page
10. **Dedup Queue Growing:** Review `/admin/dedup`, manually merge duplicates or mark as "Not duplicates"

---

**End of Even OS Architecture & User Manual — v1.0**

**GitHub Repository:** https://github.com/vinaybhardwaj-commits/even-os  
**Live Application:** https://even-os-hospital.vercel.app  
**Support:** See Admin Panel at `/admin` for configuration, monitoring, and troubleshooting
