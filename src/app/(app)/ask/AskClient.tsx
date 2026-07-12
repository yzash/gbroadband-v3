"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MiniMarkdown } from "./MiniMarkdown";

interface Msg {
  role: "user" | "assistant";
  text: string;
  tool?: string;
  sql?: string;
  cards?: Record<string, unknown>[];
  error?: boolean;
}

const SUGGESTED = [
  "What's impacting the most revenue right now?",
  "How many affected customers haven't called yet?",
  "Why do we think the fault is where we say it is?",
  "Draft the customer notification for INC-1.",
  "SELECT fault_kind, COUNT(*) FROM incidents GROUP BY fault_kind",
];

export function AskClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", text: j.answer, tool: j.tool, sql: j.sql, cards: j.cards, error: j.error }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* GE caption — always on */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <GeMark />
        <div className="text-xs text-ink-2">Ask the network</div>
        <span className="ml-auto text-2xs text-ink-3">Styled after GE · powered by Gemini · <span className="text-degraded/80">DEMONSTRATION — synthetic data</span></span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {msgs.length === 0 && (
          <div className="mt-6 text-center">
            <GeMark large />
            <p className="mt-3 text-sm text-ink-3">Ask about incidents, isolation, blast radius, or query the data directly.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-doctrine px-3.5 py-2 text-sm text-white">{m.text}</div>
            ) : (
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-surface px-3.5 py-2.5">
                <MiniMarkdown text={m.text} />
                {m.cards?.map((c, ci) => <ProposalCard key={ci} card={c} />)}
                {m.sql && <SqlDisclosure sql={m.sql} />}
                {m.tool && (
                  <div className="mt-1.5 flex items-center gap-1 text-2xs text-ink-3">
                    <span className="text-ge-blue">✦</span> tool: <code className="font-mono">{m.tool}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl border border-line bg-surface px-3.5 py-2 text-sm text-ink-3">thinking…</div></div>}
      </div>

      {/* Suggested prompts */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-2">
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy} className="chip border border-line bg-surface-2 normal-case text-ink-3 hover:text-ink">
            {s.length > 46 ? s.slice(0, 44) + "…" : s}
          </button>
        ))}
      </div>

      <form
        className="flex items-center gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the network, or paste a SELECT…"
          className="flex-1 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-doctrine"
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn-primary rounded-full">Ask</button>
      </form>
    </div>
  );
}

function ProposalCard({ card }: { card: Record<string, unknown> }) {
  return (
    <div className="mt-2 rounded-lg border border-doctrine/30 bg-doctrine/5 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide text-doctrine">{String(card.type)} draft · {String(card.incident)}</span>
        <span className="chip bg-watch/15 text-watch">draft only</span>
      </div>
      {card.type === "notification" ? (
        <>
          <div className="text-2xs text-ink-3">{String(card.recipients)} recipients · ETA {String(card.eta_hrs)}h</div>
          <div className="mt-1 text-xs italic text-ink-2">&ldquo;{String(card.message)}&rdquo;</div>
        </>
      ) : (
        <div className="text-xs text-ink-2">Dispatch to {String(card.target)} · {String(card.vendor)}</div>
      )}
      <Link href={`/incidents?id=${card.incident}`} className="mt-1.5 inline-block text-2xs text-doctrine hover:underline">
        review in Incident Room →
      </Link>
    </div>
  );
}

function SqlDisclosure({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="text-2xs text-ink-3 hover:text-ink-2">
        {open ? "▾" : "▸"} SQL
      </button>
      {open && <pre className="mt-1 overflow-x-auto rounded bg-base p-2 text-2xs text-doctrine">{sql}</pre>}
    </div>
  );
}

function GeMark({ large }: { large?: boolean }) {
  const size = large ? "text-3xl" : "text-lg";
  return (
    <span className={`font-semibold ${size}`}>
      <span className="text-ge-blue">G</span>
      <span className="text-ge-red">E</span>
      <span className="ml-1 align-middle text-ge-yellow">✦</span>
    </span>
  );
}
