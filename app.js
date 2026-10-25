import {TARGETS, MODIFIERS, KEYS, MEDIA, MOUSE, LIGHTS, validateAction, validateProfile, stockBasicAction, describe, mappingPackets, lightingPackets, payload, createProfile} from './protocol.mjs';
import {OpenKeypad, isOpenDevice, supportedAction, fromOpenAction, targetOrder} from './open-adapter.mjs';
import {LIGHTING_MODES} from './keypadopen-protocol.mjs';

const element = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const storageKey = 'keypad-studio-v1';
const starterNames = ['editing', 'media', 'letters'];
const activity = [];
const sentAssignments = new Map();
let profiles = [];
let currentId;
let layer = 1;
let target = 1;
let busy = false;
let recording = false;
let device = null;
let openKeypad = null;
let descriptors = [];
let storageWarning = false;
let advanced = false;

const currentProfile = () => profiles.find(profile => profile.id === currentId);
const currentAction = () => currentProfile().layers[layer][target];
const currentTarget = () => TARGETS.find(item => item.id === target);
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function notice(message, error = false) {
  element('notice').textContent = message;
  element('notice').classList.toggle('error', error);
  element('notice').hidden = false;
}
function log(message) {
  activity.push({time: new Date().toISOString(), message});
  if (activity.length > 250) activity.shift();
  element('activity-log').textContent = activity.map(entry => `${entry.time.slice(11, 19)}  ${entry.message}`).join('\n');
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({version: 1, currentId, profiles})); }
  catch {
    if (!storageWarning) notice('Browser storage is unavailable or full. Your edits work for this session; export your profile to keep a copy.', true);
    storageWarning = true;
  }
}
function loadProfiles() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (stored) {
      if (stored.version !== 1 || !Array.isArray(stored.profiles) || !stored.profiles.length || stored.profiles.length > 100) throw new Error('Invalid saved library.');
      profiles = stored.profiles.map(profile => ({...validateProfile(profile), id: typeof profile.id === 'string' ? profile.id : crypto.randomUUID(), ...(starterNames.includes(profile.starter) ? {starter: profile.starter} : {})}));
      if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('Duplicate profile IDs.');
      currentId = profiles.some(profile => profile.id === stored.currentId) ? stored.currentId : profiles[0].id;
    }
  } catch { notice('The saved profile library could not be loaded. A fresh basic-keys draft is open; your keypad has not changed.', true); profiles = []; }
  if (!profiles.length) { profiles = [{...createProfile('letters'), id: crypto.randomUUID(), starter: 'letters'}]; currentId = profiles[0].id; }
}
function starterProfile(preset) {
  return profiles.find(profile => profile.starter === preset) || profiles.find(profile => !profile.starter && profile.name === createProfile(preset).name);
}
function populateSelect(select, choices) {
  select.replaceChildren(...choices.map(([value, name]) => {
    const option = node('option', name);
    option.value = String(value);
    return option;
  }));
}
function renderProfiles() {
  populateSelect(element('profile-select'), profiles.map(profile => [profile.id, profile.name]));
  element('profile-select').value = currentId;
  element('profile-select').title = currentProfile().name;
  element('profile-full-name').textContent = currentProfile().name;
  element('profile-full-name').hidden = currentProfile().name.length <= 30;
  element('profile-name').value = currentProfile().name;
  element('profile-caption').textContent = currentProfile().name;
  all('[data-preset]').forEach(button => {
    button.querySelector('strong span').textContent = starterProfile(button.dataset.preset) ? 'Open' : 'Create';
    button.hidden = Boolean(device?.opened && !openKeypad && !advanced && button.dataset.preset !== 'letters');
  });
  element('preset-note').textContent = openKeypad
    ? openKeypad.protocolVersion >= 2 ? 'These are local drafts. KeypadOpen v2 supports the shown media, key, click, and scroll actions.' : 'These are local drafts. KeypadOpen v1 does not support media actions.'
    : device?.opened ? 'These are local drafts. A–F plain keys were tested on our stock reference board; test other actions carefully.' : 'Starter layouts are drafts. Connect a keypad to see which actions its firmware supports.';
  element('delete-profile').disabled = busy || profiles.length === 1;
  element('confirm-delete').disabled = busy || profiles.length === 1;
}
function renderSummary() {
  const profile = currentProfile();
  all('[data-target]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.target) === target)));
  TARGETS.forEach(item => {
    const action = profile.layers[layer][item.id];
    const label = describe(action);
    const keyLabel = element(`key-label-${item.id}`);
    if (keyLabel) { keyLabel.textContent = action.type === 'unset' ? '—' : label; keyLabel.title = label; }
    const tile = element(`tile-${item.id}`);
    tile.querySelector('strong').textContent = label;
    tile.title = label;
  });
  const count = TARGETS.filter(item => profile.layers[layer][item.id].type !== 'unset').length;
  element('configured-count').textContent = `${count} of 6 actions configured`;
  element('assignment-preview').textContent = describe(currentAction());
  const action = currentAction();
  const basicStock = layer === 1 && stockBasicAction(action);
  element('feature-note').textContent = !device?.opened ? 'Connect a keypad before saving. This profile is only a local draft.' : openKeypad
    ? !supportedAction(action) ? 'This draft action is not available on KeypadOpen firmware. Choose a key, modifier, media control, click, or scroll.'
      : openKeypad.protocolVersion < 2 && action.type === 'media' ? 'Media keys require the updated KeypadOpen firmware.'
        : 'KeypadOpen saves this action to its onboard EEPROM and reads it back.'
    : action.type === 'unset' ? 'Existing device settings are left alone for this control.' : basicStock ? 'Plain-key commands were tested with A–F on our reference board; verify this key on yours.' : advanced ? 'Experimental stock command: test it carefully and keep your existing settings recorded.' : 'This stock action is unverified. Use Show experimental options to save it.';
  const sent = sentAssignments.get(`${layer}:${target}`) === JSON.stringify(currentAction());
  element('write-state').textContent = sent ? 'Sent this session' : 'Draft';
  element('save-action').textContent = `Save ${currentTarget().name} to keypad`;
  element('save-layer').textContent = `Save ${count} configured action${count === 1 ? '' : 's'}`;
  updateControls();
}
function edited() { persist(); renderSummary(); }
function renderSteps() {
  element('key-steps').replaceChildren();
  const action = currentAction();
  if (!['keyboard', 'sequence', 'modifier'].includes(action.type)) return;
  const steps = action.type === 'modifier' ? [{modifiers: action.modifiers}] : action.steps;
  steps.forEach((step, index) => {
    const wrapper = node('div', undefined, 'step');
    const row = node('div', undefined, 'step-key');
    if (action.type === 'sequence') row.append(node('span', String(index + 1).padStart(2, '0'), 'step-index'));
    if (action.type !== 'modifier') {
      const select = node('select');
      select.setAttribute('aria-label', `Key for step ${index + 1}`);
      populateSelect(select, KEYS.map(([code, name]) => [code, name]));
      select.value = String(step.key);
      select.onchange = () => { step.key = Number(select.value); edited(); };
      row.append(select);
    }
    if (action.type === 'sequence' && action.steps.length > 1) {
      const remove = node('button', '×', 'remove-step');
      remove.setAttribute('aria-label', `Remove step ${index + 1}`);
      remove.onclick = () => { action.steps.splice(index, 1); persist(); renderEditor(); };
      row.append(remove);
    }
    const modifiers = node('div', undefined, 'modifiers');
    const extraModifiers = node('details', undefined, 'extra-modifiers');
    extraModifiers.open = Boolean(step.modifiers & 240);
    extraModifiers.append(node('summary', 'Right-side modifiers'));
    const extraGroup = node('div', undefined, 'modifiers');
    MODIFIERS.forEach(([bit, name], modifierIndex) => {
      const label = node('label', undefined, 'modifier');
      const checkbox = node('input');
      checkbox.type = 'checkbox'; checkbox.checked = Boolean(step.modifiers & bit);
      checkbox.setAttribute('aria-label', `${name} for step ${index + 1}`);
      checkbox.onchange = () => {
        const next = checkbox.checked ? step.modifiers | bit : step.modifiers & ~bit;
        if (action.type === 'modifier' && next === 0) { checkbox.checked = true; notice('A modifier-only action needs at least one modifier.', true); return; }
        step.modifiers = next;
        if (action.type === 'modifier') action.modifiers = next;
        edited();
      };
      label.append(checkbox, node('span', name));
      (modifierIndex < 4 ? modifiers : extraGroup).append(label);
    });
    extraModifiers.append(extraGroup);
    wrapper.append(row, modifiers, extraModifiers); element('key-steps').append(wrapper);
  });
}
function stopRecording() {
  recording = false;
  element('capture').textContent = 'Record shortcut';
  element('capture-hint').textContent = 'Key positions follow your system keyboard layout. Reserved system/browser shortcuts may not be recordable.';
}
function renderEditor() {
  stopRecording();
  const action = currentAction();
  element('sequence-option').hidden = (!advanced || Boolean(openKeypad)) && action.type !== 'sequence';
  for (const type of ['modifier', 'media', 'mouse']) {
    const option = element('action-type').querySelector(`option[value="${type}"]`);
    option.hidden = Boolean(device?.opened && !openKeypad && !advanced && action.type !== type);
  }
  element('editor-title').textContent = currentTarget().name;
  element('action-type').value = action.type;
  element('keyboard-editor').hidden = !['keyboard', 'sequence', 'modifier'].includes(action.type);
  element('media-editor').hidden = action.type !== 'media';
  element('mouse-editor').hidden = action.type !== 'mouse';
  element('unset-help').hidden = action.type !== 'unset';
  element('add-step').hidden = action.type !== 'sequence';
  element('sequence-help').hidden = action.type !== 'sequence';
  element('capture').hidden = action.type !== 'keyboard';
  element('keys-heading').textContent = action.type === 'sequence' ? 'Sequence steps' : action.type === 'modifier' ? 'Modifier keys' : 'Key';
  if (action.type === 'media') element('media-action').value = action.action;
  if (action.type === 'mouse') element('mouse-action').value = action.action;
  renderSteps(); renderSummary();
}
function renderLighting() {
  const modern = Boolean(openKeypad);
  const connected = Boolean(device?.opened);
  const settings = currentProfile().openLighting;
  const lightingView = element('view-lighting');
  lightingView.querySelector('.page-heading p').textContent = modern
    ? openKeypad.protocolVersion >= 2 ? 'Ten RGB effects plus static colors and off.' : 'Three KeypadOpen v1 lighting modes.'
    : connected ? 'Three stock firmware effects.' : 'Connect your keypad to see its available lighting effects.';
  lightingView.querySelector('.version-tag').textContent = modern
    ? `LIGHT / ${openKeypad.protocolVersion >= 2 ? '12' : '03'}` : connected ? 'LIGHT / 03' : 'LIGHT / --';
  element('lighting-connect').hidden = connected;
  element('lighting-footer').hidden = !connected;
  element('stock-lighting-options').hidden = modern || !connected;
  element('open-lighting-options').hidden = !modern;
  element('open-lighting-controls').hidden = !modern;
  all('#open-lighting-options [data-mode]').forEach(button => {
    button.hidden = modern && openKeypad.protocolVersion < 2 && Number(button.dataset.mode) > 2;
  });
  all('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === (modern ? settings.mode : currentProfile().lighting))));
  element('lighting-selection').textContent = `${modern ? LIGHTING_MODES[settings.mode] : LIGHTS[currentProfile().lighting]} selected`;
  element('open-brightness').value = String(settings.brightness);
  element('open-brightness-value').textContent = `${settings.brightness} / 255`;
  for (let index = 0; index < 3; index++) element(`open-color-${index}`).value = settings.colors[index];
  element('lighting-description').textContent = modern ? 'Preview only. Effects run on the keypad, even when Studio is closed.' : 'Illustrations are previews. The keypad chooses the colors and timing.';
}
function renderAll() {
  renderProfiles(); element('layer').value = String(layer); renderEditor(); renderLighting();
  element('advanced-toggle').hidden = !device?.opened || Boolean(openKeypad);
  element('advanced-toggle').textContent = advanced ? 'Hide experimental options' : 'Show experimental options';
  element('layer-picker').hidden = !advanced || Boolean(openKeypad);
  element('layer-note').textContent = openKeypad ? 'KeypadOpen has one onboard layer. Profiles stay in your browser until saved.' : layer === 1 ? 'Select a key or a knob action to edit its assignment.' : 'Experimental layer. Editing does not switch the active device layer; physical layer switching is not yet verified.';
  element('layer').disabled = Boolean(openKeypad);
  element('read-open').hidden = !openKeypad;
  element('lighting-help').textContent = openKeypad ? 'Brightness and colors are saved with the selected effect. The previous firmware supports only modes 0–2; update before selecting newer effects.' : device?.opened ? 'Stock firmware offers three fixed modes and does not expose custom colors, brightness or speed.' : '';
  element('profile-caption').nextSibling.textContent = openKeypad ? ' is a local draft. Use Import device settings to replace its first-layer assignments with the keypad’s current values.' : device?.opened ? ' is a local draft. Stock firmware cannot report its saved assignments.' : ' is a local draft. Connect a keypad to see what it supports; no settings have been sent.';
}
function updateControls() {
  const connected = Boolean(device?.opened);
  element('connection-state').textContent = connected ? (openKeypad ? `KeypadOpen v${openKeypad.protocolVersion}` : 'Stock keypad connected') : 'Not connected';
  element('connection-state').classList.toggle('connected', connected);
  element('connect').hidden = connected; element('disconnect').hidden = !connected;
  all('button, select, input').forEach(control => { control.disabled = busy; });
  element('delete-profile').disabled = busy || profiles.length === 1;
  element('confirm-delete').disabled = busy || profiles.length === 1;
  element('connect').disabled = busy || !('hid' in navigator);
  for (const id of ['save-action', 'save-layer', 'save-lighting']) element(id).disabled = busy || !connected;
  if (currentAction().type === 'unset') element('save-action').disabled = true;
  if (TARGETS.every(item => currentProfile().layers[layer][item.id].type === 'unset')) element('save-layer').disabled = true;
  if (openKeypad) {
    element('layer').disabled = true;
    element('save-action').disabled ||= !supportedAction(currentAction()) || (openKeypad.protocolVersion < 2 && currentAction().type === 'media');
    element('save-layer').disabled ||= TARGETS.some(item => {
      const action = currentProfile().layers[1][item.id];
      return action.type !== 'unset' && (!supportedAction(action) || (openKeypad.protocolVersion < 2 && action.type === 'media'));
    });
    element('save-lighting').disabled ||= openKeypad.protocolVersion < 2 && currentProfile().openLighting.mode > 2;
  } else if (connected && !advanced) {
    element('save-action').disabled ||= layer !== 1 || !stockBasicAction(currentAction());
    element('save-layer').disabled ||= layer !== 1 || TARGETS.some(item => !stockBasicAction(currentProfile().layers[1][item.id]));
  }
  element('add-step').disabled = busy || (currentAction().steps?.length || 0) >= 5;
}
async function operation(callback) {
  if (busy) return;
  stopRecording(); busy = true; updateControls();
  try { await callback(); }
  catch (error) { notice(error.message || String(error), true); log(`${error.name || 'Error'}: ${error.message || error}`); }
  finally { busy = false; renderSummary(); }
}
function changeView(view) {
  stopRecording();
  all('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  all('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
  element('view-name').textContent = {configure: 'Configure', lighting: 'Lighting', profiles: 'Profiles', test: 'Test keypad'}[view];
  const heading = element(`view-${view}`).querySelector('h1');
  heading.tabIndex = -1;
  heading.focus({preventScroll: true});
  heading.scrollIntoView({block: 'start', behavior: 'instant'});
}
const flatten = collections => collections.flatMap(collection => [collection, ...flatten(collection.children || [])]);
function candidate(devices) {
  return devices.filter(item => item.vendorId === 0x1189 && item.productId === 0x8890 && flatten(item.collections).some(collection => collection.usagePage === 0xff00 && collection.usage === 1 && collection.outputReports.some(report => report.reportId === 3 && report.items.reduce((size, item) => size + item.reportSize * item.reportCount, 0) === 512)));
}
function onInput(event) {
  log(`Vendor input ${event.reportId}: ${Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength), byte => byte.toString(16).padStart(2, '0')).join(' ')}`);
}
async function disconnect() {
  if (openKeypad) await openKeypad.close();
  else if (device) { device.removeEventListener('inputreport', onInput); if (device.opened) await device.close(); }
  openKeypad = null;
  device = null; sentAssignments.clear();
  advanced = false; layer = 1;
  element('device-summary').textContent = 'Disconnected. Your keypad keeps its saved assignments.';
  log('Disconnected.');
  renderAll();
}
async function connect() {
  let devices = await navigator.hid.getDevices();
  let choices = [...candidate(devices), ...devices.filter(isOpenDevice)];
  if (choices.length !== 1) {
    devices = await navigator.hid.requestDevice({filters: [
      {vendorId: 0x1189, productId: 0x8890, usagePage: 0xff00, usage: 1},
      {vendorId: 0x1209, productId: 0xc55d, usagePage: 0xff60, usage: 0x61},
    ]});
    if (!devices.length) { notice('No keypad selected. Click Connect keypad to try again.'); return; }
    choices = [...candidate(devices), ...devices.filter(isOpenDevice)];
  }
  if (choices.length !== 1) throw new Error('Select one supported keypad. Disconnect other matching keypads if needed.');
  await disconnect();
  const selected = choices[0];
  const replacement = isOpenDevice(selected);
  try {
    if (replacement) {
      openKeypad = new OpenKeypad(selected);
      await openKeypad.open();
    } else if (!selected.opened) await selected.open();
  }
  catch (error) { openKeypad = null; throw new Error(`Could not open or identify the keypad. Close other configurators and reconnect. ${error.message}`); }
  device = selected;
  if (!replacement) device.addEventListener('inputreport', onInput);
  if (replacement) layer = 1;
  descriptors = devices.map(item => ({productName: item.productName, vendorId: item.vendorId, productId: item.productId, collections: item.collections}));
  element('descriptors').textContent = JSON.stringify(descriptors, null, 2);
  element('device-summary').textContent = 'Mini Keypad · USB 1189:8890 · vendor report 3 · 64-byte payload · standard Windows HID driver';
  if (replacement) {
    element('device-summary').textContent = `KeypadOpen · USB 1209:C55D · protocol ${openKeypad.protocolVersion} · 32-byte Raw HID`;
  }
  notice(replacement ? 'KeypadOpen connected. Settings were read, but your local profile was not changed. Use Import device settings if desired.' : 'Stock keypad connected. Your draft is ready to edit; no settings have been changed.');
  log(`Opened ${replacement ? 'KeypadOpen' : 'stock'} interface. No configuration writes on connection.`);
  renderAll();
}
async function send(bytes) {
  const connectedDevice = device;
  if (!connectedDevice?.opened) throw new Error('Keypad disconnected. Reconnect before saving.');
  await connectedDevice.sendReport(3, payload(bytes));
  log(`USB report 3: ${bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ')} (zero-padded to 64 bytes)`);
}
async function saveMappings(selectedTargets) {
  const selectedLayer = layer;
  const assignments = selectedTargets.map(item => ({...item, action: validateAction(currentProfile().layers[selectedLayer][item.id])})).filter(item => item.action.type !== 'unset');
  if (openKeypad) {
    if (selectedLayer !== 1) throw new Error('KeypadOpen has only one onboard layer.');
    if (!assignments.length) throw new Error('Choose an assignment before saving.');
    if (assignments.some(item => !supportedAction(item.action))) throw new Error('A selected action is not supported by KeypadOpen. No settings were written.');
    await openKeypad.save({actions: assignments.map(item => [item.id, item.action])});
    assignments.forEach(item => sentAssignments.set(`1:${item.id}`, JSON.stringify(item.action)));
    notice(`Saved and read back ${assignments.length} action${assignments.length === 1 ? '' : 's'} on KeypadOpen.`);
    log(`KeypadOpen saved and read back ${assignments.length} action(s).`);
    return;
  }
  if (!advanced && (selectedLayer !== 1 || assignments.some(item => !stockBasicAction(item.action)))) {
    throw new Error('This stock assignment is unverified. Enable experimental options before saving it.');
  }
  const jobs = assignments.map(item => ({...item, packets: mappingPackets(selectedLayer, item.id, item.action)}));
  if (!jobs.length) throw new Error('Choose an assignment before saving.');
  let completed = 0;
  try {
    for (const job of jobs) {
      sentAssignments.delete(`${selectedLayer}:${job.id}`);
      notice(`Saving ${job.name} · ${completed + 1} of ${jobs.length}…`);
      for (const packet of job.packets) await send(packet);
      sentAssignments.set(`${selectedLayer}:${job.id}`, JSON.stringify(job.action));
      log(`Layer ${selectedLayer}, ${job.name}: ${describe(job.action)} — assignment and save sent.`);
      completed++;
    }
    notice(`Sent ${completed} assignment${completed === 1 ? '' : 's'} to layer ${selectedLayer}. Try ${completed === 1 ? jobs[0].name : 'each control'} in Test keypad to verify. The device does not provide readback confirmation.`);
  } catch (error) { throw new Error(`${completed} of ${jobs.length} assignments sent before an error. The interrupted assignment may be partially changed. Reconnect and save the desired assignments again. ${error.message}`); }
}
function download(filename, content) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], {type: 'application/json'}));
  const link = node('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function addProfile(profile, starter) {
  if (profiles.length >= 100) throw new Error('The library holds up to 100 profiles. Export profiles to keep portable copies.');
  const added = {...validateProfile(profile), id: crypto.randomUUID(), ...(starter ? {starter} : {})};
  profiles.push(added); currentId = added.id; layer = 1; target = 1;
  element('delete-confirm').hidden = true;
  persist(); renderAll(); notice(`“${added.name}” opened as a draft. Nothing has been sent to the keypad.`);
}

function openStarter(preset) {
  const existing = starterProfile(preset);
  if (!existing) { addProfile(createProfile(preset), preset); return; }
  existing.starter = preset;
  currentId = existing.id; layer = 1; target = 1;
  element('delete-confirm').hidden = true;
  persist(); renderAll(); notice(`Opened "${existing.name}". No new profile was created or sent to the keypad.`);
}

LIGHTING_MODES.forEach((name, mode) => {
  const card = node('button', undefined, 'light-card open-light-card');
  card.dataset.mode = String(mode);
  card.setAttribute('aria-pressed', 'false');
  const demo = node('div', undefined, `light-demo open-demo open-mode-${mode}`);
  demo.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index++) demo.append(node('i'));
  card.append(demo, node('span', `MODE ${String(mode).padStart(2, '0')}`, 'eyebrow'), node('h2', name));
  element('open-lighting-options').append(card);
});
loadProfiles();
TARGETS.forEach(item => {
  const button = node('button', undefined, 'assignment-tile');
  button.id = `tile-${item.id}`; button.dataset.target = String(item.id);
  button.append(node('small', item.name), node('strong', ''));
  button.setAttribute('aria-label', `Edit ${item.name} assignment`);
  element('assignment-list').append(button);
});
populateSelect(element('media-action'), Object.entries(MEDIA).map(([key, value]) => [key, value.name]));
populateSelect(element('mouse-action'), Object.entries(MOUSE).map(([key, value]) => [key, value.name]));
all('[data-view]').forEach(button => { button.onclick = () => changeView(button.dataset.view); });
let assignmentTrigger = null;
all('[data-target]').forEach(button => { button.onclick = () => {
  assignmentTrigger = button;
  target = Number(button.dataset.target);
  renderEditor();
  if (window.matchMedia('(max-width: 1199px)').matches) {
    const editor = element('editor-title').closest('.editor');
    element('editor-title').tabIndex = -1;
    element('editor-title').focus({preventScroll: true});
    editor.scrollIntoView({block: 'start', behavior: 'instant'});
  }
}; });
element('back-to-keypad').onclick = () => {
  const control = assignmentTrigger?.isConnected && Number(assignmentTrigger.dataset.target) === target
    ? assignmentTrigger
    : document.querySelector(`.keycap[data-target="${target}"]`) || element('device-heading');
  control.focus({preventScroll: true});
  control.scrollIntoView({block: 'center', behavior: 'instant'});
};
element('layer').onchange = () => { layer = Number(element('layer').value); renderAll(); };
element('advanced-toggle').onclick = () => { advanced = !advanced; if (!advanced) layer = 1; renderAll(); };
element('action-type').onchange = () => {
  const type = element('action-type').value;
  const previous = currentAction();
  currentProfile().layers[layer][target] = ['keyboard', 'sequence'].includes(type) ? {type, steps: previous.steps ? structuredClone(previous.steps.slice(0, type === 'keyboard' ? 1 : 5)) : [{key: 4, modifiers: 0}]} : type === 'modifier' ? {type, modifiers: previous.steps?.[0]?.modifiers || previous.modifiers || 1} : type === 'media' ? {type, action: 'play'} : type === 'mouse' ? {type, action: 'left'} : {type: 'unset'};
  persist(); renderEditor();
};
element('add-step').onclick = () => { if (currentAction().steps.length < 5) currentAction().steps.push({key: 4, modifiers: 0}); persist(); renderEditor(); };
for (const type of ['media', 'mouse']) element(`${type}-action`).onchange = () => { currentAction().action = element(`${type}-action`).value; edited(); };
element('capture').onclick = () => {
  if (recording) { stopRecording(); return; }
  recording = true; element('capture').textContent = 'Cancel recording';
  element('capture-hint').textContent = 'Press a key with optional Ctrl, Shift, Alt or Win/Cmd. Escape cancels; use the key menu to assign Escape. Tab cancels and moves focus.';
};
document.addEventListener('keydown', event => {
  if (!recording) return;
  if (event.key === 'Tab') { stopRecording(); return; }
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { stopRecording(); return; }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  const key = KEYS.find(([, , code]) => code === event.code);
  if (!key) { element('capture-hint').textContent = 'This key cannot be recorded. Choose a supported key from the menu.'; return; }
  currentProfile().layers[layer][target] = {type: 'keyboard', steps: [{key: key[0], modifiers: (event.ctrlKey ? 1 : 0) | (event.shiftKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0)}]};
  persist(); renderEditor();
}, true);
window.addEventListener('blur', stopRecording);
element('connect').onclick = () => operation(connect);
element('disconnect').onclick = () => operation(async () => { await disconnect(); notice('Disconnected. The keypad keeps working with its saved settings.'); });
element('save-action').onclick = () => operation(() => saveMappings([currentTarget()]));
element('save-layer').onclick = () => operation(() => saveMappings(TARGETS));
all('[data-mode]').forEach(button => { button.onclick = () => {
  if (openKeypad) currentProfile().openLighting.mode = Number(button.dataset.mode);
  else currentProfile().lighting = Number(button.dataset.mode);
  persist(); renderLighting();
}; });
element('open-brightness').oninput = () => {
  currentProfile().openLighting.brightness = Number(element('open-brightness').value);
  persist(); renderLighting();
};
for (let index = 0; index < 3; index++) element(`open-color-${index}`).oninput = () => {
  currentProfile().openLighting.colors[index] = element(`open-color-${index}`).value;
  persist(); renderLighting();
};
element('save-lighting').onclick = () => operation(async () => {
  if (openKeypad) {
    await openKeypad.save(currentProfile().openLighting);
    notice(`${LIGHTING_MODES[currentProfile().openLighting.mode]} saved and read back on KeypadOpen.`);
    log(`KeypadOpen lighting mode ${currentProfile().openLighting.mode} saved and read back.`);
    return;
  }
  const mode = currentProfile().lighting;
  try { for (const packet of lightingPackets(mode)) await send(packet); }
  catch (error) { throw new Error(`Lighting write interrupted; the effect or save may be incomplete. Reconnect and save the mode again. ${error.message}`); }
  notice(`${LIGHTS[mode]} sent and save requested. Check the physical LEDs.`);
});
element('profile-select').onchange = () => { currentId = element('profile-select').value; layer = 1; target = 1; element('delete-confirm').hidden = true; persist(); renderAll(); notice('Profile switched locally. Save assignments to apply them to your keypad.'); };
element('rename-profile').onclick = () => operation(async () => {
  const name = element('profile-name').value.trim();
  if (!name || name.length > 60) throw new Error('Use a profile name between 1 and 60 characters.');
  currentProfile().name = name; persist(); renderProfiles(); notice('Profile renamed locally.');
});
element('duplicate-profile').onclick = () => operation(async () => { const copy = structuredClone(currentProfile()); copy.name = `${copy.name.slice(0, 53)} (copy)`; addProfile(copy); });
element('new-profile').onclick = () => operation(async () => addProfile(createProfile()));
all('[data-preset]').forEach(button => { button.onclick = () => operation(async () => openStarter(button.dataset.preset)); });
element('delete-profile').onclick = () => {
  element('delete-confirm-name').textContent = currentProfile().name;
  element('delete-confirm').hidden = false;
  element('cancel-delete').focus();
};
element('cancel-delete').onclick = () => { element('delete-confirm').hidden = true; element('delete-profile').focus(); };
element('confirm-delete').onclick = async () => {
  await operation(async () => {
    if (profiles.length === 1) throw new Error('Keep at least one profile in the library.');
    const removed = currentProfile().name;
    profiles = profiles.filter(profile => profile.id !== currentId);
    currentId = profiles[0].id; layer = 1; target = 1;
    element('delete-confirm').hidden = true;
    persist(); renderAll(); notice(`Deleted "${removed}" from this browser. The keypad was not changed.`);
  });
  element('profile-select').focus();
};
element('export-profile').onclick = () => download('keypad-profile.json', {format: 'keypad-studio', version: 1, profile: validateProfile(currentProfile())});
element('import-profile').onclick = () => element('profile-file').click();
element('profile-file').onchange = () => operation(async () => {
  const file = element('profile-file').files[0]; element('profile-file').value = '';
  if (!file) return;
  if (file.size > 100000) throw new Error('This profile file is too large. Maximum size is 100 KB.');
  let imported;
  try { imported = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Choose an exported Keypad Studio profile.'); }
  if (imported.format !== 'keypad-studio' || imported.version !== 1) throw new Error('Unsupported profile format. Choose a Keypad Studio version 1 export.');
  addProfile(imported.profile);
});
element('read-open').onclick = () => operation(async () => {
  if (!openKeypad) throw new Error('Connect a KeypadOpen keypad first.');
  if (!window.confirm('Replace this profile’s first-layer actions and lighting draft with current device settings? Other layers stay unchanged.')) return;
  const settings = await openKeypad.read();
  targetOrder.forEach((id, index) => { currentProfile().layers[1][id] = fromOpenAction(settings.actions[index]); });
  currentProfile().openLighting = {mode: settings.mode, brightness: settings.brightness, colors: [...settings.colors]};
  persist(); renderAll();
  notice('Current device settings imported into this local profile. Nothing was written to the keypad.');
});
element('clear-log').onclick = () => { activity.length = 0; log('Activity cleared.'); };
element('export-diagnostics').onclick = () => download('keypad-diagnostics.json', {capturedAt: new Date().toISOString(), browser: navigator.userAgent, secureContext: isSecureContext, devices: descriptors, activity});
function testEvent(value, detail) {
  element('test-value').textContent = value; element('test-detail').textContent = detail;
  element('test-history').append(node('span', value));
  while (element('test-history').children.length > 12) element('test-history').firstChild.remove();
  log(`Test: ${value} · ${detail}`);
}
element('test-pad').onkeydown = event => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  const modifiers = [event.ctrlKey && 'Ctrl', event.shiftKey && 'Shift', event.altKey && 'Alt', event.metaKey && 'Win/Cmd'].filter(Boolean);
  testEvent([...modifiers, event.code].join(' + '), event.repeat ? 'Key held / repeated' : 'Keyboard event — source device cannot be identified by browser');
};
element('test-pad').addEventListener('wheel', event => { if (document.activeElement !== element('test-pad')) return; event.preventDefault(); testEvent(event.deltaY < 0 ? 'Scroll up' : 'Scroll down', `Wheel delta ${event.deltaY}`); }, {passive: false});
element('test-pad').addEventListener('pointerdown', event => { element('test-pad').focus(); testEvent(['Left click', 'Middle click', 'Right click'][event.button] || 'Mouse click', 'Mouse event'); if (event.button === 1) event.preventDefault(); });
element('test-pad').oncontextmenu = event => event.preventDefault();
if ('hid' in navigator) navigator.hid.addEventListener('disconnect', event => {
  if (event.device !== device) return;
  device = null; openKeypad = null; advanced = false; layer = 1; sentAssignments.clear(); notice('Keypad unplugged. Your local draft is still here.'); log('Device unplugged.'); renderAll();
});
renderAll();
if (!('hid' in navigator)) notice('This browser does not support WebHID. You can edit drafts here; use desktop Chrome or Edge to connect the keypad.', true);
