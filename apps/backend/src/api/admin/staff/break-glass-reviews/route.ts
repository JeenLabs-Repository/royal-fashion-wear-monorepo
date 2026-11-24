import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { STAFF_ACCESS_MODULE } from "../../../../modules/staff-access";

const QuerySchema = z.strictObject({
  status: z.enum(["open", "closed", "all"]).default("open"),
});

type Review = {
  id: string;
  opened_at: Date | string;
  first_ip: string | null;
  first_request: string | null;
  closed_at: Date | string | null;
  closed_by: string | null;
  rotated_confirmed: boolean;
  note: string | null;
};

type StaffAccessApi = {
  listBreakGlassReviews(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<Review[]>;
};

// Covered by the staff rule in the manifest (staff:manage), so only a superadmin gets here.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((issue) => issue.message).join("; "),
      "invalid_query"
    );
  }

  const filter =
    parsed.data.status === "open"
      ? { closed_at: null }
      : parsed.data.status === "closed"
        ? { closed_at: { $ne: null } }
        : {};

  const rows = await req.scope
    .resolve<StaffAccessApi>(STAFF_ACCESS_MODULE)
    .listBreakGlassReviews(filter, { order: { opened_at: "DESC" }, take: 200 });

  const now = Date.now();
  res.json({
    reviews: rows.map((row) => {
      const opened = new Date(row.opened_at).getTime();
      const until = row.closed_at ? new Date(row.closed_at).getTime() : now;
      // An explicit allowlist: nothing else from the row is returned.
      return {
        id: row.id,
        opened_at: row.opened_at,
        first_ip: row.first_ip,
        first_request: row.first_request,
        closed_at: row.closed_at,
        closed_by: row.closed_by,
        rotated_confirmed: row.rotated_confirmed,
        note: row.note,
        age_hours: Math.floor((until - opened) / 3_600_000),
      };
    }),
  });
}
