import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Heartbeat {
  IMPROVE: string | null;
  REVIEW: string | null;
  OPERATE: string | null;
  PLAN: string | null;
}

interface BacklogItem {
  id: string;
  title: string;
  priority: number;
  type: string;
  status: string;
  scope: string;
}

interface AgentStatusData {
  progress: string | null;
  backlog: BacklogItem[] | null;
  heartbeat: Heartbeat | null;
}

interface BotHealth {
  status: string;
  startedAt?: string;
  uptime?: number;
  lastPollAt?: string | null;
  lastNotificationAttempt?: string | null;
  lastNotificationSuccess?: string | null;
  notificationFailCount?: number;
  telegramConfigured?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(timestamp: string | null): string {
  if (!timestamp) return "never";
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function agentStatus(
  timestamp: string | null,
  thresholdMinutes: number
): { label: string; color: string } {
  if (!timestamp) return { label: "never run", color: "text-gray-500" };
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = diff / 60_000;
  if (mins < thresholdMinutes) return { label: "active", color: "text-green-400" };
  if (mins < thresholdMinutes * 2) return { label: "late", color: "text-yellow-400" };
  return { label: "stale", color: "text-red-400" };
}

function statusDot(color: string): string {
  if (color === "text-green-400") return "bg-green-400";
  if (color === "text-yellow-400") return "bg-yellow-400";
  if (color === "text-red-400") return "bg-red-400";
  return "bg-gray-500";
}

function parseProgressSection(
  progress: string,
  header: string
): string[] {
  const lines = progress.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`## ${header}`));
  if (idx === -1) return [];
  const entries: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("- ") && !trimmed.includes("(none") && !trimmed.includes("(initial")) {
      entries.push(trimmed.slice(2));
    }
  }
  return entries;
}

function overallHealth(heartbeat: Heartbeat | null): {
  score: string;
  label: string;
  color: string;
} {
  if (!heartbeat) return { score: "?", label: "UNKNOWN", color: "text-gray-500" };

  const agents = [
    { ts: heartbeat.IMPROVE, threshold: 180 },
    { ts: heartbeat.REVIEW, threshold: 180 },
    { ts: heartbeat.OPERATE, threshold: 180 },
    { ts: heartbeat.PLAN, threshold: 1500 },
  ];

  let staleCount = 0;
  for (const a of agents) {
    if (!a.ts) {
      staleCount++;
      continue;
    }
    const mins = (Date.now() - new Date(a.ts).getTime()) / 60_000;
    if (mins > a.threshold) staleCount++;
  }

  if (staleCount === 0) return { score: "100", label: "HEALTHY", color: "text-green-400" };
  if (staleCount === 1) return { score: "75", label: "DEGRADED", color: "text-yellow-400" };
  if (staleCount <= 2) return { score: "50", label: "DEGRADED", color: "text-yellow-400" };
  return { score: "25", label: "DOWN", color: "text-red-400" };
}

function typeColor(type: string): string {
  switch (type) {
    case "fix": return "bg-red-900/40 text-red-400";
    case "feature": return "bg-blue-900/40 text-blue-400";
    case "test-gap": return "bg-purple-900/40 text-purple-400";
    case "performance": return "bg-amber-900/40 text-amber-400";
    case "refactor": return "bg-gray-700/40 text-gray-400";
    default: return "bg-gray-700/40 text-gray-400";
  }
}

function statusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case "ready": return { label: "Ready", color: "bg-green-900/40 text-green-400" };
    case "in-progress": return { label: "In Progress", color: "bg-blue-900/40 text-blue-400" };
    case "pr-open": return { label: "PR Open", color: "bg-amber-900/40 text-amber-400" };
    case "blocked": return { label: "Blocked", color: "bg-red-900/40 text-red-400" };
    case "done": return { label: "Done", color: "bg-gray-700/40 text-gray-400" };
    default: return { label: status, color: "bg-gray-700/40 text-gray-400" };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

interface EvalRun {
  ranAt: string;
  caseCount: number;
  cardNameAccuracy: number;
  quantityAccuracy: number;
  countMatchRate: number;
  scryfallResolved: number;
  triggeredBy?: string;
  commitSha?: string;
}

export default async function StatusPage() {
  let data: AgentStatusData | null = null;
  let botHealth: BotHealth | null = null;
  let evalRuns: EvalRun[] = [];

  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : "http://localhost:3000");

    const [agentRes, botRes, evalRes] = await Promise.all([
      fetch(`${baseUrl}/api/agent-status`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/bot-health`, { cache: "no-store" }).catch(() => null),
      fetch(`${baseUrl}/api/eval-scores?limit=30`, { cache: "no-store" }).catch(() => null),
    ]);

    if (agentRes.ok) {
      data = await agentRes.json();
    }
    if (botRes?.ok) {
      botHealth = await botRes.json();
    }
    if (evalRes?.ok) {
      const evalData = await evalRes.json();
      evalRuns = evalData.runs ?? [];
    }
  } catch {
    // API not available
  }

  const heartbeat = data?.heartbeat ?? null;
  const backlog = data?.backlog ?? [];
  const progress = data?.progress ?? "";

  const health = overallHealth(heartbeat);
  const recentActivity = parseProgressSection(progress, "Recently Completed").slice(0, 10);
  const knownIssues = parseProgressSection(progress, "Known Issues");
  const inProgress = parseProgressSection(progress, "In Progress");
  const healthScores = parseProgressSection(progress, "Health Scores (last 10 sessions)").slice(0, 5);

  const agents: {
    name: string;
    key: keyof Heartbeat;
    description: string;
    thresholdMin: number;
  }[] = [
    { name: "OPERATE", key: "OPERATE", description: "Twitter bot", thresholdMin: 120 },
    { name: "REVIEW", key: "REVIEW", description: "Quality check", thresholdMin: 120 },
    { name: "IMPROVE", key: "IMPROVE", description: "Dev agent", thresholdMin: 120 },
    { name: "PLAN", key: "PLAN", description: "Strategy", thresholdMin: 1500 },
  ];

  const readyTasks = backlog.filter((t) => t.status === "ready").sort((a, b) => a.priority - b.priority);
  const activeTasks = backlog.filter((t) => t.status === "in-progress" || t.status === "pr-open");

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            &larr; Back to Deck Viewer
          </Link>
          <h1 className="text-2xl font-bold text-white mt-2">
            Agent Status Dashboard
          </h1>
        </div>
        <Link
          href="/stats"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Bot Stats &rarr;
        </Link>
      </div>

      {/* ── Health Score ── */}
      <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              System Health
            </p>
            <p className={`text-4xl font-bold mt-1 ${health.color}`}>
              {health.score}
              <span className="text-lg font-normal text-gray-500">/100</span>
            </p>
          </div>
          <div
            className={`text-sm font-semibold px-3 py-1 rounded-full ${
              health.label === "HEALTHY"
                ? "bg-green-900/40 text-green-400"
                : health.label === "DEGRADED"
                  ? "bg-yellow-900/40 text-yellow-400"
                  : "bg-red-900/40 text-red-400"
            }`}
          >
            {health.label}
          </div>
        </div>
      </div>

      {/* ── OCR Accuracy ── */}
      {evalRuns.length > 0 && (() => {
        const latest = evalRuns[0];
        const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
        // Trend: compare latest to oldest in the set
        const oldest = evalRuns[evalRuns.length - 1];
        const trend = (curr: number, prev: number) => {
          const diff = curr - prev;
          if (Math.abs(diff) < 0.005) return "→";
          return diff > 0 ? "↑" : "↓";
        };
        const trendColor = (curr: number, prev: number) => {
          const diff = curr - prev;
          if (Math.abs(diff) < 0.005) return "text-gray-400";
          return diff > 0 ? "text-green-400" : "text-red-400";
        };
        // SVG sparkline data (reversed so oldest is left)
        const sparkData = [...evalRuns].reverse();
        const sparkW = 200, sparkH = 40;
        const toPoints = (accessor: (r: EvalRun) => number) => {
          if (sparkData.length < 2) return "";
          return sparkData.map((r, i) => {
            const x = (i / (sparkData.length - 1)) * sparkW;
            const y = sparkH - accessor(r) * sparkH;
            return `${x},${y}`;
          }).join(" ");
        };

        return (
          <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">OCR Accuracy</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: "Card Names", value: latest.cardNameAccuracy, prev: oldest.cardNameAccuracy },
                { label: "Quantities", value: latest.quantityAccuracy, prev: oldest.quantityAccuracy },
                { label: "Scryfall", value: latest.scryfallResolved, prev: oldest.scryfallResolved },
                { label: "Count Match", value: latest.countMatchRate, prev: oldest.countMatchRate },
              ].map((m) => (
                <div key={m.label} className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{m.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{pct(m.value)}</p>
                  <p className={`text-xs mt-1 ${trendColor(m.value, m.prev)}`}>
                    {trend(m.value, m.prev)} from {pct(m.prev)}
                  </p>
                </div>
              ))}
            </div>
            {sparkData.length >= 2 && (
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-2">Trend ({evalRuns.length} eval runs)</p>
                <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="w-full h-10" preserveAspectRatio="none">
                  <polyline points={toPoints((r) => r.cardNameAccuracy)} fill="none" stroke="#4ade80" strokeWidth="1.5" />
                  <polyline points={toPoints((r) => r.scryfallResolved)} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
                </svg>
                <div className="flex gap-4 mt-1">
                  <span className="text-xs text-green-400">— Card Names</span>
                  <span className="text-xs text-blue-400">— Scryfall</span>
                  <span className="text-xs text-gray-500 ml-auto">{latest.caseCount} cases · {latest.triggeredBy ?? "manual"}</span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Agent Heartbeats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {agents.map((agent) => {
          const ts = heartbeat?.[agent.key] ?? null;
          const status = agentStatus(ts, agent.thresholdMin);
          return (
            <div
              key={agent.key}
              className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={`w-2 h-2 rounded-full ${statusDot(status.color)}`}
                />
                <p className="text-xs text-gray-400 uppercase tracking-wide">
                  {agent.name}
                </p>
              </div>
              <p className="text-sm text-gray-300">{agent.description}</p>
              <p className={`text-xs mt-1 ${status.color}`}>
                {relativeTime(ts)} &middot; {status.label}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Bot Health (Railway) ── */}
      <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Bot Process (Railway)
        </h2>
        {!botHealth || botHealth.status === "unreachable" ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-sm text-red-400">Unreachable</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Uptime</p>
              <p className="text-gray-300">
                {botHealth.uptime != null
                  ? `${Math.floor(botHealth.uptime / 3600)}h ${Math.floor((botHealth.uptime % 3600) / 60)}m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Last Poll</p>
              <p className="text-gray-300">
                {relativeTime(botHealth.lastPollAt ?? null)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Telegram</p>
              <p className={botHealth.telegramConfigured ? "text-green-400" : "text-red-400"}>
                {botHealth.telegramConfigured ? "Configured" : "Not configured"}
              </p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Notification Failures</p>
              <p className={(botHealth.notificationFailCount ?? 0) > 0 ? "text-red-400" : "text-green-400"}>
                {botHealth.notificationFailCount ?? 0}
                {botHealth.lastNotificationSuccess && (
                  <span className="text-gray-500 ml-1">
                    (last ok: {relativeTime(botHealth.lastNotificationSuccess)})
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* ── In Progress ── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">In Progress</h2>
          <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
            {inProgress.length === 0 && activeTasks.length === 0 ? (
              <p className="text-gray-500 text-sm">No active tasks</p>
            ) : (
              <ul className="space-y-2">
                {inProgress.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300">
                    {item}
                  </li>
                ))}
                {activeTasks.map((task) => (
                  <li key={task.id} className="text-sm text-gray-300 flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(task.status).color}`}>
                      {statusBadge(task.status).label}
                    </span>
                    {task.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Health Score History ── */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Health Scores</h2>
          <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
            {healthScores.length === 0 ? (
              <p className="text-gray-500 text-sm">No scores recorded yet</p>
            ) : (
              <ul className="space-y-1">
                {healthScores.map((entry, i) => (
                  <li key={i} className="text-sm text-gray-300 font-mono">
                    {entry}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── Next Up (Backlog) ── */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-3">
          Next Up{" "}
          <span className="text-sm font-normal text-gray-500">
            {readyTasks.length} ready / {backlog.length} total
          </span>
        </h2>
        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg overflow-hidden">
          {readyTasks.length === 0 ? (
            <p className="text-gray-500 text-sm p-4">No tasks in backlog</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium w-8">P</th>
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody>
                {readyTasks.slice(0, 8).map((task) => (
                  <tr
                    key={task.id}
                    className="border-b border-gray-700/50"
                  >
                    <td className="px-4 py-3 text-gray-400 font-mono">
                      {task.priority}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{task.title}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${typeColor(task.type)}`}
                      >
                        {task.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{task.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Recent Activity ── */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-3">Recent Activity</h2>
        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
          {recentActivity.length === 0 ? (
            <p className="text-gray-500 text-sm">No activity recorded yet</p>
          ) : (
            <ul className="space-y-1">
              {recentActivity.map((entry, i) => (
                <li key={i} className="text-sm text-gray-300 font-mono">
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Known Issues ── */}
      {knownIssues.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">
            Known Issues{" "}
            <span className="text-xs bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full">
              {knownIssues.length}
            </span>
          </h2>
          <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
            <ul className="space-y-1">
              {knownIssues.map((issue, i) => (
                <li key={i} className="text-sm text-amber-300">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <p className="text-xs text-gray-600 text-center mt-8">
        Reads from claude-progress.txt, feature-backlog.json, agent-heartbeat.json, and /api/stats.
        Refresh to update.
      </p>
    </main>
  );
}
