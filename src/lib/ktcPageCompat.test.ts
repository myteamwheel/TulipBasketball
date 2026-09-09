import assert from "node:assert/strict";
import test from "node:test";
import { parseKtcRankingPage } from "@/lib/ktcPageCompat";

const fixture = `
<html><body><div id="rankings-page-rankings">
  <div class="onePlayer">
    <div class="rank-number">1</div>
    <div class="player-name"><a href="/dynasty-rankings/players/josh-allen-542">Josh Allen</a></div>
    <div class="position-team"><span class="position">QB1</span></div>
    <div class="player-team">BUF</div>
    <div class="age">30.3 y.o.</div>
    <div class="player-tier">Tier 1</div>
    <div class="value">9,999</div>
  </div>
  <div class="onePlayer">
    <div class="rank-number">2</div>
    <div class="player-name"><a href="/dynasty-rankings/players/jamarr-chase-1000">Ja&#39;Marr Chase</a></div>
    <div class="position-team"><span class="position">WR1</span></div>
    <div class="player-team">CIN</div>
    <div class="age">26.5 y.o.</div>
    <div class="player-tier">Tier 1</div>
    <div class="value">9876</div>
  </div>
  <div class="onePlayer">
    <div class="rank-number">3</div>
    <div class="player-name"><a href="/dynasty-rankings/picks/2027-early-1st">2027 Early 1st</a></div>
    <div class="position-team"><span class="position">PICK</span></div>
    <div class="value">7000</div>
  </div>
</div></body></html>`;

test("parses current KTC .onePlayer fantasy rows and profile ids", () => {
  const rows = parseKtcRankingPage(fixture);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    ktcId: "542",
    name: "Josh Allen",
    position: "QB",
    team: "BUF",
    age: 30.3,
    value: 9999,
    rank: 1,
    positionRank: 1,
  });
  assert.equal(rows[1].name, "Ja'Marr Chase");
  assert.equal(rows[1].ktcId, "1000");
  assert.equal(rows[1].position, "WR");
  assert.equal(rows[1].positionRank, 1);
});

test("ignores malformed or non-fantasy rows rather than inventing values", () => {
  const rows = parseKtcRankingPage(`
    <div class="onePlayer"><div class="rank-number">1</div><div class="player-name"><a>Bad Row</a></div><div class="position">QB1</div><div class="value">not-a-value</div></div>
    <div class="onePlayer"><div class="rank-number">2</div><div class="player-name"><a>Future Pick</a></div><div class="position">PICK</div><div class="value">5000</div></div>
  `);
  assert.deepEqual(rows, []);
});
