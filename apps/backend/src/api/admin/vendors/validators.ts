import { z } from "@medusajs/framework/zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const ListVendorsQuerySchema = z.strictObject({
  status: z.enum(["invited", "active", "suspended"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EmptyQuerySchema = z.strictObject({});
export const EmptyBodySchema = z.strictObject({});

export const InviteVendorBody = z.strictObject({
  internal_name: text(1, 150),
  contact_name: text(1, 100),
  contact_email: z.email(),
  note: z.string().max(1000).optional(),
});

export const ReasonBody = z.strictObject({
  reason: z.string().trim().min(10).max(500),
});

const locationFields = {
  label: text(1, 60),
  state_code: text(1, 10),
  pin: text(1, 10),
  address_1: text(1, 120),
  address_2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  pickup_contact_name: text(1, 80),
  pickup_contact_phone: text(1, 20),
  status: z.enum(["active", "inactive"]).optional(),
};

export const CreateLocationBody = z.strictObject(locationFields);

// No code, no vendor id and no stock location id: none of them can be changed.
export const UpdateLocationBody = z
  .strictObject({
    label: locationFields.label.optional(),
    state_code: locationFields.state_code.optional(),
    pin: locationFields.pin.optional(),
    address_1: locationFields.address_1.optional(),
    address_2: locationFields.address_2,
    city: locationFields.city,
    pickup_contact_name: locationFields.pickup_contact_name.optional(),
    pickup_contact_phone: locationFields.pickup_contact_phone.optional(),
    status: locationFields.status,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export type InviteVendorBodyType = z.infer<typeof InviteVendorBody>;
export type ReasonBodyType = z.infer<typeof ReasonBody>;
export type CreateLocationBodyType = z.infer<typeof CreateLocationBody>;
export type UpdateLocationBodyType = z.infer<typeof UpdateLocationBody>;
