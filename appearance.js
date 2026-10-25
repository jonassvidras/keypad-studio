(() => {
  'use strict';
  const storageKey = 'keypad-studio-appearance';
  const modes = ['light', 'dark', 'system'];
  const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const themeColors = {
    light: themeMetas.find(meta => meta.media.includes('light'))?.content,
    dark: themeMetas.find(meta => meta.media.includes('dark'))?.content,
  };
  const browserTheme = themeMetas[0];
  themeMetas.slice(1).forEach(meta => meta.remove());
  browserTheme?.removeAttribute('media');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(storageKey);
    if (modes.includes(saved)) preference = saved;
  } catch {}

  function applyAppearance() {
    const resolved = preference === 'system' ? (systemAppearance.matches ? 'dark' : 'light') : preference;
    root.dataset.appearance = preference;
    root.dataset.colorScheme = resolved;
    if (browserTheme && themeColors[resolved]) browserTheme.content = themeColors[resolved];
    document.querySelectorAll('.appearance-switch [data-appearance]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.appearance === preference));
      if (button.dataset.appearance === 'system') {
        button.title = `Follow your system setting (currently ${resolved})`;
      }
    });
  }
  applyAppearance();
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.appearance-switch [data-appearance]').forEach(button => {
      button.addEventListener('click', () => {
        const selected = button.dataset.appearance;
        if (!modes.includes(selected)) return;
        preference = selected;
        try { localStorage.setItem(storageKey, preference); } catch {}
        applyAppearance();
      });
    });
    applyAppearance();
  }, {once: true});
  systemAppearance.addEventListener('change', () => {
    if (preference === 'system') applyAppearance();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = modes.includes(event.newValue) ? event.newValue : 'system';
    applyAppearance();
  });
})();
