import AuditAutoRefresh from "@/components/AuditAutoRefresh";
import AuditSnapshotPicker from "@/components/AuditSnapshotPicker";
import { notFound } from "next/navigation";
import { AuditNotFoundError, isAuditSelector } from "@/lib/auditSelection";
import Link from "next/link";
import MetricCard from "@/components/MetricCard";
import SectionHeader from "@/components/SectionHeader";
import { getAuditDashboardData } from "@/lib/audit";
import {
  formatDateEastern,
  formatDateTimeEastern,
  formatPoints,
  formatSigned,
  trendColorClass,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

function changeTone(tone: string) {
  if (tone === "POSITIVE") return "border-emerald-900/70 bg-emerald-950/20 text-emerald-200";
  if (tone === "NEGATIVE") return "border-red-900/70 bg-red-950/20 text-red-200";
  if (tone === "WARNING") return "border-amber-900/70 bg-amber-950/20 text-amber-200";
  return "border-neutral-800 bg-neutral-900 text-neutral-300";
}

function recommendationTone(kind: string) {
  if (kind === "KEEP") return "text-emerald-300 border-emerald-900/70 bg-emerald-950/20";
  if (kind === "CHANGE") return "text-red-300 border-red-900/70 bg-red-950/20";
  return "text-amber-300 border-amber-900/70 bg-amber-950/20";
}

function AuditTrend({
  rows,
}: {
  rows: Awaited<ReturnType<typeof getAuditDashboardData>>["snapshots"];
}) {
  const ordered = [...rows].reverse().slice(-30);
  if (ordered.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950 p-5 text-xs text-neutral-600">
        Trend lines will appear after the second validated daily snapshot.
      </div>
    );
  }
  const values = ordered.map((row) => row.teamValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = ordered
    .map((row, index) => {
      const x = 18 + (index / Math.max(1, ordered.length - 1)) * 664;
      const y = 178 - ((row.teamValue - min) / range) * 140;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <svg
        viewBox="0 0 700 215"
        className="min-w-[620px]"
        role="img"
        aria-label="Orlando Oswalds total dynasty capital by audit snapshot"
      >
        {[38, 73, 108, 143, 178].map((y) => (
          <line key={y} x1="18" x2="682" y1={y} y2={y} stroke="#262626" />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#34d399"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {ordered.map((row, index) => {
          const x = 18 + (index / Math.max(1, ordered.length - 1)) * 664;
          const y = 178 - ((row.teamValue - min) / range) * 140;
          return (
            <g key={row.snapshotId ?? row.generatedAt}>
              <circle cx={x} cy={y} r="4" fill="#34d399" />
              {(index === 0 || index === ordered.length - 1) && (
                <text
                  x={x}
                  y={index === 0 ? Math.min(201, y + 18) : Math.max(18, y - 10)}
                  textAnchor={index === 0 ? "start" : "end"}
                  fill="#a3a3a3"
                  fontSize="10"
                >
                  {formatPoints(row.teamValue)} · #{row.teamRank}
                </text>
              )}
            </g>
          );
        })}
        <text x="18" y="207" fill="#737373" fontSize="9">
          {ordered[0]?.snapshotDate}
        </text>
        <text x="682" y="207" textAnchor="end" fill="#737373" fontSize="9">
          {ordered.at(-1)?.snapshotDate}
        </text>
      </svg>
    </div>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedDate = Array.isArray(query.date) ? query.date[0] : query.date;
  if (!isAuditSelector(requestedDate)) notFound();
  const { data, snapshots, isLivePreview } = await getAuditDashboardData(requestedDate).catch(error => {
    if (error instanceof AuditNotFoundError) notFound();
    throw error;
  });
  const dateQuery = `?date=${encodeURIComponent(data.snapshotId ?? data.snapshotDate)}`;
  const allIncomplete = data.league.some((team) => !team.capitalComplete);
  const historicalFindings = [
    {
      kind: "CHANGE",
      title: "Raise the bar when consolidating",
      detail:
        "The deep historical audit found Orlando Oswalds received the best single asset in only 34% of Dynasty Bois trades. Consolidation should produce a clear best-player outcome.",
    },
    {
      kind: "CHANGE",
      title: "Avoid paying for last season's production",
      detail:
        "Trades led by prior-season starters and aging veterans were among Orlando Oswalds' weakest historical groups. Current role and price matter more than the old headline.",
    },
    {
      kind: "KEEP",
      title: "Keep targeting young players and quarterbacks",
      detail:
        "Those were Orlando Oswalds' strongest historical trade patterns in this Superflex league, especially when the incoming asset was already rising.",
    },
    {
      kind: "KEEP",
      title: "Keep the strong roster discipline",
      detail:
        "Orlando Oswalds' Dynasty Bois drops became top-150 assets less often than the league average in the source audit.",
    },
  ];

  return (
    <div className="min-w-0 space-y-7">
      <AuditAutoRefresh enabled={!requestedDate} />
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-400">
            Orlando Oswalds
          </div>
          <h1 className="mt-1 text-xl font-semibold text-neutral-100 sm:text-2xl">
            Dynasty Bois Audit
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">
            A saved daily view of Orlando Oswalds, every league team, roster construction,
            future picks, activity, changes and long-term trends. The page and both
            downloads use the same validated snapshot.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isLivePreview && <><a
            href={`/api/export/audit.xlsx${dateQuery}`}
            className="rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-300"
          >
            Download Excel
          </a>
          <a
            href={`/api/export/audit.pdf${dateQuery}`}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300"
          >
            Download PDF
          </a></>}
          <Link href="/audit/report" className="rounded-md border border-emerald-800 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-300">View full report</Link>
          <Link href="/audit/research" className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-500">Browse full research</Link>
        </div>
      </section>

      {isLivePreview ? (
        <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
          This is a live preview because no validated audit snapshot exists for the
          selected date. It is viewable, but it will not enter the trend history
          until a successful refresh passes roster, market, pick and projection
          checks.
        </div>
      ) : null}

      <section>
        <SectionHeader
          title={`Snapshot ${formatDateEastern(`${data.snapshotDate}T12:00:00Z`)}`}
          description={`Generated ${formatDateTimeEastern(data.generatedAt)} · refresh ${data.health.latestRefreshStatus ?? "unknown"} · ${data.health.rosteredPlayers} league players tracked.`}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <MetricCard
            label="Total capital"
            value={formatPoints(data.team.totalDynastyValue)}
            detail={`${allIncomplete ? "~" : ""}#${data.team.totalRank}/${data.league.length}`}
          />
          <MetricCard
            label="Player capital"
            value={formatPoints(data.team.playerCapital)}
            detail={`${allIncomplete ? "~" : ""}#${data.team.playerRank}`}
          />
          <MetricCard
            label="Draft capital"
            value={formatPoints(data.team.draftCapital)}
            detail={`#${data.team.draftRank} · ${data.team.draftPickCount} picks`}
          />
          <MetricCard
            label="Start-eligible"
            value={formatPoints(data.team.optimalLineupValue)}
            detail={`${allIncomplete ? "~" : ""}#${data.team.lineupRank}`}
          />
          <MetricCard
            label="Depth"
            value={formatPoints(data.team.depthValue)}
            detail={`${allIncomplete ? "~" : ""}#${data.team.depthRank}`}
          />
          <MetricCard
            label="7-day"
            value={formatSigned(data.team.change7d)}
            tone={
              data.team.change7d === null || data.team.change7d === 0
                ? "neutral"
                : data.team.change7d > 0
                  ? "positive"
                  : "negative"
            }
          />
          <MetricCard
            label="Projection coverage"
            value={`${Math.round(data.projection.coverage * 100)}%`}
            tone={data.health.projectionReady ? "positive" : "warning"}
            detail={`${data.projection.classified}/${data.projection.rosteredSkillPlayers} classified`}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="What changed"
          description="Material differences from the immediately preceding validated audit snapshot."
        />
        <div className="grid gap-2 lg:grid-cols-2">
          {data.changes.length ? (
            data.changes.map((change, index) => (
              <div
                key={`${change.category}-${change.title}-${index}`}
                className={`rounded-lg border p-3 ${changeTone(change.tone)}`}
              >
                <div className="text-[9px] font-medium uppercase tracking-wide opacity-70">
                  {change.category}
                </div>
                <div className="mt-1 text-xs font-semibold">{change.title}</div>
                <div className="mt-1 text-[11px] leading-5 opacity-80">
                  {change.detail}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-500">
              No material changes from the preceding snapshot.
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Capital trend"
          description="Validated snapshots only. Failed refreshes leave the most recent good audit untouched."
        />
        <AuditTrend rows={snapshots} />
      </section>

      <section>
        <SectionHeader
          title="Position strength"
          description="Start-eligible market capital by position, with IR and taxi excluded from the starter calculation."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {POSITIONS.map((position) => (
            <div
              key={position}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-200">
                  {position}
                </span>
                <span className="text-[10px] text-neutral-600">
                  #{data.team.positionRanks[position]}/{data.league.length}
                </span>
              </div>
              <div className="mt-2 text-xl font-semibold text-neutral-100">
                {formatPoints(data.team.positionalStarterValue[position] ?? 0)}
              </div>
              <div className="mt-1 text-[9px] text-neutral-600">
                depth {formatPoints(data.team.positionalDepthValue[position] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Every team in Dynasty Bois"
          description={
            allIncomplete
              ? "Ranks are provisional because at least one roster has an unknown current market value. Unknown is never treated as a verified zero."
              : "Player and pick coverage is complete for the current comparison."
          }
        />
        <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
          <table className="w-full min-w-[920px] text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Players</th>
                <th className="px-3 py-2 text-right">Picks</th>
                <th className="px-3 py-2 text-right">Lineup</th>
                <th className="px-3 py-2 text-right">Depth</th>
                <th className="px-3 py-2 text-right">QB/RB/WR/TE</th>
                <th className="px-3 py-2 text-right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {data.league.map((team) => (
                <tr
                  key={team.managerId}
                  className={`border-t border-neutral-800 ${team.managerId === data.team.managerId ? "bg-emerald-950/15" : ""}`}
                >
                  <td className="px-3 py-2.5 text-neutral-200">
                    <Link href={`/league/${team.managerId}`} className="font-medium">
                      {allIncomplete ? "~" : ""}#{team.totalRank} {team.teamName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-200">
                    {formatPoints(team.totalDynastyValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-400">
                    {formatPoints(team.playerCapital)} <span className="text-neutral-700">#{team.playerRank}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-400">
                    {formatPoints(team.draftCapital)} <span className="text-neutral-700">#{team.draftRank}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-400">
                    {formatPoints(team.optimalLineupValue)} <span className="text-neutral-700">#{team.lineupRank}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-400">
                    {formatPoints(team.depthValue)} <span className="text-neutral-700">#{team.depthRank}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-500">
                    {POSITIONS.map((position) => team.positionRanks[position]).join(" / ")}
                  </td>
                  <td className="px-3 py-2.5 text-right text-neutral-500">
                    {team.valuedPlayerCount}/{team.playerCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Orlando Oswalds roster"
          description="Current ownership, roster slot, KTC value and comparable 7-day and 30-day changes."
        />
        <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wide text-neutral-600">
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-left">Pos</th>
                <th className="px-3 py-2 text-left">NFL</th>
                <th className="px-3 py-2 text-left">Slot</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-right">7-day</th>
                <th className="px-3 py-2 text-right">30-day</th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((player) => (
                <tr key={player.playerId} className="border-t border-neutral-800">
                  <td className="px-3 py-2.5 font-medium text-neutral-200">
                    <Link href={`/players/${player.playerId}`}>{player.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-neutral-500">{player.position}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{player.nflTeam ?? "FA"}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{player.slot}</td>
                  <td className="px-3 py-2.5 text-right text-neutral-300">{formatPoints(player.value)}</td>
                  <td className={`px-3 py-2.5 text-right ${trendColorClass(player.change7d)}`}>{formatSigned(player.change7d)}</td>
                  <td className={`px-3 py-2.5 text-right ${trendColorClass(player.change30d)}`}>{formatSigned(player.change30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section>
          <SectionHeader
            title="Future picks"
            description="Current ownership with the same conservative pick-pricing hierarchy used throughout the dashboard."
          />
          <div className="space-y-2">
            {data.picks.length ? (
              data.picks.map((pick) => (
                <div key={pick.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-neutral-200">{pick.label}</div>
                      <div className="mt-1 text-[9px] text-neutral-600">projected slot {pick.projectedSlot} · original {pick.originTeamName}</div>
                    </div>
                    <div className="text-sm font-semibold text-neutral-200">{formatPoints(pick.value)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs text-neutral-500">No validated pick inventory is available.</div>
            )}
          </div>
        </section>

        <section>
          <SectionHeader
            title="Manager activity"
            description="Recorded Dynasty Bois trades, waiver claims, free-agent additions and drops by season."
          />
          <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-neutral-600">
                  <th className="px-3 py-2 text-left">Season</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Waivers</th>
                  <th className="px-3 py-2 text-right">FA adds</th>
                  <th className="px-3 py-2 text-right">Drops</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((row) => (
                  <tr key={row.season} className="border-t border-neutral-800">
                    <td className="px-3 py-2.5 text-neutral-200">{row.season}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-400">{row.trades}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-400">{row.waiverClaims}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-400">{row.freeAgentAdds}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-400">{row.drops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section>
        <SectionHeader
          title="Current recommendations"
          description="Rules-based prompts from the selected snapshot. Review the underlying roster and market evidence before acting."
        />
        <div className="grid gap-2 lg:grid-cols-2">
          {data.recommendations.map((row) => (
            <div key={`${row.kind}-${row.title}`} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className={`text-[9px] font-semibold uppercase tracking-wide ${row.kind === "KEEP" ? "text-emerald-400" : row.kind === "CHANGE" ? "text-red-400" : "text-amber-400"}`}>
                {row.kind}
              </div>
              <div className="mt-1 text-xs font-semibold text-neutral-200">{row.title}</div>
              <div className="mt-1 text-[11px] leading-5 text-neutral-500">{row.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Historical Orlando Oswalds findings"
          description="Durable findings carried forward from the 81-sheet Dynasty Bois source audit generated on September 23, 2026."
        />
        <div className="grid gap-2 lg:grid-cols-2">
          {historicalFindings.map((row) => (
            <div key={row.title} className={`rounded-lg border p-3 ${recommendationTone(row.kind)}`}>
              <div className="text-[9px] font-semibold uppercase tracking-wide">{row.kind}</div>
              <div className="mt-1 text-xs font-semibold text-neutral-100">{row.title}</div>
              <div className="mt-1 text-[11px] leading-5 text-neutral-400">{row.detail}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="mr-auto max-w-2xl text-[10px] leading-5 text-neutral-500">
            The September 23 source package remains available in its original
            form for every underlying table and the complete long-form report.
            The live downloads above are rebuilt from the selected saved website
            snapshot; these reference files preserve the original 81-sheet audit.
          </div>
          <a
            href="/audit/dynasty-bois-source-audit.xlsx"
            className="h-fit rounded-md border border-neutral-700 px-3 py-2 text-[10px] text-neutral-300"
          >
            Source Excel
          </a>
          <a
            href="/audit/dynasty-bois-source-audit.pdf"
            className="h-fit rounded-md border border-neutral-700 px-3 py-2 text-[10px] text-neutral-300"
          >
            Source PDF
          </a>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Snapshot history"
          description="Open an earlier date to view and download the exact audit saved after that refresh."
        />
        {snapshots.length ? (
          <AuditSnapshotPicker
            selectedId={data.snapshotId ?? null}
            options={snapshots.map((snapshot) => ({
              id: snapshot.snapshotId ?? snapshot.snapshotDate,
              date: snapshot.snapshotDate,
              label: `${formatDateTimeEastern(snapshot.generatedAt)} · #${snapshot.teamRank} · ${formatPoints(snapshot.teamValue)}`,
            }))}
          />
        ) : (
          <div className="text-xs text-neutral-600">The first validated snapshot will be saved after a healthy refresh.</div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[10px] leading-5 text-neutral-500">
        <div className="font-semibold text-neutral-300">Audit method and validation</div>
        <p className="mt-1">
          The 8 a.m. refresh saves a new audit only after roster, current market,
          future-pick ownership, pick pricing and weekly projection checks pass.
          A failed run leaves the previous validated snapshot in place. Unknown
          player values remain unknown, and forecast metrics stay hidden until at
          least 75% of rostered skill players have current-week projection or
          explicit withholding records.
        </p>
      </section>
    </div>
  );
}
