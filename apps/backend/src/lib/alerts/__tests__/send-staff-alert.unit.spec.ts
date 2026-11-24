import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveRoleRecipients, sendStaffAlert } from "../send-staff-alert";

type Assignment = { user_id: string; role_key: string; is_break_glass: boolean };
type User = { id: string; email: string | null };

const makeContainer = (assignments: Assignment[], users: User[]) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const createNotifications = jest.fn(async () => []);
  const listStaffAssignments = jest.fn(
    async (filters: { role_key: string[] }) =>
      assignments.filter((row) => filters.role_key.includes(row.role_key))
  );
  const listUsers = jest.fn(async (filters: { id: string[] }) =>
    users.filter((user) => filters.id.includes(user.id))
  );
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger;
      if (key === Modules.NOTIFICATION) return { createNotifications };
      if (key === "staffAccess") return { listStaffAssignments };
      if (key === Modules.USER) return { listUsers };
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as MedusaContainer;
  return { container, logger, createNotifications, listStaffAssignments, listUsers };
};

const props = {
  subject: "Order needs routing",
  heading: "An order needs routing",
  lines: ["Order 1001 is waiting."],
};

describe("resolveRoleRecipients", () => {
  test("returns the emails of users holding the given roles", async () => {
    const { container, listStaffAssignments } = makeContainer(
      [
        { user_id: "u1", role_key: "order_router", is_break_glass: false },
        { user_id: "u2", role_key: "support", is_break_glass: false },
      ],
      [
        { id: "u1", email: "router@example.test" },
        { id: "u2", email: "support@example.test" },
      ]
    );
    const result = await resolveRoleRecipients(container, ["order_router"]);
    expect(result).toEqual(["router@example.test"]);
    expect(listStaffAssignments).toHaveBeenCalledWith(
      { role_key: ["order_router"] },
      expect.anything()
    );
  });

  test("excludes assignments flagged break-glass", async () => {
    const { container } = makeContainer(
      [
        { user_id: "u1", role_key: "superadmin", is_break_glass: false },
        { user_id: "u9", role_key: "superadmin", is_break_glass: true },
      ],
      [
        { id: "u1", email: "owner@example.test" },
        { id: "u9", email: "breakglass@example.test" },
      ]
    );
    expect(await resolveRoleRecipients(container, ["superadmin"])).toEqual([
      "owner@example.test",
    ]);
  });

  test("de-duplicates ignoring case and drops malformed or missing addresses", async () => {
    const { container } = makeContainer(
      [
        { user_id: "u1", role_key: "support", is_break_glass: false },
        { user_id: "u2", role_key: "support", is_break_glass: false },
        { user_id: "u3", role_key: "support", is_break_glass: false },
        { user_id: "u4", role_key: "support", is_break_glass: false },
      ],
      [
        { id: "u1", email: "Same@Example.test" },
        { id: "u2", email: "same@example.test" },
        { id: "u3", email: "not-an-email" },
        { id: "u4", email: null },
      ]
    );
    expect(await resolveRoleRecipients(container, ["support"])).toEqual([
      "Same@Example.test",
    ]);
  });
});

describe("sendStaffAlert", () => {
  const key = "order-routing:ord_1:2026-01-02";

  test("emails the resolved recipients with the given key", async () => {
    const { container, createNotifications } = makeContainer(
      [
        { user_id: "u1", role_key: "order_router", is_break_glass: false },
        { user_id: "u2", role_key: "order_router", is_break_glass: false },
      ],
      [
        { id: "u1", email: "a@example.test" },
        { id: "u2", email: "b@example.test" },
      ]
    );
    const ok = await sendStaffAlert({
      container,
      kind: "order-routing",
      roleKeys: ["order_router"],
      props,
      idempotencyKey: key,
    });
    expect(ok).toBe(true);
    expect(createNotifications).toHaveBeenCalledTimes(2);
    for (const call of createNotifications.mock.calls as any[][]) {
      expect(call[0].template).toBe("staff-alert");
      expect(call[0].idempotency_key.startsWith(key)).toBe(true);
    }
  });

  test("warns and returns false when no recipient exists", async () => {
    const { container, logger, createNotifications } = makeContainer([], []);
    const ok = await sendStaffAlert({
      container,
      kind: "order-routing",
      roleKeys: ["order_router"],
      props,
      idempotencyKey: key,
    });
    expect(ok).toBe(false);
    expect(createNotifications).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[staff-alert:order-routing]")
    );
  });

  test("never throws when the lookup fails", async () => {
    const { container, logger, listStaffAssignments } = makeContainer([], []);
    listStaffAssignments.mockRejectedValueOnce(new Error("db down"));
    await expect(
      sendStaffAlert({
        container,
        kind: "order-routing",
        roleKeys: ["order_router"],
        props,
        idempotencyKey: key,
      })
    ).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      "[staff-alert:order-routing] failed: db down"
    );
  });
});
