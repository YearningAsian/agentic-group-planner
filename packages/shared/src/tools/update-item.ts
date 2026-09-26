import { z } from "zod";
import { Timestamp } from "../common";
import { PlaceCategory } from "../enums";
import { handleOf } from "../handles";

export const UpdateItemAction = z.enum(["add_slot", "mark_tbd", "swap_option", "request_alternatives", "set_attendees"]);
export type UpdateItemAction = z.infer<typeof UpdateItemAction>;

/** A new TBD block (design §2.1 `update_item`). `area` is its provisional stop until a place is chosen. */
export const NewSlot = z
  .object({
    slot_key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "a short snake_case key, like late_dessert"),
    label: z.string().min(1).max(60),
    category: PlaceCategory,
    starts_at: Timestamp,
    ends_at: Timestamp,
    together: z.boolean().default(false),
    area: z
      .object({
        label: z.string().min(1).max(80),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
  })
  .refine((slot) => Date.parse(slot.ends_at) > Date.parse(slot.starts_at), {
    path: ["ends_at"],
    message: "ends_at must be after starts_at",
  });
export type NewSlot = z.infer<typeof NewSlot>;

/** Which fields each action needs; the rest are ignored. */
const REQUIRED: Record<UpdateItemAction, ("item_handle" | "option_handle" | "member_handles" | "slot")[]> = {
  add_slot: ["slot"],
  mark_tbd: ["item_handle"],
  swap_option: ["item_handle", "option_handle"],
  request_alternatives: ["item_handle"],
  set_attendees: ["item_handle", "member_handles"],
};

export const UpdateItemInput = z
  .object({
    action: UpdateItemAction,
    item_handle: handleOf("I").optional(),
    option_handle: handleOf("O").optional(),
    member_handles: z.array(handleOf("M")).min(1).max(20).optional(),
    slot: NewSlot.optional(),
    note: z.string().max(300).optional(),
  })
  .superRefine((input, ctx) => {
    for (const field of REQUIRED[input.action]) {
      if (input[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `${input.action} needs ${field}` });
      }
    }
  });
export type UpdateItemInput = z.infer<typeof UpdateItemInput>;
