import test from 'node:test';
import assert from 'node:assert/strict';
import { fitsRoster, windowMotive } from './tradeEligibility';
test('overfull rosters and incoming taxi players still need real space', () => {
 assert.equal(fitsRoster(25, 1, 3, 24), false);
 assert.equal(fitsRoster(24, 0, 1, 24), false);
 assert.equal(fitsRoster(25, 2, 1, 24), true);
});
test('window fit rejects old production for rebuilders and picks-only contender returns', () => {
 const veteran = {isPick:false, age:32, position:'QB', hasProjection:true, value:5000, needed:true};
 assert.equal(windowMotive('REBUILDER', [veteran], 5000), null);
 assert.ok(windowMotive('CONTENDER', [veteran], 5000));
 assert.equal(windowMotive('CONTENDER', [{...veteran,isPick:true}], 5000), null);
 assert.ok(windowMotive('REBUILDER', [{...veteran,age:23}], 5000));
 assert.equal(windowMotive('REBUILDER', [{...veteran,age:23,value:300},veteran], 5000), null);
});
