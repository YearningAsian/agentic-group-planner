import { z } from "zod";

/** A display name as members see it in chat and lanes (design §2.4: at most 80 characters). */
export const DisplayName = z.string().trim().min(1, "can't be blank").max(80);

/** An avatar image on the web; null clears it. */
export const AvatarUrl = z.url({ protocol: /^https?$/ }).max(2048);

/**
 * `PATCH /api/profile` (signed in): the caller's own name and avatar. Strict, so a client can't
 * send server-owned fields such as the Stripe customer, and at least one field must be present.
 */
export const UpdateProfileRequest = z
  .strictObject({
    display_name: DisplayName.optional(),
    avatar_url: AvatarUrl.nullable().optional(),
  })
  .refine((body) => body.display_name !== undefined || body.avatar_url !== undefined, {
    message: "send display_name or avatar_url",
  });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

/** The fields a member may see of their own profile; never the payment fields. */
export const Profile = z.object({
  id: z.uuid(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileResponse = z.object({ profile: Profile });
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponse>;
