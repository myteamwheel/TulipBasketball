"""Merged analysis frame: one row per roster spot (all teams), with player attributes + acquisition."""
import os
import numpy as np, pandas as pd
from common import *

def load():
    P = pd.read_parquet(os.path.join(OUT, "players_all.parquet"))
    A = pd.read_parquet(os.path.join(OUT, "acquisitions.parquet"))
    S = A.merge(P, on="sleeper_id", how="left")
    S["age_bucket"] = pd.cut(S.age, [0, 22, 23, 24, 25, 26, 27, 28, 30, 99], right=False,
                             labels=["21 or younger", "22", "23", "24", "25", "26", "27", "28-29", "30+"])
    S["is_rookie"] = S.nfl_season_num <= 1
    S["pos"] = S.pos.where(S.pos.isin(["QB", "RB", "WR", "TE"]), "Other")
    S["n_teams"] = S.fmt_teams
    return S, P

def my_unique(S):
    M = S[S.is_me]
    g = M.groupby("sleeper_id")
    U = g.first()
    U["n_leagues"] = g.size()
    U["leagues"] = g.league.agg(lambda s: ", ".join(s))
    U["teams"] = g.team.agg(lambda s: ", ".join(s))
    U["slots"] = g.slot.agg(lambda s: ", ".join(s))
    U["methods"] = g.method.agg(lambda s: ", ".join(s))
    # opportunity: in how many of the six leagues is he rostered at all, and expected count for a random manager
    rostered = S.groupby("sleeper_id").agg(n_leagues_rostered=("league", "nunique"))
    exp = S.drop_duplicates(["sleeper_id", "league"]).assign(p=lambda d: 1 / d.n_teams).groupby("sleeper_id").p.sum()
    U = U.join(rostered).assign(expected_random=exp)
    U["lift"] = U.n_leagues / U.expected_random
    return U.reset_index()
