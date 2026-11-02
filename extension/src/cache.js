(() => {
  function memoryStore() {
    const map = new Map();
    return {
      async get(key) {
        return map.has(key) ? structuredClone(map.get(key)) : undefined;
      },
      async set(key, value) {
        map.set(key, structuredClone(value));
      },
    };
  }

  // IndexedDB de l'origine de la page. Ouverture paresseuse, un seul object store clé-valeur.
  function indexedDbStore(dbName = 'wm-doublons', storeName = 'kv') {
    let opening = null;
    const open = () => {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          const req = globalThis.indexedDB.open(dbName, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(storeName);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        opening.catch(() => { opening = null; });
      }
      return opening;
    };
    const run = async (mode, op) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = op(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || req.error);
      });
    };
    return {
      get: (key) => run('readonly', (s) => s.get(key)),
      set: async (key, value) => { await run('readwrite', (s) => s.put(value, key)); },
    };
  }

  function createCache(store) {
    const userKey = (userId) => `user:${userId}`;
    return {
      async get(userId) {
        const v = await store.get(userKey(userId));
        return v === undefined ? null : v;
      },
      put: (userId, record) => store.set(userKey(userId), record),
      async getLastUserId() {
        const v = await store.get('lastUserId');
        return v === undefined ? null : v;
      },
      setLastUserId: (userId) => store.set('lastUserId', userId),
    };
  }

  const api = { memoryStore, indexedDbStore, createCache };
  globalThis.__wmDoublons = Object.assign(globalThis.__wmDoublons || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
