import {
  agreementFilesExist,
  isValidAgreementVersion,
} from "../../modules/vendor/agreements";
import { createCardReader } from "./card-reader";

export const VENDOR_ONBOARDING_IDENTIFIER = "integration-vendor-onboarding";

export type VendorOnboardingSettings = {
  /** Hours an invitation link stays valid */
  invite_expiry_hours: number;
  /** Version label of the agreement and packing guideline vendors accept */
  current_agreement_version: string;
};

export const VENDOR_ONBOARDING_DEFAULTS: VendorOnboardingSettings = {
  invite_expiry_hours: 72,
  current_agreement_version: "v1-draft",
};

const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 336;

/**
 * Settings for vendor onboarding. The card that stores them is built in the
 * settings plugin repository; until it is installed every read returns the
 * defaults. Both stored values are checked again here, because a card cannot
 * know which agreement files exist in this app.
 */
export const getVendorOnboardingSettings =
  createCardReader<VendorOnboardingSettings>({
    identifier: VENDOR_ONBOARDING_IDENTIFIER,
    defaults: VENDOR_ONBOARDING_DEFAULTS,
    tag: "settings",
    parse: (raw, defaults, warn) => {
      let hours = defaults.invite_expiry_hours;
      const storedHours = raw.invite_expiry_hours;
      if (storedHours !== undefined) {
        if (
          typeof storedHours === "number" &&
          Number.isInteger(storedHours) &&
          storedHours >= MIN_EXPIRY_HOURS &&
          storedHours <= MAX_EXPIRY_HOURS
        ) {
          hours = storedHours;
        } else {
          warn(
            `invite_expiry_hours must be a whole number from ${MIN_EXPIRY_HOURS} to ${MAX_EXPIRY_HOURS}; using ${defaults.invite_expiry_hours}`
          );
        }
      }

      let version = defaults.current_agreement_version;
      const storedVersion = raw.current_agreement_version;
      if (storedVersion !== undefined) {
        if (
          typeof storedVersion !== "string" ||
          !isValidAgreementVersion(storedVersion)
        ) {
          warn(
            `current_agreement_version is not a valid label; using ${defaults.current_agreement_version}`
          );
        } else if (!agreementFilesExist(storedVersion)) {
          warn(
            `the documents for agreement version ${storedVersion} do not exist; using ${defaults.current_agreement_version}`
          );
        } else {
          version = storedVersion;
        }
      }

      return { invite_expiry_hours: hours, current_agreement_version: version };
    },
  });
