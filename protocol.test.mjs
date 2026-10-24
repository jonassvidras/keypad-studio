import test from 'node:test';
import assert from 'node:assert/strict';
import {stockBasicAction} from './protocol.mjs';


test('basic stock keys and unchanged controls stay in the default flow', () => {
  assert.equal(stockBasicAction({type: 'keyboard', steps: [{key: 4, modifiers: 0}]}), true);
  assert.equal(stockBasicAction({type: 'unset'}), true);
});

test('untested stock commands require experimental mode', () => {
  const actions = [
    {type: 'keyboard', steps: [{key: 4, modifiers: 1}]},
    {type: 'modifier', modifiers: 1},
    {type: 'sequence', steps: [{key: 4, modifiers: 0}]},
    {type: 'media', action: 'play'},
    {type: 'mouse', action: 'wheelUp'},
  ];
  for (const action of actions) assert.equal(stockBasicAction(action), false);
});
