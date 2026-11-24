import type {
  MedusaNextFunction,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import type { z } from "@medusajs/framework/zod";
import { EmptyQuerySchema } from "../../api/vendor/validators";
import { normalizeAdminPath, normalizeMethod } from "../rbac/normalize-path";
import type { AdminRequest } from "../rbac/reject";
import { authenticateVendor } from "./authenticate-vendor";
import { blockVendorRegistration } from "./block-vendor-registration";
import { parseStrict } from "./strict-query";

// Matcher forms from the actor-mechanics record (register block and chain that
// skips the public accept-invite route).
export const VENDOR_REGISTER_MATCHER = /^\/auth\/vendor\/emailpass\/register\/?$/;
export const VENDOR_CHAIN_MATCHER = /^\/vendor(?!\/accept-invite\/?$)(\/.*)?$/;

/**
 * Query schemas by `METHOD /lower-case/path`. Any vendor request without an
 * entry here must have an empty query, so a stray parameter such as
 * `vendor_id` is a 400 on every route, including routes added later.
 */
export const VENDOR_QUERY_SCHEMAS: Record<string, z.ZodType<unknown>> = {};

/** Last element of the chain. Strict, deny-by-default query check. */
export function validateVendorQuery(
  req: AdminRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  try {
    const path = normalizeAdminPath(req.originalUrl ?? req.url ?? "");
    const key = `${normalizeMethod(req.method)} ${path.ok ? path.matchPath : ""}`;
    const schema = VENDOR_QUERY_SCHEMAS[key] ?? EmptyQuerySchema;
    (req as unknown as { validatedQuery: unknown }).validatedQuery = parseStrict(
      schema,
      req.query
    );
    next();
  } catch (error) {
    next(error);
  }
}

export const vendorChain = [...authenticateVendor, validateVendorQuery];

// One entry for the register block and one for the chain. Request bodies are
// validated inside the route handlers with parseStrict. A second middleware
// entry for /vendor would run in an order Medusa does not document.
export const vendorRouteEntries: MiddlewareRoute[] = [
  {
    matcher: VENDOR_REGISTER_MATCHER,
    middlewares: [blockVendorRegistration] as unknown as MiddlewareRoute["middlewares"],
  },
  {
    matcher: VENDOR_CHAIN_MATCHER,
    middlewares: vendorChain as unknown as MiddlewareRoute["middlewares"],
  },
];
