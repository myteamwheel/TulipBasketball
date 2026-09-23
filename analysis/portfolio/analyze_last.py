"""Last numbers for the report."""
import json, os
import numpy as np, pandas as pd
from common import *
from load import load
S, P = load(); mine = S[S.is_me]; LO = [l for l, _, _ in LEAGUES]
U = pd.read_parquet(os.path.join(OUT, "my_unique.parquet"))
Z = {}
multi_ids = set(U[U.n_leagues >= 2].sleeper_id)
mine = mine.assign(multi=mine.sleeper_id.isin(multi_ids))
Z["method_multi"] = pd.crosstab(mine.method, mine.multi).rename(columns={True: "multi", False: "single"}).to_dict()
Z["multi_in_32"] = dict(multi=float((mine[mine.multi].n_teams == 32).mean()), single=float((mine[~mine.multi].n_teams == 32).mean()), all=float((mine.n_teams == 32).mean()))
Z["multi_slots"] = pd.crosstab(mine.slot, mine.multi, normalize="columns").round(3).rename(columns={True: "multi", False: "single"}).to_dict()
Z["cross_format"] = U[U.cross_format][["name", "pos", "leagues"]].to_dict("records")
Z["cross_depth"] = U[U.cross_depth][["name", "pos", "leagues"]].to_dict("records")
# records
rec = []
for l, lid, f in LEAGUES:
    R = json.load(open(os.path.join(RAW, "sleeper", "current", f"rosters_{lid}.json")))
    me = next(r for r in R if r.get("owner_id") == ME)
    st = me["settings"]
    rec.append(dict(league=l, w=st.get("wins"), l=st.get("losses"), t=st.get("ties"), fpts=st.get("fpts")))
Z["records"] = rec
# null for NFL-team effective number and value concentration
rng = np.random.default_rng(3)
rosters = {l: [g for _, g in S[(S.league == l) & ~S.is_me].groupby("roster_id")] for l in LO}
eff, top10 = [], []
for _ in range(4000):
    port = pd.concat([rosters[l][rng.integers(len(rosters[l]))] for l in LO])
    vc = port[port.nfl_team != "FA"].nfl_team.value_counts(normalize=True); eff.append(1 / (vc ** 2).sum())
    u = port.drop_duplicates("sleeper_id").fc_portfolio.sort_values(ascending=False); top10.append(u.head(10).sum() / u.sum())
vc = mine[mine.nfl_team != "FA"].nfl_team.value_counts(normalize=True)
Z["team_eff"] = dict(brett=float(1 / (vc ** 2).sum()), null_mean=float(np.mean(eff)), null_lo=float(np.percentile(eff, 2.5)), p_low=float((np.array(eff) <= 1 / (vc ** 2).sum()).mean()))
Z["top10_value"] = dict(brett=float(U.sort_values("fc_portfolio", ascending=False).fc_portfolio.head(10).sum() / U.fc_portfolio.sum()), null_mean=float(np.mean(top10)),
                        null_lo=float(np.percentile(top10, 2.5)), null_hi=float(np.percentile(top10, 97.5)))
# value tiers: FC vs DP agreement, multi vs single
Z["tier_agree"] = float((U.value_tier == U.value_tier_dp).mean())
Z["tier_cross"] = pd.crosstab(U.value_tier, U.value_tier_dp).to_dict()
Z["tier_multi"] = pd.crosstab(U.value_tier, U.n_leagues >= 2).rename(columns={True: "multi", False: "single"}).to_dict()
Z["trend_multi"] = pd.crosstab(U.value_trend, U.n_leagues >= 2).rename(columns={True: "multi", False: "single"}).to_dict()
Z["fc_dp_rank_spearman"] = float(U[["fc_portfolio", "dp_portfolio"]].corr(method="spearman").iloc[0, 1])
# age by position for Brett (unique) + buckets
Z["age_by_pos"] = U.groupby("pos").age.agg(["mean", "median", "count"]).round(2).reset_index().to_dict("records")
Z["age_buckets_unique"] = pd.cut(U.age, [0, 22, 23, 24, 25, 26, 27, 28, 30, 99], right=False, labels=["21 or younger", "22", "23", "24", "25", "26", "27", "28-29", "30+"]).value_counts().sort_index().to_dict()
Z["age_multi_single"] = dict(multi_mean=float(U[U.n_leagues >= 2].age.mean()), multi_median=float(U[U.n_leagues >= 2].age.median()),
                             single_mean=float(U[U.n_leagues == 1].age.mean()), single_median=float(U[U.n_leagues == 1].age.median()),
                             top10_mean=float(U.sort_values(["n_leagues", "fc_portfolio"], ascending=False).head(10).age.mean()))
# rookie by position and by league
Z["rookie_by_pos"] = mine.groupby("pos").is_rookie.agg(["mean", "sum", "count"]).round(3).reset_index().to_dict("records")
Z["rookie_by_league"] = mine.groupby("league").is_rookie.agg(["mean", "sum", "count"]).round(3).reset_index().to_dict("records")
Z["rookies_most"] = U[U.nfl_season_num <= 1].sort_values(["n_leagues", "fc_portfolio"], ascending=False).head(12)[["name", "pos", "n_leagues", "capital"]].to_dict("records")
Z["exp_unique"] = U.nfl_season_num.clip(upper=4).map({1: "Rookie", 2: "2nd year", 3: "3rd year", 4: "Veteran (4+)"}).value_counts().to_dict()
# conference by multi vs single
Z["tier_multi_single"] = pd.crosstab(U.conf_tier, U.n_leagues >= 2).rename(columns={True: "multi", False: "single"}).to_dict()
Z["conf_unique"] = U.conf.value_counts().to_dict()
Z["capital_multi"] = U.groupby(U.n_leagues >= 2).capital.value_counts().unstack(fill_value=0).T.rename(columns={True: "multi", False: "single"}).to_dict()
Z["r1_3plus"] = dict(r1_share_3plus=float((U[U.n_leagues >= 3].draft_round == 1).mean()), n_3plus=int((U.n_leagues >= 3).sum()),
                     r1_share_single=float((U[U.n_leagues == 1].draft_round == 1).mean()))
Z["archetype_unique"] = U.archetype.value_counts().to_dict()
Z["archetype_multi"] = U[U.n_leagues >= 2].archetype.value_counts().to_dict()
Z["declined_names"] = list(U[U.archetype == "Former top prospect, value declined"].name)
Z["late_names"] = list(U[U.archetype == "Late-blooming producer"].name)
Z["udfa_names"] = list(U[U.archetype.str.startswith("Undrafted")].name)
json.dump(Z, open(os.path.join(OUT, "analysis_last.json"), "w"), default=lambda o: None if (isinstance(o, float) and np.isnan(o)) else (o.item() if hasattr(o, "item") else str(o)))
for k, v in Z.items(): print(k, ":", v)
