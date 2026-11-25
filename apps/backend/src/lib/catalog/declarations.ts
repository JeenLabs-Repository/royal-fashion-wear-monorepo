import type { CustomerIdentitySettings, LmDisplayMode } from "../settings/customer-identity";

export type DeclarationRow = {
  generic_name?: string | null;
  country_of_origin?: string | null;
  packed_by_name?: string | null;
  packed_by_address?: string | null;
};

export type DeclarationLine = { label: string; value: string };

type FieldSpec = { label: string; field: keyof DeclarationRow | "owner_text" };

// What a customer may see per display mode, in display order. The sale price
// information (MRP and net quantity) is stored with each variant but is not shown by
// any mode until the written legal answer says it must be, so it has no entry here.
export const LM_DISPLAY_FIELDS: Record<LmDisplayMode, FieldSpec[]> = {
  hidden: [],
  owner_marketer: [{ label: "Marketed by", field: "owner_text" }],
  product_declared: [
    { label: "Generic name", field: "generic_name" },
    { label: "Country of origin", field: "country_of_origin" },
    { label: "Packed by", field: "packed_by_name" },
    { label: "Address", field: "packed_by_address" },
  ],
};

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

/** English country name for an ISO code such as IN; unknown codes come back as written. */
export function countryName(code: string): string {
  const upper = code.trim().toUpperCase();
  try {
    return displayNames.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

const clean = (value: string | null | undefined): string => (value ?? "").replace(/[<>]/g, "").trim();

/**
 * The lines a customer sees. An unknown mode answers nothing, so a bad stored value
 * can only hide text, never show it.
 */
export function buildDeclarationLines(
  mode: LmDisplayMode,
  settings: Pick<CustomerIdentitySettings, "lm_marketer_text">,
  declaration: DeclarationRow | null
): DeclarationLine[] {
  const specs = LM_DISPLAY_FIELDS[mode];
  if (!specs || mode === "hidden") {
    return [];
  }
  const lines: DeclarationLine[] = [];
  for (const spec of specs) {
    let value = "";
    if (spec.field === "owner_text") {
      value = clean(settings.lm_marketer_text);
    } else if (declaration) {
      const raw = declaration[spec.field];
      value = spec.field === "country_of_origin" ? clean(raw ? countryName(raw) : "") : clean(raw);
    }
    if (value !== "") {
      lines.push({ label: spec.label, value });
    }
  }
  return lines;
}
