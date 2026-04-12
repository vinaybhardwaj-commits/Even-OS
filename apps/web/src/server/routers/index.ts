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
});

export type AppRouter = typeof appRouter;
