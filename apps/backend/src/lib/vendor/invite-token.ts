import { createHash, randomBytes } from "node:crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 random bytes as 43 base64url characters, and the SHA-256 of that text in hex. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

// The base URL carries the portal base path (for example
// https://host/vendor-portal). Trailing slashes are dropped before the join, so
// the result never has a double slash. The token goes after the hash sign, so a
// browser keeps it out of requests, server logs and referrer headers.
export function buildAcceptUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/accept-invite#token=${token}`;
}
