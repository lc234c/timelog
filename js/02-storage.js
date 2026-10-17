'use strict';
/*!
 * 工时记录 · 02-storage.js（存储层：store + db）
 */
(function () {

const { KEY, IDB_NAME, IDB_VER, IDB_STORE, IDB_HANDLES, IDB_OT, IDB_LEAVE } = App.CONST;

/* ============================================================
 * store：localStorage 封装
 * ========================================================== */
const store = (function () {
    let ok = false;
    try {
        const k = '__probe__' + Date.now();
        localStorage.setItem(k, '1'); localStorage.removeItem(k);
        ok = true;
    } catch (e) { ok = false; }

    return {
        get available() { return ok; },
        read(k) { if (!ok) return null; try { return localStorage.getItem(k); } catch (e) { return null; } },
        write(k, v) { if (!ok) return false; try { localStorage.setItem(k, v); return true; } catch (e) { ok = false; return false; } },
        remove(k) { if (!ok) return; try { localStorage.removeItem(k); } catch (e) {} },
        readJSON(k, fallback) {
            const raw = this.read(k);
            if (!raw) return fallback;
            try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch (e) { return fallback; }
        },
        writeJSON(k, v) { return this.write(k, JSON.stringify(v)); }
    };
})();

/* ============================================================
 * db：IndexedDB 封装
 * ========================================================== */
const db = (function () {
    let mode = 'memory';
    let conn = null;

    function openConn() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('no-indexeddb')); return; }
            let req;
            try { req = indexedDB.open(IDB_NAME, IDB_VER); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
                if (!d.objectStoreNames.contains(IDB_HANDLES)) d.createObjectStore(IDB_HANDLES);
                if (!d.objectStoreNames.contains(IDB_OT)) d.createObjectStore(IDB_OT, { keyPath: 'id', autoIncrement: true });
                if (!d.objectStoreNames.contains(IDB_LEAVE)) d.createObjectStore(IDB_LEAVE, { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = () => { conn = req.result; resolve(conn); };
            req.onerror = () => reject(req.error || new Error('idb-open-failed'));
            req.onblocked = () => reject(new Error('idb-blocked'));
        });
    }

    function idbReadAll() {
        return new Promise((resolve, reject) => {
            const out = {};
            let t;
            try { t = conn.transaction(IDB_STORE, 'readonly'); } catch (e) { reject(e); return; }
            const req = t.objectStore(IDB_STORE).openCursor();
            req.onsuccess = () => {
                const cur = req.result;
                if (cur) { out[cur.key] = cur.value; cur.continue(); } else resolve(out);
            };
            req.onerror = () => reject(req.error);
        });
    }
    function idbWrite(puts, dels) {
        return new Promise((resolve, reject) => {
            let t;
            try { t = conn.transaction(IDB_STORE, 'readwrite'); } catch (e) { reject(e); return; }
            const os = t.objectStore(IDB_STORE);
            Object.keys(puts).forEach((k) => os.put(puts[k], k));
            (dels || []).forEach((k) => os.delete(k));
            t.oncomplete = () => resolve(true);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('abort'));
        });
    }
    function idbReplaceAll(data) {
        return new Promise((resolve, reject) => {
            let t;
            try { t = conn.transaction(IDB_STORE, 'readwrite'); } catch (e) { reject(e); return; }
            const os = t.objectStore(IDB_STORE);
            os.clear();
            Object.keys(data).forEach((k) => os.put(data[k], k));
            t.oncomplete = () => resolve(true);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('abort'));
        });
    }
    function idbSetHandle(h) {
        return new Promise((resolve, reject) => {
            let t;
            try { t = conn.transaction(IDB_HANDLES, 'readwrite'); } catch (e) { reject(e); return; }
            try { t.objectStore(IDB_HANDLES).put(h, 'backup'); }
            catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(true);
            t.onerror = () => reject(t.error || new Error('put-failed'));
            t.onabort = () => reject(t.error || new Error('abort'));
        });
    }
    function idbGetHandle() {
        return new Promise((resolve, reject) => {
            let t;
            try { t = conn.transaction(IDB_HANDLES, 'readonly'); } catch (e) { reject(e); return; }
            const req = t.objectStore(IDB_HANDLES).get('backup');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }
    function idbDropHandle() {
        return new Promise((resolve) => {
            let t;
            try { t = conn.transaction(IDB_HANDLES, 'readwrite'); } catch (e) { resolve(false); return; }
            t.objectStore(IDB_HANDLES).delete('backup');
            t.oncomplete = () => resolve(true);
            t.onerror = () => resolve(false);
        });
    }

    function localReadAll() { return store.readJSON(KEY.data, {}) || {}; }
    function localMerge(puts, dels) {
        const all = localReadAll();
        Object.keys(puts).forEach((k) => { all[k] = puts[k]; });
        (dels || []).forEach((k) => { delete all[k]; });
        return store.writeJSON(KEY.data, all);
    }
    function localReplaceAll(data) { return store.writeJSON(KEY.data, data); }

    const ready = openConn().then(
        () => { mode = 'idb'; return mode; },
        () => { mode = store.available ? 'local' : 'memory'; return mode; }
    );

    return {
        ready: ready,
        get mode() { return mode; },
        get modeLabel() {
            return mode === 'idb' ? '本地数据库（IndexedDB）'
                : mode === 'local' ? '本地缓存（localStorage，容量较小）'
                : '内存（不保存，刷新即丢失）';
        },
        /** 打开多 store 事务，供加班/请假模块使用。不可用时抛错由调用方捕获。 */
        tx(stores, txMode) {
            if (mode !== 'idb' || !conn) throw new Error('idb-unavailable');
            return conn.transaction(stores, txMode || 'readonly');
        },
        loadAll() {
            if (mode === 'idb') return idbReadAll();
            if (mode === 'local') return Promise.resolve(localReadAll());
            return Promise.resolve({});
        },
        saveMany(puts, dels) {
            if (mode === 'idb') return idbWrite(puts, dels);
            if (mode === 'local') return Promise.resolve(localMerge(puts, dels));
            return Promise.resolve(false);
        },
        replaceAll(data) {
            if (mode === 'idb') return idbReplaceAll(data);
            if (mode === 'local') return Promise.resolve(localReplaceAll(data));
            return Promise.resolve(false);
        },
        setHandle(h) { return mode === 'idb' ? idbSetHandle(h) : Promise.resolve(false); },
        getHandle() { return mode === 'idb' ? idbGetHandle() : Promise.resolve(null); },
        dropHandle() { return mode === 'idb' ? idbDropHandle() : Promise.resolve(false); }
    };
})();

/* 挂载到全局 App 对象 */
App.store = store;
App.db = db;

})();
