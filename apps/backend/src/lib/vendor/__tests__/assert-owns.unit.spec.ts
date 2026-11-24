import { assertOwns } from "../assert-owns";

const catchError = (run: () => void): { type?: string; message?: string } | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error as { type?: string; message?: string };
  }
};

describe("assertOwns", () => {
  test("passes for a resource of the vendor", () => {
    expect(() => assertOwns("vnd_1", { id: "x", vendor_id: "vnd_1" })).not.toThrow();
  });

  test("throws not found for a resource of another vendor", () => {
    const error = catchError(() => assertOwns("vnd_1", { id: "x", vendor_id: "vnd_2" }));
    expect(error?.type).toBe("not_found");
    expect(error?.message).toBe("Not found");
  });

  test("throws not found for a null and an undefined resource", () => {
    expect(catchError(() => assertOwns("vnd_1", null))?.message).toBe("Not found");
    expect(catchError(() => assertOwns("vnd_1", undefined))?.message).toBe("Not found");
  });

  test("gives the identical error for missing and foreign resources", () => {
    const missing = catchError(() => assertOwns("vnd_1", null));
    const foreign = catchError(() => assertOwns("vnd_1", { vendor_id: "vnd_2" }));
    expect({ type: foreign?.type, message: foreign?.message }).toEqual({
      type: missing?.type,
      message: missing?.message,
    });
  });

  test("supports a custom owner field", () => {
    expect(() =>
      assertOwns("vnd_1", { owner: "vnd_1" }, { ownerField: "owner" })
    ).not.toThrow();
    expect(() => assertOwns("vnd_1", { owner: "vnd_2" }, { ownerField: "owner" })).toThrow(
      "Not found"
    );
  });

  test("does not accept the default field when a custom one is named", () => {
    expect(() =>
      assertOwns("vnd_1", { vendor_id: "vnd_1", owner: "vnd_2" }, { ownerField: "owner" })
    ).toThrow("Not found");
  });
});
