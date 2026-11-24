import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import {
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  getStoreSalesChannelId,
  reconcileVendorChannelLinks,
} from "../../src/lib/vendor/channel-links";
import { getVendorModule } from "../../src/lib/vendor/vendor-module";
import { activateVendorWorkflow } from "../../src/workflows/vendors/activate-vendor";
import { reactivateVendorWorkflow } from "../../src/workflows/vendors/reactivate-vendor";
import { assertSettableStatus } from "../../src/workflows/vendors/steps/set-vendor-status";
import { suspendVendorWorkflow } from "../../src/workflows/vendors/suspend-vendor";
import { vendorActivationGateWorkflow } from "../../src/workflows/vendors/vendor-activation-gate";
import { findAuditEntries } from "../helpers/audit";

jest.setTimeout(180 * 1000);

// Decision 0015: handler errors roll back earlier steps.
const SUSPEND_HANDLER_ERROR_ROLLS_BACK = true;

const actor = { id: "user_lifecycle_spec", label: "lifecycle@example.test" };

// Controls for the handlers and the audit library call that the audit step makes. Names start with `mock` so
// jest.mock factories may read them.
const mockControl = { failAudit: false };

jest.mock("../../src/lib/audit", () => {
  const actual = jest.requireActual("../../src/lib/audit");
  return {
    ...actual,
    recordAudit: jest.fn(async (...args: unknown[]) => {
      if (mockControl.failAudit) {
        throw new Error("audit store unavailable");
      }
      return (actual.recordAudit as (...inner: unknown[]) => unknown)(...args);
    }),
  };
});

const hookState = {
  blockActivation: false,
  activations: [] as { vendor_id: string; trigger: string }[],
  failSuspension: false,
  suspensionSeen: [] as { vendor_id: string; reason: string; status?: string }[],
};

// Registered at module load, before the application starts, as the
// hook-registration record describes. A flag decides whether a handler blocks.
vendorActivationGateWorkflow.hooks.vendorActivating(async ({ vendor_id, trigger }) => {
  hookState.activations.push({ vendor_id, trigger });
  if (hookState.blockActivation) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Compliance check pending");
  }
});

suspendVendorWorkflow.hooks.vendorSuspended(async ({ vendor_id, reason }, { container }) => {
  const [vendor] = await getVendorModule(container).listVendors({ id: vendor_id }, { take: 1 });
  hookState.suspensionSeen.push({ vendor_id, reason, status: vendor?.status });
  if (hookState.failSuspension) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Suspension cleanup failed");
  }
});

let counter = 0;

async function ensureDefaultSalesChannel(container: MedusaContainer): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  let { data } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  });
  let store = data[0];

  if (!store) {
    const storeModule = container.resolve(Modules.STORE) as {
      createStores(
        data: Record<string, unknown> | Record<string, unknown>[]
      ): Promise<Record<string, unknown> | Record<string, unknown>[]>;
    };
    try {
      await createStoresWorkflow(container).run({
        input: {
          stores: [
            {
              name: "Lifecycle Spec Store",
              supported_currencies: [{ currency_code: "inr", is_default: true }],
            },
          ],
        },
      });
    } catch {
      await storeModule.createStores({
        name: "Lifecycle Spec Store",
        supported_currencies: [{ currency_code: "inr", is_default: true }],
      });
    }
    ({ data } = await query.graph({
      entity: "store",
      fields: ["id", "default_sales_channel_id"],
    }));
    store = data[0];
  }

  if (store?.default_sales_channel_id) {
    return store.default_sales_channel_id as string;
  }

  const {
    result: [channel],
  } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Lifecycle Spec Channel ${Date.now()}` }] },
  });
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_sales_channel_id: channel.id } },
  });
  return channel.id as string;
}

type FixtureOptions = {
  status?: "invited" | "active" | "suspended";
  usedInvite?: boolean;
  acceptedAgreement?: boolean;
  locations?: ("active" | "inactive")[];
};

async function makeVendor(container: MedusaContainer, options: FixtureOptions = {}) {
  counter += 1;
  const vendorModule = getVendorModule(container);
  const status = options.status ?? "invited";
  const [vendor] = await vendorModule.createVendors([
    {
      internal_name: `Lifecycle Test Vendor ${counter}`,
      contact_name: "Lifecycle Tester",
      contact_email: `lifecycle-${counter}-${Date.now()}@example.test`,
      status,
      // Active fixtures keep a first activation time so reactivation can prove
      // it is not overwritten.
      ...(status === "active" ? { activated_at: new Date() } : {}),
    },
  ]);
  const [user] = await vendorModule.createVendorUsers([
    {
      vendor_id: vendor.id,
      email: `lifecycle-user-${counter}-${Date.now()}@example.test`,
      name: "Lifecycle Tester",
    },
  ]);
  if (options.usedInvite ?? true) {
    await vendorModule.createVendorInvites([
      {
        vendor_user_id: user.id,
        token_hash: `${counter}`.padStart(64, "a"),
        expires_at: new Date(Date.now() + 3600 * 1000),
        used_at: new Date(),
      },
    ]);
  }
  if (options.acceptedAgreement ?? true) {
    await vendorModule.createVendorAgreementAcceptances([
      {
        vendor_user_id: user.id,
        version: "v1-draft",
        accepted_at: new Date(),
        ip: null,
        user_agent: null,
      },
    ]);
  }

  const locations: { id: string; stock_location_id: string; status: string }[] = [];
  for (const locationStatus of options.locations ?? ["active", "inactive"]) {
    const {
      result: [stockLocation],
    } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: `SPEC-${counter}-${locations.length}`,
            address: { address_1: "Spec", country_code: "in" },
          },
        ],
      },
    });
    const [location] = await vendorModule.createVendorLocations([
      {
        vendor_id: vendor.id,
        code: `LOC-9${String(counter).padStart(2, "0")}${locations.length}${Date.now() % 1000}`,
        label: `Spec location ${locations.length}`,
        state_code: "IN-MH",
        pin: "400001",
        address_1: "1 Spec Street",
        pickup_contact_name: "Spec Contact",
        pickup_contact_phone: "+919800000000",
        status: locationStatus,
        stock_location_id: stockLocation.id,
      },
    ]);
    locations.push({ id: location.id, stock_location_id: stockLocation.id, status: locationStatus });
  }
  return { vendor, user, locations };
}

async function linkedStockLocationIds(
  container: MedusaContainer,
  stockLocationIds: string[]
): Promise<string[]> {
  const salesChannelId = await getStoreSalesChannelId(container);
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(config: Record<string, unknown>): Promise<{ data: Record<string, any>[] }>;
  };
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "sales_channels.id"],
    filters: { id: stockLocationIds },
  });
  return data
    .filter((row) =>
      ((row.sales_channels ?? []) as ({ id: string } | null)[]).some(
        (channel) => channel?.id === salesChannelId
      )
    )
    .map((row) => row.id as string)
    .sort();
}

const statusOf = async (container: MedusaContainer, vendorId: string) => {
  const [vendor] = await getVendorModule(container).listVendors({ id: vendorId }, { take: 1 });
  return vendor;
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("vendor activation, suspension and reactivation", () => {
      beforeEach(async () => {
        hookState.blockActivation = false;
        hookState.activations.length = 0;
        hookState.failSuspension = false;
        hookState.suspensionSeen.length = 0;
        mockControl.failAudit = false;
        await ensureDefaultSalesChannel(getContainer());
      });

      describe("activation", () => {
        it("activates a registered vendor, links only the active location and audits it", async () => {
          const container = getContainer();
          const { vendor, locations } = await makeVendor(container);

          await activateVendorWorkflow(container).run({
            input: { vendor_id: vendor.id, actor },
          });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe("active");
          expect(after.activated_at).not.toBeNull();
          const active = locations.find((location) => location.status === "active")!;
          expect(
            await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            )
          ).toEqual([active.stock_location_id]);
          expect(hookState.activations).toEqual([
            { vendor_id: vendor.id, trigger: "activation" },
          ]);

          const entries = await findAuditEntries(container, {
            action: "vendor.activated",
            target_id: vendor.id,
          });
          expect(entries).toHaveLength(1);
          expect(entries[0].actor_type).toBe("user");
        });

        it("fails with a staff-readable message when no invitation was accepted", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, { usedInvite: false });

          await expect(
            activateVendorWorkflow(container).run({ input: { vendor_id: vendor.id, actor } })
          ).rejects.toMatchObject({
            message: "The vendor has not accepted the invitation yet.",
          });
          expect((await statusOf(container, vendor.id)).status).toBe("invited");
        });

        it("fails and names the agreement step when it is incomplete", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, { acceptedAgreement: false });

          await expect(
            activateVendorWorkflow(container).run({ input: { vendor_id: vendor.id, actor } })
          ).rejects.toMatchObject({
            message:
              "Required onboarding steps are incomplete: Accept the vendor agreement and packing guideline.",
          });
        });

        it("refuses an active vendor and tells the owner to reactivate a suspended one", async () => {
          const container = getContainer();
          const active = await makeVendor(container, { status: "active" });
          const suspended = await makeVendor(container, { status: "suspended" });

          await expect(
            activateVendorWorkflow(container).run({
              input: { vendor_id: active.vendor.id, actor },
            })
          ).rejects.toMatchObject({ message: "This vendor is already active." });
          await expect(
            activateVendorWorkflow(container).run({
              input: { vendor_id: suspended.vendor.id, actor },
            })
          ).rejects.toMatchObject({
            message: "This vendor is suspended. Use reactivate instead of activate.",
          });
        });

        it("is blocked by a handler with its exact message, leaving status and links untouched", async () => {
          const container = getContainer();
          const { vendor, locations } = await makeVendor(container);
          hookState.blockActivation = true;

          await expect(
            activateVendorWorkflow(container).run({ input: { vendor_id: vendor.id, actor } })
          ).rejects.toMatchObject({ message: "Compliance check pending" });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe("invited");
          expect(after.activated_at).toBeNull();
          expect(
            await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            )
          ).toEqual([]);

          hookState.blockActivation = false;
          await activateVendorWorkflow(container).run({ input: { vendor_id: vendor.id, actor } });
          expect((await statusOf(container, vendor.id)).status).toBe("active");
        });

        it("restores status and links when a step after the links fails", async () => {
          const container = getContainer();
          const { vendor, locations } = await makeVendor(container);
          mockControl.failAudit = true;

          await expect(
            activateVendorWorkflow(container).run({ input: { vendor_id: vendor.id, actor } })
          ).rejects.toMatchObject({ message: "audit store unavailable" });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe("invited");
          expect(after.activated_at).toBeNull();
          expect(
            await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            )
          ).toEqual([]);
        });
      });

      describe("suspension", () => {
        it("sets suspended, unlinks every location, runs the hook after the change and audits the reason", async () => {
          const container = getContainer();
          const { vendor, locations } = await makeVendor(container, { status: "active" });
          await reconcileVendorChannelLinks(container, vendor.id);
          expect(
            (
              await linkedStockLocationIds(
                container,
                locations.map((location) => location.stock_location_id)
              )
            ).length
          ).toBe(1);

          await suspendVendorWorkflow(container).run({
            input: { vendor_id: vendor.id, reason: "  Parcels returned damaged twice  ", actor },
          });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe("suspended");
          expect(after.suspended_at).not.toBeNull();
          expect(after.suspend_reason).toBe("Parcels returned damaged twice");
          expect(
            await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            )
          ).toEqual([]);
          expect(hookState.suspensionSeen).toEqual([
            {
              vendor_id: vendor.id,
              reason: "Parcels returned damaged twice",
              status: "suspended",
            },
          ]);

          const [entry] = await findAuditEntries(container, {
            action: "vendor.suspended",
            target_id: vendor.id,
          });
          expect((entry.meta as { reason: string }).reason).toBe(
            "Parcels returned damaged twice"
          );
        });

        it("accepts an invited vendor", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container);
          await suspendVendorWorkflow(container).run({
            input: { vendor_id: vendor.id, reason: "Owner decision before activation", actor },
          });
          expect((await statusOf(container, vendor.id)).status).toBe("suspended");
        });

        it("rejects a reason of 9 characters after trimming and changes nothing", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, { status: "active" });

          await expect(
            suspendVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "   123456789   ", actor },
            })
          ).rejects.toMatchObject({
            type: "invalid_data",
            message: "A reason of at least 10 characters is required.",
          });
          expect((await statusOf(container, vendor.id)).status).toBe("active");
          expect(hookState.suspensionSeen).toHaveLength(0);
        });

        it("refuses to suspend a vendor that is already suspended", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, { status: "suspended" });
          await expect(
            suspendVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "Suspended a second time", actor },
            })
          ).rejects.toMatchObject({ message: "This vendor is already suspended." });
        });

        it("follows the recorded behaviour when a suspension handler throws", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, { status: "active" });
          hookState.failSuspension = true;

          await expect(
            suspendVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "Cleanup handler will fail", actor },
            })
          ).rejects.toMatchObject({ message: "Suspension cleanup failed" });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe(
            SUSPEND_HANDLER_ERROR_ROLLS_BACK ? "active" : "suspended"
          );
        });
      });

      describe("reactivation", () => {
        async function suspendedVendor() {
          const container = getContainer();
          const fixture = await makeVendor(container, { status: "active" });
          await reconcileVendorChannelLinks(container, fixture.vendor.id);
          await suspendVendorWorkflow(container).run({
            input: { vendor_id: fixture.vendor.id, reason: "Suspended for the spec", actor },
          });
          hookState.activations.length = 0;
          return fixture;
        }

        it("re-links active locations, clears the reason, keeps activated_at and audits", async () => {
          const container = getContainer();
          const { vendor, locations } = await suspendedVendor();
          const firstActivation = (await statusOf(container, vendor.id)).activated_at;

          await reactivateVendorWorkflow(container).run({
            input: { vendor_id: vendor.id, reason: "Issue resolved with the vendor", actor },
          });

          const after = await statusOf(container, vendor.id);
          expect(after.status).toBe("active");
          expect(after.suspend_reason).toBeNull();
          expect(after.suspended_at).toBeNull();
          expect(after.activated_at).toEqual(firstActivation);
          const active = locations.find((location) => location.status === "active")!;
          expect(
            await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            )
          ).toEqual([active.stock_location_id]);
          expect(hookState.activations).toEqual([
            { vendor_id: vendor.id, trigger: "reactivation" },
          ]);

          const [entry] = await findAuditEntries(container, {
            action: "vendor.reactivated",
            target_id: vendor.id,
          });
          expect((entry.meta as { reason: string }).reason).toBe(
            "Issue resolved with the vendor"
          );
        });

        it("is blocked by the activation hook with the handler's message", async () => {
          const container = getContainer();
          const { vendor } = await suspendedVendor();
          hookState.blockActivation = true;

          await expect(
            reactivateVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "Issue resolved with the vendor", actor },
            })
          ).rejects.toMatchObject({ message: "Compliance check pending" });
          expect((await statusOf(container, vendor.id)).status).toBe("suspended");
        });

        it("needs a suspended vendor and a reason of 10 or more characters", async () => {
          const container = getContainer();
          const active = await makeVendor(container, { status: "active" });
          await expect(
            reactivateVendorWorkflow(container).run({
              input: { vendor_id: active.vendor.id, reason: "Not suspended at all", actor },
            })
          ).rejects.toMatchObject({
            message: "Only a suspended vendor can be reactivated.",
          });

          const { vendor } = await suspendedVendor();
          await expect(
            reactivateVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "short", actor },
            })
          ).rejects.toMatchObject({
            message: "A reason of at least 10 characters is required.",
          });
          expect((await statusOf(container, vendor.id)).status).toBe("suspended");
        });

        it("applies the activation requirements to a vendor that was never activated", async () => {
          const container = getContainer();
          const { vendor } = await makeVendor(container, {
            status: "suspended",
            acceptedAgreement: false,
          });
          await expect(
            reactivateVendorWorkflow(container).run({
              input: { vendor_id: vendor.id, reason: "Trying to skip the agreement", actor },
            })
          ).rejects.toMatchObject({
            message: expect.stringContaining("Required onboarding steps are incomplete"),
          });
        });
      });

      describe("channel links", () => {
        it("follows the rule across every vendor and location state", async () => {
          const container = getContainer();
          const expectations: [string, "active" | "inactive", boolean][] = [
            ["invited", "active", false],
            ["invited", "inactive", false],
            ["active", "active", true],
            ["active", "inactive", false],
            ["suspended", "active", false],
            ["suspended", "inactive", false],
          ];
          for (const [vendorStatus, locationStatus, expectedLinked] of expectations) {
            const { vendor, locations } = await makeVendor(container, {
              status: vendorStatus as "invited" | "active" | "suspended",
              locations: [locationStatus],
            });
            await reconcileVendorChannelLinks(container, vendor.id);
            const linked = await linkedStockLocationIds(
              container,
              locations.map((location) => location.stock_location_id)
            );
            expect({ vendorStatus, locationStatus, linked: linked.length === 1 }).toEqual({
              vendorStatus,
              locationStatus,
              linked: expectedLinked,
            });
          }
        });

        it("is idempotent and reports only what it changed", async () => {
          const container = getContainer();
          const { vendor, locations } = await makeVendor(container, { status: "active" });
          const active = locations.find((location) => location.status === "active")!;

          const first = await reconcileVendorChannelLinks(container, vendor.id);
          const second = await reconcileVendorChannelLinks(container, vendor.id);

          expect(first).toEqual({ added: [active.stock_location_id], removed: [] });
          expect(second).toEqual({ added: [], removed: [] });
        });
      });

      describe("statuses", () => {
        it("never lets a workflow set a vendor back to the starting status", () => {
          expect(() => assertSettableStatus("invited")).toThrow(
            "A vendor can only be set to active or suspended."
          );
          expect(() => assertSettableStatus("active")).not.toThrow();
          expect(() => assertSettableStatus("suspended")).not.toThrow();

          const stepSource = readFileSync(
            path.join(
              __dirname,
              "../../src/workflows/vendors/steps/set-vendor-status.ts"
            ),
            "utf8"
          );
          expect(stepSource).not.toContain('"invited"');
        });

        it("keeps the starting status out of the lifecycle workflow sources", () => {
          const dir = path.join(__dirname, "../../src/workflows/vendors");
          const lifecycleFiles = new Set([
            "activate-vendor.ts",
            "reactivate-vendor.ts",
            "suspend-vendor.ts",
            "set-vendor-status.ts",
          ]);
          const offenders = sourceFiles(dir)
            .filter((file) => lifecycleFiles.has(path.basename(file)))
            .filter((file) => /status:\s*"invited"/.test(readFileSync(file, "utf8")));
          expect(offenders).toEqual([]);
        });
      });
    });
  },
});
