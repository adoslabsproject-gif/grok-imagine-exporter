import { makeZip } from "./vendor/client-zip.js";

const ASSETS = "https://assets.grok.com/";
const ASSETS_API = "https://grok.com/rest/assets";
const POST_GET = "https://grok.com/rest/media/post/get";
const POST_DELETE = "https://grok.com/rest/media/post/delete";
const BULK_GET = "https://grok.com/rest/media/post/bulk-get";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const selCountEl = document.getElementById("selCount");
const dlBtn = document.getElementById("download");
const delSelBtn = document.getElementById("delSelected");

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
const videoMeta = new Map();           // videoId -> {thumb, dur, extStart}
const videoUrlById = new Map();        // videoId -> url download (assets full-res)
const childrenByParent = new Map();    // parentId -> [videoId]  (catena estensioni)
const selected = new Map();            // id -> {url, ext, sub}
const blobCache = new Map();

function updateCount() {
  selCountEl.textContent = selected.size;
  dlBtn.disabled = selected.size === 0;
  delSelBtn.disabled = selected.size === 0;
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
      const ext = a.mimeType === "image/png" ? "png" : a.mimeType === "image/webp" ? "webp" : "jpg";
      const fileUrl = ASSETS + key + "?cache=1";
      photos.push({ id: a.assetId, fileUrl, thumbUrl: fileUrl, ext });
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
    p.append("source", "SOURCE_GENERATED");
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
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) {
      const img = en.target;
      io.unobserve(img);
      blobFor(img.dataset.url).then((b) => (img.src = b)).catch(() => {});
    }
  }
}, { rootMargin: "300px" });

function render() {
  grid.innerHTML = "";
  for (const ph of photos) {
    const card = document.createElement("div");
    card.className = "card" + (selected.has(ph.id) ? " sel" : "");
    card.innerHTML = `<div class="check">✓</div><img alt=""><span class="open">apri ▸</span>`;
    const img = card.querySelector("img");
    img.dataset.url = ph.thumbUrl;
    io.observe(img);
    card.querySelector(".check").addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(ph.id, { url: ph.fileUrl, ext: ph.ext, sub: "images" });
      card.classList.toggle("sel", selected.has(ph.id));
    });
    card.addEventListener("click", () => openPhoto(ph));
    grid.appendChild(card);
  }
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

async function deletePost(id) {
  // forma ufficiale dal bundle dell'app: { id, isHiddenForClient }
  const r = await fetch(POST_DELETE, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ id, isHiddenForClient: false })
  });
  return r.ok;
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
  tile.innerHTML = `<div class="check">✓</div><button class="del" title="Elimina da Grok">🗑</button><img alt=""><span class="play">▶ ${meta.total || "?"}s</span>`;
  if (thumb) blobFor(thumb).then((b) => (tile.querySelector("img").src = b)).catch(() => {});
  tile.querySelector(".check").addEventListener("click", (e) => {
    e.stopPropagation();
    toggle(vid, { url: file, ext: "mp4", sub: "videos" });
    tile.classList.toggle("sel", selected.has(vid));
  });
  tile.querySelector(".del").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm("Eliminare questo VIDEO da Grok? È definitivo.")) return;
    if (await deletePost(vid)) { selected.delete(vid); tile.remove(); updateCount(); }
    else alert("Eliminazione non riuscita.");
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

document.getElementById("delPhoto").addEventListener("click", async () => {
  if (!currentPhoto) return;
  if (!confirm("Eliminare questa FOTO da Grok (e i suoi video annidati)? È definitivo.")) return;
  if (await deletePost(currentPhoto.id)) {
    photos = photos.filter((p) => p.id !== currentPhoto.id);
    selected.delete(currentPhoto.id);
    modal.classList.add("hidden");
    render(); updateCount();
  } else alert("Eliminazione non riuscita (l'endpoint potrebbe richiedere un campo diverso).");
});

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
document.getElementById("selAllPhotos").addEventListener("click", () => {
  photos.forEach((ph) => selected.set(ph.id, { url: ph.fileUrl, ext: ph.ext, sub: "images" }));
  render(); updateCount();
});
document.getElementById("selNone").addEventListener("click", () => { selected.clear(); render(); updateCount(); });

delSelBtn.addEventListener("click", async () => {
  if (!selected.size) return;
  const ids = [...selected.keys()];
  if (!confirm(`Eliminare ${ids.length} elementi selezionati da Grok? È definitivo.`)) return;
  delSelBtn.disabled = true; dlBtn.disabled = true;
  const deleted = new Set();
  let ok = 0, fail = 0;
  for (let n = 0; n < ids.length; n++) {
    if (await deletePost(ids[n])) { deleted.add(ids[n]); selected.delete(ids[n]); ok++; }
    else fail++;
    statusEl.textContent = `Elimino… ${n + 1}/${ids.length} (ok ${ok}, falliti ${fail})`;
  }
  photos = photos.filter((p) => !deleted.has(p.id));
  render(); updateCount();
  statusEl.textContent = `Eliminati ${ok} elementi${fail ? `, ${fail} falliti` : ""}.`;
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
          videoMeta.set(v.id, { thumb: v.thumbnailImageUrl || "", total: extStart + (v.videoDuration || 0), extStart });
          const par = v.originalPostId;
          if (par) {
            if (!childrenByParent.has(par)) childrenByParent.set(par, []);
            childrenByParent.get(par).push(v.id);
          }
        }
      }
    } catch (e) {}
    statusEl.textContent = `Indicizzo le catene video… ${Math.min(i + 200, ids.length)}/${ids.length}`;
  }
}

async function start() {
  await loadPhotos();
  document.getElementById("zipImages").textContent = `⬇ Tutte le immagini (${photos.length})`;
  statusEl.textContent = `${photos.length} foto. Carico i video…`;
  const vlist = await listAllVideos();
  vlist.forEach((v) => videoUrlById.set(v.id, v.url));
  await buildVideoIndex(vlist.map((v) => v.id));
  // tieni solo i TERMINALI: escludi gli intermedi (id che e genitore di un'estensione)
  allVideos = vlist.filter((v) => !childrenByParent.has(v.id));
  document.getElementById("zipVideos").textContent = `⬇ Tutti i video finali (${allVideos.length})`;
  statusEl.textContent = `${photos.length} foto · ${allVideos.length} video finali (esclusi gli intermedi più corti). Clicca una foto per i suoi video.`;
}
start().catch((e) => (statusEl.textContent = "❌ " + (e.message || e)));
