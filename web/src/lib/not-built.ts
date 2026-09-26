/** Thrown by entry-point stubs, so calling one before its owner builds it fails loudly. */
export class NotBuiltError extends Error {
  override readonly name = "NotBuiltError";

  constructor(what: string) {
    super(`${what} isn't built yet`);
  }
}

/** A stub for an exported function whose real signature its owner defines. */
export function notBuilt(what: string): (...args: unknown[]) => never {
  return () => {
    throw new NotBuiltError(what);
  };
}
