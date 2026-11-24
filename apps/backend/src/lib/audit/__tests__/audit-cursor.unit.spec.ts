import {
  AUDIT_PAGE_SIZE,
  type AuditReader,
  type AuditRow,
  auditQuerySchema,
  buildAuditFilter,
  decodeCursor,
  encodeCursor,
  escapeLike,
  queryAuditEntries,
} from "../query";

const row = (index: number): AuditRow => ({
  id: `aud_${String(index).padStart(6, "0")}`,
  at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
  actor_id: null,
  actor_type: "system",
  actor_label: null,
  roles: [],
  action: "admin.write",
  target_type: null,
  target_id: null,
  before: null,
  after: null,
  http_method: null,
  http_path: null,
  http_route: null,
  http_status: null,
  ip: null,
  forwarded_for: null,
  user_agent: null,
  request_id: null,
  meta: null,
});

describe("cursor", () => {
  it("round-trips a timestamp and an id", () => {
    const at = new Date("2026-03-04T05:06:07.089Z");
    const decoded = decodeCursor(encodeCursor(at, "aud_01ABC"));
    expect(decoded.at.toISOString()).toBe(at.toISOString());
    expect(decoded.id).toBe("aud_01ABC");
  });

  it("is opaque base64url with no padding", () => {
    const cursor = encodeCursor(new Date(), "aud_01ABC");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("aud_01ABC");
  });

  it.each([
    ["not base64url", "a b+c/="],
    ["not json", Buffer.from("not json").toString("base64url")],
    ["wrong types", Buffer.from(JSON.stringify({ at: 5, id: 6 })).toString("base64url")],
    [
      "bad date",
      Buffer.from(JSON.stringify({ at: "yesterday", id: "aud_1" })).toString("base64url"),
    ],
    [
      "id with a quote",
      Buffer.from(JSON.stringify({ at: new Date().toISOString(), id: "aud'1" })).toString(
        "base64url"
      ),
    ],
  ])("rejects a cursor that is %s", (_name, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow();
  });

  it("rejects a cursor with one character flipped into an invalid byte", () => {
    const cursor = encodeCursor(new Date(), "aud_01ABC");
    expect(() => decodeCursor(`${cursor.slice(0, -2)}!!`)).toThrow();
  });
});

describe("query schema", () => {
  it("defaults the limit to 50 and coerces a numeric string", () => {
    expect(auditQuerySchema.parse({}).limit).toBe(AUDIT_PAGE_SIZE);
    expect(auditQuerySchema.parse({ limit: "20" }).limit).toBe(20);
  });

  it.each([{ limit: "51" }, { limit: "0" }, { limit: "abc" }])("rejects %p", (query) => {
    expect(auditQuerySchema.safeParse(query).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(auditQuerySchema.safeParse({ export: "csv" }).success).toBe(false);
  });

  it.each([{ action_prefix: "staff%" }, { action_prefix: "a b" }, { action_prefix: "x".repeat(41) }])(
    "rejects the action prefix %p",
    (query) => {
      expect(auditQuerySchema.safeParse(query).success).toBe(false);
    }
  );

  it("accepts a letters, underscore and dot prefix and a safe target id", () => {
    expect(
      auditQuerySchema.safeParse({ action_prefix: "break_glass.", target_id: "user_01-AB" }).success
    ).toBe(true);
    expect(auditQuerySchema.safeParse({ target_id: "a/b" }).success).toBe(false);
  });

  it("accepts ISO date-times only", () => {
    expect(auditQuerySchema.safeParse({ from: "2026-01-01T00:00:00.000Z" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ from: "yesterday" }).success).toBe(false);
  });
});

describe("filters", () => {
  it("escapes percent, underscore and backslash", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("builds no condition for an empty query", () => {
    expect(buildAuditFilter({})).toEqual({});
  });

  it("escapes wildcard characters typed into the actor and prefix filters", () => {
    const filter = JSON.stringify(buildAuditFilter({ actor: "%", action_prefix: "a_" }));
    expect(filter).toContain("%\\\\%%");
    expect(filter).toContain("a\\\\_%");
  });

  it("combines every filter and the cursor under one and", () => {
    const filter = buildAuditFilter({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
      actor: "ann",
      action_prefix: "staff.",
      target_id: "user_1",
      cursor: encodeCursor(new Date("2026-01-15T00:00:00.000Z"), "aud_00001"),
    }) as { $and: unknown[] };
    expect(filter.$and).toHaveLength(6);
  });
});

describe("queryAuditEntries", () => {
  const readerOf = (rows: AuditRow[]) => {
    const calls: { filters: Record<string, unknown>; config: { take: number } }[] = [];
    const reader: AuditReader = {
      listAuditEntries: async (filters, config) => {
        calls.push({ filters, config });
        return rows.slice(0, config.take);
      },
    };
    return { reader, calls };
  };

  it("fetches one extra row to detect a next page and returns a cursor", async () => {
    const rows = Array.from({ length: 11 }, (_, index) => row(100 - index));
    const { reader, calls } = readerOf(rows);
    const result = await queryAuditEntries(reader, { limit: 10 });
    expect(calls[0].config.take).toBe(11);
    expect(result.rows).toHaveLength(10);
    expect(result.next_cursor).not.toBeNull();
    expect(decodeCursor(result.next_cursor as string).id).toBe(rows[9].id);
  });

  it("returns a null cursor on the last page", async () => {
    const { reader } = readerOf(Array.from({ length: 4 }, (_, index) => row(index)));
    const result = await queryAuditEntries(reader, { limit: 10 });
    expect(result.rows).toHaveLength(4);
    expect(result.next_cursor).toBeNull();
  });
});
