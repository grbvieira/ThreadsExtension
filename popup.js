const btn = document.getElementById('btnDownload');
const btnPause = document.getElementById('btnPause');
const btnCancel = document.getElementById('btnCancel');
const progressArea = document.getElementById('progressArea');
const countDisplay = document.getElementById('countDisplay');
const statusText = document.getElementById('statusText');
const progressFill = document.querySelector('.progress-fill');

// Check the current background state when the popup opens.
chrome.runtime.sendMessage({ action: "GET_STATUS" }, (state) => {
    if (state && (state.isDownloading || state.isPaused)) {
        mostrarProgresso(true);
        atualizarTela(state);
    } else if (state && state.status && (state.status.includes("Erro") || state.status.includes("Cancelado"))) {
        statusText.textContent = state.status;
        statusText.style.color = "#ff4444";
        progressArea.style.display = "block";
        btn.style.display = "block";
    }
});

// Download button.
btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = "Iniciando...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isThreadsUrl(tab?.url)) {
        btn.disabled = false;
        btn.textContent = "INICIAR DOWNLOAD";
        progressArea.style.display = "block";
        statusText.textContent = "Abra um perfil do Threads antes de baixar.";
        statusText.style.color = "#ff4444";
        return;
    }

    const username = getUsernameFromUrl(tab.url);

    chrome.runtime.sendMessage({
        action: "START_DOWNLOAD",
        usernameFolder: username,
        pageUrl: tab.url
    }, () => {
        if (chrome.runtime.lastError) {
            btn.disabled = false;
            btn.textContent = "Tentar de Novo";
            statusText.textContent = chrome.runtime.lastError.message;
            statusText.style.color = "#ff4444";
            progressArea.style.display = "block";
            return;
        }

        mostrarProgresso(true);
    });
});

// Pause/resume button.
btnPause.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "TOGGLE_PAUSE" });
});

// Cancel button.
btnCancel.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "CANCEL_DOWNLOAD" });
});

// Progress updates from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "PROGRESS_UPDATE") {
        atualizarTela(msg.data);
    }
});

function atualizarTela(state) {
    countDisplay.textContent = state.count || 0;
    statusText.textContent = state.status || "Aguardando.";

    if (state.isPaused) {
        btnPause.textContent = "CONTINUAR";
        btnPause.disabled = false;
        btnCancel.disabled = false;
        statusText.style.color = "#ffd166";
        progressFill.style.animation = "none";
        progressFill.style.width = "60%";
    } else if (state.isDownloading) {
        btnPause.textContent = "PAUSAR";
        btnPause.disabled = false;
        btnCancel.disabled = false;
        statusText.style.color = "#ddd";
        progressFill.style.animation = "loading 1.5s infinite cubic-bezier(0.4, 0, 0.2, 1)";
        progressFill.style.width = "";
    } else if (state.status && state.status.includes("Concluído")) {
        btn.textContent = "Baixar Novamente";
        btn.disabled = false;
        btn.style.display = "block";
        btnPause.disabled = true;
        btnCancel.disabled = true;
        statusText.style.color = "#00ff00";
        progressFill.style.animation = "none";
        progressFill.style.width = "100%";
    } else if (state.status && state.status.includes("Cancelado")) {
        btn.textContent = "Iniciar Novamente";
        btn.disabled = false;
        btn.style.display = "block";
        btnPause.disabled = true;
        btnCancel.disabled = true;
        statusText.style.color = "#ff4444";
        progressFill.style.animation = "none";
        progressFill.style.width = "0%";
    } else if (state.status && state.status.includes("Erro")) {
        btn.disabled = false;
        btn.textContent = "Tentar de Novo";
        btn.style.display = "block";
        btnPause.disabled = true;
        btnCancel.disabled = true;
        statusText.style.color = "#ff4444";
        progressFill.style.animation = "none";
    }
}

function mostrarProgresso(show) {
    progressArea.style.display = show ? "block" : "none";
    btn.style.display = show ? "none" : "block";
}

function getUsernameFromUrl(url) {
    try {
        const match = url.match(/@([^/]+)/);
        return match ? match[1] : "threads_unknown";
    } catch (e) {
        return "threads_download";
    }
}

function isThreadsUrl(url) {
    try {
        const { hostname, pathname } = new URL(url);
        const isThreadsHost = hostname === "threads.net" ||
            hostname.endsWith(".threads.net") ||
            hostname === "threads.com" ||
            hostname.endsWith(".threads.com");

        return isThreadsHost && /\/@[^/]+/.test(pathname);
    } catch (e) {
        return false;
    }
}
