import { MedusaError } from "@medusajs/framework/utils";
import { isForbiddenSegment } from "../anonymity/forbidden-fields";

/** `true` copies a scalar; an object copies that sub-object through its own shape. */
export type Shape = { [key: string]: true | Shape };

export type Audience = "store" | "vendor" | "admin" | "document";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const copyScalar = (value: unknown): unknown | undefined => {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  // An object, array, function or bigint under a scalar entry is dropped.
  return undefined;
};

const pick = (value: unknown, shape: Shape): Record<string, unknown> | undefined => {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const entry = shape[key];
    const raw = value[key];
    if (raw === undefined) {
      continue;
    }
    if (entry === true) {
      const scalar = copyScalar(raw);
      if (scalar !== undefined) {
        output[key] = scalar;
      }
      continue;
    }
    if (raw === null) {
      output[key] = null;
    } else if (Array.isArray(raw)) {
      output[key] = raw
        .map((item) => pick(item, entry))
        .filter((item): item is Record<string, unknown> => item !== undefined);
    } else {
      const nested = pick(raw, entry);
      if (nested !== undefined) {
        output[key] = nested;
      }
    }
  }
  return output;
};

const collectPaths = (shape: Shape, prefix = ""): string[] => {
  const paths: string[] = [];
  for (const key of Object.keys(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    const entry = shape[key];
    if (entry !== true) {
      paths.push(...collectPaths(entry, path));
    }
  }
  return paths;
};

const assertShapeIsSafe = (name: string, audience: Audience, shape: Shape, prefix = ""): void => {
  for (const key of Object.keys(shape)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Serializer "${name}" declares the unsafe key "${key}".`
      );
    }
    if ((audience === "store" || audience === "document") && isForbiddenSegment(key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Serializer "${name}" has the audience "${audience}" and may not declare "${prefix}${key}".`
      );
    }
    const entry = shape[key];
    if (entry !== true) {
      assertShapeIsSafe(name, audience, entry, `${prefix}${key}.`);
    }
  }
};

export type AllowlistSerializer<T = unknown> = {
  name: string;
  audience: Audience;
  shape: Shape;
  allowedPaths: string[];
  serialize: (value: unknown) => Partial<T> | null;
  serializeMany: (values: unknown[] | null | undefined) => Partial<T>[];
};

/**
 * Builds a serializer that copies only the keys named in `shape`. Anything
 * else on the input, including whole related objects, is dropped. Store and
 * document serializers cannot even be defined with a vendor-related key.
 */
export function defineAllowlistSerializer<T = unknown>(options: {
  name: string;
  audience: Audience;
  shape: Shape;
}): AllowlistSerializer<T> {
  const { name, audience, shape } = options;
  assertShapeIsSafe(name, audience, shape);
  const allowedPaths = collectPaths(shape);

  const serialize = (value: unknown): Partial<T> | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return (pick(value, shape) ?? null) as Partial<T> | null;
  };

  const serializeMany = (values: unknown[] | null | undefined): Partial<T>[] =>
    (values ?? [])
      .map((value) => serialize(value))
      .filter((value): value is Partial<T> => value !== null);

  return { name, audience, shape, allowedPaths, serialize, serializeMany };
}

/**
 * Throws, naming the first output path that is not in `allowedPaths`.
 * Array indexes are ignored in paths. Used by tests and by routes that want a
 * second check on what they are about to send.
 */
export function assertOutputWithinAllowlist(output: unknown, allowedPaths: string[]): void {
  const allowed = new Set(allowedPaths);
  const walk = (value: unknown, prefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, prefix);
      }
      return;
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (!allowed.has(path)) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            `Output path "${path}" is not in the allowlist.`
          );
        }
        walk(value[key], path);
      }
    }
  };
  walk(output, "");
}
