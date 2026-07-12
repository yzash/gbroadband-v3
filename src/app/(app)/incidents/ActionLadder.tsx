"use client";

/** Action ladder placeholder — the propose→approve→execute→audit flow lands in M6. */
export function ActionLadder(_props: { incidentId: string; detail: unknown; window: number; onChanged: () => void }) {
  return (
    <section className="card p-4">
      <h3 className="section-title mb-2">Action ladder · human-in-the-loop</h3>
      <p className="text-xs text-ink-3">
        Remote-first actions, confirming test, dispatch to the suspect element, and proactive notifications —
        each gated propose → approve → execute → audit — arrive in M6.
      </p>
    </section>
  );
}
