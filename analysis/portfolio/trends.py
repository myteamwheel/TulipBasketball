"""Season-by-season trends for every manager in every league-season: moves (trades, waiver claims, free-agent adds, drops, failed
claims, FAAB, rookie picks), trade results (judged in context), what was traded for, the roster at Week 1 (age, value rank,
positions, rookies, athleticism) and results (record, points, rank, titles). Brett is compared with the league-mates who shared
the same league-seasons."""
import json, os
import numpy as np, pandas as pd
from common import *
import values as VAL

H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
FMT = {l: f for l, _, f in LEAGUES}
NOW = pd.Timestamp(AS_OF_DATE)
KICK = {2021: "2021-09-09", 2022: "2022-09-08", 2023: "2023-09-07", 2024: "2024-09-05", 2025: "2025-09-04", 2026: "2026-09-10"}
PH = VAL.PH
ATH = pd.read_parquet(os.path.join(OUT, "athletic.parquet")).set_index("player_id").athletic
S = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
X = pd.read_parquet(os.path.join(OUT, "trade_ledger.parquet")); X = X[X.active]
FC = pd.read_parquet(os.path.join(OUT, "failed_claims.parquet"))
E = pd.read_parquet(os.path.join(OUT, "add_events.parquet"))
RDP = pd.read_parquet(os.path.join(OUT, "rookie_picks.parquet"))
WR = pd.read_parquet(os.path.join(OUT, "weekly_results.parquet"))
titles = {(t["league"], int(t["season"])): t["champion_owner"] for t in json.load(open(os.path.join(OUT, "titles.json")))}

# who ran each roster in each league-season
own, names = {}, {}
for label, chain in chains.items():
    for season, lid in chain:
        for r in json.load(open(os.path.join(H, lid, "rosters.json"))): own[(label, int(season), r["roster_id"])] = r.get("owner_id")
        for u in json.load(open(os.path.join(H, lid, "users.json"))): names[u["user_id"]] = u.get("display_name") or u["user_id"]
LS = sorted({(l, s) for l, s, _ in own})

S["reversal"] = (S.days * 24 < 1) & (S.end_method != "Still rostered")
Sx = S[~S.reversal]
rows = []
for (l, s) in LS:
    n = FMT[l]["teams"]; sf = FMT[l]["sf"]
    kick = pd.Timestamp(KICK.get(s, f"{s}-09-08"))
    rosters = [(rid, o) for (ll, ss, rid), o in own.items() if ll == l and ss == s]
    # roster at Week 1 (for 2021 startups, and any season: whoever was on the roster at kickoff)
    on = S[(S.league == l) & (S.start < kick) & (S.end.fillna(NOW + pd.Timedelta(days=1)) >= kick)]
    val = on.player_id.map(lambda p: VAL.player_value(p, kick, sf))
    on = on.assign(v=val.fillna(0), age=(kick - on.player_id.map(PH.birth_date)).dt.days / 365.25, pos=on.player_id.map(PH.pos),
                   rookie=on.player_id.map(PH.rookie_season) == s, ath=on.player_id.map(ATH))
    tot = on.groupby("roster_id").v.sum(); vrank = tot.rank(ascending=False, method="min")
    # regular-season results
    wr = WR[(WR.league == l) & (WR.season == s)]
    rec = wr.groupby("roster_id").agg(w=("win", "sum"), g=("win", "size"), pf=("pf", "sum"))
    if len(rec): rec["rank"] = rec.w.mul(10000).add(rec.pf).rank(ascending=False, method="first")      # wins, then points for
    for rid, o in rosters:
        if o is None: continue
        me = o == ME
        x = X[(X.league == l) & (X.season == s) & (X.roster_id == rid) & (X.manager == o)]
        st_in = Sx[(Sx.league == l) & (Sx.start_season == s) & (Sx.roster_id == rid) & (Sx.owner == o)]
        st_out = Sx[(Sx.league == l) & (Sx.end_season == s) & (Sx.roster_id == rid) & (Sx.owner == o)]
        r_on = on[on.roster_id == rid]
        rows.append(dict(league=l, season=s, roster_id=rid, owner=o, manager=names.get(o, o), is_me=me, n_teams=n,
                         trades=int(x.tid.nunique()), trade_wins=int((x.ctx_net > 0).sum()), trade_losses=int((x.ctx_net < 0).sum()),
                         big_wins=int((x.ctx_net >= 1500).sum()), big_losses=int((x.ctx_net <= -1500).sum()), trade_result_ctx=float(x.ctx_net.sum()),
                         trade_result_value=float(x.net_now.sum()), trade_value_on_day=float(x.net_then.sum()), trade_points_12m=float(x.pts_net.sum()),
                         avg_age_received=float(x.age_in.mean()) if x.age_in.notna().any() else np.nan, avg_age_sent=float(x.age_out.mean()) if x.age_out.notna().any() else np.nan,
                         players_received=int(x.n_in.sum()), players_sent=int(x.n_out.sum()),
                         picks_received=int(x.got.str.count(r"\d{4} \d(?:st|nd|rd|th)").sum()), picks_sent=int(x.gave.str.count(r"\d{4} \d(?:st|nd|rd|th)").sum()),
                         waiver_claims=int((st_in.start_method == "Waiver claim").sum()), fa_adds=int((st_in.start_method == "Free-agent add").sum()),
                         drops=int((st_out.end_method == "Dropped").sum()),
                         failed_claims=int(((FC.league == l) & (FC.season == s) & (FC.owner == o)).sum()),
                         faab_spent=float(E[(E.league == l) & (E.season == s) & (E.roster_owner == o) & (E.method == "Waiver claim")].faab.fillna(0).sum()),
                         rookie_picks_made=int(((RDP.league == l) & (RDP.season == s) & (RDP.picker == rid)).sum()),
                         wk1_players=len(r_on), wk1_avg_age=float(r_on.age.mean()) if len(r_on) else np.nan,
                         wk1_value_age=float(np.average(r_on.age[r_on.v > 0], weights=r_on.v[r_on.v > 0])) if (r_on.v > 0).any() else np.nan,
                         wk1_value=float(r_on.v.sum()), wk1_value_rank=float(vrank.get(rid, np.nan)), wk1_rookies=int(r_on.rookie.sum()),
                         wk1_qb_share=float(r_on[r_on.pos == "QB"].v.sum() / r_on.v.sum()) if r_on.v.sum() else np.nan,
                         wk1_rb_share=float(r_on[r_on.pos == "RB"].v.sum() / r_on.v.sum()) if r_on.v.sum() else np.nan,
                         wk1_wr_share=float(r_on[r_on.pos == "WR"].v.sum() / r_on.v.sum()) if r_on.v.sum() else np.nan,
                         wk1_te_share=float(r_on[r_on.pos == "TE"].v.sum() / r_on.v.sum()) if r_on.v.sum() else np.nan,
                         wk1_tes=int((r_on.pos == "TE").sum()), wk1_qbs=int((r_on.pos == "QB").sum()), wk1_athletic=float(r_on.ath.mean()) if r_on.ath.notna().any() else np.nan,
                         wins=float(rec.w.get(rid, np.nan)) if len(rec) else np.nan, games=int(rec.g.get(rid, 0)) if len(rec) else 0,
                         points_for=float(rec.pf.get(rid, np.nan)) if len(rec) else np.nan, finish=float(rec["rank"].get(rid, np.nan)) if len(rec) else np.nan,
                         champion=titles.get((l, s)) == o))
M = pd.DataFrame(rows)
M["moves"] = M.trades + M.waiver_claims + M.fa_adds
M["win_pct"] = M.wins / M.games.replace(0, np.nan)
M.to_parquet(os.path.join(OUT, "trends_manager_season.parquet"))

# ---------------- Brett vs league-mates in his league-seasons ----------------
mine = M[M.is_me][["league", "season"]].drop_duplicates()
MM = M.merge(mine, on=["league", "season"])
METRICS = ["trades", "trade_wins", "trade_losses", "big_wins", "big_losses", "trade_result_ctx", "trade_result_value", "trade_points_12m", "avg_age_received", "avg_age_sent",
           "picks_received", "picks_sent", "waiver_claims", "fa_adds", "drops", "failed_claims", "faab_spent", "rookie_picks_made", "moves", "wk1_avg_age", "wk1_value_age",
           "wk1_value_rank", "wk1_rookies", "wk1_qb_share", "wk1_rb_share", "wk1_wr_share", "wk1_te_share", "wk1_tes", "wk1_qbs", "wk1_athletic", "wins", "win_pct", "points_for", "finish"]
by_ls = []
for (l, s), g in MM.groupby(["league", "season"]):
    b = g[g.is_me].iloc[0]; o = g[~g.is_me]
    for m in METRICS:
        rank = int((g[m] > b[m]).sum() + 1) if pd.notna(b[m]) else None
        by_ls.append(dict(league=l, season=int(s), metric=m, brett=float(b[m]) if pd.notna(b[m]) else None, league_avg=float(o[m].mean()) if o[m].notna().any() else None,
                          rank=rank, of=int(g[m].notna().sum())))
BLS = pd.DataFrame(by_ls)
# per season: Brett's per-league-season average vs league-mates' average over the same league-seasons; plus Brett's totals
per_season = []
for s, g in MM.groupby("season"):
    b = g[g.is_me]; o = g[~g.is_me]
    d = dict(season=int(s), leagues=int(b.league.nunique()), league_list=", ".join(sorted(b.league)))
    for m in METRICS:
        d[f"brett_{m}"] = float(b[m].mean()) if b[m].notna().any() else None
        d[f"lm_{m}"] = float(o[m].mean()) if o[m].notna().any() else None
    for m in ["trades", "trade_wins", "trade_losses", "big_wins", "big_losses", "trade_result_ctx", "trade_result_value", "trade_points_12m", "picks_received", "picks_sent",
              "waiver_claims", "fa_adds", "drops", "failed_claims", "faab_spent", "rookie_picks_made", "moves"]:
        d[f"brett_total_{m}"] = float(b[m].sum())
    d["titles"] = int(b.champion.sum())
    per_season.append(d)
PS = pd.DataFrame(per_season)
R = dict(per_season=PS.to_dict("records"), by_league_season=BLS.to_dict("records"),
         brett_rows=M[M.is_me].sort_values(["season", "league"]).to_dict("records"))
json.dump(R, open(os.path.join(OUT, "analysis_trends.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
show = ["season", "leagues", "brett_trades", "lm_trades", "brett_waiver_claims", "lm_waiver_claims", "brett_fa_adds", "lm_fa_adds", "brett_drops", "lm_drops", "brett_total_trades",
        "brett_total_waiver_claims", "brett_total_fa_adds", "brett_total_drops"]
print(PS[show].round(1).to_string())
print(PS[["season", "brett_trade_wins", "brett_trade_losses", "brett_total_trade_result_ctx", "brett_avg_age_received", "lm_avg_age_received", "brett_picks_received", "lm_picks_received",
          "brett_wk1_avg_age", "lm_wk1_avg_age", "brett_wk1_value_rank", "brett_wk1_rookies", "lm_wk1_rookies", "brett_win_pct", "lm_win_pct", "brett_finish", "titles"]].round(2).to_string())
print(M[M.is_me][["league", "season", "trades", "waiver_claims", "fa_adds", "drops", "trade_result_ctx", "wk1_avg_age", "wk1_value_rank", "wins", "finish", "champion"]].round(1).to_string())
