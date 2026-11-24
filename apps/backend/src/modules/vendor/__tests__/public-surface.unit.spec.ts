import type { MedusaContainer } from "@medusajs/framework/types";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { createHookRegistry } from "../../../lib/vendor/hook-helpers";
import { getOnboardingSteps } from "../../../lib/vendor/onboarding-steps";
import { listVendorAdminSections } from "../../../lib/vendor/admin-sections";
import * as surface from "../public";

const EXPECTED_EXPORTS = [
  "VENDOR_MODULE",
  "assertOwns",
  "authenticateVendor",
  "defineAllowlistSerializer",
  "onVendorActivating",
  "onVendorLocationValidating",
  "onVendorSuspended",
  "recordAudit",
  "registerOnboardingStep",
  "registerVendorAdminSection",
  "requireVendor",
];

describe("the plugin surface", () => {
  test("exports exactly the documented names", () => {
    const names = Object.keys(surface)
      .filter((name) => name !== "__esModule")
      .sort();
    expect(names).toEqual([...EXPECTED_EXPORTS].sort());
  });

  test("exports the module name and callable extension points", () => {
    expect(surface.VENDOR_MODULE).toBe("vendor");
    // authenticateVendor is the middleware chain (an array), not a single function.
    expect(Array.isArray(surface.authenticateVendor)).toBe(true);
    expect(surface.authenticateVendor.length).toBeGreaterThan(0);
    for (const name of EXPECTED_EXPORTS.filter(
      (entry) => entry !== "VENDOR_MODULE" && entry !== "authenticateVendor"
    )) {
      expect(typeof (surface as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("importing it registers no onboarding step and no admin section", async () => {
    expect(listVendorAdminSections("vnd_x")).toEqual([]);
    const container = {
      resolve: (key: string) => {
        if (key === "logger") {
          return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        }
        throw new Error(`unexpected resolve ${key}`);
      },
    } as unknown as MedusaContainer;
    const steps = await getOnboardingSteps(container, { id: "vnd_x", status: "invited" });
    expect(steps.map((step) => step.key)).toEqual(["agreement"]);
  });
});

describe("createHookRegistry", () => {
  const context = { container: {} as MedusaContainer };

  test("attaches nothing until the first handler arrives and attaches once", () => {
    const attach = jest.fn();
    const registry = createHookRegistry<{ id: string }>(attach);
    expect(attach).not.toHaveBeenCalled();

    registry.add(() => undefined);
    registry.add(() => undefined);

    expect(attach).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(2);
  });

  test("runs the handlers in order with the payload and the context", async () => {
    const order: string[] = [];
    let dispatch: any;
    const registry = createHookRegistry<{ id: string }>((run) => {
      dispatch = run;
    });
    registry.add((payload, ctx) => {
      order.push(`first:${payload.id}`);
      expect(ctx).toBe(context);
    });
    registry.add(async (payload) => {
      order.push(`second:${payload.id}`);
    });

    const response = await dispatch({ id: "vnd_1" }, context);

    expect(order).toEqual(["first:vnd_1", "second:vnd_1"]);
    expect(response).toBeInstanceOf(StepResponse);
  });

  test("rethrows the first error and compensates the finished handlers in reverse", async () => {
    const log: string[] = [];
    let dispatch: any;
    const registry = createHookRegistry<{ id: string }>((run) => {
      dispatch = run;
    });
    registry.add(
      () => undefined,
      () => {
        log.push("undo-1");
      }
    );
    registry.add(
      () => undefined,
      () => {
        log.push("undo-2");
      }
    );
    registry.add(() => {
      throw new Error("blocked by a rule");
    });
    registry.add(() => {
      log.push("never runs");
    });

    await expect(dispatch({ id: "vnd_1" }, context)).rejects.toThrow("blocked by a rule");
    expect(log).toEqual(["undo-2", "undo-1"]);
  });

  test("compensates only the handlers that finished when the workflow fails later", async () => {
    const log: string[] = [];
    let dispatch: any;
    let undo: any;
    const registry = createHookRegistry<{ id: string }>((run, revert) => {
      dispatch = run;
      undo = revert;
    });
    registry.add(
      () => undefined,
      () => {
        log.push("undo-1");
      }
    );
    registry.add(
      () => undefined,
      () => {
        log.push("undo-2");
      }
    );

    const response = await dispatch({ id: "vnd_1" }, context);
    await undo((response as any).compensateInput, context);

    expect(log).toEqual(["undo-2", "undo-1"]);
  });

  test("keeps going when a compensation throws and still rethrows the original error", async () => {
    const log: string[] = [];
    let dispatch: any;
    const registry = createHookRegistry<{ id: string }>((run) => {
      dispatch = run;
    });
    registry.add(
      () => undefined,
      () => {
        log.push("undo-1");
      }
    );
    registry.add(
      () => undefined,
      () => {
        throw new Error("compensation failed");
      }
    );
    registry.add(() => {
      throw new Error("original failure");
    });
    const silence = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(dispatch({ id: "vnd_1" }, context)).rejects.toThrow("original failure");

    expect(log).toEqual(["undo-1"]);
    silence.mockRestore();
  });

  test("an undo without state does nothing", async () => {
    let undo: any;
    const registry = createHookRegistry<{ id: string }>((_run, revert) => {
      undo = revert;
    });
    registry.add(
      () => undefined,
      () => {
        throw new Error("must not run");
      }
    );
    await expect(undo(undefined, context)).resolves.toBeUndefined();
  });
});
