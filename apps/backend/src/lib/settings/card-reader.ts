import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { fetchResolvedOptions, type OptionsContainer } from "./resolve-options";

type LoggerLike = { warn: (message: string) => void };

export type CardReaderConfig<T> = {
  /** The card identifier, for example integration-vendor-onboarding */
  identifier: string;
  /** Returned whenever the card is not available */
  defaults: T;
  /** Validates stored values field by field; call `warn` for each fallback */
  parse: (
    raw: Record<string, unknown>,
    defaults: T,
    warn: (message: string) => void
  ) => T;
  /** Prefix of every log line, written as `[tag]` */
  tag: string;
};

const resolveLogger = (container: OptionsContainer): LoggerLike => {
  try {
    return container.resolve(ContainerRegistrationKeys.LOGGER) as LoggerLike;
  } catch {
    return { warn: (message) => console.warn(message) };
  }
};

/**
 * One reader per settings card. It reads at call time, on every call, and
 * returns the code defaults when the card is missing, unsaved or disabled.
 * It never reads in a constructor and never keeps a value between calls.
 * Option types belong to the reader that calls this: nothing here imports a plugin.
 */
export function createCardReader<T>(config: CardReaderConfig<T>) {
  return async (container: OptionsContainer): Promise<T> => {
    const resolved = await fetchResolvedOptions(container, config.identifier);
    if (resolved.status === "unavailable") {
      return config.defaults;
    }
    const logger = resolveLogger(container);
    return config.parse(resolved.options, config.defaults, (message) =>
      logger.warn(`[${config.tag}] ${message}`)
    );
  };
}
