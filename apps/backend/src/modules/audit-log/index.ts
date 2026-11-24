import { Module } from "@medusajs/framework/utils";
import { AUDIT_LOG_MODULE } from "./constants";
import AuditLogModuleService from "./service";

export { AUDIT_LOG_MODULE };
export type { AuditLogModuleService };

export default Module(AUDIT_LOG_MODULE, {
  service: AuditLogModuleService,
});
