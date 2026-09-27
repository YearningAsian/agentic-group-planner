/** Realtime is a doorbell: a board change refetches the document. The payload is ignored. */

export function bindStudioBoard(
  listen: (handler: () => void) => () => void,
  pull: () => Promise<void>,
  onPulled: () => void,
): () => void {
  return listen(() => {
    void pull().then(onPulled);
  });
}
