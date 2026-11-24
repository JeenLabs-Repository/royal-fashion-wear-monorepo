import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { VENDOR_MODULE } from "../../../modules/vendor";
import type VendorModuleService from "../../../modules/vendor/service";

export type CreateVendorRecordsInput = {
  internal_name: string;
  contact_name: string;
  contact_email: string;
  note?: string;
};

export const createVendorRecordsStep = createStep(
  "create-vendor-records",
  async (input: CreateVendorRecordsInput, { container }) => {
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    const created = await vendor.createVendors({
      internal_name: input.internal_name,
      contact_name: input.contact_name,
      contact_email: input.contact_email,
      note: input.note ?? null,
    });

    let user;
    try {
      user = await vendor.createVendorUsers({
        vendor_id: created.id,
        email: input.contact_email,
        name: input.contact_name,
      });
    } catch (error) {
      // A failing step is not compensated, so remove the vendor here.
      await vendor.deleteVendors([created.id]);
      throw error;
    }

    return new StepResponse(
      { vendor_id: created.id, user_id: user.id },
      { vendor_id: created.id, user_id: user.id }
    );
  },
  async (data, { container }) => {
    if (!data) {
      return;
    }
    const vendor = container.resolve(VENDOR_MODULE) as VendorModuleService;
    await vendor.deleteVendorUsers([data.user_id]);
    await vendor.deleteVendors([data.vendor_id]);
  }
);
