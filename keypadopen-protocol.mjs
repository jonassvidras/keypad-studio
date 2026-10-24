export const DEVICE_FILTER = { vendorId: 0x1209, productId: 0xc55d };
export const COLLECTION = { usagePage: 0xff60, usage: 0x61 };
export const REPORT_LENGTH = 32;
export const CONFIG_LENGTH = 64;
export const EDIT_OFFSET = 4;
export const EDIT_LENGTH = 29;
export const LIGHTING_MODES = [
  'Off', 'Static colors', 'Rainbow cycle', 'Breathing', 'Color wave',
  'Comet', 'Reactive key', 'Ripple', 'Starlight', 'Color cycle',
  'Alternating', 'Spectrum',
];

export const COMMAND = Object.freeze({
  info: 1,
  read: 2,
  edit: 3,
  save: 4,
  defaults: 5,
});

export const ACTION = Object.freeze({
  none: 0,
  keyboard: 1,
  scroll: 2,
  mouseButton: 3,
  consumer: 4,
});

const defaultActions = [
  [ACTION.keyboard, 0, 0x04],
  [ACTION.keyboard, 0, 0x05],
  [ACTION.keyboard, 0, 0x06],
  [ACTION.keyboard, 0, 0x28],
  [ACTION.scroll, 0, -1],
  [ACTION.scroll, 0, 1],
];

export function defaultSettings() {
  return {
    mode: 1,
    brightness: 48,
    colors: ['#0078ff', '#b400c8', '#ff4600'],
    actions: defaultActions.map(([type, modifiers, code]) => ({ type, modifiers, code })),
  };
}

function byte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be an integer from 0 to 255.`);
  }
  return value;
}

function validateAction(action, index) {
  if (!action || !Number.isInteger(action.type) || action.type < 0 || action.type > 4) {
    throw new Error(`Control ${index + 1} has an invalid action type.`);
  }
  byte(action.modifiers, `Control ${index + 1} modifiers`);
  if (action.type === ACTION.keyboard) {
    byte(action.code, `Control ${index + 1} key usage`);
    if (action.code > 0 && (action.code < 4 || (action.code >= 0xe0 && action.code <= 0xe7))) {
      throw new Error(`Control ${index + 1} has an invalid key usage.`);
    }
  } else if (action.type === ACTION.scroll) {
    if (!Number.isInteger(action.code) || action.code < -127 || action.code > 127 || action.code === 0) {
      throw new Error(`Control ${index + 1} scroll must be -127…-1 or 1…127.`);
    }
  } else if (action.type === ACTION.mouseButton) {
    if (![1, 2, 4].includes(action.code)) {
      throw new Error(`Control ${index + 1} mouse button is invalid.`);
    }
  } else if (action.type === ACTION.consumer) {
    if (![0xcd, 0xb6, 0xb5, 0xe2, 0xe9, 0xea].includes(action.code)) {
      throw new Error(`Control ${index + 1} media usage is invalid.`);
    }
  }
}

export function validateSettings(settings) {
  if (!settings || !Number.isInteger(settings.mode) || settings.mode < 0 || settings.mode >= LIGHTING_MODES.length) {
    throw new Error('Unknown LED mode.');
  }
  byte(settings.brightness, 'Brightness');
  if (!Array.isArray(settings.colors) || settings.colors.length !== 3) {
    throw new Error('Exactly three LED colors are required.');
  }
  for (const color of settings.colors) {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error('Each LED color must be a six-digit hex color.');
    }
  }
  if (!Array.isArray(settings.actions) || settings.actions.length !== 6) {
    throw new Error('Exactly six control actions are required.');
  }
  settings.actions.forEach(validateAction);
  return settings;
}

export function decodeConfig(record) {
  if (!(record instanceof Uint8Array) || record.length !== CONFIG_LENGTH) {
    throw new Error('The device returned an incomplete configuration.');
  }
  if (record[0] !== 0x4b || record[1] !== 0x50 || record[2] !== 1) {
    throw new Error('The device returned an unknown configuration format.');
  }
  const colors = [];
  for (let index = 0; index < 3; index++) {
    colors.push(`#${Array.from(record.slice(6 + index * 3, 9 + index * 3),
      value => value.toString(16).padStart(2, '0')).join('')}`);
  }
  const actions = [];
  for (let index = 0; index < 6; index++) {
    const offset = 15 + index * 3;
    const code = record[offset] === ACTION.scroll
      ? (record[offset + 2] << 24) >> 24
      : record[offset + 2];
    actions.push({ type: record[offset], modifiers: record[offset + 1], code });
  }
  return validateSettings({ mode: record[4], brightness: record[5], colors, actions });
}

export function encodeSettings(settings) {
  validateSettings(settings);
  const bytes = new Uint8Array(EDIT_LENGTH);
  bytes[0] = settings.mode;
  bytes[1] = settings.brightness;
  for (let index = 0; index < 3; index++) {
    const color = settings.colors[index];
    for (let channel = 0; channel < 3; channel++) {
      bytes[2 + index * 3 + channel] = Number.parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16);
    }
  }
  for (let index = 0; index < 6; index++) {
    const action = settings.actions[index];
    const offset = 11 + index * 3;
    bytes[offset] = action.type;
    bytes[offset + 1] = action.modifiers;
    bytes[offset + 2] = action.code & 0xff;
  }
  return bytes;
}

export function makeReport(command, offset = 0, count = 0, data = []) {
  byte(command, 'Command');
  const report = new Uint8Array(REPORT_LENGTH);
  report[0] = command;
  if (command === COMMAND.read) {
    if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count < 1 ||
        count > 28 || offset + count > CONFIG_LENGTH) {
      throw new Error('Invalid configuration read range.');
    }
    report[1] = offset;
    report[2] = count;
  } else if (command === COMMAND.edit) {
    if (offset !== EDIT_OFFSET || data.length !== EDIT_LENGTH || count !== EDIT_LENGTH) {
      throw new Error('The full settings payload is required for an edit.');
    }
    report[1] = offset;
    report[2] = count;
    report.set(data, 3);
  }
  return report;
}

export function checkResponse(report, command) {
  if (!(report instanceof Uint8Array) || report.length !== REPORT_LENGTH || report[0] !== command) {
    throw new Error('Unexpected response from keypad.');
  }
  if (report[1] !== 0) {
    const failures = { 1: 'Invalid range', 2: 'Invalid configuration', 3: 'EEPROM verification failed' };
    throw new Error(failures[report[1]] || `Device error ${report[1]}`);
  }
  return report;
}
