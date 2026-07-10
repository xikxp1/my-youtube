(function initPopup() {
  "use strict";

  const { DEFAULT_SETTINGS, normalizeSettings } = globalThis.MyYouTubeCore;
  const progressInput = document.querySelector("#progressBarEnabled");
  const speedInput = document.querySelector("#defaultPlaybackRate");
  const qualityInput = document.querySelector("#defaultQuality");
  const status = document.querySelector("#status");
  let statusTimer = 0;

  function render(settings) {
    progressInput.checked = settings.progressBarEnabled;
    speedInput.value = String(settings.defaultPlaybackRate);
    qualityInput.value = settings.defaultQuality;
  }

  function showStatus(message) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }

  async function saveSettings() {
    const settings = normalizeSettings({
      progressBarEnabled: progressInput.checked,
      defaultPlaybackRate: Number(speedInput.value),
      defaultQuality: qualityInput.value,
    });

    try {
      await chrome.storage.sync.set(settings);
      render(settings);
      showStatus("Saved and applied to open videos");
    } catch {
      showStatus("Could not save settings");
    }
  }

  for (const input of [progressInput, speedInput, qualityInput]) {
    input.addEventListener("change", saveSettings);
  }

  chrome.storage.sync
    .get(DEFAULT_SETTINGS)
    .then((stored) => render(normalizeSettings(stored)))
    .catch(() => {
      render(DEFAULT_SETTINGS);
      showStatus("Using default settings");
    });
})();
