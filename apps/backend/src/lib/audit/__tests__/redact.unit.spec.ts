import { extractKeyPaths, redactAudit } from "../redact";

describe("redactAudit", () => {
  test("redacts sensitive keys at any depth", () => {
    const result = redactAudit({
      password: "p1",
      apiKey: "k1",
      "x-api-key": "k2",
      refresh_token: "t1",
      otp_code: "123456",
      Authorization: "Bearer abc",
      nested: { deep: { client_secret: "s1" } },
      list: [{ session_cookie: "c1", name: "kept" }],
    }) as Record<string, any>;

    expect(result.password).toBe("[redacted]");
    expect(result.apiKey).toBe("[redacted]");
    expect(result["x-api-key"]).toBe("[redacted]");
    expect(result.refresh_token).toBe("[redacted]");
    expect(result.otp_code).toBe("[redacted]");
    expect(result.Authorization).toBe("[redacted]");
    expect(result.nested.deep.client_secret).toBe("[redacted]");
    expect(result.list[0].session_cookie).toBe("[redacted]");
    expect(result.list[0].name).toBe("kept");
  });

  test("keeps ordinary fields, including the ones named like secrets", () => {
    const input = {
      role_key: "support",
      country_code: "in",
      currency_code: "inr",
      state_code: "KA",
      postal_code: "560001",
      name: "Asha",
      email: "asha@example.test",
      keyboard: "kept",
    };
    expect(redactAudit(input)).toEqual(input);
  });

  test("never contains a seeded secret value anywhere in the output", () => {
    const secret = "S3CR3T-VALUE-123";
    const out = JSON.stringify(
      redactAudit({
        a: { token: secret },
        b: [{ password: secret }],
        c: { x: { y: { authorization: secret } } },
      })
    );
    expect(out).not.toContain(secret);
  });

  test("stops at depth 6", () => {
    let node: Record<string, unknown> = { leaf: "deep" };
    for (let i = 0; i < 9; i += 1) {
      node = { child: node };
    }
    const out = JSON.stringify(redactAudit(node));
    expect(out).toContain("[max-depth]");
    expect(out).not.toContain("deep");
  });

  test("cuts long strings", () => {
    const out = redactAudit({ note: "x".repeat(900) }) as { note: string };
    expect(out.note.endsWith("...[truncated]")).toBe(true);
    expect(out.note.length).toBe(500 + "...[truncated]".length);
  });

  test("replaces a result over 16 KB with a stub holding the sorted top-level keys", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 100; i += 1) {
      big[`field_${String(i).padStart(3, "0")}`] = "y".repeat(400);
    }
    const out = redactAudit(big) as { _truncated?: boolean; keys?: string[] };
    expect(out._truncated).toBe(true);
    expect(out.keys).toHaveLength(100);
    expect(out.keys).toEqual([...(out.keys ?? [])].sort());
  });

  test("passes null and undefined through", () => {
    expect(redactAudit(null)).toBeNull();
    expect(redactAudit(undefined)).toBeUndefined();
  });
});

describe("extractKeyPaths", () => {
  test("returns sorted dotted key names and no values", () => {
    const paths = extractKeyPaths({
      title: "SECRET-TITLE",
      address: { city: "Pune", geo: { lat: 1 } },
      items: [{ sku: "A1" }],
    });
    expect(paths).toEqual([
      "address",
      "address.city",
      "address.geo",
      "items",
      "items[].sku",
      "title",
    ]);
    expect(JSON.stringify(paths)).not.toContain("SECRET-TITLE");
    expect(JSON.stringify(paths)).not.toContain("Pune");
  });

  test("respects the depth argument", () => {
    expect(extractKeyPaths({ a: { b: { c: 1 } } }, 1)).toEqual(["a"]);
    expect(extractKeyPaths({ a: { b: { c: 1 } } }, 3)).toEqual([
      "a",
      "a.b",
      "a.b.c",
    ]);
  });

  test("returns an empty list for a non-object", () => {
    expect(extractKeyPaths("text")).toEqual([]);
    expect(extractKeyPaths(null)).toEqual([]);
  });
});
