import { getStoredPerformance } from "@/lib/playerStats";

function gradeTone(score: number) {
  if (score >= 84) return "text-emerald-300";
  if (score < 56) return "text-red-300";
  if (score < 68) return "text-amber-300";
  return "text-neutral-200";
}

function gameLine(game: Awaited<ReturnType<typeof getStoredPerformance>>["games"][number], position: string) {
  if (position === "QB") {
    return `${Number(game.completions)}/${Number(game.attempts)}, ${Math.round(Number(game.passingYards))} pass yds, ${Number(game.passingTds)} pass TD, ${Number(game.interceptions)} INT${Number(game.rushingYards) || Number(game.rushingTds) ? ` · ${Math.round(Number(game.rushingYards))} rush yds${Number(game.rushingTds) ? `, ${Number(game.rushingTds)} TD` : ""}` : ""}`;
  }
  const parts: string[] = [];
  if (Number(game.carries)) parts.push(`${Number(game.carries)} car, ${Math.round(Number(game.rushingYards))} rush yds${Number(game.rushingTds) ? `, ${Number(game.rushingTds)} TD` : ""}`);
  if (Number(game.targets) || Number(game.receptions)) parts.push(`${Number(game.receptions)}/${Number(game.targets)} rec, ${Math.round(Number(game.receivingYards))} yds${Number(game.receivingTds) ? `, ${Number(game.receivingTds)} TD` : ""}`);
  return parts.join(" · ") || `${Number(game.fantasyHalfPpr).toFixed(1)} half-PPR points`;
}

export default async function PlayerPerformancePanel({ playerId, position }: { playerId: string; position: string }) {
  const performance = await getStoredPerformance(playerId);
  const profile = performance.profile;
  const games = performance.games.slice(0, 20);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-neutral-600">Persistent performance history</div>
          <h3 className="mt-1 text-sm font-semibold text-neutral-100">NFL game log + grades</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-500">Pulled on every dashboard refresh. Historical regular-season/postseason games are backfilled from nflverse; current/preseason games are supplemented from Sleeper. Grades are context inputs, not automatic buy/sell commands.</p>
        </div>
        {profile && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-right text-[11px] text-neutral-400">
            <div className="font-medium text-neutral-200">Draft context</div>
            <div>{profile.draftYear ?? "—"}{profile.draftRound ? ` · Round ${profile.draftRound}` : ""}{profile.draftPick ? ` · Pick ${profile.draftPick}` : ""}</div>
            {(profile.draftTeam || profile.college) && <div className="text-neutral-600">{[profile.draftTeam, profile.college].filter(Boolean).join(" · ")}</div>}
          </div>
        )}
      </div>

      {performance.latestGame ? (
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-neutral-600">Latest recorded game</div>
              <div className="mt-1 text-sm font-semibold text-neutral-100">{performance.latestGame.season} · {performance.latestGame.seasonType === "PRE" ? "Preseason" : performance.latestGame.seasonType === "POST" ? "Postseason" : "Regular season"} · Week {performance.latestGame.week}</div>
              <div className="mt-1 text-xs text-neutral-400">{gameLine(performance.latestGame, position)} · {Number(performance.latestGame.fantasyHalfPpr).toFixed(1)} half-PPR</div>
            </div>
            <div className={`text-right ${gradeTone(Number(performance.latestGame.gradeScore))}`}>
              <div className="text-2xl font-bold">{performance.latestGame.grade}</div>
              <div className="text-[10px]">{Math.round(Number(performance.latestGame.gradeScore))}/100</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">{performance.latestGame.performanceSummary}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">No stored game rows yet. The next refresh will run the historical nflverse/Sleeper backfill and keep the results permanently.</div>
      )}

      {games.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead><tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wide text-neutral-600"><th className="py-2">Season</th><th>Week</th><th>Type</th><th>Stat line</th><th className="text-right">Half-PPR</th><th className="text-right">Grade</th><th className="text-right">Source</th></tr></thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id} className="border-b border-neutral-800/60">
                  <td className="py-2 text-neutral-300">{game.season}</td>
                  <td className="text-neutral-400">{game.week}</td>
                  <td className="text-neutral-500">{game.seasonType}</td>
                  <td className="max-w-[360px] text-neutral-400">{gameLine(game, position)}</td>
                  <td className="text-right text-neutral-300">{Number(game.fantasyHalfPpr).toFixed(1)}</td>
                  <td className={`text-right font-semibold ${gradeTone(Number(game.gradeScore))}`}>{game.grade}</td>
                  <td className="text-right text-neutral-600">{game.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
