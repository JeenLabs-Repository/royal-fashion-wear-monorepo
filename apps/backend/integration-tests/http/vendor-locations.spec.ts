import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import {
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  getStoreSalesChannelId,
} from "../../src/lib/vendor/channel-links";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { createVendorLocationWorkflow } from "../../src/workflows/vendors/create-vendor-location";
import { updateVendorLocationWorkflow } from "../../src/workflows/vendors/update-vendor-location";
import { vendorLocationValidationWorkflow } from "../../src/workflows/vendors/validate-vendor-location";
import { findAuditEntries } from "../helpers/audit";

jest.setTimeout(180 * 1000);

const actor = { id: "user_locations_spec", label: "locations@example.test" };

// Distinctive vendor strings. None of them may ever appear on a stock location.
const VENDOR_STRINGS = {
  internal_name: "Marlowe Quasar Traders",
  label: "Zephyr Depot Label",
  address_1: "17 Quillfeather Lane",
  address_2: "Annex Brindlewick Block",
  city: "Tarnwick",
  contact: "Orla Brindlemoor",
  phone: "+919876543210",
};

const hookState = {
  block: false,
  seen: [] as { operation: string; location_id?: string }[],
};

vendorLocationValidationWorkflow.hooks.vendorLocationValidating(async (payload) => {
  hookState.seen.push({ operation: payload.operation, location_id: payload.location_id });
  if (hookState.block) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Location rejected by rule");
  }
});

type Query = {
  graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
};

const queryOf = (container: MedusaContainer) =>
  container.resolve(ContainerRegistrationKeys.QUERY) as Query;

async function ensureDefaultSalesChannel(container: MedusaContainer): Promise<void> {
  let { data } = await queryOf(container).graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  let store = data[0];
  if (!store) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Locations Spec Store",
            supported_currencies: [{ currency_code: "inr", is_default: true }],
          },
        ],
      },
    });
    ({ data } = await queryOf(container).graph({
      entity: "store",
      fields: ["id", "default_sales_channel_id"],
    }));
    store = data[0];
  }
  if (store?.default_sales_channel_id) {
    return;
  }
  const {
    result: [channel],
  } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Locations Spec Channel ${Date.now()}` }] },
  });
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_sales_channel_id: channel.id } },
  });
}

let counter = 0;

async function makeVendor(
  container: MedusaContainer,
  status: "invited" | "active" | "suspended" = "active"
) {
  counter += 1;
  const [vendor] = await getVendorModule(container).createVendors([
    {
      internal_name: `${VENDOR_STRINGS.internal_name} ${counter}`,
      contact_name: VENDOR_STRINGS.contact,
      contact_email: `locations-${counter}-${Date.now()}@example.test`,
      status,
    },
  ]);
  return vendor;
}

const validInput = (vendorId: string, overrides: Record<string, unknown> = {}) => ({
  vendor_id: vendorId,
  label: VENDOR_STRINGS.label,
  state_code: "IN-MH",
  pin: "400001",
  address_1: VENDOR_STRINGS.address_1,
  address_2: VENDOR_STRINGS.address_2,
  city: VENDOR_STRINGS.city,
  pickup_contact_name: VENDOR_STRINGS.contact,
  pickup_contact_phone: VENDOR_STRINGS.phone,
  actor,
  ...overrides,
});

const createLocation = async (
  container: MedusaContainer,
  vendorId: string,
  overrides: Record<string, unknown> = {}
) => {
  const { result } = await createVendorLocationWorkflow(container).run({
    input: validInput(vendorId, overrides) as never,
  });
  return result as { id: string; code: string; stock_location_id: string };
};

const stockLocationCount = async (container: MedusaContainer) =>
  (await queryOf(container).graph({ entity: "stock_location", fields: ["id"] })).data.length;

const isLinked = async (container: MedusaContainer, stockLocationId: string) => {
  const salesChannelId = await getStoreSalesChannelId(container);
  const { data } = await queryOf(container).graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { id: stockLocationId },
  });
  return ((data[0]?.sales_channels ?? []) as ({ id: string } | null)[]).some(
    (channel) => channel?.id === salesChannelId
  );
};

const codeNumber = (code: string) => Number(code.replace("LOC-", ""));

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("vendor location workflows", () => {
      beforeEach(async () => {
        hookState.block = false;
        hookState.seen.length = 0;
        await ensureDefaultSalesChannel(getContainer());
      });

      it("allocates LOC codes in order across vendors", async () => {
        const container = getContainer();
        const first = await createLocation(container, (await makeVendor(container)).id);
        const second = await createLocation(container, (await makeVendor(container)).id);

        expect(first.code).toMatch(/^LOC-\d{4}$/);
        expect(second.code).toMatch(/^LOC-\d{4}$/);
        expect(codeNumber(second.code)).toBe(codeNumber(first.code) + 1);
      });

      it("creates an opaque stock location with no vendor text anywhere", async () => {
        const container = getContainer();
        const vendor = await makeVendor(container);

        const location = await createLocation(container, vendor.id);

        const { data } = await queryOf(container).graph({
          entity: "stock_location",
          fields: ["id", "name", "metadata", "address.*"],
          filters: { id: location.stock_location_id },
        });
        const stockLocation = data[0];
        expect(stockLocation.name).toBe(location.code);
        expect(stockLocation.address.country_code).toBe("in");
        expect(String(stockLocation.address.province).toLowerCase()).toBe("in-mh");
        const metadata = stockLocation.metadata;
        expect(metadata === null || Object.keys(metadata ?? {}).length === 0).toBe(true);

        const serialized = JSON.stringify(stockLocation);
        for (const value of Object.values(VENDOR_STRINGS)) {
          expect(serialized).not.toContain(value);
        }
        expect(serialized).not.toContain(vendor.id);

        const [row] = await getVendorModule(container).listVendorLocations(
          { id: location.id },
          { take: 1 }
        );
        expect(row.stock_location_id).toBe(location.stock_location_id);
      });

      describe("sales channel link rule", () => {
        const table: [string, "active" | "inactive", boolean][] = [
          ["invited", "active", false],
          ["invited", "inactive", false],
          ["active", "active", true],
          ["active", "inactive", false],
          ["suspended", "active", false],
          ["suspended", "inactive", false],
        ];

        it.each(table)(
          "vendor %s with a %s location is linked: %s",
          async (vendorStatus, locationStatus, expected) => {
            const container = getContainer();
            const vendor = await makeVendor(
              container,
              vendorStatus as "invited" | "active" | "suspended"
            );
            const location = await createLocation(container, vendor.id, {
              status: locationStatus,
            });
            expect(await isLinked(container, location.stock_location_id)).toBe(expected);
          }
        );
      });

      it("unlinks when a location becomes inactive and relinks when it is active again", async () => {
        const container = getContainer();
        const vendor = await makeVendor(container);
        const location = await createLocation(container, vendor.id);
        expect(await isLinked(container, location.stock_location_id)).toBe(true);

        await updateVendorLocationWorkflow(container).run({
          input: {
            vendor_id: vendor.id,
            location_id: location.id,
            patch: { status: "inactive" },
            actor,
          },
        });
        expect(await isLinked(container, location.stock_location_id)).toBe(false);

        await updateVendorLocationWorkflow(container).run({
          input: {
            vendor_id: vendor.id,
            location_id: location.id,
            patch: { status: "active" },
            actor,
          },
        });
        expect(await isLinked(container, location.stock_location_id)).toBe(true);
      });

      it("changes the province when the state changes and never changes the code", async () => {
        const container = getContainer();
        const vendor = await makeVendor(container);
        const location = await createLocation(container, vendor.id);

        await updateVendorLocationWorkflow(container).run({
          input: {
            vendor_id: vendor.id,
            location_id: location.id,
            patch: { state_code: "IN-KA", pin: "560001", label: "Renamed Label" },
            actor,
          },
        });

        const [row] = await getVendorModule(container).listVendorLocations(
          { id: location.id },
          { take: 1 }
        );
        expect(row.code).toBe(location.code);
        expect(row.state_code).toBe("IN-KA");
        expect(row.label).toBe("Renamed Label");
        const { data } = await queryOf(container).graph({
          entity: "stock_location",
          fields: ["id", "name", "address.province"],
          filters: { id: location.stock_location_id },
        });
        expect(data[0].name).toBe(location.code);
        expect(String(data[0].address.province).toLowerCase()).toBe("in-ka");
      });

      describe("rejected input creates nothing and uses no code", () => {
        const invalid: [string, Record<string, unknown>][] = [
          ["a PIN starting with zero", { pin: "000000" }],
          ["a PIN with five digits", { pin: "12345" }],
          ["a PIN with a letter", { pin: "40000a" }],
          ["an unknown state", { state_code: "IN-XX" }],
          ["a label over 60 characters", { label: "L".repeat(61) }],
          ["an empty address line", { address_1: "   " }],
          ["a phone that is too short", { pickup_contact_phone: "12345" }],
        ];

        it.each(invalid)("%s", async (_label, overrides) => {
          const container = getContainer();
          const vendor = await makeVendor(container);
          const before = await createLocation(container, vendor.id);
          const stockBefore = await stockLocationCount(container);
          const rowsBefore = await getVendorModule(container).listVendorLocations(
            { vendor_id: vendor.id },
            { take: null }
          );

          await expect(
            createVendorLocationWorkflow(container).run({
              input: validInput(vendor.id, overrides) as never,
            })
          ).rejects.toMatchObject({ type: "invalid_data" });

          expect(await stockLocationCount(container)).toBe(stockBefore);
          const rowsAfter = await getVendorModule(container).listVendorLocations(
            { vendor_id: vendor.id },
            { take: null }
          );
          expect(rowsAfter).toHaveLength(rowsBefore.length);

          const next = await createLocation(container, vendor.id);
          expect(codeNumber(next.code)).toBe(codeNumber(before.code) + 1);
        });

        it("reports invalid_pin_state for a bad PIN or state", async () => {
          const container = getContainer();
          const vendor = await makeVendor(container);
          await expect(
            createVendorLocationWorkflow(container).run({
              input: validInput(vendor.id, { pin: "000000" }) as never,
            })
          ).rejects.toMatchObject({
            code: "invalid_pin_state",
            message: "PIN code or state is not valid.",
          });
        });
      });

      it("treats a location of another vendor as not found", async () => {
        const container = getContainer();
        const owner = await makeVendor(container);
        const other = await makeVendor(container);
        const location = await createLocation(container, owner.id);

        await expect(
          updateVendorLocationWorkflow(container).run({
            input: {
              vendor_id: other.id,
              location_id: location.id,
              patch: { label: "Hijacked" },
              actor,
            },
          })
        ).rejects.toMatchObject({ message: "Not found" });
        const [row] = await getVendorModule(container).listVendorLocations(
          { id: location.id },
          { take: 1 }
        );
        expect(row.label).toBe(VENDOR_STRINGS.label);
      });

      describe("the validation hook", () => {
        it("blocks create with the handler's message and creates nothing", async () => {
          const container = getContainer();
          const vendor = await makeVendor(container);
          const stockBefore = await stockLocationCount(container);
          hookState.block = true;

          await expect(
            createVendorLocationWorkflow(container).run({
              input: validInput(vendor.id) as never,
            })
          ).rejects.toMatchObject({ message: "Location rejected by rule" });

          expect(await stockLocationCount(container)).toBe(stockBefore);
          expect(
            await getVendorModule(container).listVendorLocations(
              { vendor_id: vendor.id },
              { take: null }
            )
          ).toHaveLength(0);
        });

        it("blocks update with the handler's message and changes nothing", async () => {
          const container = getContainer();
          const vendor = await makeVendor(container);
          const location = await createLocation(container, vendor.id);
          hookState.block = true;

          await expect(
            updateVendorLocationWorkflow(container).run({
              input: {
                vendor_id: vendor.id,
                location_id: location.id,
                patch: { label: "Blocked rename" },
                actor,
              },
            })
          ).rejects.toMatchObject({ message: "Location rejected by rule" });

          const [row] = await getVendorModule(container).listVendorLocations(
            { id: location.id },
            { take: 1 }
          );
          expect(row.label).toBe(VENDOR_STRINGS.label);
        });

        it("runs on create and update with the operation and the proposed values", async () => {
          const container = getContainer();
          const vendor = await makeVendor(container);
          const location = await createLocation(container, vendor.id);
          await updateVendorLocationWorkflow(container).run({
            input: {
              vendor_id: vendor.id,
              location_id: location.id,
              patch: { label: "Second label" },
              actor,
            },
          });
          expect(hookState.seen).toEqual([
            { operation: "create", location_id: undefined },
            { operation: "update", location_id: location.id },
          ]);
        });
      });

      it("audits creation and update without the contact name or phone", async () => {
        const container = getContainer();
        const vendor = await makeVendor(container);
        const location = await createLocation(container, vendor.id);
        await updateVendorLocationWorkflow(container).run({
          input: {
            vendor_id: vendor.id,
            location_id: location.id,
            patch: { status: "inactive" },
            actor,
          },
        });

        const created = await findAuditEntries(container, {
          action: "vendor.location_created",
          target_id: vendor.id,
        });
        const updated = await findAuditEntries(container, {
          action: "vendor.location_updated",
          target_id: vendor.id,
        });
        expect(created).toHaveLength(1);
        expect(updated).toHaveLength(1);
        expect(created[0].after).toMatchObject({
          location: location.code,
          state_code: "IN-MH",
          pin: "400001",
          status: "active",
        });
        expect(updated[0].before).toMatchObject({ status: "active" });
        expect(updated[0].after).toMatchObject({ status: "inactive" });

        const serialized = JSON.stringify([created, updated]);
        expect(serialized).not.toContain(VENDOR_STRINGS.contact);
        expect(serialized).not.toContain(VENDOR_STRINGS.phone);
        expect(serialized).not.toContain(VENDOR_STRINGS.address_1);
      });
    });
  },
});
