import { getServerEnv } from "@/lib/env/server";
import { runPlannerChat } from "@/lib/planner-chat/run";
import { chatRequestSchema } from "@/lib/planner-chat/schema";
import { CHAT_UNAVAILABLE } from "@/lib/planner-chat/types";
import { AppError, toHttpError } from "@/lib/reliability";

export async function POST(request: Request) {
  try {
    const json: unknown = await request.json().catch(() => null);
    const parsed = chatRequestSchema.safeParse(json);
    if (!parsed.success) throw new AppError("invalid_input", "Send a message to the trip agent.");
    const env = getServerEnv();
    if (!env.META_MODEL_API_KEY) throw new AppError("provider_unavailable", CHAT_UNAVAILABLE);
    return await runPlannerChat(parsed.data, {
      apiKey: env.META_MODEL_API_KEY,
      baseURL: env.META_MODEL_API_BASE_URL,
      model: env.PLANNER_CHAT_MODEL,
      signal: request.signal,
    });
  } catch (error) {
    const { status, body } = toHttpError(error);
    return Response.json(body, { status });
  }
}
