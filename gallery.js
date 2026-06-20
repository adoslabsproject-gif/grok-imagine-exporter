import { makeZip } from "./vendor/client-zip.js";

const ASSETS = "https://assets.grok.com/";
const ASSETS_API = "https://grok.com/rest/assets";
const POST_GET = "https://grok.com/rest/media/post/get";
const BULK_GET = "https://grok.com/rest/media/post/bulk-get";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const selCountEl = document.getElementById("selCount");
const dlBtn = document.getElementById("download");

const modal = document.getElementById("modal");
const modalImg = document.getElementById("modalImg");
const modalPrompt = document.getElementById("modalPrompt");
const modalVideos = document.getElementById("modalVideos");
const modalStatus = document.getElementById("modalStatus");
const selPhotoChk = document.getElementById("selPhoto");
const vcountEl = document.getElementById("vcount");

const zipOverlay = document.getElementById("zipOverlay");
const zipTitle = document.getElementById("zipTitle");
const zipFill = document.getElementById("zipFill");
const zipStatus = document.getElementById("zipStatus");
const zipBytes = document.getElementById("zipBytes");
const zipDoneBtn = document.getElementById("zipDone");
const zipSpinner = document.getElementById("zipSpinner");
let zipping = false;

const vplayer = document.getElementById("vplayer");
const vpVideo = document.getElementById("vpVideo");
const vpStatus = document.getElementById("vpStatus");

zipDoneBtn.addEventListener("click", () => zipOverlay.classList.add("hidden"));
window.addEventListener("beforeunload", (e) => {
  if (zipping) { e.preventDefault(); e.returnValue = "Lo ZIP è in creazione: se chiudi, il file resterà incompleto."; return e.returnValue; }
});

let photos = [];                       // {id, fileUrl, thumbUrl, ext}
let allVideos = [];                    // lista completa video (per ZIP + conteggio)
let UID = "";                          // user id (dalle chiavi asset)
let cursorIndex = -1;                  // cursore di navigazione da tastiera
const videoMeta = new Map();           // videoId -> {thumb, total, extStart, created}
const videoUrlById = new Map();        // videoId -> url download (assets full-res)
const childrenByParent = new Map();    // parentId -> [videoId]  (catena estensioni)
const rootVideos = new Set();          // video senza foto-base (t2v "solo video")
const selected = new Map();            // id -> {url, ext, sub}
const blobCache = new Map();

function updateCount() {
  selCountEl.textContent = selected.size;
  dlBtn.disabled = selected.size === 0;
}

async function blobFor(url) {
  if (blobCache.has(url)) return blobCache.get(url);
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("thumb " + r.status);
  const obj = URL.createObjectURL(await r.blob());
  blobCache.set(url, obj);
  return obj;
}

// ---- enumerazione foto ---------------------------------------------------
async function loadPhotos() {
  let token = null;
  do {
    const p = new URLSearchParams();
    p.set("pageSize", "100");
    ["image/jpeg", "image/png", "image/webp"].forEach((m) => p.append("mimeTypes", m));
    p.append("orderBy", "ORDER_BY_LAST_USE_TIME");
    p.append("source", "SOURCE_GENERATED");
    p.append("includeImagineFiles", "true");
    if (token) p.set("pageToken", token);
    const r = await fetch(`${ASSETS_API}?${p.toString()}`, { credentials: "include", headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) throw new Error("Non autenticato — apri grok.com e fai login.");
    if (!r.ok) throw new Error("Errore API HTTP " + r.status);
    const d = await r.json();
    (d.assets || []).forEach((a) => {
      const key = a.key || `users/x/${a.assetId}/content`;
      if (!UID) { const m = key.match(/^users\/([^/]+)\//); if (m) UID = m[1]; }
      const ext = a.mimeType === "image/png" ? "png" : a.mimeType === "image/webp" ? "webp" : "jpg";
      const fileUrl = ASSETS + key + "?cache=1";
      photos.push({ id: a.assetId, fileUrl, thumbUrl: fileUrl, ext, createTime: a.createTime || "" });
    });
    token = d.nextPageToken;
    statusEl.textContent = `Carico foto… ${photos.length}`;
  } while (token);
  statusEl.textContent = `${photos.length} foto. Clicca per i video annidati, o spunta per selezionare.`;
  render();
}

async function listAllVideos() {
  let token = null;
  const out = [];
  do {
    const p = new URLSearchParams();
    p.set("pageSize", "100");
    p.append("mimeTypes", "video/mp4");
    p.append("orderBy", "ORDER_BY_LAST_USE_TIME");
    p.append("source", "SOURCE_ANY");
    p.append("includeImagineFiles", "true");
    if (token) p.set("pageToken", token);
    const r = await fetch(`${ASSETS_API}?${p.toString()}`, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("Errore API HTTP " + r.status);
    const d = await r.json();
    (d.assets || []).forEach((a) => {
      const key = a.key || `users/x/generated/${a.assetId}/generated_video.mp4`;
      out.push({ id: a.assetId, url: ASSETS + key + "?cache=1", name: `videos/${a.assetId}.mp4` });
    });
    token = d.nextPageToken;
    statusEl.textContent = `Preparo lista video… ${out.length}`;
  } while (token);
  return out;
}

// ---- griglia -------------------------------------------------------------
// ---- caricatore miniature robusto: coda a concorrenza limitata, abort fuori-vista,
//      retry con backoff per errori transitori, fallback URL per i 404 -------------
const MAX_THUMB = 6;
let thumbInFlight = 0;
const thumbQueue = [];
const thumbTask = new Map(); // img -> task

function loadThumb(img) {
  const url = img.dataset.url;
  if (!url) return;
  if (blobCache.has(url)) { img.src = blobCache.get(url); img.closest(".card").classList.remove("loading"); return; }
  if (thumbTask.has(img)) return;
  const task = { img, url, fallback: img.dataset.fallback || "", tries: 0, fbTried: false, aborted: false, ctrl: null };
  thumbTask.set(img, task);
  thumbQueue.push(task);
  pumpThumbs();
}
function cancelThumb(img) {
  const t = thumbTask.get(img);
  if (t) { t.aborted = true; if (t.ctrl) { try { t.ctrl.abort(); } catch (e) {} } thumbTask.delete(img); }
}
function pumpThumbs() {
  while (thumbInFlight < MAX_THUMB && thumbQueue.length) {
    const t = thumbQueue.shift();
    if (t.aborted) { thumbTask.delete(t.img); continue; }
    runThumb(t);
  }
}
async function runThumb(t) {
  thumbInFlight++;
  try {
    t.ctrl = new AbortController();
    const res = await fetch(t.url, { credentials: "include", signal: t.ctrl.signal });
    if (t.aborted) return;
    if (res.ok) {
      const obj = URL.createObjectURL(await res.blob());
      blobCache.set(t.url, obj);
      if (!t.aborted) { t.img.src = obj; t.img.closest(".card").classList.remove("loading"); }
      thumbTask.delete(t.img);
      return;
    }
    if (res.status === 404 && t.fallback && !t.fbTried) { t.fbTried = true; t.url = t.fallback; thumbQueue.push(t); return; }
    if (res.status === 429 || res.status >= 500) throw new Error("http " + res.status);
    t.img.closest(".card").classList.add("failed"); thumbTask.delete(t.img); // 404/403 definitivo
  } catch (e) {
    if (t.aborted) return;
    t.tries++;
    if (t.tries <= 4) {
      const d = 300 * Math.pow(2, t.tries - 1); // 300,600,1200,2400ms
      setTimeout(() => { if (!t.aborted) { thumbQueue.push(t); pumpThumbs(); } }, d);
    } else { t.img.closest(".card").classList.add("failed"); thumbTask.delete(t.img); }
  } finally {
    thumbInFlight--;
    pumpThumbs();
  }
}

const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) loadThumb(en.target);
    else cancelThumb(en.target);
  }
}, { rootMargin: "400px" });

function render() {
  grid.innerHTML = "";
  for (const ph of photos) {
    const isVid = ph.type === "video";
    const card = document.createElement("div");
    card.className = "card loading" + (selected.has(ph.id) ? " sel" : "");
    card.innerHTML = `<div class="check">✓</div><img alt=""><span class="open">${isVid ? "▶ video" : "apri ▸"}</span>`;
    const img = card.querySelector("img");
    if (ph.thumbUrl) { img.dataset.url = ph.thumbUrl; if (ph.thumbFallback) img.dataset.fallback = ph.thumbFallback; io.observe(img); }
    else card.classList.remove("loading");
    card.querySelector(".check").addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(ph.id, { url: ph.fileUrl, ext: ph.ext, sub: isVid ? "videos" : "images" });
      card.classList.toggle("sel", selected.has(ph.id));
    });
    card.addEventListener("click", () => (isVid ? playMedia(ph.fileUrl) : openPhoto(ph)));
    grid.appendChild(card);
  }
  if (cursorIndex >= 0 && grid.children[cursorIndex]) grid.children[cursorIndex].classList.add("cursor");
}

function toggle(id, info) {
  if (selected.has(id)) selected.delete(id);
  else selected.set(id, info);
  updateCount();
}

// ---- modal con video annidati -------------------------------------------
let currentPhoto = null;

async function getPost(id) {
  const r = await fetch(POST_GET, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ id })
  });
  if (!r.ok) return null;
  return (await r.json()).post || null;
}

let lastPlayUrl = null;
async function playMedia(url) {
  vplayer.classList.remove("hidden");
  vpStatus.textContent = "Carico il video…";
  vpVideo.removeAttribute("src");
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(r.status);
    if (lastPlayUrl) URL.revokeObjectURL(lastPlayUrl);
    lastPlayUrl = URL.createObjectURL(await r.blob());
    vpVideo.src = lastPlayUrl;
    vpStatus.textContent = "";
    vpVideo.play().catch(() => {});
  } catch (e) { vpStatus.textContent = "Impossibile caricare il video."; }
}

function renderVideoTile(vid) {
  const meta = videoMeta.get(vid) || {};
  const file = videoUrlById.get(vid);
  const thumb = meta.thumb || file;
  const tile = document.createElement("div");
  tile.className = "vtile" + (selected.has(vid) ? " sel" : "");
  tile.innerHTML = `<div class="check">✓</div><img alt=""><span class="play">▶ ${meta.total || "?"}s</span>`;
  if (thumb) blobFor(thumb).then((b) => (tile.querySelector("img").src = b)).catch(() => {});
  tile.querySelector(".check").addEventListener("click", (e) => {
    e.stopPropagation();
    toggle(vid, { url: file, ext: "mp4", sub: "videos" });
    tile.classList.toggle("sel", selected.has(vid));
  });
  tile.addEventListener("click", () => playMedia(file));   // click sul riquadro = riproduci
  modalVideos.appendChild(tile);
}

// raccoglie tutti i video discendenti dalla foto (catena estensioni inclusa)
function collectDescendantVideos(rootId) {
  const out = []; const seen = new Set(); const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const k of (childrenByParent.get(id) || [])) {
      if (seen.has(k)) continue;
      seen.add(k); out.push(k); queue.push(k);
    }
  }
  return out;
}

async function openPhoto(ph) {
  currentPhoto = ph;
  modal.classList.remove("hidden");
  modalPrompt.textContent = "";
  modalVideos.innerHTML = "";
  modalStatus.textContent = "";
  vcountEl.textContent = "0";
  selPhotoChk.checked = selected.has(ph.id);
  blobFor(ph.thumbUrl).then((b) => (modalImg.src = b)).catch(() => {});
  getPost(ph.id).then((p) => { if (p) modalPrompt.textContent = p.prompt || p.originalPrompt || ""; }).catch(() => {});

  // dall'indice: tutti i discendenti, ma SOLO i terminali (il piu lungo di ogni catena)
  const all = collectDescendantVideos(ph.id);
  const terminals = all.filter((id) => !childrenByParent.has(id));
  terminals.sort((a, b) => (videoMeta.get(a)?.total || 0) - (videoMeta.get(b)?.total || 0));
  vcountEl.textContent = terminals.length;
  modalStatus.textContent = terminals.length ? "(mostrati solo i video finali, gli intermedi sono esclusi)" : "Nessun video per questa foto.";
  for (const vid of terminals) renderVideoTile(vid);
}

selPhotoChk.addEventListener("change", () => {
  if (!currentPhoto) return;
  if (selPhotoChk.checked) selected.set(currentPhoto.id, { url: currentPhoto.fileUrl, ext: currentPhoto.ext, sub: "images" });
  else selected.delete(currentPhoto.id);
  updateCount(); render();
});

document.getElementById("selAllVids").addEventListener("click", () => {
  modalVideos.querySelectorAll(".vtile").forEach((t) => { if (!t.classList.contains("sel")) t.click(); });
});
document.getElementById("modalClose").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

document.getElementById("vpClose").addEventListener("click", () => { vpVideo.pause(); vplayer.classList.add("hidden"); });
vplayer.addEventListener("click", (e) => { if (e.target === vplayer) { vpVideo.pause(); vplayer.classList.add("hidden"); } });


// ---- ZIP streaming su disco (una sola conferma) --------------------------
async function zipDownload(list, zipName) {
  if (!list.length) { statusEl.textContent = "Niente da scaricare."; return; }

  // overlay di progresso
  zipping = true;
  zipOverlay.classList.remove("hidden");
  zipSpinner.classList.remove("hidden");
  zipDoneBtn.classList.add("hidden");
  zipTitle.textContent = "Creazione " + zipName;
  zipFill.style.width = "0%";
  zipStatus.textContent = "Avvio…";
  zipBytes.textContent = "";

  let i = 0, fails = 0, bytes = 0, lastUI = 0;

  async function* inputs() {
    for (const it of list) {
      i++;
      zipFill.style.width = Math.round((i / list.length) * 100) + "%";
      zipStatus.textContent = `Scarico e comprimo… ${i} / ${list.length}` + (fails ? ` (falliti ${fails})` : "");
      try {
        const res = await fetch(it.url, { credentials: "include" });
        if (!res.ok) { fails++; continue; }
        yield { name: it.name, input: res };
      } catch (e) { fails++; }
    }
  }

  const counter = new TransformStream({
    transform(chunk, ctrl) {
      bytes += chunk.byteLength;
      const now = Date.now();
      if (now - lastUI > 200) { lastUI = now; zipBytes.textContent = (bytes / 1048576).toFixed(1) + " MB"; }
      ctrl.enqueue(chunk);
    }
  });

  try {
    if (window.showSaveFilePicker) {
      // Chrome: streaming su disco (regge GB)
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: zipName, types: [{ description: "Archivio ZIP", accept: { "application/zip": [".zip"] } }] });
      } catch (e) { zipping = false; zipSpinner.classList.add("hidden"); zipOverlay.classList.add("hidden"); return; }
      const writable = await handle.createWritable();
      await makeZip(inputs()).pipeThrough(counter).pipeTo(writable);
    } else {
      // Firefox: niente File System Access -> zip in memoria poi download singolo
      zipStatus.textContent = "Creo lo ZIP… (un attimo)";
      const blob = await new Response(makeZip(inputs()).pipeThrough(counter)).blob();
      const url = URL.createObjectURL(blob);
      await new Promise((res) => chrome.downloads.download({ url, filename: zipName, saveAs: true }, () => res()));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    zipFill.style.width = "100%";
    zipTitle.textContent = "✅ ZIP completato";
    zipStatus.textContent = `${i - fails} file salvati${fails ? `, ${fails} falliti` : ""} — ${(bytes / 1048576).toFixed(1)} MB`;
    zipBytes.textContent = zipName;
  } catch (e) {
    zipTitle.textContent = "❌ Errore";
    zipStatus.textContent = String(e.message || e);
  } finally {
    zipSpinner.classList.add("hidden");
    zipping = false;
    zipDoneBtn.classList.remove("hidden");
  }
}

// ---- pulsanti ------------------------------------------------------------
function selInfo(ph) { return { url: ph.fileUrl, ext: ph.ext, sub: ph.type === "video" ? "videos" : "images" }; }
document.getElementById("selAllPhotos").addEventListener("click", () => {
  photos.forEach((ph) => selected.set(ph.id, selInfo(ph)));
  render(); updateCount();
});
document.getElementById("selInvert").addEventListener("click", () => {
  photos.forEach((ph) => { if (selected.has(ph.id)) selected.delete(ph.id); else selected.set(ph.id, selInfo(ph)); });
  render(); updateCount();
});
document.getElementById("selNone").addEventListener("click", () => { selected.clear(); render(); updateCount(); });

// ---- navigazione da tastiera: frecce = cursore, barra = seleziona, invio = apri ----
function gridCols() {
  const c = grid.children;
  if (c.length < 2) return 1;
  const top = c[0].offsetTop; let n = 1;
  while (n < c.length && c[n].offsetTop === top) n++;
  return n;
}
function setCursor(i) {
  const c = grid.children;
  if (!c.length) return;
  i = Math.max(0, Math.min(i, c.length - 1));
  if (cursorIndex >= 0 && c[cursorIndex]) c[cursorIndex].classList.remove("cursor");
  cursorIndex = i;
  c[i].classList.add("cursor");
  c[i].scrollIntoView({ block: "nearest" });
}
document.addEventListener("keydown", (e) => {
  if (!modal.classList.contains("hidden") || !vplayer.classList.contains("hidden")) return; // overlay aperto
  if (e.target.tagName === "INPUT") return;
  const c = grid.children;
  if (!c.length) return;
  const cur = cursorIndex < 0 ? 0 : cursorIndex;
  let done = true;
  switch (e.key) {
    case "ArrowRight": setCursor(cur + 1); break;
    case "ArrowLeft": setCursor(cur - 1); break;
    case "ArrowDown": setCursor(cur + gridCols()); break;
    case "ArrowUp": setCursor(cur - gridCols()); break;
    case " ": if (cursorIndex >= 0) c[cursorIndex].querySelector(".check").click(); break;
    case "Enter": if (cursorIndex >= 0) c[cursorIndex].click(); break;
    default: done = false;
  }
  if (done) e.preventDefault();
});


dlBtn.addEventListener("click", () => {
  const list = [...selected.entries()].map(([id, info]) => ({ url: info.url, name: `${info.sub}/${id}.${info.ext}` }));
  zipDownload(list, "grok-selezione.zip");
});

document.getElementById("zipImages").addEventListener("click", () => {
  const list = photos.map((ph) => ({ url: ph.fileUrl, name: `images/${ph.id}.${ph.ext}` }));
  zipDownload(list, "grok-immagini.zip");
});

document.getElementById("zipVideos").addEventListener("click", async () => {
  if (!allVideos.length) { statusEl.textContent = "Nessun video indicizzato."; return; }
  await zipDownload(allVideos, "grok-video.zip");
});

// indicizza i video via bulk-get: durata reale + mappa catena (genitore -> figli)
async function buildVideoIndex(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    try {
      const r = await fetch(BULK_GET, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ids: batch })
      });
      if (r.ok) {
        const posts = (await r.json()).posts || [];
        for (const v of posts) {
          const extStart = v.videoExtensionStartTime || 0;
          videoMeta.set(v.id, { thumb: v.thumbnailImageUrl || "", total: extStart + (v.videoDuration || 0), extStart, created: v.createTime || "" });
          const par = v.originalPostId;
          if (par) {
            if (!childrenByParent.has(par)) childrenByParent.set(par, []);
            childrenByParent.get(par).push(v.id);
          } else {
            rootVideos.add(v.id); // nessun genitore = "solo video" (t2v)
          }
        }
      }
    } catch (e) {}
    statusEl.textContent = `Indicizzo le catene video… ${Math.min(i + 200, ids.length)}/${ids.length}`;
  }
}

async function start() {
  await loadPhotos();
  photos.sort((a, b) => (b.createTime || "").localeCompare(a.createTime || ""));
  render();                                                   // mostra subito le foto
  document.getElementById("galleryLoading").classList.add("hidden");
  document.getElementById("zipImages").textContent = `⬇ Tutte le immagini (${photos.length})`;
  statusEl.textContent = `${photos.length} foto. Indicizzo i video…`;
  const vlist = await listAllVideos();
  vlist.forEach((v) => videoUrlById.set(v.id, v.url));
  await buildVideoIndex(vlist.map((v) => v.id));
  // tieni solo i TERMINALI: escludi gli intermedi (id che e genitore di un'estensione)
  allVideos = vlist.filter((v) => !childrenByParent.has(v.id));
  // aggiungi le foto-radice che hanno video ma non erano in SOURCE_GENERATED (origini diverse)
  const existing = new Set(photos.map((p) => p.id));
  let added = 0;
  for (const parentId of childrenByParent.keys()) {
    if (videoMeta.has(parentId) || existing.has(parentId)) continue; // e un video, o gia presente
    const kids = childrenByParent.get(parentId) || [];
    const poster = kids.length ? (videoMeta.get(kids[0]) || {}).thumb || "" : "";
    const fileUrl = ASSETS + `users/${UID}/${parentId}/content?cache=1`;
    // anteprima dal poster del video (affidabile); fallback = il content vero
    photos.push({ id: parentId, fileUrl, thumbUrl: poster || fileUrl, thumbFallback: fileUrl, ext: "jpg", createTime: "" });
    existing.add(parentId); added++;
  }
  // aggiungi i "solo video" (t2v senza foto-base): una tessera per ogni terminale di catena
  let soloVid = 0;
  for (const rootId of rootVideos) {
    const chain = [rootId, ...collectDescendantVideos(rootId)];
    for (const vid of chain) {
      if (childrenByParent.has(vid) || existing.has(vid)) continue; // non terminale o gia presente
      const m = videoMeta.get(vid) || {};
      photos.push({ id: vid, type: "video", fileUrl: videoUrlById.get(vid), thumbUrl: m.thumb || "", ext: "mp4", createTime: m.created || "" });
      existing.add(vid); soloVid++;
    }
  }
  // ordina come la galleria di Grok: per data di creazione, dal piu recente
  photos.sort((a, b) => (b.createTime || "").localeCompare(a.createTime || ""));
  render();
  document.getElementById("zipImages").textContent = `⬇ Tutte le immagini (${photos.length})`;
  document.getElementById("zipVideos").textContent = `⬇ Tutti i video finali (${allVideos.length})`;
  statusEl.textContent = `${photos.length} elementi (incl. ${soloVid} solo-video, ${added} foto origine diversa) · ${allVideos.length} video finali. Clicca una foto per i suoi video, un video per riprodurlo.`;
}
start().catch((e) => (statusEl.textContent = "❌ " + (e.message || e)));
