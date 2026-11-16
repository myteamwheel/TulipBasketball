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
  assert.equal(gradeDrafts(board,"2026-11-15")[0].outcome!.penalty,0);
});
test("productive prior seasons improve an older pick even after current value falls", () => {
  const base = {...pick(25,700,3), year:2022, start:"2022-05-01", seasons:[]};
  const productive = {...base, seasons:[{year:2022,games:15,points:200},{year:2023,games:15,points:200}]};
  assert.ok(gradeDrafts([productive],"2026-11-15")[0].outcome!.score > gradeDrafts([base],"2026-11-15")[0].outcome!.score);
});
test("nearby same-position alternatives carry more weight", () => {
  const base = pick(1,3000);
  const same = {...pick(2,6000),pos:"WR"};
  const different = {...same,pos:"RB"};
  assert.ok(gradeDrafts([base,same],"2026-11-15")[0].outcome!.penalty > gradeDrafts([base,different],"2026-11-15")[0].outcome!.penalty);
});
test("a young pick maintaining its draft value is not marked a bust", () => {
  const p = {...pick(3,5743),year:2026,start:"2026-06-01",at:{value:5617,date:"2026-05-31"},seasons:[{year:2026,games:1,points:2.2}]};
  assert.ok(gradeDrafts([p],"2026-11-16")[0].outcome!.score >= 80);
});
test("a missing historical quote for a recent pick is explicitly unrated", () => {
  const p = {...pick(1,4000),year:2026,start:"2026-06-01",at:null,seasons:[]};
  assert.equal(gradeDrafts([p],"2026-11-16")[0].outcome,null);
});
test("increasing current value does not reduce a pick grade with identical context", () => {
  const base = {...pick(1,4000),year:2026,start:"2026-06-01",at:{value:4000,date:"2026-05-31"}};
  const improved = {...base,now:{value:6000,date:"2026-11-15"}};
  assert.ok(gradeDrafts([improved],"2026-11-16")[0].outcome!.score >= gradeDrafts([base],"2026-11-16")[0].outcome!.score);
});
