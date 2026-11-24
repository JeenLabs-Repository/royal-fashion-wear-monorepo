import { Module } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "./constants";
import StaffAccessModuleService from "./service";

export { STAFF_ACCESS_MODULE };
export type { StaffAccessModuleService };

export default Module(STAFF_ACCESS_MODULE, {
  service: StaffAccessModuleService,
});
