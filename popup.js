const port = chrome.runtime.connect();
const statusEl = document.getElementById("status");
const fillEl = document.getElementById("fill");
const folderEl = document.getElementById("folder");
const jobButtons = [...document.querySelectorAll("[data-job]")];

function setBusy(busy) {
  jobButtons.forEach((b) => (b.disabled = busy));
}

port.onMessage.addListener((m) => {
  if (m.type === "status") {
    statusEl.textContent = m.msg;
  } else if (m.type === "progress") {
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    fillEl.style.width = pct + "%";
    statusEl.textContent = `${m.done}/${m.total} — ok ${m.ok}, già presenti ${m.skip}, falliti ${m.fail}`;
  } else if (m.type === "done") {
    fillEl.style.width = "100%";
    statusEl.textContent = "✅ " + m.msg;
    setBusy(false);
  } else if (m.type === "error") {
    statusEl.textContent = "❌ " + m.msg;
    setBusy(false);
  }
});

jobButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setBusy(true);
    fillEl.style.width = "0";
    statusEl.textContent = "Avvio...";
    port.postMessage({ action: "start", job: btn.dataset.job, folder: folderEl.value.trim() || "GrokExport" });
  });
});

document.getElementById("cancel").addEventListener("click", () => {
  port.postMessage({ action: "cancel" });
  statusEl.textContent = "Interruzione richiesta...";
});

document.getElementById("reset").addEventListener("click", () => {
  port.postMessage({ action: "reset" });
});

document.getElementById("openGallery").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("gallery.html") });
});
