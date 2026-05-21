const {
  delay,
  formatTimestamp,
  getStoredRootHandle,
  hasReadWritePermission,
  sanitizeName
} = ThreadsShared;

const PAGE_SIZE = 20;
const DELAY_BETWEEN_DOWNLOADS_MS = 200;
const DELAY_BETWEEN_PAGES_MS = 1000;

let currentStatus = {
  isDownloading: false,
  isPaused: false,
  count: 0,
  status: "Parado"
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_OFFSCREEN_DOWNLOAD") {
    startDownloadProcess(request.payload).catch((e) => {
      updateStatus(`Erro: ${e.message || e}`);
    });
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "CANCEL_DOWNLOAD") {
    currentStatus.isDownloading = false;
    currentStatus.isPaused = false;
    updateStatus("Download cancelado.", currentStatus.count);
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "TOGGLE_PAUSE") {
    if (!currentStatus.isDownloading) {
      sendResponse({ ok: false, paused: false });
      return true;
    }

    currentStatus.isPaused = !currentStatus.isPaused;
    updateStatus(currentStatus.isPaused ? "Download pausado." : "Download retomado.");
    sendResponse({ ok: true, paused: currentStatus.isPaused });
    return true;
  }

  return false;
});

async function startDownloadProcess(payload) {
  if (currentStatus.isDownloading) {
    updateStatus("Já existe um download em andamento.", currentStatus.count);
    return;
  }

  const rootHandle = await getStoredRootHandle();
  if (!rootHandle) {
    updateStatus("Escolha uma pasta de destino antes de baixar.");
    return;
  }

  const hasPermission = await hasReadWritePermission(rootHandle);
  if (!hasPermission) {
    updateStatus("Permissão de pasta negada.");
    return;
  }

  const safeUser = sanitizeName(payload.username, "usuario_threads");
  const targetFolder = await rootHandle.getDirectoryHandle(safeUser, { create: true });

  currentStatus = {
    isDownloading: true,
    isPaused: false,
    count: 0,
    status: `Salvando em ${safeUser}/...`
  };
  publishStatus();

  await processPagesFileSystem(payload.session, payload.username, targetFolder, payload.mediaType || "all");
}

async function processPagesFileSystem(session, username, folderHandle, mediaType) {
  let cursor = null;
  let hasNext = true;
  let totalSaved = 0;
  let totalFound = 0;

  try {
    while (hasNext && currentStatus.isDownloading) {
      await waitIfPaused();
      if (!currentStatus.isDownloading) break;

      updateStatus(`Buscando mídias... (${totalSaved})`, totalSaved);

      const variables = {
        ...session.form.variables,
        after: cursor,
        first: PAGE_SIZE
      };

      const body = new URLSearchParams();
      if (session.form.doc_id) body.append("doc_id", session.form.doc_id);
      if (session.form.lsd) body.append("lsd", session.form.lsd);
      if (session.form.fb_dtsg) body.append("fb_dtsg", session.form.fb_dtsg);
      if (session.form.jazoest) body.append("jazoest", session.form.jazoest);
      body.append("variables", JSON.stringify(variables));

      const response = await fetch(session.url, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-IG-App-ID": session.appId,
          "X-FB-LSD": session.form.lsd || "Avry",
          "X-CSRFToken": session.csrfToken || ""
        }
      });

      if (!response.ok) {
        throw new Error(`GraphQL retornou HTTP ${response.status}`);
      }

      const json = await response.json();
      const medias = filterMediasByType(extractMedias(json), mediaType);

      if (medias.length === 0) {
        updateStatus(`Nenhuma mídia do tipo selecionado nesta página... (${totalSaved})`, totalSaved);
      }

      for (const media of medias) {
        await waitIfPaused();
        if (!currentStatus.isDownloading) break;

        totalFound += 1;

        try {
          updateStatus(`Baixando ${totalFound}...`, totalSaved);
          const filename = getMediaFilename(username, media, totalFound);

          if (await fileExists(folderHandle, filename)) {
            updateStatus(`Arquivo já existe, pulando ${totalFound}...`, totalSaved);
            continue;
          }

          const mediaResponse = await fetch(media.url);
          if (!mediaResponse.ok) {
            throw new Error(`Mídia retornou HTTP ${mediaResponse.status}`);
          }

          const blob = await mediaResponse.blob();
          await saveFileDirectly(folderHandle, filename, blob);

          totalSaved += 1;
          updateStatus(`Baixando ${totalFound}...`, totalSaved);
        } catch (err) {
          console.warn("Failed to save media:", err);
        }

        await delay(DELAY_BETWEEN_DOWNLOADS_MS);
      }

      if (!currentStatus.isDownloading) break;

      const pageInfo =
        json.data?.user?.edge_owner_to_timeline_media?.page_info ||
        json.data?.mediaData?.page_info;

      if (pageInfo?.has_next_page) {
        cursor = pageInfo.end_cursor;
        updateStatus(`Indo para próxima página... (${totalSaved})`, totalSaved);
        await delay(DELAY_BETWEEN_PAGES_MS);
      } else {
        hasNext = false;
      }
    }

    if (!currentStatus.isDownloading) {
      updateStatus("Download cancelado.", totalSaved);
      return;
    }

    updateStatus(
      totalSaved > 0 ? `Concluído! (${totalSaved})` : "Nenhuma mídia encontrada.",
      totalSaved
    );
  } catch (e) {
    updateStatus(`Erro: ${e.message || e}`, totalSaved);
  } finally {
    currentStatus.isDownloading = false;
    currentStatus.isPaused = false;
    publishStatus();
  }
}

async function waitIfPaused() {
  while (currentStatus.isPaused && currentStatus.isDownloading) {
    await delay(500);
  }
}

function updateStatus(msg, count = null) {
  if (msg) currentStatus.status = msg;
  if (count !== null) currentStatus.count = count;
  publishStatus();
}

function publishStatus() {
  chrome.runtime.sendMessage({
    action: "PROGRESS_UPDATE",
    data: currentStatus
  }).catch(() => {});
}

function getMediaFilename(username, media, fallbackIndex) {
  const safeUser = sanitizeName(username, "usuario_threads");
  const safeId = sanitizeName(media.id || `midia_${fallbackIndex}`, `midia_${fallbackIndex}`);
  const carouselSuffix = media.index ? `_${media.index}` : "";
  const date = formatTimestamp(media.timestamp);
  const ext = media.ext || "jpg";

  return `${safeId}${carouselSuffix}_${safeUser}_th_${date}.${ext}`;
}

async function fileExists(folderHandle, filename) {
  try {
    await folderHandle.getFileHandle(filename);
    return true;
  } catch (e) {
    if (e.name === "NotFoundError") return false;
    throw e;
  }
}

async function saveFileDirectly(folderHandle, filename, blob) {
  const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function extractMedias(json) {
  const list = [];

  try {
    const edges =
      json.data?.user?.edge_owner_to_timeline_media?.edges ||
      json.data?.mediaData?.edges ||
      [];

    edges.forEach(edge => {
      const node = edge.node;
      if (!node) return;

      const posts = node.thread_items
        ? node.thread_items.map(item => item.post)
        : [node];

      posts.forEach(post => {
        if (!post) return;

        const timestamp =
          post.taken_at ||
          post.taken_at_timestamp ||
          post.original_timestamp ||
          null;

        if (Array.isArray(post.carousel_media)) {
          post.carousel_media.forEach((item, index) => {
            addMedia(item, list, post.pk, timestamp, index + 1);
          });
          return;
        }

        addMedia(post, list, post.pk, timestamp);
      });
    });
  } catch (e) {
    console.warn("Failed to extract media:", e);
  }

  return list;
}

function addMedia(source, list, id, fallbackTimestamp, index = null) {
  if (!source) return;

  const timestamp =
    source.taken_at ||
    source.taken_at_timestamp ||
    source.original_timestamp ||
    fallbackTimestamp ||
    null;

  if (source.video_versions?.[0]?.url) {
    list.push({
      url: source.video_versions[0].url,
      id,
      index,
      ext: "mp4",
      timestamp
    });
    return;
  }

  if (source.image_versions2?.candidates?.[0]?.url) {
    list.push({
      url: source.image_versions2.candidates[0].url,
      id,
      index,
      ext: "jpg",
      timestamp
    });
  }
}

function filterMediasByType(medias, mediaType) {
  if (mediaType === "videos") {
    return medias.filter(media => media.ext === "mp4");
  }

  if (mediaType === "images") {
    return medias.filter(media => media.ext !== "mp4");
  }

  return medias;
}
