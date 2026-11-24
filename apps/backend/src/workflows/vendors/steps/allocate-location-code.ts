import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { getVendorModule } from "../../../lib/vendor/vendor-module";

// No compensation on purpose. A code that was allocated and then not used
// leaves a gap, and gaps are allowed. The validation step runs first, so a
// rejected input never reaches this step.
export const allocateLocationCodeStep = createStep(
  "allocate-location-code",
  async (_input: void, { container }) => {
    const code = await getVendorModule(container).allocateLocationCode();
    return new StepResponse(code);
  }
);
