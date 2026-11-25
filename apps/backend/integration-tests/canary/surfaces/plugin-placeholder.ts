import { readFileSync, writeFileSync } from "node:fs";
import { totp } from "../../helpers/totp";
import { type CanaryManifest, type SurfaceContext, type SurfaceResponse, registerSurface } from "./registry";

// Placeholder for the routes a later compliance plugin mounts under /vendor/compliance.
// Replace it with real surfaces when a plugin registers routes: the plugin's fake
// tax identifiers are already part of the scanned tokens.
const PING = "/vendor/compliance/ping";

// Paths match the actor-mechanics record (enrolment and challenge for vendor).
const MFA = {
  login: "/auth/vendor/emailpass",
  factorStart: "/auth/mfa/factors",
  factorStartBody: { provider: "totp" },
  factorVerify: (id: string) => `/auth/mfa/factors/${id}/verify`,
  challengeVerify: (id: string) => `/auth/mfa/challenges/${id}/verify`,
  codeField: "code",
  methodField: "method",
  challengeKey: "mfa_challenge",
};

const json = async (url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> => {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const findSecret = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value.startsWith("otpauth://") ? new URL(value).searchParams.get("secret") : null;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string" && /secret/i.test(key) && /^[A-Z2-7]{16,}$/i.test(item)) {
        return item.toUpperCase();
      }
      const nested = findSecret(item);
      if (nested) return nested;
    }
  }
  return null;
};

const findId = (value: unknown): string | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") return record.id;
    for (const item of Object.values(record)) {
      const found = findId(item);
      if (found) return found;
    }
  }
  return null;
};

const waitForNextStep = () => new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500));

const saveSecret = (surface: SurfaceContext, secret: string) => {
  const manifest = JSON.parse(readFileSync(surface.manifestPath, "utf8")) as CanaryManifest;
  manifest.vendors.alpha.totp_secret = secret;
  writeFileSync(surface.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

// Returns a bearer token of an enrolled session for the first canary vendor, or
// a reason why none could be obtained.
const enrolledToken = async (surface: SurfaceContext): Promise<{ token?: string; reason?: string }> => {
  const alpha = surface.manifest.vendors.alpha;
  const login = () =>
    json(`${surface.backendUrl}${MFA.login}`, {
      method: "POST",
      body: JSON.stringify({ email: alpha.email, password: alpha.password }),
    });

  const first = await login();
  if (first.status !== 200 || !first.body?.token) {
    return { reason: `sign-in answered ${first.status}` };
  }
  const pendingChallenge = first.body?.[MFA.challengeKey] as
    | { id?: string; methods?: string[] }
    | undefined;
  const challenged = Boolean(pendingChallenge?.id);

  let secret = alpha.totp_secret;
  if (!challenged) {
    const started = await json(`${surface.backendUrl}${MFA.factorStart}`, {
      method: "POST",
      headers: { authorization: `Bearer ${first.body.token}` },
      body: JSON.stringify(MFA.factorStartBody),
    });
    secret =
      (typeof started.body?.secret === "string" ? started.body.secret : null) ??
      findSecret(started.body) ??
      undefined;
    const factorId =
      (started.body?.mfa_factor as { id?: string } | undefined)?.id ?? findId(started.body);
    if (started.status >= 300 || !secret || !factorId) {
      return { reason: `two-factor enrolment answered ${started.status}` };
    }
    const verified = await json(`${surface.backendUrl}${MFA.factorVerify(factorId)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${first.body.token}` },
      body: JSON.stringify({ [MFA.codeField]: totp(secret) }),
    });
    if (verified.status >= 300) {
      return { reason: `two-factor verification answered ${verified.status}` };
    }
    saveSecret(surface, secret);
    await waitForNextStep();
  } else if (!secret) {
    return { reason: "the vendor has a factor but the manifest holds no secret" };
  }

  const second = challenged ? first : await login();
  const challenge = (second.body?.[MFA.challengeKey] ?? pendingChallenge) as
    | { id?: string; methods?: string[] }
    | undefined;
  if (!challenge?.id) {
    return { reason: "sign-in did not return a challenge id" };
  }
  const method =
    Array.isArray(challenge.methods) && challenge.methods.length > 0
      ? challenge.methods[0]
      : "totp";
  const answered = await json(`${surface.backendUrl}${MFA.challengeVerify(challenge.id)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${second.body?.token}` },
    body: JSON.stringify({
      [MFA.methodField]: method,
      [MFA.codeField]: totp(secret as string),
    }),
  });
  if (answered.status >= 300 || !answered.body?.token) {
    return { reason: `two-factor challenge answered ${answered.status}` };
  }
  return { token: answered.body.token as string };
};

const collectPlugin = async (surface: SurfaceContext): Promise<SurfaceResponse[]> => {
  const url = `${surface.backendUrl}${PING}`;
  const responses: SurfaceResponse[] = [];

  const anonymous = await fetch(url);
  responses.push({
    url,
    status: anonymous.status,
    contentType: anonymous.headers.get("content-type") ?? "",
    body: await anonymous.text(),
  });
  if (anonymous.status !== 401) {
    throw new Error(`${PING} without credentials answered ${anonymous.status}, expected 401`);
  }

  const session = await enrolledToken(surface);
  if (!session.token) {
    console.warn(`[canary] plugin placeholder: authenticated request skipped (${session.reason})`);
    return responses;
  }
  const authed = await fetch(url, { headers: { authorization: `Bearer ${session.token}` } });
  responses.push({
    url: `${url}#authenticated`,
    status: authed.status,
    contentType: authed.headers.get("content-type") ?? "",
    body: await authed.text(),
  });
  if (authed.status !== 404) {
    throw new Error(`${PING} with an enrolled vendor answered ${authed.status}, expected 404`);
  }
  return responses;
};

registerSurface({
  id: "plugin-routes-placeholder",
  kind: "plugin-placeholder",
  owner: "vendor-domain",
  description:
    "A plugin route path no route serves: 401 without credentials and 404 for an enrolled vendor. The authenticated request is skipped (and a warning printed) when an enrolled session cannot be obtained over HTTP, so the minimum is 1.",
  minRequests: 1,
  collect: collectPlugin,
});
