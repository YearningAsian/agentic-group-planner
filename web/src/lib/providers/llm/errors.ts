import { AppError } from "@/lib/reliability";

/** Both providers end a run this way when the model is still calling tools at the step cap. */
export function stepLimitError(maxSteps: number): AppError {
  return new AppError("internal", `The agent took too many steps (more than ${maxSteps}). Try a smaller request.`, {
    retryable: true,
  });
}
