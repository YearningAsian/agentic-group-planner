import { profile } from "@agp/shared";
import { updateProfile } from "@/features/profile/server";
import { AppError, toHttpError } from "@/lib/reliability";
import { getServerClient } from "@/lib/supabase/server";

function badRequest(message: string): Response {
  return Response.json({ error: { code: "invalid_input", message, retryable: false } }, { status: 400 });
}

/** Updates the caller's display name and avatar, and their name in every trip they've joined (design §2.4, §5.1). */
export async function PATCH(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return badRequest("The request body must be JSON.");
  }
  const parsed = profile.UpdateProfileRequest.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(`${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }

  try {
    const client = await getServerClient();
    const { data } = await client.auth.getUser();
    if (!data.user) throw new AppError("unauthenticated", "Sign in to edit your profile.");
    const { display_name, avatar_url } = parsed.data;
    const result = await updateProfile(client, { displayName: display_name, avatarUrl: avatar_url });
    return Response.json(result satisfies profile.UpdateProfileResponse);
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
