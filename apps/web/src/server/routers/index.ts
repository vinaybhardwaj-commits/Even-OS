import { router } from '../trpc';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { profileRouter } from './profile';
import { chargeMasterRouter } from './charge-master';
import { drugMasterRouter } from './drug-master';
import { orderSetsRouter } from './order-sets';
import { consentTemplatesRouter } from './consent-templates';
import { dischargeTemplatesRouter } from './discharge-templates';
import { gstRatesRouter } from './gst-rates';
import { approvalHierarchiesRouter } from './approval-hierarchies';
import { nabhIndicatorsRouter } from './nabh-indicators';
import { patientRouter } from './patient';
import { dedupRouter } from './dedup';
import { bedRouter } from './bed';
import { wristbandRouter } from './wristband';
import { encounterRouter } from './encounter';
import { lsqRouter } from './lsq';
import { clinicalOrdersRouter } from './clinical-orders';
import { billingRouter } from './billing';
import { billingAccountsRouter } from './billing-accounts';
import { clinicalFormsRouter } from './clinical-forms';
import { conditionsRouter } from './conditions';
import { allergiesRouter } from './allergies';
import { observationsRouter } from './observations';
import { clinicalNotesRouter } from './clinical-notes';
import { proceduresRouter } from './procedures';
import { medicationOrdersRouter } from './medication-orders';
import { carePathwaysRouter } from './care-pathways';
import { insuranceClaimsRouter } from './insurance-claims';
import { refundRevenueRouter } from './refund-revenue';
import { pharmacyRouter } from './pharmacy';
import { labRadiologyRouter } from './lab-radiology';
import { otManagementRouter } from './ot-management';
import { incidentReportingRouter } from './incident-reporting';
import { rcaRouter } from './rca';
import { infectionSurveillanceRouter } from './infection-surveillance';
import { safetyAuditsRouter } from './safety-audits';
import { criticalValuesRouter } from './critical-values';
import { testCatalogRouter } from './test-catalog';
import { labReportsRouter } from './lab-reports';
import { cultureHistopathRouter } from './culture-histopath';
import { bloodBankRouter } from './blood-bank';
import { qcLeveyJenningsRouter } from './qc-levey-jennings';
import { hl7AnalyzerRouter } from './hl7-analyzer';
import { drizzleTestRouter } from './drizzle-test';
import { dashboardsRouter } from './dashboards';
import { integrationsRouter } from './integrations';
import { mrdDocumentsRouter } from './mrd-documents';
import { hardeningRouter } from './hardening';
import { patientPortalRouter } from './patient-portal';
import { evenAIRouter } from './even-ai';
import { rolesRouter } from './roles';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  profile: profileRouter,
  chargeMaster: chargeMasterRouter,
  drugMaster: drugMasterRouter,
  orderSets: orderSetsRouter,
  consentTemplates: consentTemplatesRouter,
  dischargeTemplates: dischargeTemplatesRouter,
  gstRates: gstRatesRouter,
  approvalHierarchies: approvalHierarchiesRouter,
  nabhIndicators: nabhIndicatorsRouter,
  patient: patientRouter,
  dedup: dedupRouter,
  bed: bedRouter,
  wristband: wristbandRouter,
  encounter: encounterRouter,
  lsq: lsqRouter,
  clinicalOrders: clinicalOrdersRouter,
  billing: billingRouter,
  billingAccounts: billingAccountsRouter,
  clinicalForms: clinicalFormsRouter,
  conditions: conditionsRouter,
  allergies: allergiesRouter,
  observations: observationsRouter,
  clinicalNotes: clinicalNotesRouter,
  procedures: proceduresRouter,
  medicationOrders: medicationOrdersRouter,
  carePathways: carePathwaysRouter,
  insuranceClaims: insuranceClaimsRouter,
  refundRevenue: refundRevenueRouter,
  pharmacy: pharmacyRouter,
  labRadiology: labRadiologyRouter,
  otManagement: otManagementRouter,
  incidentReporting: incidentReportingRouter,
  rca: rcaRouter,
  infectionSurveillance: infectionSurveillanceRouter,
  safetyAudits: safetyAuditsRouter,
  criticalValues: criticalValuesRouter,
  testCatalog: testCatalogRouter,
  labReports: labReportsRouter,
  cultureHistopath: cultureHistopathRouter,
  bloodBank: bloodBankRouter,
  qcLeveyJennings: qcLeveyJenningsRouter,
  hl7Analyzer: hl7AnalyzerRouter,
  drizzleTest: drizzleTestRouter,
  dashboards: dashboardsRouter,
  integrations: integrationsRouter,
  mrdDocuments: mrdDocumentsRouter,
  hardening: hardeningRouter,
  patientPortal: patientPortalRouter,
  evenAI: evenAIRouter,
  roles: rolesRouter,
});

export type AppRouter = typeof appRouter;
