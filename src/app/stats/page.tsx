import Link from "next/link";

// ---------------------------------------------------------------------------
// Types — matches the actual shape returned by /api/stats
// ---------------------------------------------------------------------------

interface Interaction {
  id: string;
  timestamp: string;
  tweetId: string;
  authorUsername: string;
  ocrSuccess: boolean;
  ocrCardsExtracted: number;
  mainboardCount: number;
  sideboardCount: number;
  scryfallCardsNotFound: string[];
  totalTimeMs: number;
  replyFormatVariant: string;
  replySent: boolean;
  errors: Array<{ type: string; message: string }>;
}

interface ApiResponse {
  interactions: Interaction[];
  summary: {
    total: number;
    successes: number;
    failures: number;
    avgTotalTimeMs: number | null;
    variantDistribution: Record<string, number>;
  };
}

// Computed view model for rendering
interface StatsView {
  totalInteractions: number;
  successRate: number;
  avgResponseTimeMs: number;
  recentRuns: {
    timestamp: string;
    author: string;
    mainboardCount: number;
    issues: string[];
    variant: string;
    tweetUrl: string | null;
    latencyMs: number;
    success: boolean;
  }[];
  errors: {
    type: string;
    message: string;
    timestamp: string;
    tweetUrl: string | null;
  }[];
  abResults: {
    variant: string;
    count: number;
    successRate: number;
    avgLatencyMs: number;
  }[];
}

function transformApiResponse(raw: ApiResponse): StatsView {
  const { interactions, summary } = raw;

  const recentRuns = interactions.map((ix) => ({
    timestamp: ix.timestamp,
    author: ix.authorUsername ?? "unknown",
    mainboardCount: ix.mainboardCount,
    issues: ix.errors.map((e) => e.message),
    variant: ix.replyFormatVariant ?? "-",
    tweetUrl: ix.tweetId ? `https://x.com/i/status/${ix.tweetId}` : null,
    latencyMs: ix.totalTimeMs,
    success: ix.ocrSuccess && ix.replySent,
  }));

  const errors = interactions
    .flatMap((ix) =>
      ix.errors.map((e) => ({
        type: e.type,
        message: e.message,
        timestamp: ix.timestamp,
        tweetUrl: ix.tweetId ? `https://x.com/i/status/${ix.tweetId}` : null,
      }))
    );

  // Compute A/B variant stats
  const variantMap = new Map<string, { count: number; successes: number; totalMs: number }>();
  for (const ix of interactions) {
    const v = ix.replyFormatVariant ?? "base";
    const entry = variantMap.get(v) ?? { count: 0, successes: 0, totalMs: 0 };
    entry.count++;
    if (ix.ocrSuccess && ix.replySent) entry.successes++;
    entry.totalMs += ix.totalTimeMs;
    variantMap.set(v, entry);
  }
  const abResults = Array.from(variantMap.entries()).map(([variant, v]) => ({
    variant,
    count: v.count,
    successRate: v.count > 0 ? (v.successes / v.count) * 100 : 0,
    avgLatencyMs: v.count > 0 ? v.totalMs / v.count : 0,
  }));

  return {
    totalInteractions: summary.total,
    successRate: summary.total > 0 ? (summary.successes / summary.total) * 100 : 0,
    avgResponseTimeMs: summary.avgTotalTimeMs ?? 0,
    recentRuns,
    errors,
    abResults,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function rateColor(rate: number): string {
  if (rate >= 90) return "text-green-400";
  if (rate >= 70) return "text-yellow-400";
  return "text-red-400";
}

function formatMs(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  let data: StatsView | null = null;

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000";

    const res = await fetch(`${baseUrl}/api/stats?hours=168`, {
      cache: "no-store",
    });

    if (res.ok) {
      const raw: ApiResponse = await res.json();
      data = transformApiResponse(raw);
    }
  } catch {
    // API not available — show empty state
  }

  // Empty state
  if (!data || data.totalInteractions === 0) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link
          href="/"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          &larr; Back to Deck Viewer
        </Link>
        <h1 className="text-2xl font-bold text-white mt-6 mb-2">Bot Stats</h1>
        <div className="mt-12 text-center">
          <p className="text-gray-500 text-lg">No data yet</p>
          <p className="text-gray-600 text-sm mt-2">
            Stats will appear here once the bot starts processing tweets.
          </p>
        </div>
      </main>
    );
  }

  const {
    totalInteractions,
    successRate,
    avgResponseTimeMs,
    recentRuns,
    errors,
    abResults,
  } = data;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        &larr; Back to Deck Viewer
      </Link>

      <h1 className="text-2xl font-bold text-white mt-6 mb-6">
        Bot Stats{" "}
        <span className="text-sm font-normal text-gray-500">Last 7 days</span>
      </h1>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Total Interactions
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {totalInteractions}
          </p>
        </div>

        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Success Rate
          </p>
          <p className={`text-2xl font-bold mt-1 ${rateColor(successRate)}`}>
            {successRate.toFixed(1)}%
          </p>
        </div>

        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Avg Response Time
          </p>
          <p className="text-2xl font-bold text-white mt-1">
            {formatMs(avgResponseTimeMs)}
          </p>
        </div>

        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Errors
          </p>
          <p className={`text-2xl font-bold mt-1 ${errors.length === 0 ? "text-green-400" : "text-red-400"}`}>
            {errors.length}
          </p>
        </div>
      </div>

      {/* ── Recent Runs ── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">
          Recent Runs{" "}
          <span className="text-sm font-normal text-gray-500">Last 24h</span>
        </h2>
        <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Author</th>
                <th className="px-4 py-3 font-medium">Cards</th>
                <th className="px-4 py-3 font-medium">Issues</th>
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium">Reply</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-gray-500"
                  >
                    No runs in the last 24 hours.
                  </td>
                </tr>
              ) : (
                recentRuns.map((run, i) => {
                  const hasErrors = run.issues.length > 0;
                  const rowClass = hasErrors
                    ? "border-b border-gray-700/50 bg-red-900/10"
                    : "border-b border-gray-700/50";

                  return (
                    <tr key={i} className={rowClass}>
                      <td className="px-4 py-3 text-gray-300">
                        {relativeTime(run.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        @{run.author}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {run.mainboardCount}
                      </td>
                      <td
                        className={`px-4 py-3 ${hasErrors ? "text-amber-400" : "text-green-400"}`}
                      >
                        {hasErrors ? run.issues.length : "OK"}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {run.variant || "-"}
                      </td>
                      <td className="px-4 py-3">
                        {run.tweetUrl ? (
                          <a
                            href={run.tweetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── A/B Results ── */}
      {abResults.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">A/B Results</h2>
          <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Variant</th>
                  <th className="px-4 py-3 font-medium">Count</th>
                  <th className="px-4 py-3 font-medium">Success Rate</th>
                  <th className="px-4 py-3 font-medium">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {abResults.map((v, i) => (
                  <tr key={i} className="border-b border-gray-700/50">
                    <td className="px-4 py-3 text-white font-medium">
                      {v.variant}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{v.count}</td>
                    <td
                      className={`px-4 py-3 ${rateColor(v.successRate)}`}
                    >
                      {v.successRate.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {formatMs(v.avgLatencyMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Error Log ── */}
      <section>
        <details className="group">
          <summary className="text-lg font-semibold text-white mb-3 cursor-pointer list-none flex items-center gap-2">
            <span className="text-gray-500 group-open:rotate-90 transition-transform">
              &#9654;
            </span>
            Error Log
            {errors.length > 0 && (
              <span className="text-xs bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">
                {errors.length}
              </span>
            )}
          </summary>

          {errors.length === 0 ? (
            <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg px-4 py-6 text-center text-gray-500">
              No errors recorded.
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {errors.slice(0, 20).map((err, i) => (
                <div
                  key={i}
                  className="bg-gray-900/80 border border-gray-700/50 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-red-400 font-mono text-xs bg-red-900/30 px-2 py-0.5 rounded">
                      {err.type}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {relativeTime(err.timestamp)}
                    </span>
                    {err.tweetUrl && (
                      <a
                        href={err.tweetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-xs transition-colors ml-auto"
                      >
                        Tweet
                      </a>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm mt-1">{err.message}</p>
                </div>
              ))}
            </div>
          )}
        </details>
      </section>
    </main>
  );
}
