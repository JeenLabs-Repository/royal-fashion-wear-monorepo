import { MedusaError } from "@medusajs/framework/utils";
import { createHash } from "node:crypto";
import { invalidInviteError, invalidPasswordError } from "../errors";
import { buildAcceptUrl, generateInviteToken, hashInviteToken } from "../invite-token";

describe("generateInviteToken", () => {
  test("returns 43 base64url characters and a 64 character lowercase hex hash", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("two calls give different tokens", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });

  test("the hash is the SHA-256 of the token text", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });
});

describe("hashInviteToken", () => {
  test("is stable and differs for a different token", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });
});

describe("buildAcceptUrl", () => {
  test("puts the token in the fragment after the base path", () => {
    expect(buildAcceptUrl("https://backend.example.com/vendor-portal", "abc")).toBe(
      "https://backend.example.com/vendor-portal/accept-invite#token=abc"
    );
  });

  test("tolerates trailing slashes on the base URL and never makes a double slash", () => {
    expect(buildAcceptUrl("https://backend.example.com/vendor-portal/", "abc")).toBe(
      "https://backend.example.com/vendor-portal/accept-invite#token=abc"
    );
    expect(buildAcceptUrl("https://backend.example.com/vendor-portal//", "abc")).toBe(
      "https://backend.example.com/vendor-portal/accept-invite#token=abc"
    );
    const url = buildAcceptUrl("http://localhost:5173/vendor-portal/", "abc");
    expect(url.replace("http://", "")).not.toContain("//");
  });

  test("never puts the token in the query string", () => {
    const url = new URL(buildAcceptUrl("https://backend.example.com/vendor-portal", "abc"));
    expect(url.pathname).toBe("/vendor-portal/accept-invite");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#token=abc");
  });
});

describe("error helpers", () => {
  test("invalidInviteError has the fixed code and message", () => {
    const error = invalidInviteError();
    expect(error).toBeInstanceOf(MedusaError);
    expect(error.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(error.code).toBe("invalid_invite");
    expect(error.message).toBe(
      "This invitation link cannot be used. Ask the store for a new invitation."
    );
  });

  test("invalidPasswordError has the fixed code and message", () => {
    const error = invalidPasswordError();
    expect(error.code).toBe("invalid_password");
    expect(error.message).toBe("Password must be 12 to 128 characters.");
  });
});
