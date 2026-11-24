/** Returns the URL only when it is plain http or https, otherwise undefined. */
export function safeHttpUrl(url: string | undefined | null): string | undefined {
  if (typeof url !== "string") {
    return undefined;
  }
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}
