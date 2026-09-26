import test from 'node:test';
import assert from 'node:assert/strict';
import { isDecisionGradeProductionSeason } from './productionEligibility';
import { projectedRookieSlot } from './pickValuation';
test('prior season remains usable in September, older and tiny samples do not', () => {
 assert.equal(isDecisionGradeProductionSeason(2025,17,2026),true);
 assert.equal(isDecisionGradeProductionSeason(2026,2,2026),false);
 assert.equal(isDecisionGradeProductionSeason(2024,17,2026),false);
 assert.equal(isDecisionGradeProductionSeason(2027,17,2026),false);
});
test('draft order uses weak weekly lineup first and neutral fallback if data is incomplete', () => {
 const teams = [{id:'young',sleeperRosterId:1},{id:'strong',sleeperRosterId:2},{id:'middle',sleeperRosterId:3}];
 assert.equal(projectedRookieSlot('young',1,teams,new Map([['young',90],['strong',150],['middle',120]])),1);
 assert.equal(projectedRookieSlot('young',1,teams,new Map([['young',90]])),2);
});
