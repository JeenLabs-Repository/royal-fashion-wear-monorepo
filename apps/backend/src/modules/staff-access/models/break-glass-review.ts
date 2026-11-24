import { model } from "@medusajs/framework/utils";

// One row per use of the break-glass account that has not been reviewed yet.
const BreakGlassReview = model
  .define("break_glass_review", {
    id: model.id({ prefix: "bgr" }).primaryKey(),
    opened_at: model.dateTime(),
    actor_user_id: model.text(),
    // The 15-minute bucket that opened this review.
    window_key: model.text(),
    first_ip: model.text().nullable(),
    // Method plus route template only, never a path with ids or a body.
    first_request: model.text().nullable(),
    closed_at: model.dateTime().nullable(),
    closed_by: model.text().nullable(),
    rotated_confirmed: model.boolean().default(false),
    note: model.text().nullable(),
  })
  .indexes([
    { name: "IDX_break_glass_review_actor_user_id", on: ["actor_user_id"] },
    // At most one open review per actor. DML appends AND deleted_at IS NULL.
    {
      name: "IDX_break_glass_review_open_unique",
      on: ["actor_user_id"],
      unique: true,
      where: "closed_at IS NULL",
    },
  ]);

export default BreakGlassReview;
