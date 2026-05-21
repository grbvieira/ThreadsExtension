(function () {
  const DB_NAME = "ThreadsDownloaderDB";
  const DB_VERSION = 1;
  const SETTINGS_STORE = "settings";
  const ROOT_FOLDER_KEY = "rootFolderHandle";

  function openSettingsDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getStoredRootHandle() {
    try {
      const db = await openSettingsDb();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE, "readonly");
        const request = transaction.objectStore(SETTINGS_STORE).get(ROOT_FOLDER_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn("Failed to read stored folder:", e);
      return null;
    }
  }

  async function storeRootHandle(handle) {
    const db = await openSettingsDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readwrite");
      transaction.objectStore(SETTINGS_STORE).put(handle, ROOT_FOLDER_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function clearStoredRootHandle() {
    try {
      const db = await openSettingsDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(SETTINGS_STORE, "readwrite");
        transaction.objectStore(SETTINGS_STORE).delete(ROOT_FOLDER_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (e) {
      console.warn("Failed to clear stored folder:", e);
    }
  }

  async function hasReadWritePermission(handle) {
    if (!handle) return false;

    const options = { mode: "readwrite" };
    if ((await handle.queryPermission(options)) === "granted") return true;
    return (await handle.requestPermission(options)) === "granted";
  }

  function sanitizeName(name, fallback = "threads_download") {
    if (!name) return fallback;
    return String(name)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function getUsernameFromUrl(url, fallback = "usuario_threads") {
    try {
      const match = url.match(/@([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function isThreadsProfileUrl(url) {
    try {
      const { hostname, pathname } = new URL(url);
      const isThreadsHost =
        hostname === "threads.net" ||
        hostname.endsWith(".threads.net") ||
        hostname === "threads.com" ||
        hostname.endsWith(".threads.com");

      return isThreadsHost && /\/@[^/]+/.test(pathname);
    } catch (e) {
      return false;
    }
  }

  globalThis.ThreadsShared = {
    DB_NAME,
    DB_VERSION,
    SETTINGS_STORE,
    ROOT_FOLDER_KEY,
    clearStoredRootHandle,
    delay,
    formatTimestamp,
    getStoredRootHandle,
    getUsernameFromUrl,
    hasReadWritePermission,
    isThreadsProfileUrl,
    sanitizeName,
    storeRootHandle
  };
})();
