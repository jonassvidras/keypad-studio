import {
  ACTION, COLLECTION, COMMAND, CONFIG_LENGTH, DEVICE_FILTER,
  EDIT_LENGTH, EDIT_OFFSET, REPORT_LENGTH, checkResponse, decodeConfig,
  encodeSettings, makeReport,
} from './keypadopen-protocol.mjs';
import {MEDIA, MOUSE, TARGETS, validateAction} from './protocol.mjs';

const targetOrder = [1, 2, 3, 14, 13, 15];
const mediaUsage = Object.fromEntries(Object.entries(MEDIA).map(([name, value]) => [value.usage, name]));

export function isOpenDevice(device) {
  return device.vendorId === DEVICE_FILTER.vendorId &&
    device.productId === DEVICE_FILTER.productId &&
    device.collections.some(collection =>
      collection.usagePage === COLLECTION.usagePage && collection.usage === COLLECTION.usage);
}

export function supportedAction(rawAction) {
  const action = validateAction(rawAction);
  if (action.type === 'unset') return true;
  if (action.type === 'keyboard' || action.type === 'modifier' || action.type === 'media') return true;
  return action.type === 'mouse' && ['left', 'right', 'middle', 'wheelUp', 'wheelDown'].includes(action.action);
}

export function toOpenAction(rawAction) {
  const action = validateAction(rawAction);
  if (!supportedAction(action) || action.type === 'unset') throw new Error('This action is not supported by KeypadOpen firmware.');
  if (action.type === 'keyboard') return {type: ACTION.keyboard, modifiers: action.steps[0].modifiers, code: action.steps[0].key};
  if (action.type === 'modifier') return {type: ACTION.keyboard, modifiers: action.modifiers, code: 0};
  if (action.type === 'media') return {type: ACTION.consumer, modifiers: 0, code: MEDIA[action.action].usage};
  if (action.action === 'wheelUp' || action.action === 'wheelDown') {
    return {type: ACTION.scroll, modifiers: 0, code: action.action === 'wheelUp' ? 1 : -1};
  }
  return {type: ACTION.mouseButton, modifiers: 0, code: MOUSE[action.action].bytes[0]};
}

export function fromOpenAction(action) {
  if (action.type === ACTION.keyboard) {
    return action.code ? {type: 'keyboard', steps: [{key: action.code, modifiers: action.modifiers}]} :
      action.modifiers ? {type: 'modifier', modifiers: action.modifiers} : {type: 'unset'};
  }
  if (action.type === ACTION.consumer && mediaUsage[action.code]) return {type: 'media', action: mediaUsage[action.code]};
  if (action.type === ACTION.scroll && Math.abs(action.code) === 1) {
    return {type: 'mouse', action: action.code > 0 ? 'wheelUp' : 'wheelDown'};
  }
  if (action.type === ACTION.mouseButton) {
    const button = {1: 'left', 2: 'right', 4: 'middle'}[action.code];
    if (button) return {type: 'mouse', action: button};
  }
  return {type: 'unset'};
}

export class OpenKeypad {
  constructor(device) {
    if (!isOpenDevice(device)) throw new Error('This is not a KeypadOpen device.');
    this.device = device;
    this.pending = null;
    this.protocolVersion = 0;
    this.deviceDirty = false;
    this.onInput = event => {
      if (!this.pending || event.device !== this.device || event.reportId !== 0 || event.data.byteLength !== REPORT_LENGTH) return;
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice();
      if (bytes[0] !== this.pending.command) return;
      clearTimeout(this.pending.timeout);
      this.pending.resolve(bytes);
      this.pending = null;
    };
  }

  async open() {
    this.device.addEventListener('inputreport', this.onInput);
    try {
      if (!this.device.opened) await this.device.open();
      await this.read();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close() {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('Keypad disconnected.'));
      this.pending = null;
    }
    this.device.removeEventListener('inputreport', this.onInput);
    if (this.device.opened) await this.device.close();
  }

  async request(command, offset = 0, count = 0, data = []) {
    if (!this.device.opened) throw new Error('Keypad disconnected.');
    if (this.pending) throw new Error('Another keypad request is in progress.');
    const report = makeReport(command, offset, count, data);
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new Error('Keypad response timed out. Reconnect and try again.'));
      }, 2500);
      this.pending = {command, timeout, resolve, reject};
      this.device.sendReport(0, report).catch(error => {
        if (this.pending?.timeout === timeout) {
          clearTimeout(timeout);
          this.pending = null;
          reject(error);
        }
      });
    });
    return checkResponse(response, command);
  }

  async read() {
    const info = await this.request(COMMAND.info);
    if (info[2] !== 0x4b || info[3] !== 0x50 || ![1, 2].includes(info[4]) || info[5] !== CONFIG_LENGTH) {
      throw new Error('Unsupported KeypadOpen protocol.');
    }
    this.protocolVersion = info[4];
    this.deviceDirty = info[7] !== 0;
    const record = new Uint8Array(CONFIG_LENGTH);
    for (let offset = 0; offset < CONFIG_LENGTH; offset += 28) {
      const count = Math.min(28, CONFIG_LENGTH - offset);
      const response = await this.request(COMMAND.read, offset, count);
      if (response[2] !== offset || response[3] !== count) throw new Error('Unexpected configuration chunk.');
      record.set(response.slice(4, 4 + count), offset);
    }
    return decodeConfig(record);
  }

  async save(changes) {
    const current = await this.read();
    if (this.deviceDirty) {
      throw new Error('The keypad has unsaved temporary settings. Reconnect it before saving from Studio.');
    }
    if (changes.mode !== undefined) current.mode = changes.mode;
    if (changes.brightness !== undefined) current.brightness = changes.brightness;
    if (changes.colors !== undefined) current.colors = changes.colors;
    for (const [target, action] of changes.actions || []) {
      const index = targetOrder.indexOf(target);
      if (index < 0) throw new Error('Unknown keypad control.');
      current.actions[index] = toOpenAction(action);
    }
    if (this.protocolVersion < 2 && (current.mode > 2 || current.actions.some(action => action.type === ACTION.consumer))) {
      throw new Error('Update KeypadOpen firmware before using new lighting modes or media keys.');
    }
    await this.request(COMMAND.edit, EDIT_OFFSET, EDIT_LENGTH, encodeSettings(current));
    await this.request(COMMAND.save);
    const actual = await this.read();
    if (JSON.stringify(actual) !== JSON.stringify(current)) throw new Error('The saved settings did not match read-back.');
    return actual;
  }
}

export {targetOrder};
