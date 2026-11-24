import type { MedusaContainer } from "@medusajs/framework/types";
import { MedusaError } from "@medusajs/framework/utils";
import { getVendorOnboardingSettings } from "../settings/vendor-onboarding";
import { getVendorModule } from "./vendor-module";

export type VendorEligibilityReason = "not_active" | "agreement_outdated";

export type VendorEligibility = {
  eligible: boolean;
  status: string;
  reasons: VendorEligibilityReason[];
};

type ResolvingContainer = Pick<MedusaContainer, "resolve">;

/** Loads one vendor row or throws a not found error. */
export async function loadVendor(container: ResolvingContainer, vendorId: string) {
  const [vendor] = await getVendorModule(container).listVendors(
    { id: vendorId },
    { take: 1 }
  );
  if (!vendor) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Vendor not found.");
  }
  return vendor;
}

/**
 * True when any user of the vendor accepted the agreement version the settings
 * name today. The version is read at call time, so a changed version reopens
 * the step with no other action.
 */
export async function isAgreementCurrent(
  container: ResolvingContainer,
  vendorId: string
): Promise<boolean> {
  const vendorModule = getVendorModule(container);
  const { current_agreement_version: version } = await getVendorOnboardingSettings(
    container as MedusaContainer
  );
  const users = await vendorModule.listVendorUsers(
    { vendor_id: vendorId },
    { select: ["id"], take: null }
  );
  if (users.length === 0) {
    return false;
  }
  const accepted = await vendorModule.listVendorAgreementAcceptances(
    { vendor_user_id: users.map((user) => user.id), version },
    { select: ["id"], take: 1 }
  );
  return accepted.length > 0;
}

export async function getVendorEligibility(
  container: ResolvingContainer,
  vendorId: string
): Promise<VendorEligibility> {
  const vendor = await loadVendor(container, vendorId);
  const reasons: VendorEligibilityReason[] = [];
  if (vendor.status !== "active") {
    reasons.push("not_active");
  }
  if (!(await isAgreementCurrent(container, vendorId))) {
    reasons.push("agreement_outdated");
  }
  return { eligible: reasons.length === 0, status: vendor.status, reasons };
}

/** The single check the catalog routes call before a vendor may create or change listings. */
export async function assertVendorEligible(
  container: ResolvingContainer,
  vendorId: string
): Promise<void> {
  const eligibility = await getVendorEligibility(container, vendorId);
  if (!eligibility.eligible) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This vendor is not eligible to list products yet.",
      "vendor_ineligible"
    );
  }
}
