import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

// A vendor starts out waiting for the owner and never goes back there, so the
// only statuses a workflow may set are these two.
export const SETTABLE_STATUSES = ["active", "suspended"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export function assertSettableStatus(status: string): asserts status is SettableStatus {
  if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A vendor can only be set to active or suspended."
    );
  }
}

export type SetVendorStatusInput = {
  vendor_id: string;
  status: SettableStatus;
  reason?: string;
  set_activated_at_if_null?: boolean;
  clear_suspension?: boolean;
};

type StatusSnapshot = {
  status: string;
  activated_at: string | null;
  suspended_at: string | null;
  suspend_reason: string | null;
};

const toIso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const toDate = (value: string | null): Date | null => (value ? new Date(value) : null);

export const setVendorStatusStep = createStep(
  "set-vendor-status",
  async (input: SetVendorStatusInput, { container }) => {
    assertSettableStatus(input.status);
    const vendorModule = getVendorModule(container);
    const [vendor] = await vendorModule.listVendors({ id: input.vendor_id }, { take: 1 });
    if (!vendor) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor not found.");
    }

    const previous: StatusSnapshot = {
      status: vendor.status,
      activated_at: toIso(vendor.activated_at),
      suspended_at: toIso(vendor.suspended_at),
      suspend_reason: vendor.suspend_reason ?? null,
    };

    const now = new Date();
    const patch: Record<string, unknown> = { id: vendor.id, status: input.status };
    if (input.status === "active") {
      if (input.set_activated_at_if_null && !vendor.activated_at) {
        patch.activated_at = now;
      }
      if (input.clear_suspension) {
        patch.suspended_at = null;
        patch.suspend_reason = null;
      }
    } else {
      patch.suspended_at = now;
      patch.suspend_reason = (input.reason ?? "").trim() || null;
    }

    await vendorModule.updateVendors([patch] as never);
    return new StepResponse(
      { vendor_id: vendor.id, previous_status: vendor.status },
      { vendor_id: vendor.id, previous }
    );
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    const { vendor_id, previous } = compensation;
    await getVendorModule(container).updateVendors([
      {
        id: vendor_id,
        status: previous.status,
        activated_at: toDate(previous.activated_at),
        suspended_at: toDate(previous.suspended_at),
        suspend_reason: previous.suspend_reason,
      },
    ] as never);
  }
);
