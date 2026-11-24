import { z } from "@medusajs/framework/zod";
import {
  ONBOARDING_ROUTES,
  evaluateVendorAccess,
  vendorStatusGuard,
} from "../status-guard";
import { parseStrict, strictQuery } from "../strict-query";

const mockVendorModule = {
  listVendorUsers: jest.fn(),
  listVendors: jest.fn(),
};

jest.mock("../vendor-module", () => ({
  getVendorModule: () => mockVendorModule,
}));

const makeRes = () => {
  const res: Record<string, any> = { locals: {} };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  method: "GET",
  originalUrl: "/vendor/me",
  auth_context: { actor_id: "vusr_1", actor_type: "vendor" },
  scope: {},
  ...overrides,
});

describe("evaluateVendorAccess", () => {
  test.each([
    ["GET", "/vendor/me"],
    ["POST", "/vendor/products"],
    ["DELETE", "/vendor/anything/at/all"],
  ])("allows an active vendor on %s %s", (method, path) => {
    expect(evaluateVendorAccess("active", method, path)).toEqual({ allow: true });
  });

  test.each([
    ["GET", "/vendor/me"],
    ["POST", "/vendor/agreement/accept"],
    ["GET", "/vendor/products"],
  ])("denies a suspended vendor on %s %s with vendor_suspended", (method, path) => {
    expect(evaluateVendorAccess("suspended", method, path)).toEqual({
      allow: false,
      code: "vendor_suspended",
      message: "Your account is suspended. Contact the store.",
    });
  });

  test.each([
    ["GET", "/vendor/me"],
    ["GET", "/vendor/onboarding"],
    ["GET", "/vendor/agreement/current"],
    ["POST", "/vendor/agreement/accept"],
    ["GET", "/vendor/me/locations"],
    ["POST", "/vendor/me/password"],
  ])("lets an invited vendor call %s %s", (method, path) => {
    expect(evaluateVendorAccess("invited", method, path)).toEqual({ allow: true });
  });

  test.each([
    ["GET", "/vendor/products"],
    ["POST", "/vendor/products"],
    ["GET", "/vendor/me/other"],
    ["POST", "/vendor/me"],
    ["GET", "/vendor/agreementx"],
    ["GET", "/vendor/compliance/ping"],
  ])("denies an invited vendor on %s %s with vendor_not_active", (method, path) => {
    expect(evaluateVendorAccess("invited", method, path)).toEqual({
      allow: false,
      code: "vendor_not_active",
      message: "Your account is waiting for activation by the store.",
    });
  });

  test("ignores a trailing slash, a query string and letter case", () => {
    expect(evaluateVendorAccess("invited", "GET", "/vendor/me/")).toEqual({ allow: true });
    expect(evaluateVendorAccess("invited", "GET", "/vendor/me?x=1")).toEqual({ allow: true });
    expect(evaluateVendorAccess("invited", "get", "/Vendor/Me")).toEqual({ allow: true });
    expect(evaluateVendorAccess("invited", "GET", "/vendor/products/")).toMatchObject({
      allow: false,
    });
  });

  test("denies an invited vendor on a path that cannot be normalised", () => {
    expect(evaluateVendorAccess("invited", "GET", "/vendor/../vendor/me")).toMatchObject({
      allow: false,
    });
  });

  test("never lets an unknown status in", () => {
    expect(evaluateVendorAccess("mystery", "GET", "/vendor/products")).toMatchObject({
      allow: false,
      code: "vendor_not_active",
    });
  });

  test("keeps the onboarding list explicit", () => {
    expect(ONBOARDING_ROUTES.map((route) => route.path)).toEqual([
      "/vendor/me",
      "/vendor/me/locations",
      "/vendor/onboarding",
      "/vendor/me/password",
      "/vendor/agreement",
    ]);
  });
});

describe("vendorStatusGuard", () => {
  beforeEach(() => {
    mockVendorModule.listVendorUsers.mockReset();
    mockVendorModule.listVendors.mockReset();
  });

  const setVendor = (status: string) => {
    mockVendorModule.listVendorUsers.mockResolvedValue([
      { id: "vusr_1", vendor_id: "vnd_1", email: "u@example.test" },
    ]);
    mockVendorModule.listVendors.mockResolvedValue([
      { id: "vnd_1", status, internal_name: "Spec Vendor" },
    ]);
  };

  test("attaches the vendor derived from the actor id and calls next", async () => {
    setVendor("active");
    const req: any = makeReq();
    const next = jest.fn();

    await vendorStatusGuard(req, makeRes() as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.vendor).toEqual({
      id: "vnd_1",
      user_id: "vusr_1",
      user_email: "u@example.test",
      status: "active",
      internal_name: "Spec Vendor",
    });
    expect(mockVendorModule.listVendorUsers).toHaveBeenCalledWith({ id: "vusr_1" }, { take: 1 });
  });

  test("refuses a suspended vendor with 403 vendor_suspended", async () => {
    setVendor("suspended");
    const res = makeRes();
    const next = jest.fn();

    await vendorStatusGuard(makeReq() as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "vendor_suspended" })
    );
  });

  test("refuses an invited vendor on a non-onboarding route with vendor_not_active", async () => {
    setVendor("invited");
    const res = makeRes();

    await vendorStatusGuard(
      makeReq({ originalUrl: "/vendor/products" }) as never,
      res as never,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "vendor_not_active" })
    );
  });

  test("reads the module again on every request, so a status change applies at once", async () => {
    setVendor("active");
    const first = makeRes();
    await vendorStatusGuard(makeReq() as never, first as never, jest.fn());
    expect(first.status).not.toHaveBeenCalled();

    setVendor("suspended");
    const second = makeRes();
    await vendorStatusGuard(makeReq() as never, second as never, jest.fn());

    expect(second.status).toHaveBeenCalledWith(403);
    expect(mockVendorModule.listVendors).toHaveBeenCalledTimes(2);
  });

  test("answers 401 when the actor id is missing or no vendor user exists", async () => {
    const noActor = makeRes();
    await vendorStatusGuard(
      makeReq({ auth_context: { actor_type: "vendor" } }) as never,
      noActor as never,
      jest.fn()
    );
    expect(noActor.status).toHaveBeenCalledWith(401);

    mockVendorModule.listVendorUsers.mockResolvedValue([]);
    const noUser = makeRes();
    await vendorStatusGuard(makeReq() as never, noUser as never, jest.fn());
    expect(noUser.status).toHaveBeenCalledWith(401);
  });

  test("hands an unexpected error to next", async () => {
    mockVendorModule.listVendorUsers.mockRejectedValue(new Error("database down"));
    const next = jest.fn();
    await vendorStatusGuard(makeReq() as never, makeRes() as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "database down" }));
  });
});

describe("strict query helpers", () => {
  const empty = z.strictObject({});

  test("an empty query passes", () => {
    expect(parseStrict(empty, {})).toEqual({});
  });

  test.each([{ limit: "1" }, { vendor_id: "vnd_other" }])(
    "an unknown key %j is a 400",
    (query) => {
      expect(() => parseStrict(empty, query)).toThrow(
        expect.objectContaining({ type: "invalid_data" })
      );
    }
  );

  test("the message names the key and never repeats the value", () => {
    try {
      parseStrict(empty, { vendor_id: "SECRET-VALUE" });
      throw new Error("expected a throw");
    } catch (error) {
      const message = (error as { message: string }).message;
      expect(message).toContain("vendor_id");
      expect(message).not.toContain("SECRET-VALUE");
    }
  });

  test("the middleware stores the parsed value or passes the error on", () => {
    const next = jest.fn();
    const req: any = { query: {} };
    strictQuery(empty)(req, {} as never, next);
    expect(req.validatedQuery).toEqual({});
    expect(next).toHaveBeenCalledWith();

    const failing = jest.fn();
    strictQuery(empty)({ query: { limit: "1" } } as never, {} as never, failing);
    expect(failing).toHaveBeenCalledWith(expect.objectContaining({ type: "invalid_data" }));
  });
});
