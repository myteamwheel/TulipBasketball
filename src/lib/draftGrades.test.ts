import { strict as assert } from "node:assert";
import { test } from "node:test";
import archive from "../data/draft-selections.json";
import { gradeDrafts, type Selection } from "./draftGrades";

const picks = archive.picks as Selection[];
const asOf = archive.checked;
const graded = gradeDrafts(picks, asOf);
function selected(name: string) {
  const row = graded.find(p => p.name === name);
  assert.ok(row, `Missing selection ${name}`);
  return row;
}

test("grades preserve a recent pick's value and productive careers", () => {
  assert.ok(selected("Fernando Mendoza").outcome!.score >= 75);
  assert.ok(selected("Ken Walker").outcome!.score >= 85);
  assert.ok(selected("Jayden Daniels").outcome!.score >= 85);
  assert.ok(selected("George Pickens").outcome!.score >= 85);
});
test("late picks with minimal production are not automatic successes", () => {
  assert.ok(selected("Dorian Thompson-Robinson").outcome!.score < 80);
  assert.ok(selected("Johnny Wilson").outcome!.score < 80);
});
test("increasing current value never reduces a grade for the same pick", () => {
  const original = selected("Fernando Mendoza");
  assert.ok(original.current);
  const revised = picks.map(p => p.id === original.id ? {...p, now: {...original.current!, value:original.current!.value + 1000}} : p);
  assert.ok(gradeDrafts(revised, asOf).find(p => p.id === original.id)!.outcome!.score >= original.outcome!.score);
});
test("a missing current quote is never treated as a zero", () => {
  const original = selected("Fernando Mendoza");
  const revised = picks.map(p => p.id === original.id ? {...p,now:null} : p);
  assert.equal(gradeDrafts(revised,asOf).find(p => p.id === original.id)!.outcome,null);
});
test("a same-position alternative carries a larger penalty", () => {
  const selectedPick = selected("Jameson Williams");
  const alternative = picks.find(p => p.draft === selectedPick.draft && p.overall === selectedPick.overall + 1)!;
  const change = (position: string) => picks.map(p => p.id === alternative.id ? {...p,pos:position,now:{value:9999,date:asOf}} : p);
  const same = gradeDrafts(change(selectedPick.pos),asOf).find(p => p.id === selectedPick.id)!;
  const different = gradeDrafts(change("QB"),asOf).find(p => p.id === selectedPick.id)!;
  assert.ok(same.outcome!.penalty > different.outcome!.penalty);
});
test("a late pick with useful value is not an F because of a nearby star", () => {
  const p = selected("Jalen Royals");
  const alternatives = picks.filter(x => x.draft===p.draft && x.overall>p.overall && x.overall<=p.overall+4);
  const revised = picks.map(x => alternatives.some(a=>a.id===x.id) ? {...x,now:{value:9999,date:asOf}} : x.id===p.id ? {...x,now:{value:3000,date:asOf}} : x);
  assert.ok(gradeDrafts(revised,asOf).find(x=>x.id===p.id)!.outcome!.score >= 60);
});
test("ranking retains distinctions when displayed grades both reach 100", () => {
  const first = selected("Ken Walker");
  assert.ok(first.current);
  const changed = (value:number) => picks.map(p => p.id === first.id ? {...p,now:{value,date:asOf}} : p);
  const high = gradeDrafts(changed(9999),asOf).find(p => p.id === first.id)!.outcome!;
  const lower = gradeDrafts(changed(8500),asOf).find(p => p.id === first.id)!.outcome!;
  assert.equal(high.score,100);
  assert.equal(lower.score,100);
  assert.ok(high.edge > lower.edge);
});
