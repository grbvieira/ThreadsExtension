const {
  clearStoredRootHandle,
  getStoredRootHandle,
  getUsernameFromUrl,
  hasReadWritePermission,
  isThreadsProfileUrl,
  storeRootHandle
} = ThreadsShared;

const btn = document.getElementById("btnDownload");
const btnPause = document.getElementById("btnPause");
const btnCancel = document.getElementById("btnCancel");
const btnChooseFolder = document.getElementById("btnChooseFolder");
const btnForgetFolder = document.getElementById("btnForgetFolder");
const countDisplay = document.getElementById("countDisplay");
const statusText = document.getElementById("statusText");
const progressArea = document.getElementById("progressArea");
const folderName = document.getElementById("folderName");

let selectedRootHandle = null;

document.addEventListener("DOMContentLoaded", async () => {
  selectedRootHandle = await getStoredRootHandle();
  await refreshFolderUi();

  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (state) => {
    if (chrome.runtime.lastError) return;

    if (state && (state.isDownloading || state.isPaused)) {
      btn.style.display = "none";
      progressArea.style.display = "block";
      updateUi(state);
    }
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "PROGRESS_UPDATE") {
    updateUi(msg.data);
  }
});

btn.addEventListener("click", async () => {
  btn.disabled = true;
  statusText.textContent = "Preparando...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!isThreadsProfileUrl(tab?.url)) {
      showError("Abra um perfil do Threads antes de baixar.");
      return;
    }

    selectedRootHandle = await ensureRootFolder();
    if (!selectedRootHandle) {
      showError("Selecione uma pasta para salvar.");
      return;
    }

    const username = getUsernameFromUrl(tab.url);

    chrome.runtime.sendMessage({
      action: "START_FILE_SYSTEM_DOWNLOAD",
      usernameFolder: username,
      pageUrl: tab.url,
      mediaType: getSelectedMediaType()
    }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }

      if (response && response.ok === false) {
        btn.disabled = false;
        return;
      }

      btn.style.display = "none";
      progressArea.style.display = "block";
    });
  } catch (e) {
    showError(e.message || "Não foi possível iniciar o download.");
  } finally {
    btn.disabled = false;
  }
});

btnChooseFolder.addEventListener("click", async () => {
  try {
    selectedRootHandle = await pickRootFolder();
    await refreshFolderUi();
    showInfo("Pasta atualizada.");
  } catch (e) {
    showError("Seleção de pasta cancelada.");
  }
});

btnForgetFolder.addEventListener("click", async () => {
  await clearStoredRootHandle();
  chrome.runtime.sendMessage({ action: "FORGET_SAVE_FOLDER" }, () => {});
  selectedRootHandle = null;
  await refreshFolderUi();
  showInfo("Pasta esquecida.");
});

btnPause.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "TOGGLE_PAUSE" });
});

btnCancel.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "CANCEL_DOWNLOAD" });
});

function updateUi(state) {
  countDisplay.textContent = state.count || 0;
  statusText.textContent = state.status || "Aguardando.";

  if (state.isPaused) {
    btnPause.textContent = "CONTINUAR";
    btnPause.disabled = false;
    btnCancel.disabled = false;
    statusText.style.color = "#ffd166";
    return;
  }

  if (state.isDownloading) {
    btnPause.textContent = "PAUSAR";
    btnPause.disabled = false;
    btnCancel.disabled = false;
    statusText.style.color = "#ddd";
    return;
  }

  btn.style.display = "block";
  btn.textContent = state.status?.includes("Concluído") ? "Baixar Novamente" : "INICIAR DOWNLOAD";
  btnPause.disabled = true;
  btnCancel.disabled = true;
  statusText.style.color = state.status?.includes("Erro") ? "#ff4444" : "#ddd";
}

function showError(message) {
  btn.disabled = false;
  btn.style.display = "block";
  progressArea.style.display = "block";
  statusText.textContent = message;
  statusText.style.color = "#ff4444";
}

function showInfo(message) {
  statusText.textContent = message;
  statusText.style.color = "#ddd";
}

async function ensureRootFolder() {
  if (selectedRootHandle && await hasReadWritePermission(selectedRootHandle)) {
    return selectedRootHandle;
  }

  return pickRootFolder();
}

async function pickRootFolder() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await storeRootHandle(handle);
  selectedRootHandle = handle;
  return handle;
}

async function refreshFolderUi() {
  if (selectedRootHandle) {
    folderName.textContent = selectedRootHandle.name || "Pasta selecionada";
    btnForgetFolder.disabled = false;
  } else {
    folderName.textContent = "Nenhuma pasta selecionada";
    btnForgetFolder.disabled = true;
  }
}

function getSelectedMediaType() {
  return document.querySelector('input[name="mediaType"]:checked')?.value || "all";
}
