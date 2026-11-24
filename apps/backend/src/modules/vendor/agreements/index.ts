import { MedusaError } from "@medusajs/framework/utils";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// One lower-case label, at most 32 characters, no slash, no space and no
// leading dot. The label becomes part of a file name, so this pattern is what
// keeps a stored setting from reaching outside this directory.
export const AGREEMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export type AgreementDocumentKey = "agreement" | "packing-guideline";

export type AgreementDocument = {
  key: AgreementDocumentKey;
  title: string;
  markdown: string;
};

export function isValidAgreementVersion(version: string): boolean {
  return typeof version === "string" && AGREEMENT_VERSION_PATTERN.test(version);
}

// `__dirname` is src/modules/vendor/agreements in development and the same
// path under .medusa/server after a build. The build step copies the Markdown
// files there.
export function agreementFilePaths(version: string): {
  agreement: string;
  packing_guideline: string;
} {
  if (!isValidAgreementVersion(version)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The agreement version label is not valid.",
      "agreement_version_invalid"
    );
  }
  return {
    agreement: join(__dirname, `agreement.${version}.md`),
    packing_guideline: join(__dirname, `packing-guideline.${version}.md`),
  };
}

/** True only when the label is valid and both documents exist. Never throws. */
export function agreementFilesExist(version: string): boolean {
  if (!isValidAgreementVersion(version)) {
    return false;
  }
  const paths = agreementFilePaths(version);
  return existsSync(paths.agreement) && existsSync(paths.packing_guideline);
}

export function readAgreementDocuments(version: string): AgreementDocument[] {
  const paths = agreementFilePaths(version);
  if (!existsSync(paths.agreement) || !existsSync(paths.packing_guideline)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `The agreement documents for version "${version}" were not found.`,
      "agreement_version_missing"
    );
  }
  return [
    {
      key: "agreement",
      title: "Vendor Agreement",
      markdown: readFileSync(paths.agreement, "utf8"),
    },
    {
      key: "packing-guideline",
      title: "Packing Guideline",
      markdown: readFileSync(paths.packing_guideline, "utf8"),
    },
  ];
}

/** Versions whose two documents are both present, sorted. */
export function listAgreementVersions(): string[] {
  const versions = readdirSync(__dirname)
    .map((name) => /^agreement\.(.+)\.md$/.exec(name)?.[1])
    .filter((version): version is string => Boolean(version))
    .filter((version) => agreementFilesExist(version));
  return [...new Set(versions)].sort();
}
