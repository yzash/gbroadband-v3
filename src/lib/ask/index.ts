import {
  query_incidents,
  get_incident,
  get_blast_radius,
  get_isolation,
  ops_snapshot,
  draft_proposal,
  run_sql,
} from "./tools";
import { getDb } from "../db";
import { pesoCompact } from "../tokens";

export interface AskResponse {
  answer: string;
  tool: string;
  sql?: string;
  cards?: Record<string, unknown>[];
  mode: "canned" | "live";
  error?: boolean;
}

function normId(raw: string, prefix: string, pad: number): string {
  const m = raw.match(new RegExp(`${prefix}-?(\\d+)`, "i"));
  if (!m) return "";
  return `${prefix}-${m[1].padStart(pad, "0")}`;
}

function incidentBySuspect(suspect: string): string | null {
  const r = getDb()
    .prepare("SELECT id FROM incidents WHERE top_suspect=? AND state NOT IN ('resolved') ORDER BY rank_score DESC LIMIT 1")
    .get(suspect) as { id: string } | undefined;
  return r?.id ?? null;
}

/** Deterministic intent router over the real tools — works with no network. */
export function askCanned(question: string): AskResponse {
  const q = question.trim();
  const lower = q.toLowerCase();
  const incId = normId(q, "INC", 3);
  const splId = normId(q, "SPL", 3);

  // Raw SQL
  if (/^select\b/i.test(q) || lower.includes("run sql") || lower.includes("run_sql")) {
    const sqlMatch = q.match(/select[\s\S]+/i);
    const res = run_sql(sqlMatch ? sqlMatch[0] : q);
    if (!res.ok) return { answer: `SQL error: ${res.error}`, tool: "run_sql", sql: res.sql, mode: "canned", error: true };
    const preview = res.rows!.slice(0, 12);
    const cols = preview.length ? Object.keys(preview[0]) : [];
    const table =
      preview.length === 0
        ? "_no rows_"
        : [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...preview.map((r) => `| ${cols.map((c) => String(r[c])).join(" | ")} |`)].join("\n");
    return { answer: `${res.rows!.length} row(s):\n\n${table}`, tool: "run_sql", sql: res.sql, mode: "canned" };
  }

  // Draft a notification / dispatch
  if (lower.includes("draft") || lower.includes("notification") || (lower.includes("notify") && incId)) {
    const id = incId || query_incidents().rows[0]?.id as string;
    if (!id) return { answer: "No incident to draft for.", tool: "draft_proposal", mode: "canned" };
    const kind = lower.includes("dispatch") ? "dispatch" : "notification";
    const r = draft_proposal(id, kind);
    return { answer: r.text + (kind === "notification" && r.card ? `\n\n> ${r.card.message}` : ""), tool: "draft_proposal", cards: r.card ? [r.card] : [], mode: "canned" };
  }

  // Why suspect X not Y / isolation reasoning
  if (lower.includes("why") || lower.includes("isolation") || (splId && (lower.includes("fault") || lower.includes("suspect")))) {
    const id = incId || (splId ? incidentBySuspect(splId) : null) || (query_incidents().rows[0]?.id as string);
    if (!id) return { answer: "No incident to explain.", tool: "get_isolation", mode: "canned" };
    return { answer: get_isolation(id).text, tool: "get_isolation", mode: "canned" };
  }

  // Silent sufferers / haven't called
  if (lower.includes("haven't called") || lower.includes("havent called") || lower.includes("silent") || lower.includes("not called") || lower.includes("inferred")) {
    if (incId) return { answer: get_blast_radius(incId).text, tool: "get_blast_radius", mode: "canned" };
    const rows = query_incidents().rows;
    const totalInf = rows.reduce((a, r) => a + (r.inferred_count as number), 0);
    const totalObs = rows.reduce((a, r) => a + (r.observed_count as number), 0);
    return {
      answer: `Across open incidents, **${totalInf} affected customers haven't called** (silent/inferred) vs ${totalObs} who have. Notifying the silent set is where proactive comms earn the most goodwill.`,
      tool: "get_blast_radius",
      mode: "canned",
    };
  }

  // Revenue / exposure
  if (lower.includes("revenue") || lower.includes("exposure") || lower.includes("money") || lower.includes("most") ) {
    const { rows } = query_incidents();
    if (rows.length === 0) return { answer: "No open incidents impacting revenue right now.", tool: "query_incidents", mode: "canned" };
    const top = rows[0];
    return {
      answer: `**${top.id}** is impacting the most revenue: ${pesoCompact(top.peso_exposure as number)}/mo across ${
        (top.observed_count as number) + (top.inferred_count as number)
      } lines at ${top.top_suspect}. Next:\n\n${query_incidents().text}`,
      tool: "query_incidents",
      mode: "canned",
    };
  }

  // Specific incident
  if (incId) return { answer: get_incident(incId).text, tool: "get_incident", mode: "canned" };

  // List incidents
  if (lower.includes("incident") || lower.includes("outage") || lower.includes("list")) {
    return { answer: query_incidents().text, tool: "query_incidents", mode: "canned" };
  }

  // Default: ops snapshot
  return { answer: ops_snapshot().text, tool: "ops_snapshot", mode: "canned" };
}

/** Live Gemini path (function-calling). Falls back to canned on any error. */
export async function ask(question: string): Promise<AskResponse> {
  const mode = process.env.DEMO_MODE ?? "canned";
  if (mode !== "live" || !process.env.GEMINI_API_KEY) return askCanned(question);
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Ground the model with a live snapshot + let it request run_sql via text.
    const ctx = ops_snapshot().text + "\n\nOpen incidents:\n" + query_incidents().text;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are the GE assistant for a broadband NOC (demonstration, synthetic data). Answer concisely in markdown using this live context. If the user asks for data you don't have, suggest a SQL query.\n\nContext:\n${ctx}\n\nQuestion: ${question}`;
    const res = await model.generateContent(prompt);
    return { answer: res.response.text(), tool: "gemini", mode: "live" };
  } catch {
    return { ...askCanned(question), mode: "canned" };
  }
}
