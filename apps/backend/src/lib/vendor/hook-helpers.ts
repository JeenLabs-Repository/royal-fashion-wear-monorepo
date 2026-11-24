// Helpers a plugin uses to attach handlers to the three vendor hooks without
// touching Medusa's hook API or StepResponse.
//
// A handler receives the hook payload and `{ container }`. Throwing a
// MedusaError from an activation or location handler stops the parent workflow
// and shows the error message to the owner unchanged. A suspension handler runs
// after the status change and the sales channel unlinking. What happens when a
// suspension handler throws is described in the plugin guide.
//
// Any number of handlers can attach. They share one registered hook handler per
// hook and run in the order they attached. When one throws, the handlers that
// already finished are compensated in reverse order and the error is rethrown.

import type { MedusaContainer } from "@medusajs/framework/types";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import type {
  VendorActivatingPayload,
  VendorLocationValidatingPayload,
  VendorSuspendedPayload,
} from "../../modules/vendor/hook-types";
import { suspendVendorWorkflow } from "../../workflows/vendors/suspend-vendor";
import { vendorLocationValidationWorkflow } from "../../workflows/vendors/validate-vendor-location";
import { vendorActivationGateWorkflow } from "../../workflows/vendors/vendor-activation-gate";

export type VendorHookContext = { container: MedusaContainer };

export type VendorHookHandler<Payload> = (
  payload: Payload,
  context: VendorHookContext
) => Promise<void> | void;

export type VendorHookCompensation = (context: VendorHookContext) => Promise<void> | void;

type Registration<Payload> = {
  handler: VendorHookHandler<Payload>;
  compensate?: VendorHookCompensation;
};

type DispatchState = { count: number };

type Dispatch<Payload> = (
  payload: Payload,
  context: VendorHookContext
) => Promise<StepResponse<undefined, DispatchState>>;

type Undo = (state: DispatchState | undefined, context: VendorHookContext) => Promise<void>;

async function compensateInReverse<Payload>(
  registrations: Registration<Payload>[],
  context: VendorHookContext
): Promise<void> {
  for (const registration of [...registrations].reverse()) {
    try {
      await registration.compensate?.(context);
    } catch (error) {
      // One failing compensation must not hide the others or the original error.
      console.error(
        `[vendor-hooks] a compensation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * One registry per hook. `attach` is called once, when the first handler
 * arrives, with the single dispatcher to register on the hosting workflow.
 * Importing this file attaches nothing.
 */
export function createHookRegistry<Payload>(
  attach: (dispatch: Dispatch<Payload>, undo: Undo) => void
) {
  const registrations: Registration<Payload>[] = [];
  let attached = false;

  const dispatch: Dispatch<Payload> = async (payload, context) => {
    const completed: Registration<Payload>[] = [];
    try {
      for (const registration of registrations) {
        await registration.handler(payload, context);
        completed.push(registration);
      }
    } catch (error) {
      await compensateInReverse(completed, context);
      throw error;
    }
    return new StepResponse(undefined, { count: completed.length });
  };

  const undo: Undo = async (state, context) => {
    if (!state) {
      return;
    }
    await compensateInReverse(registrations.slice(0, state.count), context);
  };

  return {
    add(handler: VendorHookHandler<Payload>, compensate?: VendorHookCompensation): void {
      registrations.push({ handler, compensate });
      if (!attached) {
        attached = true;
        attach(dispatch, undo);
      }
    },
    size: (): number => registrations.length,
  };
}

const activating = createHookRegistry<VendorActivatingPayload>((dispatch, undo) => {
  vendorActivationGateWorkflow.hooks.vendorActivating(
    ({ vendor_id, trigger }, { container }) =>
      dispatch({ vendor_id, trigger }, { container: container as MedusaContainer }),
    (state, { container }) =>
      undo(state as DispatchState | undefined, { container: container as MedusaContainer })
  );
});

const locationValidating = createHookRegistry<VendorLocationValidatingPayload>(
  (dispatch, undo) => {
    vendorLocationValidationWorkflow.hooks.vendorLocationValidating(
      (payload, { container }) =>
        dispatch(payload as VendorLocationValidatingPayload, {
          container: container as MedusaContainer,
        }),
      (state, { container }) =>
        undo(state as DispatchState | undefined, { container: container as MedusaContainer })
    );
  }
);

const suspended = createHookRegistry<VendorSuspendedPayload>((dispatch, undo) => {
  suspendVendorWorkflow.hooks.vendorSuspended(
    ({ vendor_id, reason }, { container }) =>
      dispatch({ vendor_id, reason }, { container: container as MedusaContainer }),
    (state, { container }) =>
      undo(state as DispatchState | undefined, { container: container as MedusaContainer })
  );
});

/** Runs before activation and reactivation change anything. Throw a MedusaError to block. */
export function onVendorActivating(
  handler: VendorHookHandler<VendorActivatingPayload>,
  compensate?: VendorHookCompensation
): void {
  activating.add(handler, compensate);
}

/** Runs before a location is created or updated. Throw a MedusaError to reject it. */
export function onVendorLocationValidating(
  handler: VendorHookHandler<VendorLocationValidatingPayload>,
  compensate?: VendorHookCompensation
): void {
  locationValidating.add(handler, compensate);
}

/** Runs after the vendor is suspended and unlinked from the sales channel. Clean up here. */
export function onVendorSuspended(
  handler: VendorHookHandler<VendorSuspendedPayload>,
  compensate?: VendorHookCompensation
): void {
  suspended.add(handler, compensate);
}
