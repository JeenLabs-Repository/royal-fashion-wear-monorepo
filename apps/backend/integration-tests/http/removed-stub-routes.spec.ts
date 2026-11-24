import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createApiKeysWorkflow } from "@medusajs/medusa/core-flows";
import { createStaffUser, staffHeaders } from "../helpers/staff-users";

jest.setTimeout(60 * 1000);

// The test client throws on a non-2xx answer, so read the status from either
// the response or the thrown error.
const statusOf = async (request: Promise<{ status: number }>) =>
  request
    .then((response) => response.status)
    .catch((error) => error.response?.status as number | undefined);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("removed stub routes", () => {
      test("GET /store/custom answers 404", async () => {
        const { result } = await createApiKeysWorkflow(getContainer()).run({
          input: {
            api_keys: [
              {
                title: "Stub route test",
                type: "publishable",
                created_by: "",
              },
            ],
          },
        });

        const status = await statusOf(
          api.get("/store/custom", {
            headers: { "x-publishable-api-key": result[0].token },
          })
        );

        expect(status).toBe(404);
      });

      test("GET /admin/custom answers 404", async () => {
        // Default deny answers 403 to a user without a role, so proving the
        // route is gone needs a signed-in superadmin.
        const superadmin = await createStaffUser(getContainer(), {
          roleKeys: ["superadmin"],
        });
        const headers = await staffHeaders(api, superadmin);

        const status = await statusOf(api.get("/admin/custom", { headers }));

        expect(status).toBe(404);
      });
    });
  },
});
