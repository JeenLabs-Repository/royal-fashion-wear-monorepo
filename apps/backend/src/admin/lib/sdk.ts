// The staff screens create the one SDK client of the dashboard extension.
// The vendor screens reuse that instance instead of configuring a second one.
export { sdk } from "./client";
