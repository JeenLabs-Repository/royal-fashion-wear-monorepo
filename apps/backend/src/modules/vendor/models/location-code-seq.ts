import { model } from "@medusajs/framework/utils";

// One row, id "default". Holds the last location number handed out.
const LocationCodeSeq = model.define("location_code_seq", {
  id: model.text().primaryKey(),
  last_value: model.number().default(0),
});

export default LocationCodeSeq;
