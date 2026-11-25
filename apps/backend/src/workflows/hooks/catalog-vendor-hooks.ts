import {
  hideVendorProducts,
  restoreVendorProducts,
} from "../../lib/catalog/vendor-product-visibility";
import { onVendorActivating, onVendorSuspended } from "../../modules/vendor/public";

// Medusa 2.22.7 allows only one handler per createHook (decision 0015 + measured).
// Phase 3's onVendor* helpers own the single attach to:
//   suspendVendorWorkflow.hooks.vendorSuspended
//   vendorActivationGateWorkflow.hooks.vendorActivating
// and fan out to every registered plugin and this catalog coupling.

type Changed = { vendor_id: string; product_ids: string[] };

// Compensation receives only `{ container }` from the registry, so the last change
// per hook is kept here for the undo that runs when a later step or peer handler fails.
let lastSuspended: Changed | null = null;
let lastActivating: Changed | null = null;

// Suspension runs after the status change: hide every live product of the vendor.
onVendorSuspended(
  async ({ vendor_id }, { container }) => {
    const product_ids = await hideVendorProducts(container, vendor_id);
    lastSuspended = { vendor_id, product_ids };
  },
  async ({ container }) => {
    const changed = lastSuspended;
    lastSuspended = null;
    if (!changed || changed.product_ids.length === 0) {
      return;
    }
    await restoreVendorProducts(container, changed.vendor_id, {
      productIds: changed.product_ids,
    });
  }
);

// Activation and reactivation run this before the status change. It relinks the
// products a suspension hid. If a peer handler blocks (or a later step fails),
// compensation re-hides exactly those products.
onVendorActivating(
  async ({ vendor_id }, { container }) => {
    const product_ids = await restoreVendorProducts(container, vendor_id);
    lastActivating = { vendor_id, product_ids };
  },
  async ({ container }) => {
    const changed = lastActivating;
    lastActivating = null;
    if (!changed || changed.product_ids.length === 0) {
      return;
    }
    await hideVendorProducts(container, changed.vendor_id, {
      productIds: changed.product_ids,
    });
  }
);
