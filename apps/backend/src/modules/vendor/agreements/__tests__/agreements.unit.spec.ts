import { MedusaError } from "@medusajs/framework/utils";
import { readFileSync } from "node:fs";
import {
  agreementFilePaths,
  agreementFilesExist,
  isValidAgreementVersion,
  listAgreementVersions,
  readAgreementDocuments,
} from "..";

const BANNER =
  "> DRAFT PLACEHOLDER: wording pending legal review. Not valid for real vendors.";

describe("isValidAgreementVersion", () => {
  test.each(["v1-draft", "v2", "2026.12-a"])("accepts %s", (version) => {
    expect(isValidAgreementVersion(version)).toBe(true);
  });

  test.each(["", "../x", "V1", "a/b", "a b", "a".repeat(33), ".hidden", "..", "a\\b"])(
    "rejects %p",
    (version) => {
      expect(isValidAgreementVersion(version)).toBe(false);
    }
  );

  test("accepts a label of exactly 32 characters", () => {
    expect(isValidAgreementVersion("a".repeat(32))).toBe(true);
  });
});

describe("agreementFilePaths", () => {
  test("returns two absolute paths for the shipped version", () => {
    const paths = agreementFilePaths("v1-draft");
    expect(paths.agreement.endsWith("agreement.v1-draft.md")).toBe(true);
    expect(paths.packing_guideline.endsWith("packing-guideline.v1-draft.md")).toBe(
      true
    );
    expect(
      paths.agreement.startsWith("/") || /^[A-Za-z]:[\\/]/.test(paths.agreement)
    ).toBe(true);
  });

  test("throws a MedusaError for an invalid label", () => {
    expect(() => agreementFilePaths("../etc")).toThrow(MedusaError);
  });
});

describe("agreementFilesExist", () => {
  test("is true for the shipped version", () => {
    expect(agreementFilesExist("v1-draft")).toBe(true);
  });

  test("is false for a missing version", () => {
    expect(agreementFilesExist("v9")).toBe(false);
  });

  test("is false, without throwing, for a traversal label", () => {
    expect(() => agreementFilesExist("../etc")).not.toThrow();
    expect(agreementFilesExist("../etc")).toBe(false);
  });
});

describe("readAgreementDocuments", () => {
  test("returns the agreement and the packing guideline with their titles", () => {
    const documents = readAgreementDocuments("v1-draft");
    expect(documents.map((document) => document.key)).toEqual([
      "agreement",
      "packing-guideline",
    ]);
    expect(documents.map((document) => document.title)).toEqual([
      "Vendor Agreement",
      "Packing Guideline",
    ]);
    for (const document of documents) {
      expect(document.markdown.length).toBeGreaterThan(0);
    }
  });

  test("throws not found with the code agreement_version_missing for a missing version", () => {
    try {
      readAgreementDocuments("v9");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MedusaError);
      expect((error as MedusaError).type).toBe(MedusaError.Types.NOT_FOUND);
      expect((error as MedusaError).code).toBe("agreement_version_missing");
    }
  });

  test("both shipped files start with the draft banner", () => {
    const paths = agreementFilePaths("v1-draft");
    for (const file of [paths.agreement, paths.packing_guideline]) {
      expect(readFileSync(file, "utf8").split("\n")[0]).toBe(BANNER);
    }
  });
});

describe("listAgreementVersions", () => {
  test("lists the shipped version", () => {
    expect(listAgreementVersions()).toContain("v1-draft");
  });
});
