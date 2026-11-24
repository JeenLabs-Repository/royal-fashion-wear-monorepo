import { assertOutputWithinAllowlist } from "..";
import { vendorAgreementSerializer } from "../vendor/agreement";
import { toVendorLocationView, vendorLocationSerializer } from "../vendor/location";
import { vendorOnboardingSerializer } from "../vendor/onboarding";
import { vendorSelfSerializer, vendorUserSerializer } from "../vendor/self";

const LEAKS = {
  note: "OWNER-PRIVATE-NOTE",
  suspend_reason: "SUSPENSION-REASON",
  suspended_at: "2026-01-01T00:00:00.000Z",
  stock_location_id: "sloc_secret",
  vendor_id: "vnd_secret",
  token_hash: "a".repeat(64),
};

const FORBIDDEN_KEYS = Object.keys(LEAKS);

const expectNoLeak = (output: unknown) => {
  const text = JSON.stringify(output);
  for (const key of FORBIDDEN_KEYS) {
    expect(text).not.toContain(`"${key}"`);
  }
  for (const value of Object.values(LEAKS)) {
    expect(text).not.toContain(value);
  }
};

describe("vendor serializers", () => {
  test("the self serializer drops every internal column", () => {
    const output = vendorSelfSerializer.serialize({
      id: "vnd_1",
      internal_name: "Spec Vendor",
      contact_name: "Spec Contact",
      contact_email: "spec@example.test",
      status: "active",
      activated_at: new Date("2026-02-02T00:00:00.000Z"),
      eligible_to_list: true,
      ...LEAKS,
    });
    expectNoLeak(output);
    expect(output).toEqual({
      id: "vnd_1",
      internal_name: "Spec Vendor",
      contact_name: "Spec Contact",
      contact_email: "spec@example.test",
      status: "active",
      activated_at: "2026-02-02T00:00:00.000Z",
      eligible_to_list: true,
    });
    assertOutputWithinAllowlist(output, vendorSelfSerializer.allowedPaths);
  });

  test("the user serializer keeps id, email and name only", () => {
    const output = vendorUserSerializer.serialize({
      id: "vusr_1",
      email: "u@example.test",
      name: "Spec User",
      vendor_id: "vnd_secret",
      token_hash: "x",
    });
    expect(output).toEqual({ id: "vusr_1", email: "u@example.test", name: "Spec User" });
    assertOutputWithinAllowlist(output, vendorUserSerializer.allowedPaths);
  });

  test("the location serializer adds the state name and drops internal ids", () => {
    const view = toVendorLocationView({
      id: "vloc_1",
      code: "LOC-0001",
      label: "Spec site",
      state_code: "IN-MH",
      pin: "400001",
      address_1: "1 Spec Street",
      address_2: null,
      city: null,
      pickup_contact_name: "Spec Contact",
      pickup_contact_phone: "+919800000000",
      status: "active",
      ...LEAKS,
    });
    const output = vendorLocationSerializer.serialize(view);
    expectNoLeak(output);
    expect(output).toMatchObject({ code: "LOC-0001", state_code: "IN-MH", state_name: "Maharashtra" });
    assertOutputWithinAllowlist(output, vendorLocationSerializer.allowedPaths);
  });

  test("an unknown state gives a null state name instead of an error", () => {
    expect(toVendorLocationView({ state_code: "IN-XX" }).state_name).toBeNull();
  });

  test("the agreement serializer keeps the documents and drops extras", () => {
    const output = vendorAgreementSerializer.serialize({
      version: "v1-draft",
      accepted: true,
      accepted_at: "2026-03-03T00:00:00.000Z",
      documents: [
        { key: "agreement", title: "Vendor Agreement", markdown: "# One", hidden: "x" },
        { key: "packing-guideline", title: "Packing Guideline", markdown: "# Two" },
      ],
      ...LEAKS,
    });
    expectNoLeak(output);
    expect(JSON.stringify(output)).not.toContain("hidden");
    expect((output as { documents: unknown[] }).documents).toHaveLength(2);
    assertOutputWithinAllowlist(output, vendorAgreementSerializer.allowedPaths);
  });

  test("the onboarding serializer keeps the step shape and drops extras", () => {
    const output = vendorOnboardingSerializer.serialize({
      status: "invited",
      activation_pending: false,
      steps: [
        {
          key: "agreement",
          title: "Accept the vendor agreement and packing guideline",
          required_for_activation: true,
          complete: false,
          link: "/agreement",
          isComplete: "function",
        },
      ],
      ...LEAKS,
    });
    expectNoLeak(output);
    expect(JSON.stringify(output)).not.toContain("isComplete");
    assertOutputWithinAllowlist(output, vendorOnboardingSerializer.allowedPaths);
  });

  test("every vendor serializer rejects an output path outside its allowlist", () => {
    expect(() =>
      assertOutputWithinAllowlist({ note: "x" }, vendorSelfSerializer.allowedPaths)
    ).toThrow(/note/);
  });

  test("no vendor serializer declares a private column", () => {
    const all = [
      vendorSelfSerializer,
      vendorUserSerializer,
      vendorLocationSerializer,
      vendorAgreementSerializer,
      vendorOnboardingSerializer,
    ].flatMap((serializer) => serializer.allowedPaths);
    for (const key of FORBIDDEN_KEYS) {
      expect(all).not.toContain(key);
    }
  });
});
