export const TARGETS = [
  {id: 1, name: 'Key 1'}, {id: 2, name: 'Key 2'}, {id: 3, name: 'Key 3'},
  {id: 13, name: 'Knob left'}, {id: 14, name: 'Knob push'}, {id: 15, name: 'Knob right'}
];
export const MODIFIERS = [[1, 'Ctrl'], [2, 'Shift'], [4, 'Alt'], [8, 'Win / Cmd'], [16, 'Right Ctrl'], [32, 'Right Shift'], [64, 'Right Alt'], [128, 'Right Win / Cmd']];
export const KEYS = [
  ...Array.from({length: 26}, (_, index) => [4 + index, String.fromCharCode(65 + index), `Key${String.fromCharCode(65 + index)}`]),
  ...Array.from({length: 9}, (_, index) => [30 + index, String(index + 1), `Digit${index + 1}`]),
  [39, '0', 'Digit0'], [40, 'Enter', 'Enter'], [41, 'Escape', 'Escape'], [42, 'Backspace', 'Backspace'], [43, 'Tab', 'Tab'], [44, 'Space', 'Space'],
  [45, 'Minus', 'Minus'], [46, 'Equals', 'Equal'], [47, '[', 'BracketLeft'], [48, ']', 'BracketRight'], [49, 'Backslash', 'Backslash'],
  [51, 'Semicolon', 'Semicolon'], [52, 'Quote', 'Quote'], [53, 'Backtick', 'Backquote'], [54, 'Comma', 'Comma'], [55, 'Period', 'Period'], [56, 'Slash', 'Slash'], [57, 'Caps Lock', 'CapsLock'],
  ...Array.from({length: 12}, (_, index) => [58 + index, `F${index + 1}`, `F${index + 1}`]),
  [70, 'Print Screen', 'PrintScreen'], [71, 'Scroll Lock', 'ScrollLock'], [72, 'Pause', 'Pause'], [73, 'Insert', 'Insert'], [74, 'Home', 'Home'], [75, 'Page Up', 'PageUp'], [76, 'Delete', 'Delete'], [77, 'End', 'End'], [78, 'Page Down', 'PageDown'],
  [79, 'Right arrow', 'ArrowRight'], [80, 'Left arrow', 'ArrowLeft'], [81, 'Down arrow', 'ArrowDown'], [82, 'Up arrow', 'ArrowUp'],
  [83, 'Num Lock', 'NumLock'], [84, 'Numpad /', 'NumpadDivide'], [85, 'Numpad *', 'NumpadMultiply'], [86, 'Numpad −', 'NumpadSubtract'], [87, 'Numpad +', 'NumpadAdd'], [88, 'Numpad Enter', 'NumpadEnter'],
  ...Array.from({length: 9}, (_, index) => [89 + index, `Numpad ${index + 1}`, `Numpad${index + 1}`]),
  [98, 'Numpad 0', 'Numpad0'], [99, 'Numpad .', 'NumpadDecimal'], [101, 'Menu', 'ContextMenu']
];
export const MEDIA = {play: {name: 'Play / pause', usage: 0xcd}, previous: {name: 'Previous track', usage: 0xb6}, next: {name: 'Next track', usage: 0xb5}, mute: {name: 'Mute', usage: 0xe2}, volumeUp: {name: 'Volume up', usage: 0xe9}, volumeDown: {name: 'Volume down', usage: 0xea}};
export const MOUSE = {left: {name: 'Left click', bytes: [1, 0, 0, 0, 0]}, right: {name: 'Right click', bytes: [2, 0, 0, 0, 0]}, middle: {name: 'Middle click', bytes: [4, 0, 0, 0, 0]}, wheelUp: {name: 'Scroll up', bytes: [0, 0, 0, 1, 0]}, wheelDown: {name: 'Scroll down', bytes: [0, 0, 0, 255, 0]}};
for (const [modifier, label] of MODIFIERS.slice(0, 3)) {
  for (const [direction, wheel] of [['Up', 1], ['Down', 255]]) MOUSE[`${label.toLowerCase()}Wheel${direction}`] = {name: `${label} + scroll ${direction.toLowerCase()}`, bytes: [0, 0, 0, wheel, modifier]};
}
export const LIGHTS = ['Lights out', 'Last-key breathing', 'Color chase'];
export const DEFAULT_OPEN_LIGHTING = {mode: 1, brightness: 48, colors: ['#0078ff', '#b400c8', '#ff4600']};
export function validateAction(action) {
  if (!action || typeof action !== 'object') throw new Error('Invalid assignment.');
  if (action.type === 'unset') return {type: 'unset'};
  if (action.type === 'modifier') {
    if (!Number.isInteger(action.modifiers) || action.modifiers < 1 || action.modifiers > 255) throw new Error('Choose at least one modifier key.');
    return {type: 'modifier', modifiers: action.modifiers};
  }
  if (['keyboard', 'sequence'].includes(action.type)) {
    if (!Array.isArray(action.steps) || action.steps.length < 1 || action.steps.length > 5 || (action.type === 'keyboard' && action.steps.length !== 1)) throw new Error('Choose one key, or a sequence of up to five keys.');
    return {type: action.type, steps: action.steps.map(step => {
      if (!step || !KEYS.some(([code]) => code === step.key) || !Number.isInteger(step.modifiers) || step.modifiers < 0 || step.modifiers > 255) throw new Error('Invalid key or modifier in profile.');
      return {key: step.key, modifiers: step.modifiers};
    })};
  }
  if (action.type === 'media' && Object.hasOwn(MEDIA, action.action)) return {type: 'media', action: action.action};
  if (action.type === 'mouse' && Object.hasOwn(MOUSE, action.action)) return {type: 'mouse', action: action.action};
  throw new Error('Unknown action type.');
}
export function stockBasicAction(rawAction) {
  const action = validateAction(rawAction);
  return action.type === 'unset' ||
    (action.type === 'keyboard' && action.steps[0].modifiers === 0);
}
export function describe(action) {
  if (action.type === 'unset') return 'Leave unchanged';
  if (action.type === 'modifier') return MODIFIERS.filter(([bit]) => action.modifiers & bit).map(([, name]) => name).join(' + ');
  if (action.type === 'media') return MEDIA[action.action].name;
  if (action.type === 'mouse') return MOUSE[action.action].name;
  return action.steps.map(step => [...MODIFIERS.filter(([bit]) => step.modifiers & bit).map(([, name]) => name), KEYS.find(([code]) => code === step.key)[1]].join(' + ')).join(' → ');
}
export function mappingPackets(layer, target, rawAction) {
  if (![1, 2, 3].includes(layer) || !TARGETS.some(item => item.id === target)) throw new Error('Invalid layer or control.');
  const action = validateAction(rawAction);
  if (action.type === 'unset') return [];
  const packets = [[0xa1, layer]];
  if (action.type === 'modifier') packets.push([target, (layer << 4) | 1, 0, 0, action.modifiers, 0]);
  else if (['keyboard', 'sequence'].includes(action.type)) {
    packets.push([target, (layer << 4) | 1, action.steps.length, 0, action.steps[0].modifiers, 0]);
    action.steps.forEach((step, index) => packets.push([target, (layer << 4) | 1, action.steps.length, index + 1, step.modifiers, step.key]));
  } else if (action.type === 'media') {
    const usage = MEDIA[action.action].usage;
    packets.push([target, (layer << 4) | 2, usage & 255, usage >> 8]);
  } else packets.push([target, (layer << 4) | 3, ...MOUSE[action.action].bytes]);
  packets.push([0xaa, 0xaa]);
  return packets;
}
export function lightingPackets(mode) {
  if (![0, 1, 2].includes(mode)) throw new Error('Unknown lighting mode.');
  return [[0xa1, 1], [0xb0, 0x18, mode], [0xaa, 0xa1]];
}
export function payload(bytes) {
  if (!Array.isArray(bytes) || bytes.length > 64 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Invalid USB payload.');
  const data = new Uint8Array(64);
  data.set(bytes);
  return data;
}
export function validateProfile(profile) {
  if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 60 || ![0, 1, 2].includes(profile.lighting)) throw new Error('Invalid profile name or lighting mode.');
  const layers = {};
  for (const layer of [1, 2, 3]) {
    if (!profile.layers?.[layer]) throw new Error(`Profile is missing layer ${layer}.`);
    layers[layer] = Object.fromEntries(TARGETS.map(target => [target.id, validateAction(profile.layers[layer][target.id])]));
  }
  const openLighting = profile.openLighting || DEFAULT_OPEN_LIGHTING;
  if (!Number.isInteger(openLighting.mode) || openLighting.mode < 0 || openLighting.mode > 11 ||
      !Number.isInteger(openLighting.brightness) || openLighting.brightness < 0 || openLighting.brightness > 255 ||
      !Array.isArray(openLighting.colors) || openLighting.colors.length !== 3 ||
      openLighting.colors.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('Invalid KeypadOpen lighting settings.');
  }
  return {name: profile.name.trim(), lighting: profile.lighting,
    openLighting: {mode: openLighting.mode, brightness: openLighting.brightness, colors: [...openLighting.colors]}, layers};
}
export function createProfile(preset = 'blank') {
  const profile = {name: {blank: 'Untitled profile', letters: 'Basic keys', media: 'Media desk', editing: 'Everyday editing'}[preset] || 'Untitled profile', lighting: 2, openLighting: structuredClone(DEFAULT_OPEN_LIGHTING), layers: {}};
  for (const layer of [1, 2, 3]) profile.layers[layer] = Object.fromEntries(TARGETS.map(target => [target.id, {type: 'unset'}]));
  const keyboard = (key, modifiers = 0) => ({type: 'keyboard', steps: [{key, modifiers}]});
  let actions;
  if (preset === 'letters') actions = TARGETS.map((_, index) => keyboard(4 + index));
  if (preset === 'media') actions = ['previous', 'play', 'next', 'volumeDown', 'mute', 'volumeUp'].map(action => ({type: 'media', action}));
  if (preset === 'editing') actions = [keyboard(6, 1), keyboard(25, 1), keyboard(29, 1), ...['wheelUp', 'middle', 'wheelDown'].map(action => ({type: 'mouse', action}))];
  if (actions) TARGETS.forEach((target, index) => { profile.layers[1][target.id] = actions[index]; });
  return profile;
}
