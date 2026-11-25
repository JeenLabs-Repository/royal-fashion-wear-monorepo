jest.mock("@gorgo/medusa-integration", () => {
  const actual = jest.requireActual("@gorgo/medusa-integration");
  return {
    ...actual,
    resolveIntegrationOptions: jest.fn(),
  };
});

import {
  resolveIntegrationOptions,
  INTEGRATION_MODULE,
} from "@gorgo/medusa-integration";
import { fetchResolvedOptions } from "../resolve-options";

const helper = resolveIntegrationOptions as jest.Mock;

describe("fetchResolvedOptions package fallback", () => {
  beforeEach(() => {
    helper.mockReset();
  });

  it("maps unknown-identifier from package helper to missing", async () => {
    helper.mockRejectedValue(
      new Error(
        'No integration provider registered for "int_integration-smtp_default". Declare it in medusa-config under the integration plugin\'s options.providers.'
      )
    );
    const container = {
      resolve: (key: string) => {
        if (key === INTEGRATION_MODULE) {
          throw new Error(`Could not resolve '${key}'.`);
        }
        return undefined;
      },
    };
    await expect(
      fetchResolvedOptions(container, "integration-smtp")
    ).resolves.toEqual({ status: "unavailable", reason: "missing" });
  });

  it("maps MedusaError-shaped unknown-identifier to missing", async () => {
    const err = Object.assign(
      new Error(
        'No integration provider registered for "int_integration-smtp_default".'
      ),
      { __isMedusaError: true, type: "not_allowed" }
    );
    helper.mockRejectedValue(err);
    const container = {
      resolve: () => {
        throw new Error("Could not resolve 'integrationModuleService'.");
      },
    };
    await expect(
      fetchResolvedOptions(container, "integration-smtp")
    ).resolves.toEqual({ status: "unavailable", reason: "missing" });
  });
});
