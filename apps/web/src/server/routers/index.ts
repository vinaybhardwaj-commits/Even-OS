import { router } from '../trpc';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { profileRouter } from './profile';
import { chargeMasterRouter } from './charge-master';
import { drugMasterRouter } from './drug-master';
import { orderSetsRouter } from './order-sets';
import { consentTemplatesRouter } from './consent-templates';
import { dischargeTemplatesRouter } from './discharge-templates';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  profile: profileRouter,
  chargeMaster: chargeMasterRouter,
  drugMaster: drugMasterRouter,
  orderSets: orderSetsRouter,
  consentTemplates: consentTemplatesRouter,
  dischargeTemplates: dischargeTemplatesRouter,
});

export type AppRouter = typeof appRouter;
