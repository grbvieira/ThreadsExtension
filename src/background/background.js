importScripts("../shared/shared.js");

const { clearStoredRootHandle, getUsernameFromUrl, sanitizeName } = ThreadsShared;

let currentAppId = "238260118697367";
let currentCsrfToken = "";
let capturedSession = null;

let globalStatus = {
  isDownloading: false,
  isPaused: false,
  count: 0,
  status: "Parado"
};

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.url.includes("/graphql/query") && details.method === "POST") {
      const appId = details.requestHeaders.find(h => h.name.toLowerCase() === "x-ig-app-id");
      const csrf = details.requestHeaders.find(h => h.name.toLowerCase() === "x-csrftoken");

      if (appId) currentAppId = appId.value;
      if (csrf) currentCsrfToken = csrf.value;
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
          const sourceUrl = details.documentUrl || details.originUrl || details.initiator || "";

          capturedSession = {
            url: details.url,
            appId: currentAppId,
            csrfToken: currentCsrfToken,
            sourceUrl,
            sourceOrigin: getOrigin(sourceUrl),
            profileUsername: getUsernameFromUrl(sourceUrl, ""),
            targetUserId: parsedVars.userID,
            form: {
              doc_id: details.requestBody.formData.doc_id?.[0] || null,
              lsd: details.requestBody.formData.lsd?.[0] || null,
              fb_dtsg: details.requestBody.formData.fb_dtsg?.[0] || "",
              jazoest: details.requestBody.formData.jazoest?.[0] || "",
              variables: parsedVars
            }
          };

          chrome.storage.local.set({ session: capturedSession });
          chrome.action.setBadgeText({ text: "ON" });
          chrome.action.setBadgeBackgroundColor({ color: "#2196F3" });
        }
      } catch (e) {
        console.warn("Failed to capture session:", e);
      }
    }
  },
  { urls: ["https://*.threads.net/*", "https://*.threads.com/*"] },
  ["requestBody"]
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PROGRESS_UPDATE") {
    globalStatus = { ...request.data };
    if (typeof globalStatus.count === "number") {
      chrome.action.setBadgeText({ text: String(globalStatus.count) });
    }
    if (!globalStatus.isDownloading && globalStatus.status !== "Parado") {
      clearCapturedSession();
    }
    return false;
  }

  if (request.action === "START_FILE_SYSTEM_DOWNLOAD") {
    startDownload(request).then(sendResponse);
    return true;
  }

  if (request.action === "GET_STATUS") {
    sendResponse(globalStatus);
    return true;
  }

  if (request.action === "FORGET_SAVE_FOLDER") {
    clearStoredRootHandle().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === "CANCEL_DOWNLOAD" || request.action === "TOGGLE_PAUSE") {
    forwardToOffscreen(request).then(sendResponse);
    return true;
  }

  return false;
});

async function startDownload(request) {
  if (globalStatus.isDownloading) {
    updateStatus("Já existe um download em andamento.", globalStatus.count);
    return { ok: false, error: "download_in_progress" };
  }

  if (!capturedSession) {
    const stored = await chrome.storage.local.get("session");
    capturedSession = stored.session || null;
  }

  if (!capturedSession) {
    updateStatus("Erro: dê F5 na página do Threads antes de baixar.");
    return { ok: false, error: "missing_session" };
  }

  const validation = validateSessionForPage(capturedSession, request.pageUrl || "", request.usernameFolder || "");
  if (!validation.ok) {
    updateStatus(validation.message);
    clearCapturedSession();
    return { ok: false, error: validation.error };
  }

  await ensureOffscreenDocument();

  globalStatus = {
    isDownloading: true,
    isPaused: false,
    count: 0,
    status: "Preparando download..."
  };
  publishStatus();

  return await chrome.runtime.sendMessage({
    action: "START_OFFSCREEN_DOWNLOAD",
    payload: {
      session: {
        ...capturedSession,
        appId: capturedSession.appId || currentAppId,
        csrfToken: capturedSession.csrfToken || currentCsrfToken
      },
      username: sanitizeName(request.usernameFolder || "usuario_threads", "usuario_threads"),
      pageUrl: request.pageUrl || "",
      mediaType: request.mediaType || "all"
    }
  });
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  if (!chrome.offscreen?.hasDocument) {
    const contexts = await clients.matchAll();
    const offscreenUrl = chrome.runtime.getURL("src/offscreen/offscreen.html");
    if (contexts.some(context => context.url === offscreenUrl)) return;
  }

  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["BLOBS"],
    justification: "Keep long-running media downloads alive while writing files selected by the user."
  });
}

async function forwardToOffscreen(request) {
  await ensureOffscreenDocument();
  try {
    return await chrome.runtime.sendMessage(request);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function validateSessionForPage(session, pageUrl, username) {
  if (!pageUrl) {
    return { ok: false, error: "missing_page_url", message: "Erro: aba inválida." };
  }

  const pageOrigin = getOrigin(pageUrl);
  if (session.sourceOrigin && pageOrigin && session.sourceOrigin !== pageOrigin) {
    return {
      ok: false,
      error: "origin_mismatch",
      message: "Erro: atualize a aba do Threads antes de baixar."
    };
  }

  const currentUsername = sanitizeName(username, "").toLowerCase();
  const capturedUsername = sanitizeName(session.profileUsername || "", "").toLowerCase();

  if (!capturedUsername) {
    return {
      ok: false,
      error: "profile_unknown",
      message: "Erro: não foi possível confirmar o perfil da sessão. Dê F5 no perfil atual e tente novamente."
    };
  }

  if (capturedUsername && currentUsername && capturedUsername !== currentUsername) {
    return {
      ok: false,
      error: "profile_mismatch",
      message: "Erro: a sessão capturada é de outro perfil. Dê F5 no perfil atual e tente novamente."
    };
  }

  return { ok: true };
}

function updateStatus(msg, count = null) {
  if (msg) globalStatus.status = msg;
  if (count !== null) globalStatus.count = count;
  publishStatus();
}

function publishStatus() {
  chrome.runtime.sendMessage({
    action: "PROGRESS_UPDATE",
    data: globalStatus
  }).catch(() => {});
}

function clearCapturedSession() {
  capturedSession = null;
  chrome.storage.local.remove("session").catch(() => {});
}

function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return "";
  }
}
