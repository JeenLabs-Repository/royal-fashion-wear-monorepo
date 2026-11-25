import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import {
  addReservation,
  assertMedusaVersion,
  buildSpikeFixture,
  completeCart,
  delta,
  listReservations,
  moveReservation,
  observe,
  otherVendorLocation,
  PROVINCE_A,
  PROVINCE_B,
  recordSpike,
  reduceReservation,
  removeReservation,
  snapshotInventory,
  storeVariantQuantity,
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
    describe("reservation placement, move and split", () => {
      it("runs on the pinned Medusa version", () => {
        const version = assertMedusaVersion();
        recordSpike("S1", "setup", "version", { version });
        expect(version).toBe("2.22.7");
      });

      describe.each(LAYOUTS)("layout %s", (layout) => {
        it("records placement, move, split and oversize behaviour", async () => {
          const container = getContainer();
          const build = (stocks: { a: number; b: number }, creationOrder?: "AB" | "BA") =>
            buildSpikeFixture(container, api, { layout, stocks, creationOrder });

          // Step 1a: where the reservation lands, in both creation orders.
          const placements: { creation: string; province: string; location: string }[] = [];
          for (const creationOrder of ["AB", "BA"] as const) {
            const f = await build({ a: 5, b: 5 }, creationOrder);
            expect(Object.keys(f.locationIds)).toEqual(expect.arrayContaining(["A", "B"]));
            for (const province of [PROVINCE_B, PROVINCE_B, PROVINCE_B, PROVINCE_A]) {
              await observe("S1", layout, "1a-placement", async () => {
                const done = await completeCart(f, { quantity: 1, province });
                const mine = await reservationFor(f, done.lineItemId);
                placements.push({ creation: creationOrder, province, location: mine?.location ?? "none" });
                return {
                  creation_order: creationOrder,
                  candidate_order: f.candidateOrder,
                  province,
                  complete_error: done.error ?? null,
                  shipping_options: done.shippingOptions.map((o) => o.name),
                  reservation_location: mine?.location ?? null,
                };
              });
            }
          }
          const follows =
            placements.length === 8 &&
            placements.every((p) => p.location === (p.province === PROVINCE_B ? "B" : "A"));
          recordSpike("S1", layout, "1a-summary", { follows_customer_state: follows, placements });

          // Step 1b: move a reservation to the other vendor location.
          let movable = false;
          await observe("S1", layout, "1b-move", async () => {
            const f = await build({ a: 5, b: 5 });
            const done = await completeCart(f, { quantity: 1, province: PROVINCE_B });
            const res = (await reservationFor(f, done.lineItemId))!;
            const target = otherVendorLocation(res.location);
            const before = await snapshotInventory(f);
            const moved = await moveReservation(f, res.id, target);
            const after = await snapshotInventory(f);
            movable =
              moved.ok &&
              delta(before, after, res.location, "reserved") === -1 &&
              delta(before, after, target, "reserved") === 1;
            return {
              ok: moved.ok,
              error: moved.error ?? null,
              from: res.location,
              to: target,
              before,
              after,
              reservations_after: await listReservations(f),
            };
          });

          // Step 1c: move to a location that holds no stock.
          await observe("S1", layout, "1c-move-to-empty", async () => {
            const f = await build({ a: 5, b: 0 });
            const done = await completeCart(f, { quantity: 1, province: PROVINCE_A });
            const res = (await reservationFor(f, done.lineItemId))!;
            const before = await snapshotInventory(f);
            const moved = await moveReservation(f, res.id, "B");
            const after = await snapshotInventory(f);
            return {
              ok: moved.ok,
              error: moved.error ?? null,
              from: res.location,
              before,
              after,
              available_at_target_negative: (after.B?.available ?? 0) < 0,
            };
          });

          // Step 1d: split an order of 4 over two locations, two ways.
          let splitVariant1 = false;
          await observe("S1", layout, "1d-split-reduce-and-create", async () => {
            const f = await build({ a: 5, b: 5 });
            const done = await completeCart(f, { quantity: 4, province: PROVINCE_B });
            const res = (await reservationFor(f, done.lineItemId))!;
            const target = otherVendorLocation(res.location);
            const reduced = await reduceReservation(f, res.id, 2);
            const created = await addReservation(f, {
              label: target,
              quantity: 2,
              lineItemId: done.lineItemId!,
            });
            const reservations = (await listReservations(f)).filter(
              (r) => r.line_item_id === done.lineItemId
            );
            splitVariant1 = reduced.ok && created.ok;
            return {
              ok: splitVariant1,
              reduce_error: reduced.error ?? null,
              create_error: created.error ?? null,
              reservations,
              total: reservations.reduce((sum, r) => sum + r.quantity, 0),
              snapshot: await snapshotInventory(f),
            };
          });

          let recreatable = false;
          let splitVariant2 = false;
          await observe("S1", layout, "1d-split-delete-and-recreate", async () => {
            const f = await build({ a: 5, b: 5 });
            const done = await completeCart(f, { quantity: 4, province: PROVINCE_B });
            const res = (await reservationFor(f, done.lineItemId))!;
            const removed = await removeReservation(f, res.id);
            const first = await addReservation(f, { label: "A", quantity: 2, lineItemId: done.lineItemId! });
            const second = await addReservation(f, { label: "B", quantity: 2, lineItemId: done.lineItemId! });
            const reservations = (await listReservations(f)).filter(
              (r) => r.line_item_id === done.lineItemId
            );
            const total = reservations.reduce((sum, r) => sum + r.quantity, 0);
            splitVariant2 = removed.ok && first.ok && second.ok;
            recreatable = splitVariant2 && total === 4;
            return {
              ok: splitVariant2,
              delete_error: removed.error ?? null,
              create_errors: [first.error ?? null, second.error ?? null],
              reservations,
              total,
              snapshot: await snapshotInventory(f),
            };
          });

          // Step 1e: an order larger than any single location.
          let oversizeCompletes = false;
          for (const quantity of [5, 7]) {
            await observe("S1", layout, `1e-oversize-${quantity}`, async () => {
              const f = await build({ a: 3, b: 3 });
              const done = await completeCart(f, { quantity, province: PROVINCE_B });
              const reservations = (await listReservations(f)).filter(
                (r) => r.line_item_id === done.lineItemId
              );
              if (quantity === 5) {
                oversizeCompletes = !done.error && !!done.orderId;
              }
              return {
                quantity,
                complete_ok: !done.error && !!done.orderId,
                error: done.error ?? null,
                reservations,
                storefront_inventory_quantity: await storeVariantQuantity(f),
              };
            });
          }

          recordSpike("S1", layout, "derived", {
            S1_movable: movable,
            S1_recreatable: recreatable,
            S1_split_ok: splitVariant1 || splitVariant2,
            S1_oversize_completes: oversizeCompletes,
            follows_customer_state: follows,
          });
        });
      });
    });
  },
});
