import { Module } from "@medusajs/framework/utils";
import VendorCatalogService from "./service";

export const VENDOR_CATALOG_MODULE = "vendorCatalog";

export default Module(VENDOR_CATALOG_MODULE, {
  service: VendorCatalogService,
});
