import { MedusaError } from "@medusajs/framework/utils";

export type VendorAdminSection = {
  key: string;
  title: string;
  /** A path inside the Admin. `:vendorId` is replaced by the vendor's id. */
  path: string;
};

const VENDOR_ID_PLACEHOLDER = ":vendorId";
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// One leading slash, then letters, digits and the characters - . _ ~ and /.
// No scheme, no colon, no percent escape, no whitespace, no backslash.
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/;

const sections = new Map<string, VendorAdminSection>();

const invalid = (message: string) =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message);

/**
 * Registers a link that the vendor detail page shows under "Plugin sections".
 * A plugin calls this once when it loads. The path must stay inside the Admin.
 */
export function registerVendorAdminSection(section: VendorAdminSection): void {
  if (!KEY_PATTERN.test(section.key)) {
    throw invalid(
      `The section key "${section.key}" must use lower-case letters, digits, hyphens and underscores.`
    );
  }
  if (section.title.trim().length < 1 || section.title.length > 80) {
    throw invalid("The section title must be 1 to 80 characters.");
  }
  const probe = section.path.split(VENDOR_ID_PLACEHOLDER).join("x");
  if (!SAFE_PATH.test(probe) || probe.includes("..")) {
    throw invalid(
      `The section path "${section.path}" must be a path inside the Admin that starts with one slash.`
    );
  }
  if (sections.has(section.key)) {
    throw new MedusaError(
      MedusaError.Types.DUPLICATE_ERROR,
      `A section with the key "${section.key}" is already registered.`
    );
  }
  sections.set(section.key, { key: section.key, title: section.title, path: section.path });
}

/** The registered sections with the vendor id put into every path. */
export function listVendorAdminSections(vendorId: string): VendorAdminSection[] {
  const safeId = encodeURIComponent(vendorId);
  return [...sections.values()].map((section) => ({
    key: section.key,
    title: section.title,
    path: section.path.split(VENDOR_ID_PLACEHOLDER).join(safeId),
  }));
}

/** Empties the registry. Tests only. */
export function __resetVendorAdminSectionsForTests(): void {
  sections.clear();
}
