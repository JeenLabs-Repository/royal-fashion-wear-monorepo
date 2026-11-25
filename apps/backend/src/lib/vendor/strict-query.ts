import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import type { z } from "@medusajs/framework/zod";

/**
 * Parses a value with a strict schema. An unknown key, a wrong type or a
 * missing field is a 400 whose message names the problem but never echoes the
 * value.
 */
export function parseStrict<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      message || "The request is not valid."
    );
  }
  return result.data;
}

/** Middleware form of the strict query check. The parsed value lands on `validatedQuery`. */
export function strictQuery<T>(schema: z.ZodType<T>) {
  return (req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction): void => {
    try {
      // qs can turn a single value into a one-element array; take the first string.
      const normalized = Object.fromEntries(
        Object.entries((req.query ?? {}) as Record<string, unknown>).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] : value,
        ])
      );
      (req as unknown as { validatedQuery: T }).validatedQuery = parseStrict(schema, normalized);
      next();
    } catch (error) {
      next(error);
    }
  };
}
