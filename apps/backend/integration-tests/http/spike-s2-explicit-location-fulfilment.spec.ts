import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  assertMedusaVersion,
  AWB,
  buildSpikeFixture,
  completeCart,
  delta,
  fulfilOrder,
  levelOf,
  listReservations,
  moveReservation,
  observe,
  otherVendorLocation,
  PROVINCE_A,
  PROVINCE_B,
  readOrder,
  recordSpike,
  shipFulfilment,
  snapshotInventory,
  type SpikeFixture,
  type SpikeLayout,
} from "../support/spike-fixtures";

jest.setTimeout(15 * 60 * 1000);

const LAYOUTS: SpikeLayout[] = ["hub-only", "per-location"];

const reservationFor = async (f: SpikeFixture, lineItemId: string | undefined) =>
  (await listReservations(f)).find((r) => r.line_item_id === lineItemId);

medusaIntegrationTestRunner({
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("fulfilment at an explicit location", () => {
      it("runs on the pinned Medusa version", () => {
        const version = assertMedusaVersion();
        recordSpike("S2", "setup", "version", { version });
        expect(version).toBe("2.22.7");
      });

      describe.each(LAYOUTS)("layout %s", (layout) => {
        it("records fulfilment, shipment labels and mismatch behaviour", async () => {
          const container = getContainer();
          const build = (stocks: { a: number; b: number }) =>
            buildSpikeFixture(container, api, { layout, stocks });

          // Step 2a: fulfil at a location different from the reservation's.
          let mismatchTolerated = false;
          await observe("S2", layout, "2a-mismatched-location", async () => {
            const f = await build({ a: 5, b: 5 });
            const done = await completeCart(f, { quantity: 2, province: PROVINCE_B });
            const res = (await reservationFor(f, done.lineItemId))!;
            const other = otherVendorLocation(res.location);
            const before = await snapshotInventory(f);
            const fulfilled = await fulfilOrder(f, {
              orderId: done.orderId!,
              lineItemId: done.lineItemId!,
              quantity: 2,
              locationId: f.locationIds[other],
            });
            mismatchTolerated = fulfilled.ok;
            return {
              ok: fulfilled.ok,
              error: fulfilled.error ?? null,
              reserved_at: res.location,
              fulfilled_at: other,
              before,
              after: await snapshotInventory(f),
              reservations_after: await listReservations(f),
            };
          });

          // Step 2b: move the reservation first, then fulfil at the same location, then ship.
          let explicitOk = false;
          let labelsKeepOnlyAwb = false;
          await observe("S2", layout, "2b-moved-then-fulfilled", async () => {
            const f = await build({ a: 5, b: 5 });
            const done = await completeCart(f, { quantity: 2, province: PROVINCE_B });
            const res = (await reservationFor(f, done.lineItemId))!;
            const target = otherVendorLocation(res.location);
            const moved = await moveReservation(f, res.id, target);
            const before = await snapshotInventory(f);
            const fulfilled = await fulfilOrder(f, {
              orderId: done.orderId!,
              lineItemId: done.lineItemId!,
              quantity: 2,
              locationId: f.locationIds[target],
            });
            const after = await snapshotInventory(f);
            explicitOk =
              moved.ok &&
              fulfilled.ok &&
              delta(before, after, target, "stocked") === -2 &&
              delta(before, after, res.location, "stocked") === 0 &&
              levelOf(after, target).reserved === 0;

            const fulfillmentId = (fulfilled.result as { id?: string } | undefined)?.id;
            const shipped = fulfillmentId
              ? await shipFulfilment(f, {
                  orderId: done.orderId!,
                  fulfillmentId,
                  lineItemId: done.lineItemId!,
                  quantity: 2,
                })
              : { ok: false, error: "no fulfilment id returned" };
            const order = await readOrder(f, done.orderId!);
            const labels = ((order.fulfillments as any[]) ?? []).flatMap((fl) => fl.labels ?? []);
            labelsKeepOnlyAwb =
              labels.length === 1 &&
              labels[0].tracking_number === AWB &&
              !labels[0].tracking_url &&
              !labels[0].label_url;
            return {
              move_ok: moved.ok,
              move_error: moved.error ?? null,
              fulfil_ok: fulfilled.ok,
              fulfil_error: fulfilled.error ?? null,
              before,
              after,
              ship_ok: shipped.ok,
              ship_error: shipped.error ?? null,
              order,
            };
          });

          // Step 2c: fulfil at a location with no stock and no reservation.
          await observe("S2", layout, "2c-empty-location", async () => {
            const f = await build({ a: 5, b: 0 });
            const done = await completeCart(f, { quantity: 1, province: PROVINCE_A });
            const fulfilled = await fulfilOrder(f, {
              orderId: done.orderId!,
              lineItemId: done.lineItemId!,
              quantity: 1,
              locationId: f.locationIds.B,
            });
            return {
              ok: fulfilled.ok,
              error: fulfilled.error ?? null,
              snapshot: await snapshotInventory(f),
            };
          });

          recordSpike("S2", layout, "derived", {
            S2_explicit_ok: explicitOk,
            S2_mismatch_tolerated: mismatchTolerated,
            S2_labels_keep_only_awb: labelsKeepOnlyAwb,
          });
        });
      });
    });
  },
});
