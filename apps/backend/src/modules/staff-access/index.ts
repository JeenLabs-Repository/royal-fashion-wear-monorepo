import { Module } from "@medusajs/framework/utils";
import { STAFF_ACCESS_MODULE } from "./constants";
import syncRolesLoader from "./loaders/sync-roles";
import StaffAccessModuleService from "./service";

export { STAFF_ACCESS_MODULE };
export type { StaffAccessModuleService };

export default Module(STAFF_ACCESS_MODULE, {
  service: StaffAccessModuleService,
  loaders: [syncRolesLoader],
});
