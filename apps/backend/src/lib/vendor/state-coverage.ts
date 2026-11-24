import type { MedusaContainer } from "@medusajs/framework/types";
import { getStateByCode } from "../geo-india/states";
import { getVendorModule } from "./vendor-module";

export type StateCoverageEntry = {
  state_code: string;
  state_name: string;
  active_vendor_count: number;
  /** True when exactly one active vendor serves the state. */
  single_vendor: boolean;
};

type CoverageVendor = { id: string; status: string };
type CoverageLocation = { vendor_id: string; state_code: string; status: string };

/**
 * Counts, per state, the distinct active vendors that have at least one active
 * location there. Suspended and invited vendors and inactive locations are
 * ignored. Only states that at least one active vendor serves are returned,
 * sorted by state name.
 */
export function computeStateCoverage(
  vendors: readonly CoverageVendor[],
  locations: readonly CoverageLocation[]
): StateCoverageEntry[] {
  const activeVendors = new Set(
    vendors.filter((vendor) => vendor.status === "active").map((vendor) => vendor.id)
  );
  const vendorsByState = new Map<string, Set<string>>();

  for (const location of locations) {
    if (location.status !== "active" || !activeVendors.has(location.vendor_id)) {
      continue;
    }
    const state = getStateByCode(location.state_code);
    if (!state) {
      continue;
    }
    const set = vendorsByState.get(state.code) ?? new Set<string>();
    set.add(location.vendor_id);
    vendorsByState.set(state.code, set);
  }

  return [...vendorsByState.entries()]
    .map(([stateCode, set]) => ({
      state_code: stateCode,
      state_name: getStateByCode(stateCode)!.name,
      active_vendor_count: set.size,
      single_vendor: set.size === 1,
    }))
    .sort((a, b) => a.state_name.localeCompare(b.state_name));
}

/** Reads active vendors and their active locations, then counts. */
export async function loadStateCoverage(
  container: MedusaContainer
): Promise<StateCoverageEntry[]> {
  const vendorModule = getVendorModule(container);
  const vendors = await vendorModule.listVendors(
    { status: "active" },
    { select: ["id", "status"], take: null }
  );
  if (vendors.length === 0) {
    return [];
  }
  const locations = await vendorModule.listVendorLocations(
    { vendor_id: vendors.map((vendor) => vendor.id), status: "active" },
    { select: ["vendor_id", "state_code", "status"], take: null }
  );
  return computeStateCoverage(vendors, locations);
}
