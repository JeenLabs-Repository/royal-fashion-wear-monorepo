import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { collectFieldTerms, findForbiddenTerm } from "./forbidden-fields";

const GENERIC_MESSAGE = "A requested field is not available.";

// Request text is attacker-controlled: keep log lines to printable characters.
const safeForLog = (text: string): string =>
  text.replace(/[^\x20-\x7e]/g, "?").slice(0, 100);

const warn = (req: MedusaRequest, text: string): void => {
  try {
    const logger = (req.scope as { resolve: (key: string) => unknown } | undefined)?.resolve(
      ContainerRegistrationKeys.LOGGER
    ) as { warn: (message: string) => void } | undefined;
    (logger?.warn ?? console.warn)(`[store-guard] ${text}`);
  } catch {
    console.warn(`[store-guard] ${text}`);
  }
};

/**
 * Rejects a Store API request whose `fields`, `expand` or `include` names a
 * vendor-related relation. The answer is a generic 400 that does not echo the
 * term. The query is read from the original URL, which does not depend on
 * whether a core validator has parsed it yet. Never reads the body.
 */
export function storeAnonymityGuard(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  let offending: string | null = null;
  try {
    const params = new URL(req.originalUrl ?? req.url ?? "", "http://localhost").searchParams;
    for (const raw of collectFieldTerms(params)) {
      offending = findForbiddenTerm(raw);
      if (offending) {
        break;
      }
    }
  } catch {
    // A URL that cannot be parsed is rejected: this guard fails closed.
    offending = "<unparseable>";
  }

  if (offending) {
    warn(req, `rejected term "${safeForLog(offending)}"`);
    next(new MedusaError(MedusaError.Types.INVALID_DATA, GENERIC_MESSAGE, "forbidden_field"));
    return;
  }
  next();
}

// Matcher form from the actor mechanics record (experiment on store prefix):
// "/store*", all methods.
export const storeGuardRoutes: MiddlewareRoute[] = [
  {
    matcher: "/store*",
    middlewares: [storeAnonymityGuard],
  },
];
