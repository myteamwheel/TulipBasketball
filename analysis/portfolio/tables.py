"""Downloadable exports, in two packages built from the same tables:
  all leagues   exports/Dynasty-Portfolio-{Reports.pdf, Data.xlsx, Data.csv, Data.sqlite}
  Dynasty Bois  exports/Dynasty-Bois-{Report.pdf, Data.xlsx, Data.csv, Data.sqlite} -- every dataset and table filtered to the league
PDF: the reports in print layout with bookmarks and page numbers. Excel: README + data dictionary + one sheet per table. CSV: every table
in one tidy long file (report, table, row, field, value). SQLite: every table (+ weekly lineups and value history) with _tables / _columns.
"""
import io, json, os, re, sqlite3, subprocess, tempfile
import numpy as np, pandas as pd
from common import *

EXP = os.path.join(ROOT, "exports"); os.makedirs(EXP, exist_ok=True)
BUILT = AS_OF_DATE
H = os.path.join(RAW, "sleeper", "history")
chains = json.load(open(os.path.join(H, "_chains.json")))
PH = pd.read_parquet(os.path.join(OUT, "players_hist.parquet")).set_index("player_id")
REPORT_FILES = [("audit", "Six-League-Dynasty-Audit.html"), ("history", "Six-League-Ownership-History.html"), ("combine", "Six-League-Combine-Profile.html"),
                ("ledger", "Six-League-Trade-Ledger.html"), ("playbook", "Six-League-Trade-Playbook.html"), ("timeline", "Six-League-Strategy-Timeline.html"),
                ("bois", "Dynasty-Bois-Report.html"), ("fhp", "Free-Hot-Pot-Report.html")]
RNAME = {k: t for k, t, _ in REPORTS}
RURL = {k: u for k, _, u in REPORTS}
SHORT = {"reference": "REF", "audit": "AUD", "history": "HIS", "combine": "CMB", "ledger": "LED", "playbook": "PLY", "timeline": "TML", "bois": "BOI", "fhp": "FHP"}
REP_LABEL = dict(reference="Reference", **RNAME)

# ======================================================================= table registry
TABLES = []
def clean(df):
    df = df.copy()
    df.columns = [str(c) for c in df.columns]
    for c in df.columns:
        s = df[c]
        if s.dtype == object:
            def conv(x):
                if isinstance(x, (list, tuple, np.ndarray)):
                    x = list(x)
                    return "; ".join(str(i) for i in x) if all(not isinstance(i, (dict, list)) for i in x) else json.dumps(x, default=str)
                if isinstance(x, dict): return json.dumps(x, default=str)
                if isinstance(x, (np.bool_,)): return bool(x)
                return x
            df[c] = s.map(conv)
        elif str(s.dtype).startswith("datetime64") and getattr(s.dt, "tz", None) is not None:
            df[c] = s.dt.tz_localize(None)
        elif s.dtype.kind == "f":
            df[c] = s.round(6)
    return df.reset_index(drop=True)
def add(name, report, kind, desc, df, big=False):
    assert name not in {t["name"] for t in TABLES}, name
    TABLES.append(dict(name=name, report=report, kind=kind, desc=desc, df=clean(df), big=big))

# ======================================================================= reference
lg_rows = []
spots = pd.read_parquet(os.path.join(OUT, "roster_spots.parquet"))
for label, lid, f in LEAGUES:
    L = json.load(open(os.path.join(RAW, "sleeper", "current", f"league_{lid}.json")))
    myteam = spots[(spots.league == label) & spots.is_me].team.iloc[0] if ((spots.league == label) & spots.is_me).any() else None
    lg_rows.append(dict(league=label, league_name=L.get("name"), league_id_2026=lid, teams=f["teams"], superflex=f["sf"], ppr=f["ppr"], te_premium=f["tep"], pass_td_points=f["pass_td"],
                        brett_team=myteam, seasons=", ".join(s for s, _ in sorted(chains.get(label, [])) ), league_ids_by_season=json.dumps({s: i for s, i in sorted(chains.get(label, []))})))
add("leagues", "reference", "dataset", "The six Sleeper leagues: names, 2026 league IDs, format, Brett's team, and each season's league ID (Sleeper issues a new ID every season).", pd.DataFrame(lg_rows))
add("reports", "reference", "dataset", "The seven published reports and their links.",
    pd.DataFrame([dict(report=RNAME[k], url=RURL[k], file=f"report/{fn}") for k, fn in REPORT_FILES]))
TR = json.load(open(os.path.join(OUT, "analysis_trades.json")))
mg = pd.DataFrame(TR["traders_all"])[["manager", "name", "leagues", "trades", "wins", "losses", "win_rate", "total_now", "total_then", "total_delta", "pts_net", "qualified", "rank", "grade", "style", "titles"]]
add("managers", "reference", "dataset", "Every manager who has traded in the five trading leagues, with their all-league trade record and ranking (ranked only with 10+ trades).",
    mg.rename(columns={"manager": "manager_id", "name": "display_name", "total_now": "net_value_today", "total_then": "net_value_on_trade_days", "total_delta": "net_value_from_aging",
                       "pts_net": "net_lineup_points", "rank": "all_league_rank", "grade": "all_league_grade"}))

# ======================================================================= Dynasty Audit (current rosters)
PA = pd.read_parquet(os.path.join(OUT, "players_all.parquet"))
# raw per-source copies of fields that exist in cleaned form (birth_date, college, draft_year/round/pick, rookie_season)
PA = PA.drop(columns=[c for c in PA.columns if c.startswith(("dpi_", "nv_", "sl_birth", "sl_college", "sl_rookie_year")) or c in ("dp_season", "dp_round", "dp_pick", "dp_college")])
sp = spots.merge(PA[["sleeper_id", "name", "pos", "nfl_team"]], on="sleeper_id", how="left")
add("current_roster_spots", "audit", "dataset", "Every roster spot in all six leagues as pulled from Sleeper on 22 Sep 2026 (starters, bench, taxi, IR), with owner and league format.", sp)
add("current_players_all_rosters", "audit", "dataset", "Every player rostered anywhere in the six leagues (615), fully enriched: bio, NFL draft, college, production, 2026 role, FantasyCalc and DynastyProcess values, tiers, archetype.", PA)
add("current_brett_players", "audit", "dataset", "Brett's 107 unique current players with the audit's master columns (the sortable master table in the Dynasty Audit).",
    pd.read_csv(os.path.join(OUT, "master_players.csv")))
add("future_picks", "audit", "dataset", "Every 2027–2029 rookie pick in all six leagues: original team, current owner, whether Brett owns it, and its value today in context (projected slot for 2027 from the original team's roster strength; round average after that).",
    pd.read_parquet(os.path.join(OUT, "future_picks.parquet")))

# ======================================================================= Ownership history
ST = pd.read_parquet(os.path.join(OUT, "stints_enriched.parquet"))
# player details live in players_ever_rostered (join on player_id); league format in leagues
ST = ST.drop(columns=["start_ts", "end_ts", "fp_id", "sf", "n_teams", "capital", "school", "conf", "conf_tier", "college_level", "draft_pick", "draft_round", "rookie_season"])
add("ownership_stints", "history", "dataset", "Every stint of every player on every roster in the six leagues since 2021 (10,081): how and when it started and ended, values and ranks at start, end and today, points started. Player details: join players_ever_rostered on player_id.", ST)
add("brett_players_ever_owned", "history", "dataset", "Every player Brett has ever owned (468) with stints, leagues, days owned and how he got and lost them.", pd.read_csv(os.path.join(OUT, "brett_every_player_owned.csv")))
add("players_ever_rostered", "history", "dataset", "Bio, NFL draft and college for every player ever rostered in the six leagues (1,342), with Sleeper, NFL (gsis) and FantasyPros IDs.", PH.reset_index())
RDn = pd.read_parquet(os.path.join(OUT, "rookie_picks.parquet"))
RDn["player_name"] = RDn.player_id.map(PH.name); RDn["pos"] = RDn.player_id.map(PH.pos); RDn["draft_date"] = pd.to_datetime(RDn.ts, unit="ms")
add("rookie_draft_picks", "history", "dataset", "Every rookie-draft selection in the leagues' histories (startups excluded): round, overall pick, slot, original owner of the pick, who made it and who was taken.",
    RDn.drop(columns=["ts"]))

# ======================================================================= Combine
ATH = pd.read_parquet(os.path.join(OUT, "athletic.parquet"))
ATH.insert(1, "name", ATH.player_id.map(PH.name)); ATH.insert(2, "pos", ATH.player_id.map(PH.pos))
add("athletic_profiles", "combine", "dataset", "NFL combine results for every player ever rostered, with within-position percentiles against all combine participants since 2000 and the composite scores (0–1).", ATH)

# ======================================================================= Trades
X = pd.read_parquet(os.path.join(OUT, "trade_ledger.parquet"))
add("trades", "ledger", "dataset", "Every side of every trade in the leagues' histories (one row per team per trade): what it got and gave, the team's situation (contending / middle / rebuilding), value on the day, one, two and three years on and today, lineup points in the 12 months after, the context-adjusted result (ctx_net), grade, aging and consensus label. `active` = counted in the analysis.", X)
TA_ = pd.read_parquet(os.path.join(OUT, "trade_assets.parquet"))
add("trade_assets", "ledger", "dataset", "Every player and pick that changed hands in a counted trade, with its value on the trade date, one year later and today (picks valued by slot, with the basis used), and the player's age, production and value trend at the time.", TA_)
TF = pd.read_parquet(os.path.join(OUT, "trade_features.parquet"))
# outcomes and labels live in `trades` (join on tid + roster_id); keep only the keys and the features here
TF = TF.drop(columns=[c for c in TF.columns if c in set(X.columns) and c not in ("tid", "roster_id", "league", "manager")] + ["win"], errors="ignore")
add("trade_features", "playbook", "dataset", "One row per team per counted trade with the features the Trade Playbook uses: timing (New York time), what the side received and sent (value, age, positions, picks, last-season production, value trend, athleticism, rookies, age-cliff share), the headline asset and roster strength. Outcomes are in `trades` (join on tid + roster_id).", TF)
add("brett_trades_ranked", "ledger", "dataset", "Brett's 228 trades ranked by the context-adjusted result (and by value today and by how they aged).", pd.read_csv(os.path.join(OUT, "brett_trades_ranked.csv")))
add("all_trades_winner_loser", "ledger", "dataset", "All 1,007 trades between two or more teams, with the winner and loser by today's value, both sides named, gaps on the day and today, and whether the result flipped.",
    pd.read_csv(os.path.join(OUT, "all_trades_lopsided.csv")))
add("traders_dynasty_bois", "ledger", "dataset", "Dynasty Bois trader rankings (every manager since 2021; ranked with 5+ trades): record in context, big trades, share of the value swing won, totals, lineup points, the rank on six single measures and the rank range.", pd.DataFrame(TR["traders_bois"]))
add("traders_all_leagues", "ledger", "dataset", "Trader rankings across all leagues (ranked with 10+ trades), same measures.", pd.DataFrame(TR["traders_all"]))
add("traders_by_league", "ledger", "dataset", "Trader rankings within each league (managers with 5+ trades there), same measures.", pd.DataFrame(TR["traders_by_league"]))
add("trends_manager_season", "timeline", "dataset", "Every manager in every league-season: trades and their results, waiver claims, free-agent adds, drops, failed claims, FAAB, rookie picks, the roster at Week 1 (age, value rank, rookies, position shares, athleticism) and results (wins, points, finish, title).",
    pd.read_parquet(os.path.join(OUT, "trends_manager_season.parquet")))
add("weekly_results", "timeline", "dataset", "Every regular-season matchup result: league, season, week, roster, win (1 / 0.5 / 0) and points for.", pd.read_parquet(os.path.join(OUT, "weekly_results.parquet")))
add("recommendations", "playbook", "dataset", "The 20 recommendations from the Trade Playbook: five to change and five to keep, for all leagues and for Dynasty Bois, with the evidence for each.",
    pd.DataFrame(json.load(open(os.path.join(OUT, "recommendations.json")))))
add("weekly_lineups", "history", "dataset", "Every player on every roster in every week with Sleeper matchup data: started or benched, and points scored (111,598 rows).",
    pd.read_parquet(os.path.join(OUT, "weekly_lineups.parquet")), big=True)
add("dynastyprocess_value_history", "reference", "dataset", "DynastyProcess monthly values (1QB and superflex) for every player and pick since May 2020, from the dynastyprocess/data git history.",
    pd.read_parquet(os.path.join(OUT, "dp_long.parquet")), big=True)

# ======================================================================= report tables (analysis JSONs, flattened)
def humanize(k): return k.replace("_", " ").strip().capitalize()
DESC = {
    # playbook
    "brett_month": "Brett's trades by calendar month (New York time): won, lost, even, win rate, net value today and on trade day, one-year win rate.",
    "brett_phase": "Brett's trades by two-month phase of the dynasty year.", "bois_month": "Brett's Dynasty Bois trades by month.", "bois_phase": "Brett's Dynasty Bois trades by phase.",
    "calendar": "All two-team trades by month: volume, typical winning margin today, and how often the trade-day favourite is still ahead.",
    "skill_calendar": "Net value today gained by the 8 best and lost by the 8 worst traders (all leagues), by month.",
    "asset_calendar": "Median share of the price paid that each kind of asset was still worth one year later, by phase bought.",
    "formula": "League-wide: share of two-team trades won by the side with more of each feature (today, one year later, when fair on the day, on lineup points), with 95% ranges.",
    "shapes": "League-wide: win rates for common trade shapes (2-for-1, older-for-younger, players-for-picks...).", "formula_bois": "The formula and shapes, Dynasty Bois only.",
    "formula_by_phase": "Key formula features split by phase of the year.", "model_now": "Logistic model of which side won (value today) on the differences between the sides; odds per SD.",
    "model_1y": "The same model on value one year after the trade.", "model_now_no_value": "The model without the trade-day value edge.",
    "tags": "Brett's record by what he received (headline asset, shape, context) vs league-mates' record in the same kind of trade.", "tags_bois": "The same, Dynasty Bois only.",
    "head_class": "Win rates by class of headline asset, Brett vs league-mates.", "head_class_bois": "The same, Dynasty Bois only.",
    "brett_worst": "Brett's 12 costliest trades with their tags.", "brett_best": "Brett's 12 best trades with their tags.", "bois_worst": "Brett's 8 costliest Dynasty Bois trades.",
    "bois_best": "Brett's 8 best Dynasty Bois trades.", "bois_partners": "Brett's Dynasty Bois record against each trade partner.",
    "bois_playbooks": "How each Dynasty Bois trader operates: frequency, timing, consolidation, best-asset share, ages and picks in and out.",
    # ledger
    "brett_trades": "Brett's trades with values, grades, aging and consensus labels.", "top50_now": "The 50 most lopsided trades by today's value, both sides named.",
    "top50_moved": "The 50 trades whose balance moved most since trade day.", "top25_then": "The 25 biggest wins on the day, and how they turned out.",
    "traders_bois": "Dynasty Bois trader rankings.", "traders_all": "All-league trader rankings.", "traders_by_league": "Trader rankings within each league.",
    "phase": "Brett's trades by phase of the year (Trade Ledger view).", "brett_partners": "Brett's most frequent trade partners and his record against them.",
    "brett_by_context": "Brett's trades by his team's situation at the time (contending / middle / rebuilding).", "lm_by_context": "League-mates' trades by situation.",
    "tag_context": "Brett's record in key trade types split by his team's situation, with league-mates'.", "tag_context_bois": "The same, Dynasty Bois only.",
    "by_context": "Brett vs league-mates by situation (all leagues).", "by_context_bois": "Brett vs league-mates by situation (Dynasty Bois).",
    # timeline
    "per_season": "Per season: Brett's per-league-season averages and totals vs league-mates' averages over the same league-seasons.",
    "by_league_season": "Every metric for every league-season Brett played: his value, the league-mates' average and his rank.",
    "brett_rows": "Brett's rows from the manager-season table.",
}
def walk(v, path, out):
    if isinstance(v, dict):
        for k, x in v.items(): walk(x, f"{path}.{k}" if path else str(k), out)
    elif isinstance(v, list) and v and any(isinstance(x, (dict, list)) for x in v):
        out.append((path, json.dumps(v, default=str)))
    elif isinstance(v, list):
        out.append((path, "; ".join(str(x) for x in v)))
    else:
        out.append((path, v))
def flatten(fname, prefix, report):
    Z = json.load(open(os.path.join(OUT, fname)))
    kn = []
    for k, v in Z.items():
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            add(f"{prefix}_{k}", report, "result", DESC.get(k, humanize(k)), pd.json_normalize(v, sep="."))
        elif isinstance(v, dict) and v and all(isinstance(x, dict) for x in v.values()):
            gcol = "group" if not any("group" in x for x in v.values()) else "_group"
            add(f"{prefix}_{k}", report, "result", DESC.get(k, humanize(k)), pd.json_normalize([{gcol: g, **x} for g, x in v.items()], sep="."))
        else:
            rows = []; walk(v, "", rows)
            kn += [dict(item=k, key=p or "", value=val) for p, val in rows]
    if kn:
        kdf = pd.DataFrame(kn); kdf["value"] = kdf.value.map(lambda x: x if not isinstance(x, float) or x == x else None).astype(object)
        add(f"{prefix}_key_numbers", report, "result", f"Single numbers and small lookups behind the {REP_LABEL[report]} (item = analysis name, key = sub-field).", kdf)
flatten("analysis_core.json", "audit_core", "audit"); flatten("analysis_extra.json", "audit_extra", "audit")
flatten("analysis_more.json", "audit_more", "audit"); flatten("analysis_last.json", "audit_last", "audit")
flatten("analysis_hist.json", "history", "history"); flatten("analysis_combine.json", "combine", "combine")
flatten("analysis_trades.json", "ledger", "ledger"); flatten("analysis_patterns.json", "playbook", "playbook"); flatten("analysis_trends.json", "timeline", "timeline")
# the ledger's trader tables are already datasets above
TABLES[:] = [t for t in TABLES if t["name"] not in ("ledger_traders_bois", "ledger_traders_all", "ledger_traders_by_league", "ledger_brett_trades", "timeline_brett_rows")]
ORDER = {"reference": 0, "audit": 1, "history": 2, "combine": 3, "ledger": 4, "playbook": 5, "timeline": 6, "bois": 7, "fhp": 8}
TABLES.sort(key=lambda t: (ORDER[t["report"]], t["kind"] != "dataset"))

# ======================================================================= data dictionary
CD = {
 "trades": {"tid": "Sleeper transaction id of the trade", "league": "League", "season": "League season the trade belongs to", "date": "Trade time (UTC)", "roster_id": "This side's roster id in the league",
   "manager": "Sleeper user id of this side's manager", "manager_name": "Manager display name", "team": "Team name that season", "partner_ids": "Other side's manager id(s)", "partner": "Other side's team name(s)",
   "partner_name": "Other side's manager name(s)", "got": "Players and picks this side received (picks show slot and who was drafted with it, for reference)", "gave": "Players and picks this side sent",
   "n_in": "Players received", "n_out": "Players sent", "v_in": "Value received on the trade date (DynastyProcess)", "v_out": "Value sent on the trade date", "now_in": "Value received, today",
   "now_out": "Value sent, today", "age_in": "Average age of players received", "age_out": "Average age of players sent", "pos_in": "Positions received", "pos_out": "Positions sent",
   "category": "Kind of trade (player-for-player, sold players for picks, ...)", "n_sides": "Number of teams in the trade", "pts_got": "Lineup points the received players scored for this team in the 12 months after the trade, while on the roster",
   "pts_partner": "Lineup points the sent players scored for the other team(s) in the 12 months after the trade", "net_then": "v_in - v_out (trade day)", "net_now": "now_in - now_out (today); > 0 = won", "delta": "net_now - net_then (how it aged)",
   "gross_then": "v_in + v_out", "gross_now": "now_in + now_out", "pts_net": "pts_got - pts_partner", "shape": "players sent-for-received", "grade": "A+ >= +3,000 ... F <= -1,500 (result in context)",
   "aging": "Aged much better / better / held / worse / much worse (delta bands of 500 and 1,500)", "consensus": "Bold bet / won by consensus / fair on the day, and how it turned out",
   "active": "Counted in the analysis (some value changed hands, not undone, not a redone copy)", "undone": "Reversed within 24 hours (excluded)",
   "superseded": "Redone within 48 hours by a later trade repeating most of its moves (the earlier copy is excluded; one case, Dynasty Bois 6 Jan 2023)",
   "net_1y": "Net value one year after the trade", "net_2y": "Net value two years after", "net_3y": "Net value three years after",
   "pts_got_all": "Lineup points the received players scored for this team for as long as it kept them", "pts_partner_all": "The same for the other side",
   "pts_net_all": "pts_got_all - pts_partner_all", "roster_pct": "Roster value rank at the trade, 0 = strongest in the league, 1 = weakest", "standing_pct": "Standings rank at the trade (in season from week 3), 0 = first",
   "ctx_index": "Average of roster_pct and standing_pct (roster_pct alone in the offseason)", "context": "Contending (ctx_index <= 1/3), Middle, or Rebuilding (>= 2/3)",
   "points_credit": "Share of the lineup-point result that counts: 1 contending, 0.5 middle, 0 rebuilding", "pts_value": "pts_net converted to value points (x 18.1, the ratio of the two measures' spreads)",
   "ctx_net": "Result in context = net_now + points_credit x pts_value; > 0 = won", "grade_value": "Grade on value today alone", "big": "Big win / Big loss when |ctx_net| >= 1,500"},
 "trade_assets": {"tid": "Trade id", "league": "League", "kind": "player or pick", "asset_id": "Sleeper player id, or 'season Rround (orig roster)' for picks", "to": "Receiving roster id", "frm": "Sending roster id",
   "pos": "Position (PICK for picks)", "name": "Player name, or pick with its slot", "v_then": "Value on the trade date", "v_prev": "Player value about 3 months before the trade", "v_now": "Value today",
   "v_1y": "Value 365 days after the trade", "age": "Player age at the trade", "exp": "NFL seasons completed before the trade", "draft_round": "NFL draft round", "capital": "NFL draft capital group",
   "athletic": "Athletic composite percentile (0-1)", "prior_pts": "PPR points in the last completed NFL season", "prior_games": "Games in that season", "prior_rank": "Positional PPR rank that season",
   "prior_ppg": "PPR points per game that season", "prior_best_ppg": "Best PPR points per game in any earlier season (7+ games)", "ytd_ppg": "This season's PPR points per game at the trade (Sep-Dec trades)",
   "ytd_rank": "This season's positional rank by points per game", "ytd_weeks": "Weeks played this season at the trade", "pick_season": "Draft year of the pick", "pick_round": "Round of the pick",
   "pick_orig_roster": "Roster whose finish sets the pick's slot", "pick_slot": "Slot the pick landed at (round.pick)", "pick_overall": "Overall pick number in that league's rookie draft",
   "pick_years_out": "Drafts between the trade and the pick's draft (0 = the next draft)", "pick_basis_then": "How the pick was valued on the trade date (known slot / projected early-middle-late / round average / slot value after the draft)",
   "pick_basis_now": "How the pick is valued today", "pick_player": "Sleeper id of the player drafted with the pick (reference only)", "pick_player_name": "Player drafted with the pick (reference only)",
   "v_now_drafted_player": "Today's value of the player actually drafted (reference; not used to judge trades)", "past_cliff": "Past the position's age cliff (QB 31, RB 26, WR 27, TE 28)",
   "rookie": "In his first NFL season", "starter_prior": "Starter last season (QB/TE top 12, RB/WR top 24 PPR)", "elite_prior": "Elite last season (QB/TE top 6, RB/WR top 12)",
   "career_year": "Last season's PPG 20%+ above any earlier season, and a starter", "missed_time": "Fewer than 10 games last season (not a rookie)", "hot_start": "Starter-level PPG this season, not a starter last season",
   "momentum": "Value change over the 3 months before the trade", "riser": "Value up 20%+ over those 3 months", "faller": "Value down 20%+ over those 3 months", "r1": "NFL first-round pick", "month": "Month of the trade (New York time)"},
 "trade_features": {"date_et": "Trade time, New York", "month": "Month (New York)", "year": "Year (New York)", "y1_in": "Value received, one year after", "y1_out": "Value sent, one year after",
   "net_1y": "Net value one year after the trade", "win": "1 won / -1 lost / 0 even (today)", "is_me": "Brett's side", "roster_value": "Total player value on this roster just before the trade",
   "roster_rank": "Rank of that total in the league (1 = strongest)", "roster_pct": "0 = strongest roster, 1 = weakest"},
 "ownership_stints": {"league": "League", "roster_id": "Roster", "player_id": "Sleeper player id", "start_ts": "Start (ms since epoch, UTC)", "start_method": "How the stint began", "start_season": "Season it began",
   "start_info": "Details (draft slot, trade id, waiver bid...)", "owner": "Manager id", "end_ts": "End (ms, UTC)", "end_method": "How it ended", "end_season": "Season it ended", "end_info": "Details",
   "start": "Start time", "end": "End time (blank = still rostered)", "days": "Days on the roster", "is_me": "Brett's roster", "stint_id": "Stint id", "sf": "Superflex league", "n_teams": "League size",
   "fp_id": "FantasyPros id", "age_start": "Age at start", "age_end": "Age at end (or today)", "nfl_year_at_start": "NFL season number at start", "v_start": "Value at start", "rank_start": "Dynasty rank at start",
   "v_end": "Value at end", "rank_end": "Rank at end", "v_max_held": "Highest value while held", "rank_best_held": "Best rank while held", "v_max_12m_after_add": "Highest value in the 12 months after the add",
   "rank_best_12m_after_add": "Best rank in the 12 months after the add", "v_max_12m_after_exit": "Highest value in the 12 months after he left", "rank_best_12m_after_exit": "Best rank in the 12 months after he left",
   "full_year_after_exit": "A full year has passed since he left", "v_now": "Value today", "rank_now": "Rank today", "started_points": "Points scored in this team's starting lineup during the stint",
   "starts": "Weeks started", "weeks_rostered_inseason": "In-season weeks on the roster"},
}
def auto_desc(t, c):
    for pre, who in (("in_", "received"), ("out_", "sent")):
        if c.startswith(pre):
            k = c[len(pre):]
            m = {"n": f"Assets {who} (players + picks)", "players": f"Players {who}", "picks": f"Picks {who}", "v": f"Value {who} on the trade date", "best": f"Value of the single best asset {who}",
                 "pick_share": f"Share of value {who} in picks", "age": f"Value-weighted age of players {who}", "age_blend": f"Value-weighted age of everything {who} (picks count as 21.5)",
                 "prior_pts": f"Last-season PPR points of players {who}", "momentum": f"Value-weighted 3-month value trend of players {who}", "ath": f"Value-weighted athletic composite of players {who}",
                 "rookie_share": f"Share of value {who} in rookies", "cliff_share": f"Share of value {who} in players past their age cliff", "starter_share": f"Share of value {who} in last season's starters",
                 "r1_share": f"Share of value {who} in NFL first-round picks"}
            if k in m: return m[k]
            if k.endswith("_share"): return f"Share of value {who} at {k[:-6]}"
    if c.startswith("head_"): return f"Headline asset received (the most valuable piece): {c[5:].replace('_', ' ')}"
    return None
def dictionary(tables):
    rows = []
    for t in tables:
        if t["kind"] != "dataset": continue
        for c in t["df"].columns:
            base = t["name"] if t["name"] in CD else ("trades" if t["name"] in ("trade_features", "brett_trades_ranked") else t["name"])
            d = CD.get(base, {}).get(c) or (CD["trades"].get(c) if t["name"] == "trade_features" else None) or auto_desc(t["name"], c) or ""
            rows.append(dict(table=t["name"], column=c, type=str(t["df"][c].dtype), description=d))
    return pd.DataFrame(rows)

# ======================================================================= Dynasty Bois view of every table
LG = "Dynasty Bois"
bois_players = set(pd.read_parquet(os.path.join(OUT, "stints.parquet")).query("league == @LG").player_id) | set(spots[spots.league == LG].sleeper_id)
bois_fp = set(PH.fp_id.reindex(list(bois_players)).dropna())
def bois_view(tables):
    out = []
    for t in tables:
        df, n = t["df"], t["name"]
        if n in ("managers", "traders_all_leagues", "traders_by_league"): continue                       # all-league rankings
        if n == "leagues": df = df[df.league == LG]
        elif n == "reports": df = df
        elif n == "recommendations": df = df[df.scope == LG]
        elif n == "current_players_all_rosters": df = df[df.sleeper_id.isin(set(spots[spots.league == LG].sleeper_id))]
        elif n == "current_brett_players": df = df[df.leagues.astype(str).str.contains("Bois")]
        elif n in ("players_ever_rostered", "athletic_profiles"): df = df[df.player_id.isin(bois_players)]
        elif n == "brett_players_ever_owned": df = df[df.leagues.astype(str).str.contains("Bois")] if "leagues" in df else df
        elif n == "dynastyprocess_value_history": df = df[df.fp_id.isin(bois_fp)]
        elif n.endswith("_key_numbers"): df = df[df["item"].astype(str).str.contains("bois", case=False)]
        elif "league" in df.columns: df = df[df.league == LG]
        elif t["kind"] == "result" and "bois" in n: df = df
        elif t["kind"] == "result" and "group" in df.columns and (df.group == LG).any(): df = df[df.group == LG]
        elif t["kind"] == "dataset" and n == "traders_dynasty_bois": df = df
        else: continue                                                                                     # an all-league aggregate
        if df.empty: continue
        out.append(dict(t, df=df.reset_index(drop=True)))
    return out

