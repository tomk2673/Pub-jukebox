(() => {
  const buttons = [...document.querySelectorAll("[data-install-app]")];
  const notes = [...document.querySelectorAll("[data-install-note]")];
  const panels = [...document.querySelectorAll("[data-install-panel]")];
  if (!buttons.length && !notes.length) return;

  let installPrompt = null;
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function showNote(message = "") {
    for (const note of notes) {
      note.textContent = message;
      note.classList.toggle("hidden", !message);
    }
  }

  function showButtons(show) {
    for (const button of buttons) button.classList.toggle("hidden", !show);
  }

  function showPanel(show) {
    for (const panel of panels) panel.classList.toggle("hidden", !show);
  }

  if (standalone) {
    showPanel(false);
    showButtons(false);
    showNote("");
  } else {
    showPanel(true);
    showButtons(true);
    showNote(ios
      ? "Na iPhonu: Sdílet → Přidat na plochu → Otevřít jako webovou aplikaci."
      : "Po instalaci se jukebox otevře přes celou obrazovku bez lišty prohlížeče.");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    showPanel(true);
    showButtons(true);
    showNote("Po instalaci se aplikace otevře bez lišty prohlížeče.");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    showPanel(false);
    showButtons(false);
    showNote("Aplikace je nainstalovaná. Spusť ji z plochy.");
  });

  for (const button of buttons) {
    button.addEventListener("click", async () => {
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        installPrompt = null;
        if (choice.outcome === "accepted") {
          showButtons(false);
          showNote("Instalace je potvrzená. Aplikaci najdeš na ploše.");
        }
        return;
      }
      if (ios) {
        showNote("V Safari klepni na Sdílet, potom Přidat na plochu a zapni Otevřít jako webovou aplikaci.");
      } else {
        showNote("V Chromu otevři nabídku ⋮ a zvol Nainstalovat PUB Jukebox.");
      }
    });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      showNote("Instalace aplikace je dočasně nedostupná; web zůstává funkční.");
    });
  }
})();
