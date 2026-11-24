import {
  assertOutputWithinAllowlist,
  defineAllowlistSerializer,
} from "../define-allowlist-serializer";

const basic = defineAllowlistSerializer({
  name: "basic",
  audience: "vendor",
  shape: { id: true, name: true },
});

describe("defineAllowlistSerializer", () => {
  test("copies only declared keys", () => {
    expect(basic.serialize({ id: "a", name: "b", secret: "x" })).toEqual({ id: "a", name: "b" });
  });

  test("drops an object or array under a scalar entry", () => {
    expect(basic.serialize({ id: { nested: "x" }, name: ["y"] })).toEqual({});
  });

  test("recurses into a nested shape", () => {
    const serializer = defineAllowlistSerializer({
      name: "nested",
      audience: "vendor",
      shape: { user: { id: true } },
    });
    expect(serializer.serialize({ user: { id: 1, email: "e" } })).toEqual({ user: { id: 1 } });
  });

  test("maps every element when the value under a nested shape is an array", () => {
    const serializer = defineAllowlistSerializer({
      name: "list",
      audience: "vendor",
      shape: { items: { id: true } },
    });
    expect(serializer.serialize({ items: [{ id: 1, x: 2 }, { id: 2, y: 3 }] })).toEqual({
      items: [{ id: 1 }, { id: 2 }],
    });
  });

  test("converts a Date to an ISO string, omits undefined and keeps null", () => {
    const serializer = defineAllowlistSerializer({
      name: "dates",
      audience: "vendor",
      shape: { at: true, missing: true, none: true },
    });
    const at = new Date("2026-11-23T10:00:00.000Z");
    expect(serializer.serialize({ at, missing: undefined, none: null })).toEqual({
      at: "2026-11-23T10:00:00.000Z",
      none: null,
    });
  });

  test("serialize returns null for null and undefined", () => {
    expect(basic.serialize(null)).toBeNull();
    expect(basic.serialize(undefined)).toBeNull();
  });

  test("serializeMany maps arrays and treats null as empty", () => {
    expect(basic.serializeMany([{ id: 1, z: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(basic.serializeMany(null)).toEqual([]);
  });

  test("does not read inherited properties", () => {
    const parent = { name: "inherited" };
    const child = Object.create(parent) as Record<string, unknown>;
    child.id = "own";
    expect(basic.serialize(child)).toEqual({ id: "own" });
  });

  test("allowedPaths lists every declared path, parents first", () => {
    const serializer = defineAllowlistSerializer({
      name: "paths",
      audience: "admin",
      shape: { user: { id: true }, tags: { name: true } },
    });
    expect(serializer.allowedPaths).toEqual(["user", "user.id", "tags", "tags.name"]);
  });

  test.each(["vendor_name", "stock_location", "awb_number", "locations", "routing"])(
    "a store serializer cannot declare %s",
    (key) => {
      expect(() =>
        defineAllowlistSerializer({ name: "bad", audience: "store", shape: { [key]: true } })
      ).toThrow();
    }
  );

  test("a document serializer cannot declare a nested vendor key", () => {
    expect(() =>
      defineAllowlistSerializer({
        name: "bad-nested",
        audience: "document",
        shape: { items: { vendor_ref: true } },
      })
    ).toThrow();
  });

  test("vendor and admin serializers may declare those keys", () => {
    expect(() =>
      defineAllowlistSerializer({ name: "ok-v", audience: "vendor", shape: { vendor_id: true } })
    ).not.toThrow();
    expect(() =>
      defineAllowlistSerializer({ name: "ok-a", audience: "admin", shape: { stock_location_id: true } })
    ).not.toThrow();
  });

  test("a store serializer may declare the inventory quantity", () => {
    expect(() =>
      defineAllowlistSerializer({ name: "qty", audience: "store", shape: { inventory_quantity: true } })
    ).not.toThrow();
  });

  test("refuses prototype keys in a shape", () => {
    const shape = JSON.parse('{"__proto__": true}');
    expect(() =>
      defineAllowlistSerializer({ name: "proto", audience: "admin", shape })
    ).toThrow();
  });
});

describe("assertOutputWithinAllowlist", () => {
  const paths = ["user", "user.id", "tags", "tags.name"];

  test("accepts output inside the allowlist, arrays included", () => {
    expect(() =>
      assertOutputWithinAllowlist({ user: { id: 1 }, tags: [{ name: "a" }, { name: "b" }] }, paths)
    ).not.toThrow();
  });

  test("throws naming the offending path", () => {
    expect(() =>
      assertOutputWithinAllowlist({ user: { id: 1, email: "e" } }, paths)
    ).toThrow("user.email");
  });

  test("the output of a serializer always satisfies its own allowlist", () => {
    const serializer = defineAllowlistSerializer({
      name: "self-check",
      audience: "vendor",
      shape: { id: true, items: { sku: true } },
    });
    const output = serializer.serialize({ id: "a", items: [{ sku: "s", x: 1 }], extra: 1 });
    expect(() => assertOutputWithinAllowlist(output, serializer.allowedPaths)).not.toThrow();
  });
});
