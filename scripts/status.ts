/**
 * One-screen operational status for the adapter: is the service up, can it
 * reach technocore.chat, what has been published recently, is anything
 * stuck, and is the archive timer still running.
 *
 * Opens the database read-only and never writes. Exit code: 0 = healthy,
 * 1 = something needs attention, 2 = the check itself could not run.
 *
 * Usage:
 *   npm run status
 *   npm run status -- --json
 *   npm run status -- --hours 24 --stale-minutes 15
 *   npm run status -- --notify   # POST to TECHNOCORE_ALERT_WEBHOOK_URL if attention is needed
 */
import Database from "better-sqlite3";
import { loadConfig, type AdapterConfig } from "../src/config/env.js";
import { parseArgs } from "./arg-parser.js";

/** A publish still `pending` after this long is stuck, not in flight. */
const PENDING_STUCK_MINUTES = 5;

interface StatusReport {
  checkedAt: string;
  service: { status: "ok" | "down"; url: string; nodeEnv?: string; publishingEnabled?: boolean };
  upstream: { status: "ok" | "degraded" | "unknown" | "skipped"; latencyMs?: number };
  agents: { slug: string; status: string; publicDid: string }[];
  publishes: { windowHours: number; byStatus: Record<string, number> };
  archive: { room: string; lastSequence: number; lastPolledAt: string | null; stale: boolean }[];
  attention: string[];
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function minutesAgo(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - Date.parse(iso)) / 60_000);
}

async function checkService(config: AdapterConfig, report: StatusReport): Promise<void> {
  // A wildcard bind address is reachable on loopback.
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const base = `http://${host.includes(":") ? `[${host}]` : host}:${config.port}/api/technocore`;
  report.service.url = base;

  try {
    const health = (await getJson(`${base}/health`, 3000)) as {
      data?: { nodeEnv?: string; publishingEnabled?: boolean };
    };
    report.service.status = "ok";
    report.service.nodeEnv = health.data?.nodeEnv;
    report.service.publishingEnabled = health.data?.publishingEnabled;
    if (health.data?.publishingEnabled === false) {
      report.attention.push(
        "Publishing is disabled (TECHNOCORE_IDENTITY_ENCRYPTION_KEY not loaded).",
      );
    }
  } catch (err) {
    report.service.status = "down";
    report.attention.push(
      `Adapter service is not responding at ${base}/health (${(err as Error).message}).`,
    );
    return;
  }

  try {
    const upstream = (await getJson(`${base}/health/upstream`, 20_000)) as {
      data?: { status?: string; latencyMs?: number };
    };
    const status = upstream.data?.status;
    report.upstream = {
      status: status === "ok" || status === "degraded" ? status : "unknown",
      latencyMs: upstream.data?.latencyMs,
    };
    if (report.upstream.status !== "ok") {
      report.attention.push(
        `technocore.chat is ${report.upstream.status} from the adapter's side.`,
      );
    }
  } catch (err) {
    report.upstream = { status: "unknown" };
    report.attention.push(`Upstream health check failed (${(err as Error).message}).`);
  }
}

function checkDatabase(
  config: AdapterConfig,
  report: StatusReport,
  windowHours: number,
  staleMinutes: number,
): void {
  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    const now = Date.now();

    report.agents = db
      .prepare("SELECT slug, status, public_did AS publicDid FROM technocore_agents ORDER BY slug")
      .all() as StatusReport["agents"];

    const since = new Date(now - windowHours * 3_600_000).toISOString();
    const counts = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM technocore_publish_requests
         WHERE created_at >= ? GROUP BY status`,
      )
      .all(since) as { status: string; n: number }[];
    for (const status of ["published", "failed", "unknown", "pending"]) {
      report.publishes.byStatus[status] = counts.find((c) => c.status === status)?.n ?? 0;
    }

    type Row = {
      created_at: string;
      slug: string | null;
      room: string;
      nonce: string | null;
      error_code: string | null;
    };
    const describe = (r: Row) =>
      `${r.slug ?? "?"} → ${r.room}, nonce ${r.nonce ?? "?"}, at ${r.created_at}`;
    const problemQuery = `
      SELECT p.created_at, a.slug, p.room, p.nonce, p.error_code
      FROM technocore_publish_requests p LEFT JOIN technocore_agents a ON a.id = p.agent_id
      WHERE p.status = ? AND p.created_at >= ? ORDER BY p.created_at DESC`;

    // `unknown` never resolves on its own, so look back indefinitely.
    for (const r of db.prepare(problemQuery).all("unknown", "") as Row[]) {
      report.attention.push(
        `Unresolved publish (may or may not have posted): ${describe(r)}. Re-read the room before retrying.`,
      );
    }
    const stuckBefore = new Date(now - PENDING_STUCK_MINUTES * 60_000).toISOString();
    for (const r of db.prepare(problemQuery).all("pending", "") as Row[]) {
      if (r.created_at < stuckBefore)
        report.attention.push(`Publish stuck in pending: ${describe(r)}.`);
    }
    for (const r of db.prepare(problemQuery).all("failed", since) as Row[]) {
      report.attention.push(`Publish failed (${r.error_code ?? "unknown error"}): ${describe(r)}.`);
    }

    const cursors = db
      .prepare("SELECT room, last_sequence, last_polled_at FROM technocore_room_cursors")
      .all() as { room: string; last_sequence: number; last_polled_at: string | null }[];
    for (const room of config.allowedRooms) {
      const c = cursors.find((x) => x.room === room);
      const age = minutesAgo(c?.last_polled_at ?? null, now);
      const stale = age === null || age > staleMinutes;
      report.archive.push({
        room,
        lastSequence: c?.last_sequence ?? 0,
        lastPolledAt: c?.last_polled_at ?? null,
        stale,
      });
      if (stale) {
        report.attention.push(
          age === null
            ? `Room ${room} has never been archived.`
            : `Room ${room} last archived ${age} min ago (expected every 5; is the archive timer running?).`,
        );
      }
    }
  } finally {
    db.close();
  }
}

function renderText(r: StatusReport, staleNow: number): string {
  const lines: string[] = [];
  const pad = (s: string) => s.padEnd(13);
  lines.push(`GSG Technocore Adapter status  ${r.checkedAt}`);
  lines.push("");
  lines.push(
    pad("Service") +
      (r.service.status === "ok"
        ? `OK    ${r.service.url} (${r.service.nodeEnv ?? "?"}, publishing ${r.service.publishingEnabled ? "enabled" : "DISABLED"})`
        : `DOWN  ${r.service.url}`),
  );
  lines.push(
    pad("Upstream") +
      (r.upstream.status === "ok"
        ? `OK    technocore.chat ${r.upstream.latencyMs ?? "?"} ms`
        : r.upstream.status.toUpperCase()),
  );
  lines.push("");
  lines.push("Agents");
  if (r.agents.length === 0) lines.push("  (none)");
  for (const a of r.agents)
    lines.push(`  ${a.slug.padEnd(24)} ${a.status.padEnd(8)} ${a.publicDid}`);
  lines.push("");
  const b = r.publishes.byStatus;
  lines.push(
    `Publishes, last ${r.publishes.windowHours} h: published ${b.published} · failed ${b.failed} · ` +
      `unknown ${b.unknown} · pending ${b.pending}`,
  );
  lines.push(
    "  (Policy rejections are not stored; see `journalctl -u gsg-technocore-adapter | grep rejected`.)",
  );
  lines.push("");
  lines.push("Archive");
  for (const a of r.archive) {
    const age = minutesAgo(a.lastPolledAt, staleNow);
    lines.push(
      `  ${a.room.padEnd(24)} seq ${String(a.lastSequence).padEnd(6)} ` +
        `${age === null ? "never polled" : `polled ${age} min ago`}${a.stale ? "  ← stale" : ""}`,
    );
  }
  lines.push("");
  if (r.attention.length === 0) {
    lines.push("Nothing needs attention.");
  } else {
    lines.push(`Needs attention (${r.attention.length}):`);
    for (const a of r.attention) lines.push(`  - ${a}`);
  }
  return lines.join("\n");
}

async function notify(report: StatusReport): Promise<void> {
  const url = process.env.TECHNOCORE_ALERT_WEBHOOK_URL;
  if (!url) {
    console.error("--notify: TECHNOCORE_ALERT_WEBHOOK_URL is not set; no alert sent.");
    return;
  }
  const text =
    `GSG Technocore Adapter needs attention (${report.attention.length}):\n` +
    report.attention.map((a) => `• ${a}`).join("\n");
  // `text` is read by Slack-style webhooks, `content` by Discord.
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) console.error(`--notify: webhook returned HTTP ${res.status}.`);
}

async function main(): Promise<number> {
  const { flags, booleans } = parseArgs(process.argv.slice(2));
  const windowHours = Number(flags.hours ?? 24);
  const staleMinutes = Number(flags["stale-minutes"] ?? 15);
  if (!(windowHours > 0) || !(staleMinutes > 0)) {
    console.error("Error: --hours and --stale-minutes must be positive numbers.");
    return 2;
  }

  const config = loadConfig();
  const report: StatusReport = {
    checkedAt: new Date().toISOString(),
    service: { status: "down", url: "" },
    upstream: { status: "skipped" },
    agents: [],
    publishes: { windowHours, byStatus: {} },
    archive: [],
    attention: [],
  };

  await checkService(config, report);
  try {
    checkDatabase(config, report, windowHours, staleMinutes);
  } catch (err) {
    console.error(
      `Error: could not read the database at ${config.dbPath}: ${(err as Error).message}`,
    );
    return 2;
  }

  console.log(
    booleans.has("json") ? JSON.stringify(report, null, 2) : renderText(report, Date.now()),
  );

  if (report.attention.length > 0 && booleans.has("notify")) {
    try {
      await notify(report);
    } catch (err) {
      console.error(`--notify: could not reach the webhook (${(err as Error).message}).`);
    }
  }
  return report.attention.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(2);
  });
