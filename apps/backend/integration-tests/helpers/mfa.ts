import { MedusaError } from "@medusajs/framework/utils";
import { signToken } from "./create-admin-user";
import { totp } from "./totp";
import { probe, type ApiClient } from "./staff-users";
import { decodeJwtPayload, vendorBearer, vendorLogin } from "./vendor-fixtures";

/**
 * The two-step sign-in sequence for the vendor actor, exactly as the
 * actor-mechanics record observed it.
 */
export const MFA_FLOW = {
  startMethod: "POST",
  startPath: "/auth/mfa/factors",
  startBody: { provider: "totp" },
  /** Key of the TOTP secret in the start response. */
  secretKey: "secret",
  /** Key of the factor object in the start response (holds the id for verify). */
  factorKey: "mfa_factor",
  confirmMethod: "POST",
  /** Path template; `:id` is replaced with the factor id. */
  confirmPathTemplate: "/auth/mfa/factors/:id/verify",
  /** Key that carries the six-digit code in the confirm request and the challenge answer. */
  codeKey: "code",
  recoveryMethod: "POST",
  recoveryPath: "/auth/mfa/recovery-codes",
  recoveryBody: { count: 10 },
  /** Key of the recovery codes in the recovery response. */
  recoveryKey: "recovery_codes",
  /** Key present in the sign-in response when a challenge is pending. */
  challengeKey: "mfa_challenge",
  /** Path template; `:id` is replaced with the challenge id. */
  challengeAnswerPathTemplate: "/auth/mfa/challenges/:id/verify",
  /** Key that carries the challenge method in the answer request. */
  methodKey: "method",
  /** Key of the final token in the answer response. */
  tokenKey: "token",
} as const;

/** The claim name the auth context reads for enrolment. */
export const MFA_CLAIM = "mfa_enabled";

export type VendorCredentials = { email: string; password: string; token_secret: string };

const read = (data: unknown, key: string): unknown =>
  (data as Record<string, unknown> | undefined)?.[key];

/**
 * Enrols the signed-in vendor user in TOTP through the real endpoints.
 * Never logs the secret or the recovery codes.
 */
export async function enrollVendorMfa(
  api: ApiClient,
  token: string
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const headers = vendorBearer(token);

  const start = await probe(api, headers, MFA_FLOW.startMethod, MFA_FLOW.startPath, {
    ...MFA_FLOW.startBody,
  });
  const secret = read(start.body, MFA_FLOW.secretKey);
  const factor = read(start.body, MFA_FLOW.factorKey) as { id?: string } | undefined;
  if (start.status !== 200 || typeof secret !== "string" || !factor?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Starting enrolment failed with status ${start.status}`
    );
  }

  const confirmPath = MFA_FLOW.confirmPathTemplate.replace(":id", factor.id);
  const confirm = await probe(api, headers, MFA_FLOW.confirmMethod, confirmPath, {
    [MFA_FLOW.codeKey]: totp(secret),
  });
  if (confirm.status !== 200) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Confirming enrolment failed with status ${confirm.status}`
    );
  }

  const recovery = await probe(api, headers, MFA_FLOW.recoveryMethod, MFA_FLOW.recoveryPath, {
    ...MFA_FLOW.recoveryBody,
  });
  const codes = read(recovery.body, MFA_FLOW.recoveryKey);
  if (recovery.status !== 200 || !Array.isArray(codes)) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Generating recovery codes failed with status ${recovery.status}`
    );
  }
  return { secret, recoveryCodes: codes.map(String) };
}

/** Signs in a user that enrolled, following the challenge path the record names. */
export async function loginVendorWithMfa(
  api: ApiClient,
  input: { email: string; password: string; secret: string }
): Promise<string> {
  const login = await probe(api, {}, "POST", "/auth/vendor/emailpass", {
    email: input.email,
    password: input.password,
  });
  const challenge = read(login.body, MFA_FLOW.challengeKey) as
    | { id?: string; methods?: string[] }
    | undefined;
  const firstFactor = read(login.body, MFA_FLOW.tokenKey);
  if (
    login.status !== 200 ||
    !challenge?.id ||
    typeof firstFactor !== "string"
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Sign-in did not return a challenge (status ${login.status})`
    );
  }
  const method =
    Array.isArray(challenge.methods) && challenge.methods.length > 0
      ? challenge.methods[0]
      : "totp";
  const answerPath = MFA_FLOW.challengeAnswerPathTemplate.replace(":id", challenge.id);
  const answer = await probe(
    api,
    vendorBearer(firstFactor),
    "POST",
    answerPath,
    {
      [MFA_FLOW.methodKey]: method,
      [MFA_FLOW.codeKey]: totp(input.secret),
    }
  );
  const token = read(answer.body, MFA_FLOW.tokenKey);
  if (answer.status !== 200 || typeof token !== "string") {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Answering the challenge failed with status ${answer.status}`
    );
  }
  return token;
}

/**
 * Headers for a vendor user.
 * `enrolled: false` signs in for real, so the server decides what the token
 * says and two-step sign-in is not enrolled.
 * `enrolled: true` takes the claims of a real sign-in and adds the enrolment
 * claim, the way the staff helper does, so suites do not repeat the whole
 * enrolment flow. The enrolment flow itself is covered by `enrollVendorMfa`.
 */
export async function getVendorSession(
  api: ApiClient,
  credentials: VendorCredentials,
  options: { enrolled: boolean }
): Promise<{ headers: Record<string, string> }> {
  const token = await vendorLogin(api, credentials);
  if (!options.enrolled) {
    return { headers: vendorBearer(token) };
  }
  // Drop the timing claims so the signer sets its own.
  const { iat: _iat, exp: _exp, ...claims } = decodeJwtPayload(token);
  const minted = signToken({ ...claims, [MFA_CLAIM]: true }, credentials.token_secret);
  return { headers: vendorBearer(minted) };
}
