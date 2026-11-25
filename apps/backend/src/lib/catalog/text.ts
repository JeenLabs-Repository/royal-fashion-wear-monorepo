import { MedusaError } from "@medusajs/framework/utils";

/**
 * Plain text from vendor input. Whole script and style elements are removed
 * with their content, then every remaining tag, then any stray angle bracket.
 * Nothing is decoded. Line breaks stay as "\n", runs of spaces collapse and
 * control characters other than the line break are removed.
 */
export function stripTags(input: string): string {
  let text = input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // An unclosed script or style element loses everything after its opening tag.
  text = text.replace(/<(script|style)\b[\s\S]*$/gi, "");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  text = text.replace(/[<>]/g, "");
  text = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
  text = text.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "");
  text = text.replace(/ {2,}/g, " ");
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Strips tags, then refuses empty text and text longer than `max` characters. */
export function normalizePlainText(input: string, max: number): string {
  const text = stripTags(input);
  if (text === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Text is required.",
      "text_required"
    );
  }
  if (text.length > max) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Text must be at most ${max} characters.`,
      "text_too_long"
    );
  }
  return text;
}
