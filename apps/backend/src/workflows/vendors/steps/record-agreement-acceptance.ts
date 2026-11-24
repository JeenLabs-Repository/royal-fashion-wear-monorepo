import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getVendorOnboardingSettings } from "../../../lib/settings/vendor-onboarding";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

export type RecordAgreementAcceptanceInput = {
  vendor_user_id: string;
  version: string;
  ip?: string | null;
  user_agent?: string | null;
};

export type AgreementAcceptanceResult = { version: string; accepted_at: string };

const toIso = (value: Date | string): string => new Date(value).toISOString();

export const recordAgreementAcceptanceStep = createStep(
  "record-agreement-acceptance",
  async (input: RecordAgreementAcceptanceInput, { container }) => {
    const vendorModule = getVendorModule(container);

    const settings = await getVendorOnboardingSettings(container);
    if (input.version !== settings.current_agreement_version) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The agreement was updated. Reload and read the new version.",
        "agreement_version_changed"
      );
    }

    const [user] = await vendorModule.listVendorUsers(
      { id: input.vendor_user_id },
      { select: ["id"], take: 1 }
    );
    if (!user) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }

    const [existing] = await vendorModule.listVendorAgreementAcceptances(
      { vendor_user_id: input.vendor_user_id, version: input.version },
      { take: 1, order: { accepted_at: "ASC" } }
    );
    if (existing) {
      const unchanged: AgreementAcceptanceResult = {
        version: existing.version,
        accepted_at: toIso(existing.accepted_at),
      };
      return new StepResponse(unchanged, {
        created_id: null as string | null,
      });
    }

    const [created] = await vendorModule.createVendorAgreementAcceptances([
      {
        vendor_user_id: input.vendor_user_id,
        version: input.version,
        accepted_at: new Date(),
        ip: input.ip ?? null,
        user_agent: input.user_agent ? input.user_agent.slice(0, 200) : null,
      },
    ]);
    const result: AgreementAcceptanceResult = {
      version: created.version,
      accepted_at: toIso(created.accepted_at),
    };
    return new StepResponse(result, {
      created_id: created.id as string | null,
    });
  },
  async (compensation, { container }) => {
    if (!compensation?.created_id) {
      return;
    }
    await getVendorModule(container).deleteVendorAgreementAcceptances([
      compensation.created_id,
    ]);
  }
);
