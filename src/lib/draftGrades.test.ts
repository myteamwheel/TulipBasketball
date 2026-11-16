import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gradeDrafts, type Selection } from "./draftGrades";

function pick(overall: number, value: number, round = 1): Selection {
  return { id:String(overall),draft:"draft",year:2024,auction:false,start:"2024-05-01",
    overall,round,teams:12,bid:null,playerId:String(overall),name:String(overall),pos:"WR",
    owner:"owner",manager:"manager",team:null,profile:null,at:{value,date:"2024-04-30"},
    two:null,due:"2026-05-01",now:{value,date:"2026-11-15"},games:0,points:0 };
}
test("nearby opportunity penalty accounts for multiple higher-value players", () => {
  const board = [pick(1,3000),pick(2,4000),pick(3,5000),pick(4,6000),pick(5,7000),pick(6,9000)];
  const graded = gradeDrafts(board,"2026-11-15");
  assert.ok(graded[0].outcome!.penalty > graded[1].outcome!.penalty);
  const changedFifth = board.map(p => p.overall === 6 ? {...p,now:{value:9900,date:"2026-11-15"}} : p);
  assert.equal(gradeDrafts(changedFifth,"2026-11-15")[0].outcome!.penalty,graded[0].outcome!.penalty);
});
test("valuable late selection retains at least a C despite a nearby star", () => {
  const board = [pick(37,3000,4),pick(38,9000,4),pick(39,7000,4),pick(40,6000,4),pick(41,5000,4)];
  assert.ok(gradeDrafts(board,"2026-11-15")[0].outcome!.score >= 70);
});
test("missing current quotes never create opportunity penalties", () => {
  const board = [pick(1,3000), {...pick(2,9000),now:null}];
  assert.equal(gradeDrafts(board,"2026-11-15")[0].outcome,null);
});
