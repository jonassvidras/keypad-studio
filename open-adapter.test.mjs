import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenKeypad, fromOpenAction, isOpenDevice, supportedAction, toOpenAction} from './open-adapter.mjs';
import {createProfile, validateProfile} from './protocol.mjs';
import {defaultSettings, encodeSettings} from './keypadopen-protocol.mjs';

function mockDevice(version) {
  const record = new Uint8Array(64);
  record.set([0x4b, 0x50, 1]);
  record.set(encodeSettings(defaultSettings()), 4);
  let listener;
  const commands = [];
  const device = {
    vendorId: 0x1209, productId: 0xc55d,
    collections: [{usagePage: 0xff60, usage: 0x61}], opened: false,
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    addEventListener(_type, callback) { listener = callback; },
    removeEventListener() { listener = null; },
    async sendReport(_id, request) {
      commands.push(request[0]);
      const response = new Uint8Array(32);
      response[0] = request[0];
      if (request[0] === 1) response.set([0x4b, 0x50, version, 64, 0, 0], 2);
      if (request[0] === 2) {
        response[2] = request[1];
        response[3] = request[2];
        response.set(record.slice(request[1], request[1] + request[2]), 4);
      }
      if (request[0] === 3) record.set(request.slice(3, 3 + request[2]), request[1]);
      listener({device: this, reportId: 0, data: new DataView(response.buffer)});
    },
  };
  return {device, commands};
}

test('KeypadOpen profile mapping supports media and basic mouse actions', () => {
  assert.deepEqual(toOpenAction({type: 'media', action: 'play'}),
    {type: 4, modifiers: 0, code: 0xcd});
  assert.deepEqual(fromOpenAction({type: 4, modifiers: 0, code: 0xe9}),
    {type: 'media', action: 'volumeUp'});
  assert.deepEqual(toOpenAction({type: 'mouse', action: 'wheelDown'}),
    {type: 2, modifiers: 0, code: -1});
  assert.equal(supportedAction({type: 'sequence', steps: [{key: 4, modifiers: 0}]}), false);
  assert.equal(supportedAction({type: 'mouse', action: 'ctrlWheelUp'}), false);
});

test('saved legacy profiles gain separate KeypadOpen lighting defaults', () => {
  const profile = createProfile('letters');
  delete profile.openLighting;
  const restored = validateProfile(profile);
  assert.equal(restored.lighting, 2);
  assert.equal(restored.openLighting.mode, 1);
  assert.equal(restored.openLighting.colors.length, 3);
});

test('matching the replacement requires its vendor HID collection', () => {
  const device = {vendorId: 0x1209, productId: 0xc55d,
    collections: [{usagePage: 0xff60, usage: 0x61}]};
  assert.equal(isOpenDevice(device), true);
  assert.equal(isOpenDevice({...device, collections: []}), false);
});

test('v1 rejects new media actions without writing to the keypad', async () => {
  const {device, commands} = mockDevice(1);
  const keypad = new OpenKeypad(device);
  await keypad.open();
  await assert.rejects(keypad.save({actions: [[1, {type: 'media', action: 'play'}]]}), /Update KeypadOpen/);
  assert.equal(commands.includes(3), false);
  await keypad.close();
});

test('v2 preserves other fields when saving one media action', async () => {
  const {device, commands} = mockDevice(2);
  const keypad = new OpenKeypad(device);
  await keypad.open();
  const saved = await keypad.save({actions: [[1, {type: 'media', action: 'play'}]]});
  assert.equal(saved.actions[0].type, 4);
  assert.equal(saved.actions[1].code, 5);
  assert.equal(saved.mode, 1);
  assert.deepEqual(commands.filter(command => command === 3 || command === 4), [3, 4]);
  await keypad.close();
});
