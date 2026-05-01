import { router } from '../../trpc';
import { scmVendorsRouter } from './vendors';
import { scmItemsRouter } from './items';
import { scmInventoryRouter } from './inventory';
import { scmPurchaseOrdersRouter } from './purchase-orders';
import { scmAlertsRouter } from './alerts';
import { scmRolesRouter } from './roles';
import { scmIndentsRouter } from './indents';

// ============================================================
// SCM ROOT ROUTER — Phase 1.4 router split (Q2 Path C)
//
// Composes 5 SCM sub-routers; wired into appRouter.scm in routers/index.ts.
// Backward compat: pharmacy-clinical.ts re-exports each procedure under
// the legacy pharmacy.* namespace so existing UI / tests continue to work
// while admin pages migrate to scm.* (Phase 1.5+).
//
// Phase 8 cleanup: drops the deprecation re-exports once all callers
// migrate to scm.*.
//
// Sub-router map:
//   scm.vendors.{create, list, update, detail}
//   scm.items.{create, list, detail, update, transitionStatus}
//   scm.inventory.{add, list, detail, adjust, transfer, expiryWatchlist}
//   scm.purchaseOrders.{create, addItem, approve, sendToVendor, receive, list, listItems}
//   scm.alerts.{checkLowStock, list, resolve}
//   scm.roles.{assign, revoke, list, listForUser}
//   scm.indents.{create, list, listForMyApproval, detail, listItems, approve, reject, cancel, issue, acknowledge, close}
// ============================================================

export const scmRouter = router({
  vendors: scmVendorsRouter,
  items: scmItemsRouter,
  inventory: scmInventoryRouter,
  purchaseOrders: scmPurchaseOrdersRouter,
  alerts: scmAlertsRouter,
  roles: scmRolesRouter,
  indents: scmIndentsRouter,
});
