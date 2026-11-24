import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import type { z } from "@medusajs/framework/zod";
import { parseStrict } from "./strict-query";

// Despite the file name this holds no middleware entry. The staff chain is the
// only middleware entry for /admin, and a second entry could run before it in
// an order Medusa does not document, so the admin vendor routes validate their
// input here, inside the handler, after the chain has run.

/** Strict check of a request body. A missing body counts as an empty one. */
export function adminVendorBody<T>(
  schema: z.ZodType<T>,
  req: AuthenticatedMedusaRequest
): T {
  return parseStrict(schema, req.body ?? {});
}

/** Strict check of a query string. */
export function adminVendorQuery<T>(
  schema: z.ZodType<T>,
  req: AuthenticatedMedusaRequest
): T {
  return parseStrict(schema, req.query);
}

/** The actor recorded on audit entries for staff actions. */
export function staffActor(req: AuthenticatedMedusaRequest): { id: string } {
  return { id: req.auth_context.actor_id };
}
