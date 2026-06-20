// Grok Imagine Exporter - service worker
// Enumera gli asset via /rest/assets (con i cookie della sessione, niente CORS
// grazie a host_permissions) e li scarica via chrome.downloads.

const API = "https://grok.com/rest/assets";

// Definizione dei "lavori" disponibili dal popup.
const JOBS = {
  videos:  { label: "Video generati",     mimeTypes: ["video/mp4"],                              source: "SOURCE_GENERATED", sub: "videos",  ext: "mp4" },
  images:  { label: "Immagini generate",  mimeTypes: ["image/jpeg", "image/png", "image/webp"], source: "SOURCE_GENERATED", sub: "images" },
  uploads: { label: "Upload Imagine",     mimeTypes: ["image/jpeg", "image/png", "image/webp"], source: "SOURCE_UPLOADED",  sub: "uploads", fileSource: "IMAGINE_SELF_UPLOAD_FILE_SOURCE" }
};

let cancelFlag = false;

function extFromMime(m) {
  if (m === "video/mp4") return "mp4";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "jpg";
}

async function fetchPage(cfg, token) {
  const p = new URLSearchParams();
  p.set("pageSize", "100");
  cfg.mimeTypes.forEach((m) => p.append("mimeTypes", m));
  p.append("orderBy", "ORDER_BY_LAST_USE_TIME");
  p.append("source", cfg.source);
  p.append("includeImagineFiles", "true");
  if (token) p.set("pageToken", token);
  const r = await fetch(`${API}?${p.toString()}`, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (r.status === 401 || r.status === 403) throw new Error("Non autenticato: apri grok.com ed effettua il login, poi riprova.");
  if (!r.ok) throw new Error("Errore API HTTP " + r.status);
  return r.json();
}

function downloadOne(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false }, (id) => {
      if (chrome.runtime.lastError) resolve({ ok: false, err: chrome.runtime.lastError.message });
      else resolve({ ok: true, id });
    });
  });
}

async function runJob(jobKey, folder, send) {
  const cfg = JOBS[jobKey];
  if (!cfg) { send({ type: "error", msg: "Job sconosciuto: " + jobKey }); return; }
  cancelFlag = false;

  // 1) Enumerazione completa con paginazione
  send({ type: "status", msg: `Enumero "${cfg.label}"...` });
  let token = null;
  const assets = [];
  do {
    const d = await fetchPage(cfg, token);
    (d.assets || []).forEach((a) => assets.push(a));
    token = d.nextPageToken;
    send({ type: "status", msg: `Trovati ${assets.length} elementi...` });
    if (cancelFlag) { send({ type: "done", msg: "Annullato durante l'enumerazione." }); return; }
  } while (token);

  // Filtro opzionale per fileSource (es. solo upload di Imagine, non gli allegati chat)
  const items = assets.filter((a) => !cfg.fileSource || a.fileSource === cfg.fileSource);
  const total = items.length;

  // 2) Stato di ripresa (skip dei gia scaricati in run precedenti)
  const storeKey = "done_" + jobKey;
  const store = await chrome.storage.local.get(storeKey);
  const done = new Set(store[storeKey] || []);

  let ok = 0, fail = 0, skip = 0, completed = 0;
  const CONCURRENCY = 6;
  let nextIndex = 0;

  function report() {
    send({ type: "progress", total, done: completed, ok, fail, skip });
  }

  async function worker() {
    while (true) {
      if (cancelFlag) return;
      const i = nextIndex++;
      if (i >= total) return;
      const a = items[i];
      if (done.has(a.assetId)) { skip++; completed++; report(); continue; }
      const ext = cfg.ext || extFromMime(a.mimeType);
      const key = a.key || `users/${a.userId || ""}/${a.assetId}/content`;
      const url = `https://assets.grok.com/${key}?cache=1`;
      const filename = `${folder}/${cfg.sub}/${a.assetId}.${ext}`;
      const res = await downloadOne(url, filename);
      if (res.ok) { ok++; done.add(a.assetId); } else { fail++; }
      completed++;
      if (completed % 20 === 0) await chrome.storage.local.set({ [storeKey]: [...done] });
      report();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await chrome.storage.local.set({ [storeKey]: [...done] });
  send({
    type: "done",
    msg: cancelFlag
      ? `Fermato. ${ok} scaricati, ${skip} gia presenti, ${fail} falliti.`
      : `Completato "${cfg.label}": ${ok} scaricati, ${skip} gia presenti, ${fail} falliti su ${total}.`
  });
}

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (m) => {
    const send = (x) => { try { port.postMessage(x); } catch (e) {} };
    if (m.action === "start") {
      try { await runJob(m.job, m.folder || "GrokExport", send); }
      catch (e) { send({ type: "error", msg: String(e && e.message ? e.message : e) }); }
    } else if (m.action === "cancel") {
      cancelFlag = true;
    } else if (m.action === "reset") {
      await chrome.storage.local.clear();
      send({ type: "status", msg: "Memoria 'gia scaricati' azzerata." });
    }
  });
});
