// --- CONFIGURATION ---
let CURRENT_APP_ID = "238260118697367";
let CURRENT_CSRF_TOKEN = "";
let capturedSession = null;

let globalStatus = {
  isDownloading: false,
  isPaused: false,
  count: 0,
  status: "Parado"
};

let currentDownloadId = null;

// Simple throttling to avoid too many simultaneous downloads.
const PAGE_SIZE = 20;
const DELAY_BETWEEN_DOWNLOADS_MS = 250;
const DELAY_BETWEEN_PAGES_MS = 1200;

// --- UTILS ---
function sanitizeName(name) {
  if (!name) return "threads_backup";
  const safe = String(name).replace(/[^a-z0-9\-_]/gi, "_");
  return safe || "threads_backup";
}

function sanitizeFilePart(name) {
  if (!name) return "arquivo";
  return String(name)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "arquivo";
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStatus(msg, count = null) {
  if (msg) globalStatus.status = msg;

  if (count !== null) {
    globalStatus.count = count;
    chrome.action.setBadgeText({ text: String(count) });
  }

  chrome.runtime.sendMessage({
    action: "PROGRESS_UPDATE",
    data: globalStatus
  }).catch(() => {});
}

function formatTimestamp(ts) {
  if (!ts) return "sem_data";

  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return "sem_data";

  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}${mm}${dd}`;
}

function getDownloadPath(username, media, indexGlobal) {
  const safeUser = sanitizeFilePart(username);
  const safeId = sanitizeFilePart(media.id || `midia_${indexGlobal}`);
  const ext = media.ext || "jpg";
  const data = formatTimestamp(media.timestamp);

  const fileName = `${safeId}_${safeUser}_th_${data}.${ext}`;
  return `${safeUser}/${fileName}`;
}

function chromeDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function waitForDownloadComplete(downloadId) {
  return new Promise((resolve, reject) => {
    const listener = (delta) => {
      if (delta.id !== downloadId) return;

      if (delta.state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }

      if (delta.state?.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error("Download interrompido"));
      }
    };

    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const state = items?.[0]?.state;
      if (state === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      }
      if (state === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error("Download interrompido"));
      }
    });
  });
}

function clearCapturedSession() {
  capturedSession = null;
  chrome.storage.local.remove("session").catch(() => {});
}

async function waitIfPaused() {
  while (globalStatus.isPaused && globalStatus.isDownloading) {
    await delay(500);
  }
}

// --- REQUEST SNIFFERS ---
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.url.includes("/graphql/query") && details.method === "POST") {
      const appId = details.requestHeaders.find(
        h => h.name.toLowerCase() === "x-ig-app-id"
      );
      const csrf = details.requestHeaders.find(
        h => h.name.toLowerCase() === "x-csrftoken"
      );

      if (appId) CURRENT_APP_ID = appId.value;
      if (csrf) CURRENT_CSRF_TOKEN = csrf.value;
    }
  },
  { urls: ["https://*.threads.net/*", "https://*.threads.com/*"] },
  ["requestHeaders"]
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (
      details.method === "POST" &&
      details.url.includes("/graphql/query") &&
      details.requestBody?.formData?.variables
    ) {
      try {
        const parsedVars = JSON.parse(details.requestBody.formData.variables[0]);

        if (parsedVars.userID) {
          capturedSession = {
            url: details.url,
            origin: details.initiator || details.originUrl || "",
            form: {
              doc_id: details.requestBody.formData.doc_id
                ? details.requestBody.formData.doc_id[0]
                : null,
              lsd: details.requestBody.formData.lsd
                ? details.requestBody.formData.lsd[0]
                : null,
              fb_dtsg: details.requestBody.formData.fb_dtsg
                ? details.requestBody.formData.fb_dtsg[0]
                : "",
              jazoest: details.requestBody.formData.jazoest
                ? details.requestBody.formData.jazoest[0]
                : "",
              variables: parsedVars
            }
          };

          chrome.storage.local.set({ session: capturedSession });
          chrome.action.setBadgeText({ text: "ON" });
          chrome.action.setBadgeBackgroundColor({ color: "#2196F3" });
        }
      } catch (e) {
        console.warn("Falha ao capturar sessão:", e);
      }
    }
  },
  { urls: ["https://*.threads.net/*", "https://*.threads.com/*"] },
  ["requestBody"]
);

// --- MESSAGE CONTROL ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_DOWNLOAD") {
    const rawName = request.usernameFolder || "user_unknown";
    const cleanName = sanitizeName(rawName);

    console.log(`📂 Pedido recebido para: ${cleanName}`);
    iniciarDownloadArquivos(cleanName, request.pageUrl || "");

    sendResponse({ started: true });
    return;
  }

  if (request.action === "TOGGLE_PAUSE") {
    if (!globalStatus.isDownloading) {
      sendResponse({ ok: false, paused: false });
      return;
    }

    globalStatus.isPaused = !globalStatus.isPaused;
    updateStatus(globalStatus.isPaused ? "⏸️ Pausado" : "▶️ Retomando...");
    sendResponse({ ok: true, paused: globalStatus.isPaused });
    return;
  }

  if (request.action === "CANCEL_DOWNLOAD") {
    globalStatus.isDownloading = false;
    globalStatus.isPaused = false;

    if (currentDownloadId) {
      chrome.downloads.cancel(currentDownloadId, () => {
        updateStatus("❌ Cancelado pelo usuário");
      });
    } else {
      updateStatus("❌ Cancelado pelo usuário");
    }

    clearCapturedSession();
    sendResponse({ ok: true });
    return;
  }

  if (request.action === "GET_STATUS") {
    sendResponse(globalStatus);
    return;
  }
});

async function iniciarDownloadArquivos(username, pageUrl) {
  if (!capturedSession) {
    const stored = await chrome.storage.local.get("session");
    capturedSession = stored.session;
  }

  if (!capturedSession) {
    updateStatus("❌ Erro: Dê F5 na página.");
    return;
  }

  if (pageUrl && capturedSession.origin) {
    try {
      if (new URL(pageUrl).origin !== new URL(capturedSession.origin).origin) {
        updateStatus("Erro: atualize a aba do Threads antes de baixar.");
        clearCapturedSession();
        return;
      }
    } catch (e) {
      updateStatus("Erro: aba invalida.");
      return;
    }
  }

  if (globalStatus.isDownloading) {
    updateStatus("⚠️ Já existe um download em andamento.", globalStatus.count);
    return;
  }

  globalStatus = {
    isDownloading: true,
    isPaused: false,
    count: 0,
    status: "Iniciando..."
  };

  await processarPaginasDownloads(capturedSession, username);
}

// --- MAIN LOOP ---
async function processarPaginasDownloads(session, username) {
  let cursor = null;
  let hasNext = true;
  let totalSalvo = 0;
  let totalEncontrado = 0;

  while (hasNext && globalStatus.isDownloading) {
    try {
      await waitIfPaused();
      if (!globalStatus.isDownloading) break;

      updateStatus(`Buscando mídias... (${totalSalvo})`, totalSalvo);

      const newVariables = {
        ...session.form.variables,
        after: cursor,
        first: PAGE_SIZE
      };

      const bodyParams = new URLSearchParams();
      if (session.form.doc_id) bodyParams.append("doc_id", session.form.doc_id);
      if (session.form.lsd) bodyParams.append("lsd", session.form.lsd);
      if (session.form.fb_dtsg) bodyParams.append("fb_dtsg", session.form.fb_dtsg);
      if (session.form.jazoest) bodyParams.append("jazoest", session.form.jazoest);
      bodyParams.append("variables", JSON.stringify(newVariables));

      const response = await fetch(session.url, {
        method: "POST",
        body: bodyParams,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-IG-App-ID": CURRENT_APP_ID,
          "X-FB-LSD": session.form.lsd || "Avry",
          "X-CSRFToken": CURRENT_CSRF_TOKEN
        }
      });

      const text = await response.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Resposta inválida:", text);
        hasNext = false;
        break;
      }

      const midias = extrairMidias(json);

      if (midias.length === 0) {
        updateStatus(`Nenhuma mídia nesta página... (${totalSalvo})`, totalSalvo);
      }

      for (const media of midias) {
        await waitIfPaused();
        if (!globalStatus.isDownloading) break;

        totalEncontrado += 1;
        const caminho = getDownloadPath(username, media, totalEncontrado);

        try {
          updateStatus(`Baixando ${totalEncontrado}...`, totalSalvo);

          currentDownloadId = await chromeDownload({
            url: media.url,
            filename: caminho,
            saveAs: false,
            conflictAction: "uniquify"
          });

          await waitForDownloadComplete(currentDownloadId);
          totalSalvo += 1;
          updateStatus(`Baixando ${totalEncontrado}...`, totalSalvo);
        } catch (err) {
          console.warn(`Falha ao baixar ${caminho}:`, err);
        } finally {
          currentDownloadId = null;
        }

        await delay(DELAY_BETWEEN_DOWNLOADS_MS);
      }

      if (!globalStatus.isDownloading) break;

      const pageInfo =
        json.data?.mediaData?.page_info ||
        json.data?.user?.edge_owner_to_timeline_media?.page_info;

      if (pageInfo && pageInfo.has_next_page) {
        cursor = pageInfo.end_cursor;
        updateStatus(`Indo para próxima página... (${totalSalvo})`, totalSalvo);
        await delay(DELAY_BETWEEN_PAGES_MS);
      } else {
        hasNext = false;
      }
    } catch (e) {
      console.error("Erro fatal:", e);
      globalStatus.isDownloading = false;
      globalStatus.isPaused = false;
      currentDownloadId = null;
      updateStatus(`❌ Erro Interno: ${e.message || e}`, totalSalvo);
      return;
    }
  }

  clearCapturedSession();

  if (!globalStatus.isDownloading) {
    globalStatus.isPaused = false;
    currentDownloadId = null;
    updateStatus("❌ Cancelado pelo usuário", totalSalvo);
    chrome.action.setBadgeText({ text: "STOP" });
    chrome.action.setBadgeBackgroundColor({ color: "#ff4444" });
    return;
  }

  if (totalSalvo > 0) {
    globalStatus.isDownloading = false;
    globalStatus.isPaused = false;
    currentDownloadId = null;
    updateStatus(`✅ Concluído! (${totalSalvo})`, totalSalvo);
    chrome.action.setBadgeText({ text: "OK" });
    chrome.action.setBadgeBackgroundColor({ color: "#00FF00" });
  } else {
    globalStatus.isDownloading = false;
    globalStatus.isPaused = false;
    currentDownloadId = null;
    updateStatus("Nada baixado.", 0);
  }
}

// --- MEDIA EXTRACTION ---
function extrairMidias(json) {
  const lista = [];

  try {
    const edges =
      json.data?.mediaData?.edges ||
      json.data?.user?.edge_owner_to_timeline_media?.edges ||
      [];

    edges.forEach(edge => {
      const node = edge.node;
      if (!node) return;

      const items = node.thread_items
        ? node.thread_items.map(i => i.post)
        : [node];

      items.forEach(post => {
        if (!post) return;

        if (post.carousel_media && Array.isArray(post.carousel_media)) {
          post.carousel_media.forEach(m => addMedia(m, lista, post.pk));
        } else {
          addMedia(post, lista, post.pk);
        }
      });
    });
  } catch (e) {
    console.error("Erro extração:", e);
  }

  return lista;
}

function addMedia(obj, lista, id) {
  try {
    if (!obj) return;

    const timestamp =
      obj.taken_at ||
      obj.taken_at_timestamp ||
      obj.original_timestamp ||
      null;

    if (obj.video_versions?.length > 0 && obj.video_versions[0]?.url) {
      lista.push({
        url: obj.video_versions[0].url,
        id: id,
        ext: "mp4",
        timestamp
      });
      return;
    }

    if (
      obj.image_versions2?.candidates?.length > 0 &&
      obj.image_versions2.candidates[0]?.url
    ) {
      lista.push({
        url: obj.image_versions2.candidates[0].url,
        id: id,
        ext: "jpg",
        timestamp
      });
    }
  } catch (e) {
    console.warn("Falha ao adicionar mídia:", e);
  }
}
