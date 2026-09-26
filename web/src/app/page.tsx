/**
 * A static landing page. It links nowhere until `/login` and `/trips` exist; then it becomes the
 * redirect to one of them (plan task FE-202).
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-text">Group Trip Agent</h1>
      <p className="text-lg text-text">Plan together, pay together, remember together.</p>
      <p className="text-base text-text-muted">
        A group chats about a trip and mentions the agent. It plans the day, books with each person&rsquo;s
        consent, and turns the trip into a shared recap. Sign-in opens once the first milestone ships.
      </p>
    </main>
  );
}
