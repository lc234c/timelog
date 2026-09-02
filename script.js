/*!
 * 工时记录 · script.js（重构版 v2.1.0）
 * 结构：常量 → 工具 → 存储 → 状态 → 数据层 → 渲染调度 → 渲染层 → 业务逻辑 → 事件 → 初始化
 * 约定：所有日期键均为本地时区的 'YYYY-MM-DD'，统一由 toDateKey/parseDateKey 转换，禁止直接 new Date(日期字符串)。
 */
(function () {
'use strict';

/* ============================================================
 * 1. 常量
 * ========================================================== */
const KEY = {
    data: 'attendanceData',          // 打卡记录（IndexedDB 为主，localStorage 为同步镜像）
    shifts: 'shiftSchedules',
    shiftType: 'defaultShiftType',
    calExpanded: 'calendarDefaultExpanded',
    target: 'chartTargetHours',
    backupAt: 'lastBackupRemind',    // 上次备份时间戳
    backupCount: 'lastBackupCount',  // 上次备份时的记录天数，用于按增量提醒
    fileSync: 'fileSyncName'         // 已绑定备份文件的文件名（提示用，句柄存 IndexedDB）
};

/* IndexedDB：days 存打卡记录，handles 存备份文件的句柄 */
const IDB_NAME = 'worktime-db', IDB_VER = 2, IDB_STORE = 'days', IDB_HANDLES = 'handles';
/* 累计新增多少天记录就提醒备份一次 */
const BACKUP_THRESHOLD = 10;

const PUNCH_KEYS = ['s1', 'e1', 's2', 'e2'];          // 打卡槽位顺序
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$/;            // HH:MM
const RE_HMS = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;   // HH:MM:SS
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const C = {
    primary: '#4a90e2', success: '#34c759', grid: '#eef0f3',
    axis: '#a8a8ae', tip: '#8e8e93', text: '#1c1c1e'
};
const STEP_COLORS = ['#4a90e2', '#ff9500', '#34c759', '#34c759'];
const TARGET_DEFAULT = 6, TARGET_MIN = 0.5, TARGET_MAX = 24;
const EXPORT_W = 720, EXPORT_H = 420;
const LONG_PRESS_MS = 600, LONG_PRESS_MOVE_PX = 10;
const DAY = 86400000;

const DEFAULT_SCHEDULES = {
    day: {
        name: '白班',
        periods: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }],
        steps: ['上午上班', '上午下班', '下午上班', '下午下班'],
        keys: PUNCH_KEYS,
        labels: ['上午工时', '下午工时']
    },
    night: {
        name: '夜班',
        periods: [{ start: '19:30', end: '23:59' }, { start: '00:00', end: '05:00' }],
        steps: ['夜班上班', '午夜下班', '凌晨上班', '凌晨下班'],
        keys: PUNCH_KEYS,
        labels: ['前半段工时', '后半段工时']
    }
};
const SHIFT_TYPES = ['day', 'night'];

/* ============================================================
 * 2. 工具函数
 * ========================================================== */
const pad2 = (n) => String(n).padStart(2, '0');
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

/** Date → 'YYYY-MM-DD'（本地时区） */
function toDateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
/** 'YYYY-MM-DD' → 本地 00:00 的 Date（避免 new Date(str) 被当成 UTC；含回环校验，拒绝 2026-13-40 这类溢出值） */
function parseDateKey(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], day = +m[3];
    const d = new Date(y, mo - 1, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => startOfDay(new Date());
const isSameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime();
/** Date → 'HH:MM:SS' */
const toTimeStr = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
/** 'HH:MM:SS' → 当日秒数 */
function timeToSec(s) {
    const p = String(s || '').split(':');
    return (+(p[0] || 0)) * 3600 + (+(p[1] || 0)) * 60 + (+(p[2] || 0));
}
const isValidHM = (s) => RE_HM.test(String(s || ''));
const isValidHMS = (s) => RE_HMS.test(String(s || ''));
const isValidDateKey = (s) => RE_DATE.test(String(s || '')) && !!parseDateKey(s);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
/** HTML 转义，杜绝 innerHTML 注入 */
function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
    let t = 0;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
}
/** 本周一 00:00 ~ 周日 23:59:59.999（周一为一周之始） */
function weekRange(d) {
    const base = startOfDay(d), w = base.getDay() || 7;
    const mon = addDays(base, 1 - w), sun = addDays(mon, 6);
    sun.setHours(23, 59, 59, 999);
    return { mon: mon, sun: sun };
}
/** 遍历 [start, end]（含两端）的每一天 */
function eachDay(start, end, fn) {
    for (let d = startOfDay(start); d.getTime() <= startOfDay(end).getTime(); d = addDays(d, 1)) fn(d);
}
/** 两个时间段（HH:MM）之差，支持跨天；任一端缺失返回 0 */
function durationHours(a, b) {
    if (!a || !b) return 0;
    let s = timeToSec(b) - timeToSec(a);
    if (s < 0) s += DAY / 1000;
    return s / 3600;
}
const inPeriods = (periods, hm) => periods.some((p) => hm >= p.start && hm <= p.end);

/* ============================================================
 * 3. 存储层
 *    store —— localStorage：偏好设置等小数据（同步读写）
 *    db    —— IndexedDB：打卡记录主存储（异步、大容量，按日期分条存储）
 *             不可用时自动降级为 localStorage，再不行降级为纯内存
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

/* ---- IndexedDB 打卡记录仓库（按日期一条记录，读写粒度小） ---- */
const db = (function () {
    let mode = 'memory';        // idb | local | memory
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
            };
            req.onsuccess = () => { conn = req.result; resolve(conn); };
            req.onerror = () => reject(req.error || new Error('idb-open-failed'));
            req.onblocked = () => reject(new Error('idb-blocked'));
        });
    }

    /* 游标遍历取值，保留日期键 */
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
    /* 备份文件句柄：FileSystemFileHandle 可结构化克隆，直接存入 IndexedDB。
       注意：put() 在句柄不可克隆时会「同步」抛出 DataCloneError，必须一并捕获。 */
    function idbSetHandle(h) {
        return new Promise((resolve, reject) => {
            let t;
            try { t = conn.transaction(IDB_HANDLES, 'readwrite'); } catch (e) { reject(e); return; }
            let req;
            try { req = t.objectStore(IDB_HANDLES).put(h, 'backup'); }
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

    /* ---- localStorage 降级实现：整包读写 ---- */
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
        /** 当前存储方式的中文名，用于界面提示 */
        get modeLabel() {
            return mode === 'idb' ? '本地数据库（IndexedDB）'
                : mode === 'local' ? '本地缓存（localStorage，容量较小）'
                : '内存（不保存，刷新即丢失）';
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
        /* 备份文件句柄；IndexedDB 不可用时无法持久化句柄，只能每次手动选文件 */
        setHandle(h) { return mode === 'idb' ? idbSetHandle(h) : Promise.resolve(false); },
        getHandle() { return mode === 'idb' ? idbGetHandle() : Promise.resolve(null); },
        dropHandle() { return mode === 'idb' ? idbDropHandle() : Promise.resolve(false); }
    };
})();

/* ============================================================
 * 4. 状态
 * ========================================================== */
const state = {
    data: loadMirror(),               // { 'YYYY-MM-DD': { shiftType, status:{s1,e1,s2,e2} } }
                                      // 启动时先用 localStorage 镜像同步填充，避免首屏空白；
                                      // 随后由 hydrate() 用 IndexedDB 的权威数据校正
    selected: today(),                // 当前选中日期（始终为当天 00:00）
    view: { y: 0, m: 0 },             // 月视图当前年月
    shiftType: 'day',                 // 当前生效班别
    calExpanded: false,               // 日历视图：true=月视图 / false=周视图
    chart: { type: 'line', range: 'month', customStart: '', customEnd: '' },
    targetHours: TARGET_DEFAULT,
    version: 0                        // 数据版本号，用于失效统计缓存
};
state.view.y = state.selected.getFullYear();
state.view.m = state.selected.getMonth();
state.shiftType = normalizeShiftType(store.read(KEY.shiftType));
state.calExpanded = store.read(KEY.calExpanded) === '1';
state.targetHours = loadTargetHours();

/** 空打卡状态；用函数声明以保证提升（normalizeData 在 state 初始化时即被调用） */
function emptyStatus() { return { s1: null, e1: null, s2: null, e2: null }; }
const shifts = loadShiftSchedules();

/* ============================================================
 * 5. 数据层
 * ========================================================== */
/** 读取 localStorage 镜像（同步，仅用于首屏快速渲染） */
function loadMirror() {
    return normalizeData(store.readJSON(KEY.data, null));
}
/** 数据清洗：返回一份干净副本（同时用于导入） */
function normalizeData(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((ds) => {
        if (!isValidDateKey(ds)) return;
        const rec = raw[ds];
        if (!rec || typeof rec !== 'object') return;
        const src = rec.status && typeof rec.status === 'object' ? rec.status : rec;
        const status = emptyStatus();
        let any = false;
        PUNCH_KEYS.forEach((k) => {
            const v = src[k];
            if (typeof v === 'string' && isValidHMS(v)) { status[k] = v; any = true; }
            else if (typeof v === 'string' && isValidHM(v)) { status[k] = v + ':00'; any = true; }
        });
        if (!any) return;                                  // 空记录不入库，避免污染统计
        out[ds] = { shiftType: normalizeShiftType(rec.shiftType), status: status };
    });
    return out;
}
function normalizeShiftType(t) { return SHIFT_TYPES.indexOf(t) >= 0 ? t : 'day'; }

/* ---- 持久化调度 ----
 * 变更只记录「脏键」，合并后批量写入：单次打卡只写 1 条记录，而不是全量重写。
 * 每次变更同时同步刷新 localStorage 镜像，作为 IndexedDB 不可用时的兜底。
 */
let dirtyKeys = null;      // Set<日期键>；null 表示暂无增量
let dirtyAll = false;      // true 表示整库替换（导入 / 清空）
let flushTimer = 0;
const FLUSH_DELAY = 200;

function markDirty(ds) { if (!dirtyKeys) dirtyKeys = new Set(); dirtyKeys.add(ds); }
function markAllDirty() { dirtyAll = true; }

function writeMirror(data) {
    if (!store.available) return;
    try { localStorage.setItem(KEY.data, JSON.stringify(data)); } catch (e) {}
}

function saveData() {
    state.version++;
    writeMirror(state.data);
    scheduleFlush();
    if (syncHook) { try { syncHook(); } catch (e) {} }
    /* 备份状态会随记录数变化，纳入渲染调度统一刷新 */
    if (typeof invalidate === 'function') invalidate('dataStatus');
}
/* 数据变更后的外部钩子，由文件同步模块注册（避免跨模块的 TDZ 问题） */
let syncHook = null;
function setSyncHook(fn) { syncHook = fn; }
function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = 0; flushData(); }, FLUSH_DELAY);
}
/** 把累积的变更写入 IndexedDB；返回 Promise<boolean> */
function flushData() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    if (dirtyAll) {
        dirtyAll = false;
        dirtyKeys = null;
        return db.replaceAll(state.data).catch(() => false);
    }
    if (!dirtyKeys || !dirtyKeys.size) return Promise.resolve(true);
    const puts = {}, dels = [];
    dirtyKeys.forEach((ds) => {
        if (state.data[ds]) puts[ds] = state.data[ds];
        else dels.push(ds);
    });
    dirtyKeys = null;
    return db.saveMany(puts, dels).catch(() => false);
}

/** 从 IndexedDB 载入权威数据并校正内存状态。
 *  · IndexedDB 有数据 → 以它为准（localStorage 被清理时可据此恢复）
 *  · IndexedDB 为空而镜像有数据 → 首次升级，把镜像迁入库
 *  @returns Promise<{count:number, restored:number}> */
function hydrate() {
    return db.ready
        .then(() => db.loadAll())
        .then((raw) => {
            const remote = normalizeData(raw);
            const remoteCount = Object.keys(remote).length;
            const mirrorCount = Object.keys(state.data).length;
            if (remoteCount > 0) {
                state.data = remote;
                state.version++;
                if (remoteCount !== mirrorCount) writeMirror(state.data);
            } else if (mirrorCount > 0) {
                db.replaceAll(state.data).catch(() => {});
            }
            return { count: remoteCount || mirrorCount, restored: Math.max(0, remoteCount - mirrorCount) };
        })
        .catch(() => ({ count: Object.keys(state.data).length, restored: 0 }));
}

/** 只读取某天记录（不存在返回 null，不创建） */
function getRecord(ds) {
    const r = state.data[ds];
    return r || null;
}
/** 取（或按需创建）某天记录。
 *  仅在写入路径调用（打卡 / 补卡），因此无条件标记脏键——
 *  调用方紧接着会修改 status，必须确保变更被落盘。 */
function ensureRecord(ds, shiftType) {
    let r = state.data[ds];
    if (!r) {
        r = state.data[ds] = { shiftType: normalizeShiftType(shiftType || state.shiftType), status: emptyStatus() };
    } else if (!r.shiftType) {
        r.shiftType = normalizeShiftType(shiftType || state.shiftType);
    }
    markDirty(ds);
    return r;
}
/** 删除某天记录（不存在则返回 false） */
function removeRecord(ds) {
    if (!state.data[ds]) return false;
    delete state.data[ds];
    markDirty(ds);
    state.version++;
    writeMirror(state.data);
    scheduleFlush();
    if (typeof invalidate === 'function') invalidate('dataStatus');
    return true;
}
/** 整体替换全部数据（导入 / 清空） */
function replaceAllData(next) {
    state.data = next;
    markAllDirty();
    state.version++;
    writeMirror(state.data);
    scheduleFlush();
    if (typeof invalidate === 'function') invalidate('dataStatus');
}
/** 当前选中日期的记录（只读；空则视为全空状态） */
const currentRecord = () => getRecord(toDateKey(state.selected));
const currentStatus = () => { const r = currentRecord(); return r ? r.status : emptyStatus(); };
const getShift = (t) => shifts[normalizeShiftType(t || state.shiftType)] || shifts.day;

/** 当日工时 */
function dayHours(rec) {
    if (!rec) return 0;
    const s = rec.status;
    return durationHours(s.s1, s.e1) + durationHours(s.s2, s.e2);
}
/** 已打卡次数（0~4） */
const punchCount = (rec) => PUNCH_KEYS.reduce((n, k) => n + (rec && rec.status[k] ? 1 : 0), 0);
/** 下一个待打卡槽位下标，4 表示已满 */
function nextSlot(rec) {
    if (!rec) return 0;
    for (let i = 0; i < PUNCH_KEYS.length; i++) if (!rec.status[PUNCH_KEYS[i]]) return i;
    return 4;
}

/* ---- 统计（带缓存，数据变更即失效）---- */
const memo = { version: -1, map: {} };
function cached(key, compute) {
    if (memo.version !== state.version) { memo.version = state.version; memo.map = {}; }
    if (!(key in memo.map)) memo.map[key] = compute();
    return memo.map[key];
}
/** 区间统计：只统计「有工时」的天，避免空记录拉低日均 */
function rangeStats(start, end) {
    let total = 0, days = 0;
    eachDay(start, end, (d) => {
        const h = dayHours(getRecord(toDateKey(d)));
        if (h > 0) { total += h; days++; }
    });
    return { total: total, days: days };
}
function monthStats() {
    const y = state.selected.getFullYear(), m = state.selected.getMonth();
    return cached('m' + y + '-' + m, () => rangeStats(new Date(y, m, 1), new Date(y, m + 1, 0)));
}
function weekStats() {
    const w = weekRange(state.selected);
    return cached('w' + toDateKey(w.mon), () => rangeStats(w.mon, w.sun));
}
const isWorkday = (d) => { const w = d.getDay(); return w !== 0 && w !== 6; };
function workdaysInMonth(y, m) {
    return cached('wd' + y + '-' + m, () => {
        let n = 0;
        eachDay(new Date(y, m, 1), new Date(y, m + 1, 0), (d) => { if (isWorkday(d)) n++; });
        return n;
    });
}

/* ---- 班别配置 ---- */
function buildShiftText(periods) {
    return periods.map((p) => p.start + '~' + p.end).join(' (午休) ');
}
function cloneSchedule(s) {
    return {
        name: s.name, steps: s.steps.slice(), keys: s.keys.slice(), labels: s.labels.slice(),
        periods: s.periods.map((p) => ({ start: p.start, end: p.end })),
        text: buildShiftText(s.periods)
    };
}
/** 内置默认 + localStorage 自定义合并；非法时段回退默认 */
function loadShiftSchedules() {
    const out = { day: cloneSchedule(DEFAULT_SCHEDULES.day), night: cloneSchedule(DEFAULT_SCHEDULES.night) };
    const custom = store.readJSON(KEY.shifts, null);
    if (!custom || typeof custom !== 'object') return out;
    SHIFT_TYPES.forEach((t) => {
        const c = custom[t];
        if (!c || !Array.isArray(c.periods)) return;
        const ps = c.periods.filter((p) => p && isValidHM(p.start) && isValidHM(p.end)).slice(0, 2);
        if (!ps.length) return;
        out[t].periods = ps;
        out[t].text = buildShiftText(ps);
    });
    return out;
}
function saveShiftSchedules() {
    store.writeJSON(KEY.shifts, {
        day: { periods: shifts.day.periods },
        night: { periods: shifts.night.periods }
    });
}
function resetShiftSchedules() {
    shifts.day = cloneSchedule(DEFAULT_SCHEDULES.day);
    shifts.night = cloneSchedule(DEFAULT_SCHEDULES.night);
}

function loadTargetHours() {
    const v = parseFloat(store.read(KEY.target));
    return (!isNaN(v) && v > 0) ? clamp(v, TARGET_MIN, TARGET_MAX) : TARGET_DEFAULT;
}
function saveTargetHours(v) {
    const nv = clamp(parseFloat(v) || TARGET_DEFAULT, TARGET_MIN, TARGET_MAX);
    state.targetHours = nv;
    store.write(KEY.target, String(nv));
    return nv;
}

/* ============================================================
 * 6. DOM 缓存 & Toast
 * ========================================================== */
/* DOM 引用统一缓存，由 init() → cacheEls() 填充（脚本可安全放置在文档任意位置） */
const els = {};

function showToast(msg, isError) {
    let t = els.toast;
    if (!t) {
        t = document.createElement('div');
        t.id = 'appToast'; t.className = 'app-toast';
        ($('.app') || document.body).appendChild(t);
        els.toast = t;
    }
    t.textContent = msg;
    t.className = 'app-toast show' + (isError ? ' err' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'app-toast'; }, 2400);
}

/* ============================================================
 * 7. 渲染调度
 *   所有 UI 更新都通过 invalidate('calendar','stats',…) 声明脏区，
 *   同一帧内合并为一次渲染，杜绝「一次操作重绘 5~6 次」。
 * ========================================================== */
const RENDERERS = {
    calendar: renderCalendarView,
    selected: renderSelected,
    stats: renderTodayStats,
    tabStats: renderTabStats,
    history: renderHistoryList,
    chart: drawChart,
    /* 设置页的备份状态 / 存储方式；元素可能不存在，refreshDataStatus 内部已做空值保护 */
    dataStatus: () => { if (typeof refreshDataStatus === 'function') refreshDataStatus(); }
};
const pending = {};
let rafId = 0;
function invalidate() {
    for (let i = 0; i < arguments.length; i++) pending[arguments[i]] = true;
    if (!rafId) rafId = requestAnimationFrame(flushRender);
}
function flushRender() {
    rafId = 0;
    Object.keys(RENDERERS).forEach((name) => {
        if (!pending[name]) return;
        delete pending[name];
        try { RENDERERS[name](); } catch (e) { console.error('[render:' + name + ']', e); }
    });
}
/** 数据变更后统一入口：保存 + 全量刷新 + 触发本地文件同步（由 saveData 内部的钩子触发） */
function commit() {
    saveData();
    invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart');
}

/* ============================================================
 * 8. 日历渲染（月视图 / 周视图 共用一套格子逻辑 + 事件委托）
 * ========================================================== */
function buildDayCell(date, opts) {
    opts = opts || {};
    const div = document.createElement('div');
    const ds = toDateKey(date), rec = getRecord(ds), n = punchCount(rec);
    div.className = 'cal-date';
    div.dataset.date = ds;
    if (opts.dim) div.classList.add('dim');
    if (n === 4) div.classList.add('cal-done');
    else if (n > 0) div.classList.add('cal-partial');
    if (n > 0) div.classList.add('has-record');
    if (isSameDay(date, state.selected)) div.classList.add('selected');
    if (isSameDay(date, new Date())) div.classList.add('today');
    div.textContent = date.getDate();
    return div;
}
function renderCalendarView() {
    const grid = els.calGrid;
    if (!grid) return;
    let cells;
    if (state.calExpanded) {
        const y = state.view.y, m = state.view.m;
        if (els.calTitle) els.calTitle.textContent = y + '年 ' + pad2(m + 1) + '月';
        const first = new Date(y, m, 1), lead = (first.getDay() || 7) - 1;
        const total = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7) * 7;
        cells = [];
        for (let i = 0; i < total; i++) {
            const d = new Date(y, m, i - lead + 1);
            cells.push(buildDayCell(d, { dim: d.getMonth() !== m }));
        }
    } else {
        const w = weekRange(state.selected);
        if (els.calTitle) {
            els.calTitle.textContent = (w.mon.getMonth() + 1) + '月' + w.mon.getDate() + '日 - ' +
                (w.sun.getMonth() + 1) + '月' + w.sun.getDate() + '日';
        }
        cells = [];
        eachDay(w.mon, w.sun, (d) => cells.push(buildDayCell(d)));
    }
    const frag = document.createDocumentFragment();
    cells.forEach((c) => frag.appendChild(c));
    grid.textContent = '';
    grid.appendChild(frag);
    if (els.collapseCal) els.collapseCal.textContent = state.calExpanded ? '▽' : '△';
}

/* ============================================================
 * 9. 打卡区渲染
 * ========================================================== */
function renderSelected() {
    const d = state.selected, cfg = getShift();
    if (els.selDateText) els.selDateText.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (els.shiftText) els.shiftText.textContent = '排班时段: ' + cfg.text;
    if (els.shiftSelect && els.shiftSelect.value !== state.shiftType) els.shiftSelect.value = state.shiftType;
}
function setDetailRow(key, val, label) {
    const row = els.todayDetail && els.todayDetail.querySelector('.detail-row[data-key="' + key + '"]');
    if (!row) return;
    const lb = row.querySelector('.detail-label');
    if (lb && label) lb.textContent = label;
    const v = row.querySelector('.detail-value');
    if (v) v.textContent = val || '--:--:--';
    row.classList.toggle('has', !!val);
}
function renderTodayStats() {
    const rec = currentRecord(), st = currentStatus(), cfg = getShift();
    const idx = nextSlot(rec);
    if (els.totalHours) els.totalHours.textContent = dayHours(rec).toFixed(2);
    if (els.punchCount) els.punchCount.textContent = idx + ' / 4';
    if (els.shiftBar) els.shiftBar.className = idx === 4 ? 'shift-bar done' : 'shift-bar';
    if (els.btnText) els.btnText.textContent = idx < 4 ? cfg.steps[idx] : '已完成';
    if (els.punchBtn) {
        els.punchBtn.style.background = idx < 4 ? STEP_COLORS[idx] : '#c7c7cc';
        els.punchBtn.disabled = idx >= 4;
    }
    PUNCH_KEYS.forEach((k, i) => setDetailRow(k, st[k], cfg.steps[i]));
}
/** 切换统计 Tab 顶部卡片（本月 / 本周） */
function renderTabStats() {
    const ms = monthStats(), ws = weekStats();
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setVal('tabMonthTotal', ms.total.toFixed(2));
    setVal('tabMonthDays', ms.days);
    setVal('tabMonthAvg', ms.days ? (ms.total / ms.days).toFixed(2) : '0.00');
    setVal('tabWeekTotal', ws.total.toFixed(2));
    setVal('tabWeekDays', ws.days);
    setVal('tabWeekAvg', ws.days ? (ws.total / ws.days).toFixed(2) : '0.00');
    const tip = document.getElementById('tabWeekTip');
    if (tip) {
        const w = weekRange(state.selected);
        tip.textContent = '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '~' +
            (w.sun.getMonth() + 1) + '/' + w.sun.getDate() + '（点击日历切换）';
    }
}

/* ============================================================
 * 10. 工时记录列表
 * ========================================================== */
function pairHtml(l1, l2, t1, t2) {
    return '<div class="history-pair">' +
        '<div class="history-row"><span class="history-label">' + esc(l1) + '</span>' +
        '<span class="history-time ' + (t1 ? 'done' : 'pending') + '">' + esc(t1 || '--:--:--') + '</span></div>' +
        '<div class="history-row"><span class="history-label">' + esc(l2) + '</span>' +
        '<span class="history-time ' + (t2 ? 'done' : 'pending') + '">' + esc(t2 || '--:--:--') + '</span></div>' +
        '</div>';
}
/** 未填日期时自动填充为「本月 1 日 ~ 今天」 */
function ensureHistoryRange() {
    const sd = document.getElementById('historyStartDate'), ed = document.getElementById('historyEndDate');
    if (!sd || !ed) return { start: '', end: '' };
    if (!isValidDateKey(sd.value) || !isValidDateKey(ed.value)) {
        const t = new Date();
        sd.value = toDateKey(new Date(t.getFullYear(), t.getMonth(), 1));
        ed.value = toDateKey(t);
    }
    if (sd.value > ed.value) { const tmp = sd.value; sd.value = ed.value; ed.value = tmp; }
    return { start: sd.value, end: ed.value };
}
function renderHistoryList() {
    const box = document.getElementById('historyList');
    if (!box) return;
    const range = ensureHistoryRange();
    if (!range.start) { box.textContent = '组件未就绪'; return; }
    const keys = Object.keys(state.data)
        .filter((ds) => isValidDateKey(ds) && ds >= range.start && ds <= range.end && punchCount(state.data[ds]) > 0)
        .sort((a, b) => b.localeCompare(a));
    if (!keys.length) {
        box.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">在 ' +
            esc(range.start) + ' 至 ' + esc(range.end) + ' 期间，暂无打卡记录</div>';
        return;
    }
    const frag = document.createDocumentFragment();
    keys.forEach((ds) => {
        const rec = state.data[ds], st = rec.status, cfg = getShift(rec.shiftType);
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML =
            '<div class="history-item-header"><div class="history-head-left">' +
            '<span class="history-date">' + esc(ds) + '</span>' +
            '<span class="history-shift-tag ' + (rec.shiftType === 'night' ? 'night' : 'day') + '">' + esc(cfg.name) + '</span>' +
            '</div></div>' +
            '<div class="history-item-body">' +
            '<div class="history-col">' + pairHtml(cfg.steps[0], cfg.steps[1], st.s1, st.e1) + '</div>' +
            '<div class="history-col">' + pairHtml(cfg.steps[2], cfg.steps[3], st.s2, st.e2) + '</div>' +
            '</div>' +
            '<div class="history-item-footer"><span class="history-footer-label">当日总工时</span>' +
            '<span class="history-footer-hours"><b>' + dayHours(rec).toFixed(2) + '</b> h</span></div>';
        frag.appendChild(item);
    });
    box.textContent = '';
    box.appendChild(frag);
}

/* ============================================================
 * 11. 图表（页面展示与 PNG 导出共用同一绘制引擎）
 * ========================================================== */
function chartRange() {
    const sel = state.selected, y = sel.getFullYear(), m = sel.getMonth();
    if (state.chart.range === 'week') { const w = weekRange(sel); return { start: w.mon, end: w.sun }; }
    if (state.chart.range === 'custom') {
        const s = parseDateKey(state.chart.customStart), e = parseDateKey(state.chart.customEnd);
        if (s && e) return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
}
function chartSeries() {
    const r = chartRange(), arr = [];
    eachDay(r.start, r.end, (d) => {
        const ds = toDateKey(d), rec = getRecord(ds);
        arr.push({ date: d.getDate(), ds: ds, total: dayHours(rec), hasRecord: punchCount(rec) > 0 });
    });
    return arr;
}
function chartRangeLabel() {
    const sel = state.selected;
    if (state.chart.range === 'week') {
        const w = weekRange(sel);
        return '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '-' + (w.sun.getMonth() + 1) + '/' + w.sun.getDate();
    }
    if (state.chart.range === 'custom' && state.chart.customStart && state.chart.customEnd) {
        return state.chart.customStart.slice(5) + ' ~ ' + state.chart.customEnd.slice(5);
    }
    return (sel.getMonth() + 1) + '月';
}
function setupCanvas(canvas, dpr) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: rect.width, h: rect.height };
}
function xLabelStep(n) { return n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2)); }

/**
 * 绘制图表：页面展示与导出共用
 * @returns {{pad,bw,cw,ch,maxV,pts}|null}
 */
function paintChart(ctx, W, H, series, opt) {
    opt = opt || {};
    ctx.clearRect(0, 0, W, H);
    if (opt.background) { ctx.fillStyle = opt.background; ctx.fillRect(0, 0, W, H); }

    const pad = opt.pad, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
    if (cw <= 0 || ch <= 0) return null;

    if (!series || !series.length) return null;

    let maxV = 0;
    series.forEach((d) => { if (d.total > maxV) maxV = d.total; });
    maxV = Math.max(maxV, opt.minMax || 8, state.targetHours) * 1.15;

    if (opt.title) {
        ctx.fillStyle = C.text; ctx.font = '600 15px ' + FONT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(opt.title, pad.left - 20, 16);
    }

    /* 网格 + Y 轴刻度 */
    const yTicks = 4;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.fillStyle = C.axis; ctx.font = '11px ' + FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let t = 0; t <= yTicks; t++) {
        const v = maxV * t / yTicks, y = pad.top + ch - (v / maxV) * ch;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillText(v.toFixed(0) + 'h', pad.left - 6, y);
    }

    /* 达标线 */
    const yT = pad.top + ch - (state.targetHours / maxV) * ch;
    if (state.targetHours <= maxV) {
        ctx.strokeStyle = 'rgba(52,199,89,.45)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(W - pad.right, yT); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(52,199,89,.75)'; ctx.textAlign = 'left';
        ctx.fillText(state.targetHours + 'h', W - pad.right + 2, yT);
    }

    const n = series.length, bw = cw / n;
    ctx.fillStyle = C.axis; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '10px ' + FONT;
    const step = xLabelStep(n);
    for (let x = 0; x < n; x++) {
        if ((x + 1) % step === 0 || x === 0 || x === n - 1) {
            ctx.fillText(series[x].date, pad.left + bw * (x + 0.5), H - pad.bottom + 6);
        }
    }

    const pts = series.map((d, i) => ({
        x: pad.left + bw * (i + 0.5),
        y: pad.top + ch - (d.total / maxV) * ch,
        d: d
    }));

    if (state.chart.type === 'bar') {
        const barW = Math.max(3, bw * 0.62);
        series.forEach((d, i) => {
            const bh = (d.total / maxV) * ch;
            if (bh <= 0) return;
            const bx = pts[i].x - barW / 2, by = pts[i].y;
            const grad = ctx.createLinearGradient(0, by, 0, by + bh);
            if (d.total >= state.targetHours) { grad.addColorStop(0, C.success); grad.addColorStop(1, 'rgba(52,199,89,.55)'); }
            else { grad.addColorStop(0, C.primary); grad.addColorStop(1, 'rgba(74,144,226,.5)'); }
            ctx.fillStyle = grad;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(bx, by, barW, bh, [3, 3, 0, 0]); else ctx.rect(bx, by, barW, bh);
            ctx.fill();
        });
    } else {
        /* 折线 + 半透明面积 */
        const fill = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        fill.addColorStop(0, 'rgba(74,144,226,.22)');
        fill.addColorStop(1, 'rgba(74,144,226,0)');
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.lineTo(pts[pts.length - 1].x, pad.top + ch);
        ctx.lineTo(pts[0].x, pad.top + ch);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();

        ctx.strokeStyle = C.primary; ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        pts.forEach((p) => {
            if (p.d.total <= 0) return;
            ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = p.d.total >= state.targetHours ? C.success : C.primary; ctx.fill();
        });
    }

    if (opt.legend) {
        ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const lx = pad.left + 6, ly = H - 14;
        ctx.fillStyle = C.primary; ctx.fillRect(lx, ly - 4, 12, 8);
        ctx.fillStyle = C.tip; ctx.fillText('每日工时', lx + 18, ly);
        ctx.fillStyle = C.success; ctx.fillRect(lx + 86, ly - 4, 12, 8);
        ctx.fillStyle = C.tip; ctx.fillText('达标(≥' + state.targetHours + 'h)', lx + 104, ly);
    }
    return { pad: pad, bw: bw, cw: cw, ch: ch, maxV: maxV, pts: pts };
}

let chartGeo = null, chartPts = null;
function drawChart() {
    const canvas = els.chartCanvas;
    if (!canvas) return;
    const setup = setupCanvas(canvas, window.devicePixelRatio || 1);
    if (!setup) return;                       // 面板隐藏（宽高为 0）时跳过，切 Tab 时会重绘
    const titleEl = document.getElementById('chartTitle');
    if (titleEl) titleEl.textContent = '📊 工时趋势 · ' + chartRangeLabel();

    const series = chartSeries();
    const hasAny = series.some((d) => d.total > 0);
    const emptyEl = document.getElementById('chartEmpty');
    if (!hasAny) {
        if (emptyEl) emptyEl.style.display = 'flex';
        canvas.style.display = 'none';
        chartGeo = null; chartPts = null;
        renderChartSummary();
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    canvas.style.display = 'block';
    const geo = paintChart(setup.ctx, setup.w, setup.h, series, {
        pad: { top: 18, right: 14, bottom: 26, left: 34 },
        minMax: 8
    });
    chartGeo = geo; chartPts = geo ? geo.pts : null;
    renderChartSummary();
}
/** 导出用：白底 + 标题 + 图例，无数据返回 false */
function paintChartToCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const series = chartSeries();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (!series.some((d) => d.total > 0)) {
        ctx.fillStyle = C.text; ctx.font = '600 15px ' + FONT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('工时趋势 · ' + chartRangeLabel(), 20, 16);
        ctx.fillStyle = C.tip; ctx.font = '13px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('该范围暂无打卡记录', W / 2, H / 2);
        return false;
    }
    return !!paintChart(ctx, W, H, series, {
        pad: { top: 44, right: 18, bottom: 32, left: 40 },
        background: '#ffffff',
        title: '工时趋势 · ' + chartRangeLabel(),
        legend: true,
        minMax: state.targetHours
    });
}
function showChartTooltip(e) {
    const canvas = els.chartCanvas, tip = document.getElementById('chartTooltip');
    if (!canvas || !chartGeo || !chartPts || !tip) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - rect.left;
    let idx = Math.floor((cx - chartGeo.pad.left) / chartGeo.bw);
    idx = clamp(idx, 0, chartPts.length - 1);
    const d = chartPts[idx].d;
    if (d.total <= 0 && !d.hasRecord) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<b>' + esc(d.ds) + '</b><br>工时: ' + d.total.toFixed(2) + ' h' +
        (d.total >= state.targetHours ? ' ✅' : '');
    const tw = tip.offsetWidth || 110;
    tip.style.left = clamp(chartPts[idx].x - tw / 2, 8, Math.max(8, canvas.parentElement.clientWidth - tw - 8)) + 'px';
    tip.style.top = (chartPts[idx].y - 44) + 'px';
    tip.style.display = 'block';
    clearTimeout(tip._h);
    tip._h = setTimeout(() => { tip.style.display = 'none'; }, 2200);
}

/* ---- 图表摘要：累计 / 环比 / 进度 ---- */
function trendPart(prev, cur) {
    if (!(prev > 0)) return '';
    const diff = cur - prev, pct = diff / prev;
    const sign = pct >= 0.1 ? 'up' : (pct <= -0.1 ? 'down' : 'flat');
    if (sign === 'flat') {
        return '<span class="cs-item"><span class="cs-label">较上期</span><span class="cs-val">→ ' +
            (diff >= 0 ? '+' : '') + diff.toFixed(2) + 'h</span></span>';
    }
    const cls = sign === 'up' ? 'cs-trend-up' : 'cs-trend-down';
    const arrow = sign === 'up' ? '🔺' : '🔻';
    return '<span class="cs-item ' + cls + '"><span class="cs-label">较上期</span><span class="cs-val">' +
        arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(2) + 'h</span></span>';
}
function renderChartSummary() {
    const el = els.chartSummary;
    if (!el) return;
    const sel = state.selected, y = sel.getFullYear(), m = sel.getMonth();
    const now = today(), html = [];

    if (state.chart.range === 'month') {
        const cur = rangeStats(new Date(y, m, 1), new Date(y, m + 1, 0));
        const prevEndDay = Math.min(new Date(y, m + 1, 0).getDate(), new Date(y, m, 0).getDate());
        const prev = rangeStats(new Date(y, m - 1, 1), new Date(y, m - 1, prevEndDay));
        let elapsed = 0;
        eachDay(new Date(y, m, 1), new Date(y, m + 1, 0), (d) => { if (d <= now && isWorkday(d)) elapsed++; });
        const wTotal = workdaysInMonth(y, m), pct = wTotal ? Math.round(elapsed / wTotal * 100) : 0;
        html.push('<span class="cs-item cs-total"><span class="cs-label">当月累计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
        html.push(trendPart(prev.total, cur.total));
        html.push('<span class="cs-item cs-progress"><span class="cs-label">工作日进度 ' + elapsed + '/' + wTotal + '（' + pct + '%）</span><span class="cs-bar"><i style="width:' + pct + '%"></i></span></span>');
    } else if (state.chart.range === 'week') {
        const w = weekRange(sel);
        const cur = rangeStats(w.mon, w.sun);
        const prev = rangeStats(addDays(w.mon, -7), addDays(w.mon, -1));
        let elapsed = 0;
        eachDay(w.mon, w.sun, (d) => { if (d <= now && isWorkday(d)) elapsed++; });
        const avg = cur.days ? cur.total / cur.days : 0;
        const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
        html.push('<span class="cs-item cs-total"><span class="cs-label">本周累计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
        html.push(trendPart(prev.total, cur.total));
        html.push('<span class="cs-item"><span class="cs-label">日均</span><span class="cs-val">' + avg.toFixed(2) + 'h</span></span>');
        html.push('<span class="cs-item cs-progress"><span class="cs-label">已工作 ' + elapsed + ' 天（周' + wdNames[now.getDay()] + '）</span></span>');
    } else {
        const s = parseDateKey(state.chart.customStart), e = parseDateKey(state.chart.customEnd);
        if (s && e) {
            const cur = rangeStats(s, e), avg = cur.days ? cur.total / cur.days : 0;
            html.push('<span class="cs-item cs-total"><span class="cs-label">范围总计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
            html.push('<span class="cs-item"><span class="cs-label">天数</span><span class="cs-val">' + cur.days + '</span></span>');
            html.push('<span class="cs-item"><span class="cs-label">日均</span><span class="cs-val">' + avg.toFixed(2) + 'h</span></span>');
        }
    }
    el.innerHTML = html.join('');
}
function updateChartLegend() {
    const el = document.getElementById('chartLegend达标');
    if (el) el.textContent = '当日达标(≥' + state.targetHours + 'h)';
    const sv = document.getElementById('settingsTargetVal');
    if (sv) sv.textContent = state.targetHours + 'h';
}
function setChartRange(val) {
    state.chart.range = val;
    $$('.chart-range-opt').forEach((o) => o.classList.toggle('selected', o.dataset.val === val));
    const custom = document.getElementById('chartCustom');
    if (custom) custom.style.display = val === 'custom' ? 'flex' : 'none';
    invalidate('chart');
}
/** 图表范围跟随日历视图联动（自定义范围不打扰） */
function syncChartWithCalView() {
    if (state.chart.range === 'custom') return;
    setChartRange(state.calExpanded ? 'month' : 'week');
}

/* ============================================================
 * 12. 关于 / 更新日志
 * ========================================================== */
/* file:// 或离线环境下的兜底更新日志（正常情况以 changelog.json 为准） */
const FALLBACK_CHANGELOG = [
    {
        version: '2.2.0', date: '2026-09-02', tag: '新增', items: [
            '新增本地数据库（IndexedDB）：容量大幅提升，按日分条存储；清理 localStorage 后自动恢复记录',
            '新增本地文件自动同步：绑定文件后每次打卡自动写入，清缓存后可重新选文件找回（桌面版 Chrome/Edge）',
            '设置页新增数据状态区，显示备份时间与存储方式；备份提醒改为按新增 10 天记录触发'
        ]
    },
    {
        version: '2.1.1', date: '2026-09-02', tag: '修复', items: [
            '修复「下载备份文件」提示已开始下载、实际没有文件：iOS/PWA/内置浏览器不支持 <a download>，原逻辑却无条件报成功',
            '改为下载前探测环境能力，不可靠时直接弹出可复制的备份数据并说明原因，不再谎报成功',
            '修复 Service Worker 可能拦截 blob 下载请求；修复 iOS 上图表分享被拒绝（改同步生成图片）'
        ]
    },
    {
        version: '2.1.0', date: '2026-09-02', tag: '优化', items: [
            'script.js 全面重构：单一数据源 + 统一渲染调度，代码量减少约 35%',
            '修复：点击日历会产生「空打卡记录」，导致统计天数与日均被稀释',
            '修复：new Date("YYYY-MM-DD") 按 UTC 解析，东八区下自定义图表范围首尾各差一天',
            '修复：切换班别会在备份数据中留下空壳记录',
            '修复：夜班时「今日统计」仍显示白班步骤名（上午上班/下午下班）',
            '修复：初始化时图表切到本周但范围按钮仍高亮「本月」',
            '优化：日历改用事件委托，监听器数量从 200+ 降到 5 个',
            '优化：一次操作只重绘一次（原来同一次打卡会触发 5~6 次图表重绘）',
            '安全：记录列表与更新日志统一 HTML 转义，脏数据导入时自动清洗'
        ]
    }
];
let APP_VERSION = '2.1.0';
let CHANGELOG = FALLBACK_CHANGELOG;

function renderChangelog() {
    const box = document.getElementById('changelogList');
    if (!box) return;
    const TAG_CLS = { '新增': 'new', '优化': 'opt', '修复': 'fix', '发布': 'rel', '移除': 'opt', '文档': 'opt' };
    const frag = document.createDocumentFragment();
    CHANGELOG.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'changelog-item';
        const tag = log.tag || log.type || '优化';
        const cls = 'tag-' + (TAG_CLS[tag] || 'opt');
        let html = '<div class="changelog-head"><span class="changelog-version">v' + esc(log.version) + '</span>' +
            '<span class="changelog-tag ' + cls + '">' + esc(tag) + '</span>' +
            '<span class="changelog-date">' + esc(log.date) + '</span></div><ul class="changelog-items">';
        (log.items || []).forEach((t) => {
            const text = typeof t === 'string' ? t : (t && t.text) || '';
            html += '<li>' + esc(text) + '</li>';
        });
        html += '</ul>';
        item.innerHTML = html;
        frag.appendChild(item);
    });
    box.textContent = '';
    box.appendChild(frag);
}
/** 异步拉取 version.json / changelog.json，失败则沿用内存兜底 */
function loadAboutData() {
    if (typeof fetch !== 'function') { renderChangelog(); return; }
    const getJSON = (url) => fetch(url, { cache: 'no-cache' })
        .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error(url))));
    Promise.all([
        getJSON('version.json').then((j) => { if (j && j.version) APP_VERSION = String(j.version); }).catch(() => {}),
        getJSON('changelog.json').then((j) => {
            if (j && Array.isArray(j) && j.length) CHANGELOG = j;
        }).catch(() => {})
    ]).then(renderChangelog);
}
function checkForUpdates() {
    const btn = document.getElementById('checkUpdateBtn');
    const done = (msg) => {
        showToast(msg);
        if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
    };
    if (btn) { btn.disabled = true; btn.textContent = '检查中…'; }
    if (typeof fetch !== 'function') { done('⚠️ 当前环境不支持检查更新'); return; }
    fetch('version.json', { cache: 'no-cache' })
        .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error('bad response'))))
        .then((j) => {
            if (!j || !j.version) { done('⚠️ 无法读取版本信息'); return; }
            const remote = String(j.version).replace(/^v/, ''), cur = String(APP_VERSION).replace(/^v/, '');
            if (cur === remote) done('✅ 当前已是最新版本 v' + cur);
            else done('🆕 发现新版本 v' + remote + '（当前 v' + cur + '），请前往更新');
        })
        .catch(() => done('⚠️ 检查更新失败（可能以 file:// 打开，建议用 http server）'));
}

/* ============================================================
 * 13. 日期 / 视图操作
 * ========================================================== */
function selectDate(d) {
    if (!d) return;
    state.selected = startOfDay(d);
    state.view.y = state.selected.getFullYear();
    state.view.m = state.selected.getMonth();
    const rec = currentRecord();
    state.shiftType = rec ? normalizeShiftType(rec.shiftType) : state.shiftType;
    invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart');
}
function gotoToday() {
    const t = today();
    state.selected = t;
    state.view.y = t.getFullYear();
    state.view.m = t.getMonth();
    const rec = currentRecord();
    if (rec) state.shiftType = normalizeShiftType(rec.shiftType);
    invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart');
}
function changeMonth(offset) {
    const m = state.view.m + offset;
    const d = new Date(state.view.y, m, 1);
    state.view.y = d.getFullYear();
    state.view.m = d.getMonth();
    invalidate('calendar', 'tabStats');
}
function changeWeek(offset) {
    const mon = addDays(weekRange(state.selected).mon, offset * 7);
    state.selected = mon;
    state.view.y = mon.getFullYear();
    state.view.m = mon.getMonth();
    invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart');
}
/** 切换月/周视图；persist=true 时写入偏好 */
function setCalView(expanded, persist) {
    state.calExpanded = !!expanded;
    if (persist) store.write(KEY.calExpanded, state.calExpanded ? '1' : '0');
    if (!expanded) {
        // 折叠为周视图时，把选中日同步到可视周
        const w = weekRange(state.selected);
        if (state.selected < w.mon || state.selected > w.sun) state.selected = w.mon;
    }
    syncChartWithCalView();
    invalidate('calendar', 'selected', 'stats');
}

/* ============================================================
 * 14. 打卡 / 删除 / 补卡
 * ========================================================== */
function changeShift() {
    if (!els.shiftSelect) return;
    state.shiftType = normalizeShiftType(els.shiftSelect.value);
    store.write(KEY.shiftType, state.shiftType);
    /* 仅当该日已有打卡记录时才落盘班别，避免留下「空壳记录」污染备份与统计 */
    const rec = currentRecord();
    if (rec) { rec.shiftType = state.shiftType; markDirty(toDateKey(state.selected)); }
    saveData();
    invalidate('selected', 'stats', 'history');
}
function smartPunch() {
    const btn = els.punchBtn;
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    try {
        const now = new Date(), ts = toTimeStr(now), hm = ts.slice(0, 5);
        const cfg = getShift();
        if (!inPeriods(cfg.periods, hm) &&
            !confirm('当前时间(' + hm + ')不在【' + cfg.name + '】排班时段内，是否强制打卡/补卡？')) return;

        /* 夜班跨天归属：凌晨打卡且当前选中「今天」时，归属到夜班起始日（昨天）。
           若用户已手动选中昨天或其他日期，则保持不变，避免重复回退。 */
        let target = state.selected;
        if (state.shiftType === 'night' && now.getHours() < 6 && isSameDay(state.selected, now)) {
            target = addDays(target, -1);
        }
        const ds = toDateKey(target);
        const rec = ensureRecord(ds, state.shiftType);
        const slot = nextSlot(rec);
        if (slot >= 4) { showToast('该日期4次打卡已满，无法增加！', true); return; }
        rec.status[PUNCH_KEYS[slot]] = ts;

        if (!isSameDay(target, state.selected)) {
            state.selected = target;
            state.view.y = target.getFullYear();
            state.view.m = target.getMonth();
            state.shiftType = normalizeShiftType(rec.shiftType);
        }
        commit();
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
        showToast('✅ 打卡成功');
    } finally {
        btn.style.opacity = '1';
        btn.disabled = false;
        invalidate('stats');   // 由渲染层决定是否置灰
    }
}
/** 删除「今日统计」中某一条打卡 */
function deleteTodayTime(key) {
    if (PUNCH_KEYS.indexOf(key) < 0) return;
    const ds = toDateKey(state.selected), rec = getRecord(ds);
    if (!rec || !rec.status[key]) return;
    const d = state.selected;
    if (!confirm('确定删除「' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日」的这次打卡记录吗？')) return;
    /* 该时段清空后若整日已无打卡，直接移除该日，避免留下空壳记录污染统计 */
    rec.status[key] = null;
    if (punchCount(rec) === 0) removeRecord(ds);
    else { markDirty(ds); commit(); }
    showToast('删除成功');
}

function openMakeupModal(d) {
    const date = startOfDay(d || state.selected);
    const ds = toDateKey(date);
    const dateEl = document.getElementById('makeupDate');
    const timeEl = document.getElementById('makeupTime');
    const typeEl = document.getElementById('makeupType');
    if (!dateEl || !timeEl || !typeEl) return;
    dateEl.value = ds;
    timeEl.value = toTimeStr(new Date());
    const rec = getRecord(ds);
    const cfg = getShift(rec ? rec.shiftType : state.shiftType);
    typeEl.textContent = '';
    cfg.steps.forEach((s, i) => {
        const o = document.createElement('option');
        o.value = cfg.keys[i];
        o.textContent = s;
        typeEl.appendChild(o);
    });
    openModal('makeupModal');
}
function submitMakeup() {
    const dateEl = document.getElementById('makeupDate');
    const typeEl = document.getElementById('makeupType');
    const timeEl = document.getElementById('makeupTime');
    if (!dateEl || !typeEl || !timeEl) return;
    const ds = dateEl.value, key = typeEl.value;
    let tm = (timeEl.value || '').trim();
    if (!isValidDateKey(ds)) { showToast('请选择有效日期！', true); return; }
    if (!tm) { showToast('请填写补卡时间！', true); return; }
    if (isValidHM(tm)) tm += ':00';
    if (!isValidHMS(tm)) { showToast('时间格式应为 HH:MM(:SS)', true); return; }
    if (PUNCH_KEYS.indexOf(key) < 0) { showToast('请选择打卡类型！', true); return; }

    const rec = ensureRecord(ds, state.shiftType);
    rec.status[key] = tm;
    const d = parseDateKey(ds);
    state.selected = d;
    state.view.y = d.getFullYear();
    state.view.m = d.getMonth();
    state.shiftType = normalizeShiftType(rec.shiftType);
    commit();
    closeModal('makeupModal');
    showToast('补卡成功（' + ds + ' ' + key + ': ' + tm + '）');
}

/* ============================================================
 * 15. 弹窗 / 设置
 * ========================================================== */
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('show'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('show'); }
const openSettings = () => { refreshCalDefaultSwitch(); refreshDataStatus(); openModal('settingsModal'); };
const closeSettings = () => closeModal('settingsModal');
const closeAbout = () => closeModal('aboutModal');
const closeMakeupModal = () => closeModal('makeupModal');
const closeShiftSettings = () => closeModal('shiftSettingsModal');
const closeCopyFallback = () => closeModal('copyFallbackModal');

function openAbout() {
    closeSettings();
    const v = document.getElementById('aboutVersion');
    if (v) v.textContent = APP_VERSION;
    renderChangelog();
    openModal('aboutModal');
}

/* ---- 月历默认展开开关 ---- */
function refreshCalDefaultSwitch() {
    const sw = document.getElementById('calDefaultSwitch');
    if (!sw) return;
    sw.classList.toggle('on', !!state.calExpanded);
    sw.setAttribute('aria-checked', state.calExpanded ? 'true' : 'false');
}
function toggleCalDefault() {
    setCalView(!state.calExpanded, true);
    refreshCalDefaultSwitch();
    showToast(state.calExpanded ? '✅ 月历已展开为月视图' : '✅ 月历已折叠为周视图');
}

/* ---- 自定义班别时间段 ---- */
function openShiftSettings() {
    closeSettings();
    const fill = (prefix, periods) => {
        for (let i = 0; i < 2; i++) {
            const p = periods[i] || { start: '00:00', end: '00:00' };
            const s = document.getElementById(prefix + 'Start' + (i + 1));
            const e = document.getElementById(prefix + 'End' + (i + 1));
            if (s) s.value = p.start;
            if (e) e.value = p.end;
        }
    };
    fill('day', shifts.day.periods);
    fill('night', shifts.night.periods);
    const err = document.getElementById('shiftSettingsErr');
    if (err) err.style.display = 'none';
    openModal('shiftSettingsModal');
}
function readShiftPeriods(prefix) {
    const ps = [];
    for (let i = 0; i < 2; i++) {
        const s = $('#' + prefix + 'Start' + (i + 1)), e = $('#' + prefix + 'End' + (i + 1));
        const sv = s ? s.value : '', ev = e ? e.value : '';
        if (!isValidHM(sv) || !isValidHM(ev)) {
            return { ok: false, msg: isValidHM(sv) && isValidHM(ev) ? '' : '请完整填写起止时间（HH:MM）' };
        }
        ps.push({ start: sv, end: ev });
    }
    return { ok: true, periods: ps };
}
function applyShiftSettings() {
    const day = readShiftPeriods('day'), night = readShiftPeriods('night');
    const errEl = document.getElementById('shiftSettingsErr');
    const fail = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
    if (!day.ok) { fail('白班：' + day.msg); return; }
    if (!night.ok) { fail('夜班：' + night.msg); return; }
    SHIFT_TYPES.forEach((t) => {
        const ps = t === 'day' ? day.periods : night.periods;
        shifts[t].periods = ps;
        shifts[t].text = buildShiftText(ps);
    });
    saveShiftSchedules();
    closeShiftSettings();
    invalidate('selected', 'stats', 'history', 'chart');
    showToast('✅ 班别时间段已更新');
}
function resetShiftSettingsAction() {
    if (!confirm('确定恢复白/夜班时间段为系统默认吗？')) return;
    resetShiftSchedules();
    saveShiftSchedules();
    closeShiftSettings();
    invalidate('selected', 'stats', 'history', 'chart');
    showToast('已恢复默认班别时间段');
}

/* ---- 达标线 ---- */
function promptTargetHours() {
    closeSettings();
    const raw = prompt('设置每日达标线（小时，' + TARGET_MIN + '~' + TARGET_MAX + '）\n当前值：' + state.targetHours + 'h', String(state.targetHours));
    if (raw === null) return;
    const nv = parseFloat(raw);
    if (isNaN(nv) || nv <= 0) { showToast('❌ 输入无效，已保持 ' + state.targetHours + 'h', true); return; }
    saveTargetHours(nv);
    updateChartLegend();
    invalidate('chart');
    showToast('达标线已设为 ' + state.targetHours + 'h');
}

/* ============================================================
 * 16. 本地文件自动落盘（File System Access API）
 *   绑定一个本地 .json 文件后，每次打卡自动覆盖写入；
 *   浏览器数据被清除后，重新打开页面点「连接」即可从该文件恢复。
 *   仅 Chrome / Edge 等桌面浏览器支持；iOS / Safari / 手机端自动隐藏入口。
 * ========================================================== */
const fileSync = (function () {
    const supported = typeof window !== 'undefined' &&
        typeof window.showSaveFilePicker === 'function' &&
        typeof window.showOpenFilePicker === 'function';

    let handle = null;         // 已绑定的 FileSystemFileHandle
    let status = 'off';        // off | linked | need-tap | error
    let fileName = '';
    let lastError = '';
    let lastSyncAt = 0;
    let timer = 0;

    /** 句柄权限查询 / 申请；mode: 'read' | 'readwrite' */
    async function permit(h, mode) {
        if (!h || typeof h.queryPermission !== 'function') return false;
        const opt = { mode: mode || 'readwrite' };
        try {
            if (await h.queryPermission(opt) === 'granted') return true;
            return await h.requestPermission(opt) === 'granted';
        } catch (e) { return false; }
    }
    function setStatus(s, err) {
        status = s; lastError = err || '';
        refreshDataStatus();
    }
    function suggestedName() { return store.read(KEY.fileSync) || buildBackupFileName(); }

    /** 读取文件文本；文件被删除/移动时返回 null */
    async function readHandle(h) {
        try {
            const f = await h.getFile();
            fileName = f.name || fileName;
            const txt = await f.text();
            return { text: txt, name: f.name, mtime: f.lastModified || 0 };
        } catch (e) { return null; }
    }
    /** 把当前数据写入已绑定文件 */
    async function writeNow() {
        if (!handle) return false;
        if (!(await permit(handle, 'readwrite'))) {
            setStatus('need-tap', '文件访问权限已失效');
            return false;
        }
        let w = null;
        try {
            w = await handle.createWritable();
            await w.write(JSON.stringify(state.data));
            await w.close();
            lastSyncAt = Date.now();
            setStatus('linked');
            return true;
        } catch (e) {
            try { if (w) await w.close(); } catch (e2) {}
            setStatus('error', '写入文件失败（文件可能已被删除或移动）');
            return false;
        }
    }
    /** 防抖写入：连续打卡只写一次 */
    function scheduleWrite() {
        if (!supported || !handle) return;
        clearTimeout(timer);
        timer = setTimeout(() => { timer = 0; writeNow(); }, 800);
    }

    return {
        get supported() { return supported; },
        get status() { return status; },
        get fileName() { return fileName; },
        get lastError() { return lastError; },
        get lastSyncAt() { return lastSyncAt; },
        get linked() { return !!handle; },
        /** 状态文案，用于设置页展示 */
        get statusText() {
            if (!supported) return '当前浏览器不支持（需 Chrome/Edge 桌面版）';
            if (status === 'linked') return '已同步到 ' + fileName;
            if (status === 'need-tap') return '需点击重新授权';
            if (status === 'error') return lastError || '同步异常';
            return '未开启';
        },

        /** 选择并绑定一个备份文件（必须在用户手势中调用） */
        async link() {
            if (!supported) { showToast('❌ 当前浏览器不支持本地文件同步', true); return false; }
            let h;
            try {
                h = await window.showSaveFilePicker({
                    suggestedName: suggestedName(),
                    types: [{ description: '工时备份数据', accept: { 'application/json': ['.json'] } }],
                    excludeAcceptAllOption: true
                });
            } catch (e) {
                if (!e || e.name !== 'AbortError') showToast('❌ 未选择文件', true);
                return false;
            }
            if (!(await permit(h, 'readwrite'))) {
                showToast('❌ 未获得文件写入权限', true);
                return false;
            }
            handle = h;
            /* 目标文件已有内容时，先询问是否用它恢复（这是清缓存后的主要恢复入口） */
            let restoredCount = 0;
            const got = await readHandle(h);
            if (got && got.text) {
                let parsed = null;
                try { parsed = JSON.parse(got.text); } catch (e) { parsed = null; }
                const clean = normalizeData(parsed);
                const n = Object.keys(clean).length;
                if (n > 0 && confirm('文件「' + (got.name || '备份') + '」中已有 ' + n +
                    ' 条打卡记录。\n\n【确定】用文件内容恢复当前数据\n【取消】用当前数据覆盖该文件')) {
                    replaceAllData(clean);
                    commit();
                    restoredCount = n;
                }
            }
            /* 句柄存入 IndexedDB 以便下次自动恢复；个别浏览器不支持克隆句柄，
               失败时不能阻断本次同步——只是下次打开需要重新点一次授权。 */
            let persisted = false;
            try { persisted = await db.setHandle(h); } catch (e) { persisted = false; }
            store.write(KEY.fileSync, fileName || '工时记录备份.json');
            const ok = await writeNow();
            setStatus(ok ? 'linked' : 'error', ok ? '' : '首次写入失败');

            /* 恢复信息与开启结果合并为一条提示：
               两条 toast 间隔极短，分开会立刻被覆盖，用户根本看不到恢复了几条。 */
            if (!ok) {
                showToast(restoredCount ? '❌ 已恢复 ' + restoredCount + ' 条，但写入文件失败' : '❌ 绑定成功但写入失败', true);
            } else if (restoredCount) {
                showToast('✅ 已从文件恢复 ' + restoredCount + ' 条记录，并开启自动同步');
            } else {
                showToast(persisted ? '✅ 已开启本地文件自动同步' : '✅ 已开启同步（本次有效，重开需重新选文件）');
            }
            return ok;
        },

        /** 尝试用已保存的句柄恢复（页面启动时静默调用；未被授权则进入 need-tap） */
        async tryRestore() {
            if (!supported) return false;
            let h = null;
            try { h = await db.getHandle(); } catch (e) { h = null; }
            if (!h) return false;
            handle = h;
            /* 已授权则直接读取恢复，无需用户操作 */
            if ((await permit(h, 'read')) !== true) {
                setStatus('need-tap', '');
                return false;
            }
            const got = await readHandle(h);
            if (!got) { setStatus('error', '备份文件已失效，请重新绑定'); return false; }
            let parsed = null;
            try { parsed = JSON.parse(got.text); } catch (e) { parsed = null; }
            const clean = normalizeData(parsed);
            const n = Object.keys(clean).length;
            const cur = Object.keys(state.data).length;
            if (n > cur) {
                replaceAllData(clean);
                commit();
                showToast('🔄 已从备份文件恢复 ' + n + ' 条记录');
            }
            setStatus('linked');
            return true;
        },

        /** 用户点击「重新连接」：手动再选一次文件（清缓存后句柄丢失时的主要路径） */
        async reconnect() {
            if (!supported) { showToast('❌ 当前浏览器不支持本地文件同步', true); return false; }
            if (handle && (await permit(handle, 'readwrite'))) return await writeNow();
            return await this.link();
        },

        /** 解除绑定 */
        async unlink() {
            clearTimeout(timer); timer = 0;
            handle = null; fileName = ''; lastSyncAt = 0;
            try { await db.dropHandle(); } catch (e) {}
            store.remove(KEY.fileSync);
            setStatus('off');
            showToast('已关闭本地文件同步');
        },

        scheduleWrite: scheduleWrite,
        writeNow: writeNow
    };
})();
setSyncHook(() => fileSync.scheduleWrite());

/* ============================================================
 * 17. 备份 / 导入 / 清空
 * ========================================================== */
/* ---- 下载能力探测 ---------------------------------------------------------
 * <a download> 在以下环境「不报错但也不下载」，是「提示成功却没文件」的根源：
 *   · iOS Safari（含 iPadOS）
 *   · iOS 桌面 PWA（display: standalone）
 *   · 微信 / 部分 App 内置 WebView
 * 因此这里先探测环境，不可靠时不走 <a download>，直接给「可复制」的兜底，确保数据一定拿得到。
 * ------------------------------------------------------------------------- */
const dlEnv = (function () {
    let isIOS = false, isStandalone = false, isInApp = false, supportsAttr = false;
    try {
        const ua = navigator.userAgent || '';
        const isIPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
        isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS;
        isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true;
        isInApp = /MicroMessenger|Weibo|QQ\/|Alipay|baiduboxapp|DingTalk/i.test(ua);
        supportsAttr = 'download' in document.createElement('a');
    } catch (e) { supportsAttr = false; }
    return {
        isIOS: isIOS, isStandalone: isStandalone, isInApp: isInApp, supportsAttr: supportsAttr,
        /* 只有「原生支持 download 属性」且「不在 iOS / 内置 WebView」时才认为可靠 */
        reliable: supportsAttr && !isIOS && !isInApp
    };
})();

/**
 * 触发下载。
 * @returns {'ok'|'unsupported'|'fail'} —— 注意：不再无条件返回 true
 */
function triggerDownload(filename, blob) {
    if (!dlEnv.reliable) return 'unsupported';
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        /* 下载启动后即可回收；延迟留足启动时间，并加保护避免重复移除报错 */
        setTimeout(() => {
            try { document.body.removeChild(a); } catch (e) {}
            try { URL.revokeObjectURL(url); } catch (e) {}
        }, 30000);
        return 'ok';
    } catch (e) {
        return 'fail';
    }
}
const buildBackupJSON = () => JSON.stringify(state.data);
function buildBackupFileName() {
    const t = new Date();
    return '工时记录备份_' + t.getFullYear() + pad2(t.getMonth() + 1) + pad2(t.getDate()) +
        '_' + pad2(t.getHours()) + pad2(t.getMinutes()) + '.json';
}
/** 兜底弹窗：把备份数据摆出来供手动复制（tip 为空则不显示提示条） */
function showCopyFallback(text, tip) {
    closeSettings();
    const ta = document.getElementById('copyFallbackText');
    if (!ta) { showToast('❌ 无法展示备份数据，请刷新后重试', true); return; }
    ta.value = text;
    let el = document.getElementById('copyFallbackTip');
    if (!el && ta.parentNode) {
        el = document.createElement('div');
        el.id = 'copyFallbackTip';
        ta.parentNode.insertBefore(el, ta);
    }
    if (el) {
        if (tip) {
            el.textContent = tip;
            el.style.cssText = 'font-size:12px;line-height:1.6;color:#8a6d00;background:#fff8e1;' +
                'border:1px solid #ffe082;border-radius:8px;padding:9px 11px;margin:0 0 10px;';
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }
    openModal('copyFallbackModal');
    /* 弹窗后自动选中，方便直接长按/全选复制 */
    try { ta.focus(); ta.select(); } catch (e) {}
}
/** 记录一次「备份完成」：写入时间戳与当时的记录天数，作为下次提醒的基准 */
function markBackedUp() {
    store.write(KEY.backupAt, String(Date.now()));
    store.write(KEY.backupCount, String(Object.keys(state.data).length));
    refreshDataStatus();
}
function downloadBackup() {
    const text = buildBackupJSON();
    const result = triggerDownload(buildBackupFileName(), new Blob([text], { type: 'application/json' }));
    if (result === 'ok') {
        closeSettings();
        markBackedUp();
        showToast('✅ 备份文件已开始下载');
        return;
    }
    if (result === 'fail') {
        showCopyFallback(text, '下载失败，请复制下方数据自行保存。');
        showToast('❌ 下载失败，已转为手动复制', true);
        return;
    }
    /* 环境不支持直接下载：不谎报成功，直接给可复制的数据 */
    const why = dlEnv.isInApp ? '当前在 App 内置浏览器中' : '当前环境（iOS/PWA）不支持直接下载文件';
    showCopyFallback(text, why + '，请全选复制下方数据，粘贴到备忘录或文件中保存。' +
        '也可在 Safari / Chrome 中打开本页后重试下载。');
    /* 数据已呈现给用户（可复制保存），同样计为一次备份 */
    markBackedUp();
    showToast('⚠️ 无法直接下载，已生成备份数据', true);
}
function copyData() {
    const text = buildBackupJSON();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => { closeSettings(); markBackedUp(); showToast('📋 备份数据已复制到剪贴板'); })
            .catch(() => showCopyFallback(text, '自动复制被浏览器拦截，请手动全选复制。'));
    } else {
        showCopyFallback(text, '当前环境不支持自动复制，请手动全选复制。');
    }
}
/** 导入：清洗 → 二次确认 → 覆盖 → 全量刷新 */
function applyImportData(obj) {
    const clean = normalizeData(obj);
    const count = Object.keys(clean).length;
    if (!count) { showToast('❌ 备份中没有可导入的打卡记录', true); return; }
    if (!confirm('导入将用该备份覆盖当前所有数据（共 ' + count + ' 条日期记录），确定继续吗？')) return;
    replaceAllData(clean);
    state.selected = today();
    state.view.y = state.selected.getFullYear();
    state.view.m = state.selected.getMonth();
    const rec = currentRecord();
    state.shiftType = rec ? normalizeShiftType(rec.shiftType) : state.shiftType;
    commit();
    closeSettings();
    showToast('✅ 已导入 ' + count + ' 条记录');
}
function openImportFromFile() {
    closeSettings();
    const inp = document.getElementById('importFileInput');
    if (!inp) { openImportModal(); return; }
    inp.value = '';
    if (!inp._bound) {
        inp._bound = true;
        inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target && ev.target.result;
                if (!text) { showToast('❌ 读取文件为空', true); return; }
                try { applyImportData(JSON.parse(text)); }
                catch (e) { showToast('❌ 导入失败：文件不是合法 JSON', true); }
            };
            reader.onerror = () => showToast('❌ 读取文件失败', true);
            reader.readAsText(f);
        });
    }
    inp.click();
}
function openImportModal() {
    closeSettings();
    const v = prompt('请粘贴之前备份的 JSON 数据：');
    if (!v) return;
    try { applyImportData(JSON.parse(v)); }
    catch (e) { showToast('❌ 导入失败：格式不正确', true); }
}
function clearAllData() {
    if (!confirm('【警告】将删除本地所有打卡记录！\n建议先备份。是否继续？')) return;
    if (!confirm('最后确认：真的清空所有数据吗？不可撤销！')) return;
    replaceAllData({});          // 整库替换：会同步清空 IndexedDB 与本地镜像
    store.remove(KEY.backupCount);
    store.remove(KEY.backupAt);
    commit();
    closeSettings();
    showToast('所有数据已清空');
}

/* ============================================================
 * 18. 图表交互
 * ========================================================== */
function toggleChartType() {
    state.chart.type = state.chart.type === 'bar' ? 'line' : 'bar';
    const btn = document.getElementById('chartToggle');
    if (btn) btn.textContent = state.chart.type === 'bar' ? '趋势线' : '柱状图';
    invalidate('chart');
}
function applyCustomRange() {
    const s = $('#chartCustomStart'), e = $('#chartCustomEnd');
    if (!s || !e) return;
    if (!isValidDateKey(s.value) || !isValidDateKey(e.value)) { showToast('请选择完整起止日期', true); return; }
    if (s.value > e.value) { showToast('开始日期不能晚于结束日期', true); return; }
    state.chart.customStart = s.value;
    state.chart.customEnd = e.value;
    invalidate('chart');
}
function chartExportName() {
    return '工时趋势图_' + chartRangeLabel().replace(/[^\w一-龥]+/g, '_') + '.png';
}
/**
 * 生成图表 PNG blob：优先走同步的 toDataURL，以保持用户手势上下文
 * （iOS 上 navigator.share 要求 transient activation，异步 toBlob 回调里调用会被拒绝）。
 */
function buildChartBlob(cb) {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W; canvas.height = EXPORT_H;
    if (!paintChartToCanvas(canvas)) { cb(null, 'empty'); return; }
    try {
        const dataUrl = canvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        cb(new Blob([arr], { type: 'image/png' }), null);
    } catch (e) {
        if (!canvas.toBlob) { cb(null, 'unsupported'); return; }
        canvas.toBlob((b) => cb(b, b ? null : 'fail'), 'image/png');
    }
}
/** 降级：可下载则下载，否则开新窗预览供长按保存 */
function degradeImageSave(file, blob) {
    if (dlEnv.reliable) {
        if (triggerDownload(file.name, blob) === 'ok') { showToast('🖼️ 已转为下载'); return; }
        showToast('❌ 分享与下载均不可用', true);
        return;
    }
    try {
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');
        if (win) showToast('已在新窗口打开，请长按图片保存', true);
        else showToast('❌ 无法打开预览，请更换浏览器重试', true);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
    } catch (e) {
        showToast('❌ 无法打开预览，请更换浏览器重试', true);
    }
}
function shareFile(file, blob) {
    const canShare = navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }));
    if (!canShare) { degradeImageSave(file, blob); return; }
    navigator.share({ title: file.name, files: [file] })
        .then(() => showToast('✅ 分享成功'))
        .catch((e) => { if (!e || e.name !== 'AbortError') degradeImageSave(file, blob); });
}
function exportChartPNG() {
    buildChartBlob((blob, err) => {
        if (err === 'empty') { showToast('该范围暂无打卡记录可导出', true); return; }
        if (!blob) { showToast('❌ 导出失败，请重试', true); return; }
        const name = chartExportName();
        const r = triggerDownload(name, blob);
        if (r === 'ok') { showToast('🖼️ 图表图片已开始下载'); return; }
        /* 不可靠环境下不假装成功：转系统分享（iOS 可存入「文件」/「照片」） */
        shareFile(new File([blob], name, { type: 'image/png' }), blob);
    });
}
function shareChartImage() {
    buildChartBlob((blob, err) => {
        if (err === 'empty') { showToast('该范围暂无打卡记录可分享', true); return; }
        if (!blob) { showToast('❌ 生成图片失败，请重试', true); return; }
        shareFile(new File([blob], chartExportName(), { type: 'image/png' }), blob);
    });
}

/* ============================================================
 * 19. 事件绑定
 * ========================================================== */
function on(target, ev, fn, opt) {
    if (!target) { console.warn('[bind] 元素不存在，跳过：' + ev); return; }
    target.addEventListener(ev, fn, opt);
}
const onId = (id, ev, fn, opt) => on(document.getElementById(id), ev, fn, opt);

function bindEvents() {
    /* ---- 日历：事件委托（点击切换 / 长按补卡），只挂 5 个监听器 ---- */
    const grid = els.calGrid;
    if (grid) {
        let lpTimer = 0, lpStart = null, suppressClick = false;
        const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } };
        const pointXY = (e) => (e.touches && e.touches[0]) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };

        grid.addEventListener('pointerdown', (e) => {
            const cell = e.target.closest ? e.target.closest('.cal-date') : null;
            if (!cell || !cell.dataset.date) return;
            lpStart = pointXY(e);
            cancelLP();
            lpTimer = setTimeout(() => {
                lpTimer = 0;
                suppressClick = true;
                openMakeupModal(parseDateKey(cell.dataset.date));
            }, LONG_PRESS_MS);
        });
        grid.addEventListener('pointermove', (e) => {
            if (!lpTimer || !lpStart) return;
            const p = pointXY(e);
            if (Math.abs(p.x - lpStart.x) > LONG_PRESS_MOVE_PX || Math.abs(p.y - lpStart.y) > LONG_PRESS_MOVE_PX) cancelLP();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => grid.addEventListener(ev, cancelLP));
        grid.addEventListener('click', (e) => {
            if (suppressClick) { suppressClick = false; return; }
            const cell = e.target.closest ? e.target.closest('.cal-date') : null;
            if (!cell || !cell.dataset.date) return;
            selectDate(parseDateKey(cell.dataset.date));
        });
    }

    /* ---- 日历导航 / 视图 ---- */
    on(els.collapseCal, 'click', () => setCalView(!state.calExpanded, false));
    onId('prevMonth', 'click', () => (state.calExpanded ? changeMonth(-1) : changeWeek(-1)));
    onId('nextMonth', 'click', () => (state.calExpanded ? changeMonth(1) : changeWeek(1)));
    onId('todayTag', 'click', gotoToday);

    /* ---- 打卡区 ---- */
    on(els.shiftSelect, 'change', changeShift);
    on(els.punchBtn, 'click', smartPunch);
    on(els.todayStatsCard, 'click', toggleTodayDetails);
    on(els.todayDetail, 'click', (e) => {
        const btn = e.target.closest ? e.target.closest('.detail-del') : null;
        if (!btn) return;
        e.stopPropagation();
        const row = btn.closest('.detail-row');
        if (row && row.dataset.key) deleteTodayTime(row.dataset.key);
    });

    /* ---- 补卡 ---- */
    onId('cancelMakeup', 'click', closeMakeupModal);
    onId('cancelMakeup2', 'click', closeMakeupModal);
    onId('confirmMakeup', 'click', submitMakeup);

    /* ---- 设置 ---- */
    [['openSettingsBtn', openSettings], ['closeSettingsBtn', closeSettings], ['closeSettingsBtn2', closeSettings],
     ['openShiftSettingsItem', openShiftSettings], ['downloadBackupItem', downloadBackup],
     ['copyDataItem', copyData], ['importFileItem', openImportFromFile], ['openImportItem', openImportModal],
     ['clearDataItem', clearAllData], ['openAboutItem', openAbout], ['targetSettingItem', promptTargetHours]
    ].forEach((p) => onId(p[0], 'click', p[1]));

    /* 本地文件自动同步：未开启则绑定，已开启则「确定=立即同步 / 取消=关闭」 */
    onId('fileSyncItem', 'click', () => {
        if (!fileSync.supported) {
            showToast('❌ 当前浏览器不支持本地文件同步，请用「下载备份文件」', true);
            return;
        }
        if (!fileSync.linked) { fileSync.link(); return; }
        if (fileSync.status !== 'linked') { fileSync.reconnect(); return; }
        if (confirm('本地文件自动同步已开启\n文件：' + fileSync.fileName + '\n\n' +
            '【确定】立即同步一次\n【取消】关闭自动同步')) {
            fileSync.writeNow().then((ok) => showToast(ok ? '✅ 已同步到文件' : '❌ 同步失败', !ok));
        } else {
            fileSync.unlink();
        }
    });

    const calSwitch = document.getElementById('calDefaultSwitch');
    on(calSwitch, 'click', toggleCalDefault);
    on(calSwitch, 'keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCalDefault(); }
    });

    /* ---- 班别设置弹窗 ---- */
    onId('shiftSettingsCancel', 'click', closeShiftSettings);
    onId('shiftSettingsClose', 'click', closeShiftSettings);
    onId('shiftSettingsConfirm', 'click', applyShiftSettings);
    onId('shiftSettingsReset', 'click', resetShiftSettingsAction);

    /* ---- 关于 ---- */
    onId('closeAboutBtn', 'click', closeAbout);
    onId('closeAboutBtn2', 'click', closeAbout);
    onId('checkUpdateBtn', 'click', checkForUpdates);

    /* ---- 复制兜底 ---- */
    onId('copyFallbackClose', 'click', closeCopyFallback);
    onId('copyFallbackClose2', 'click', closeCopyFallback);
    onId('copyFallbackRetry', 'click', () => {
        const ta = document.getElementById('copyFallbackText');
        if (!ta) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value)
                .then(() => showToast('📋 已复制到剪贴板'))
                .catch(() => showToast('❌ 复制失败，请手动长按复制', true));
        } else showToast('❌ 复制失败，请手动长按复制', true);
    });

    /* ---- 工时记录 ---- */
    const query = () => { ensureHistoryRange(); invalidate('history'); };
    onId('historyQueryBtn', 'click', query);
    onId('historyRefreshBtn', 'click', query);

    /* ---- 图表 ---- */
    on(els.chartCanvas, 'click', showChartTooltip);
    on(els.chartCanvas, 'touchstart', showChartTooltip, { passive: true });
    onId('chartToggle', 'click', toggleChartType);
    onId('chartExport', 'click', exportChartPNG);
    onId('chartExport', 'contextmenu', (e) => { e.preventDefault(); shareChartImage(); });
    onId('chartCustomApply', 'click', applyCustomRange);
    $$('.chart-range-opt').forEach((opt) => on(opt, 'click', () => setChartRange(opt.dataset.val)));

    /* ---- 遮罩点击关闭 ---- */
    [['makeupModal', closeMakeupModal], ['settingsModal', closeSettings],
     ['copyFallbackModal', closeCopyFallback], ['shiftSettingsModal', closeShiftSettings],
     ['aboutModal', closeAbout]
    ].forEach((p) => onId(p[0], 'click', (e) => { if (e.target === e.currentTarget) p[1](); }));

    /* ---- 窗口尺寸变化：防抖重绘 ---- */
    on(window, 'resize', debounce(() => invalidate('chart'), 200));
}

/** 「今日统计」展开 / 折叠 */
function toggleTodayDetails(e) {
    if (e && e.target && e.target.closest && e.target.closest('#todayDetail')) return;
    const d = els.todayDetail, ic = els.expandIcon;
    if (!d) return;
    const open = d.style.display === 'none';
    d.style.display = open ? 'block' : 'none';
    if (ic) ic.textContent = open ? '△' : '▽';
}

/* ============================================================
 * 20. Tab 切换
 * ========================================================== */
function initTabbar() {
    const items = $$('.tabbar-item');
    const panels = { tabPunch: document.getElementById('tabPunch'), tabStats: document.getElementById('tabStats') };
    function activate(name) {
        items.forEach((it) => it.classList.toggle('active', it.getAttribute('data-tab') === name));
        Object.keys(panels).forEach((k) => {
            if (panels[k]) panels[k].classList.toggle('active', k === name);
        });
        if (name === 'tabStats') {
            ensureHistoryRange();
            invalidate('tabStats', 'history', 'chart');
        } else {
            invalidate('stats');
        }
    }
    items.forEach((it) => on(it, 'click', () => activate(it.getAttribute('data-tab'))));
    activate('tabPunch');
}

/* ============================================================
 * 21. 时钟
 * ========================================================== */
let clockTimer = 0;
function tickClock() {
    if (els.clock) els.clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}
function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 1000); }
function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; } }
on(document, 'visibilitychange', () => {
    if (document.hidden) { stopClock(); flushData(); } else startClock();
});
/* 关闭 / 切后台前强制落盘，避免防抖窗口内的变更丢失 */
on(window, 'pagehide', flushData);
on(window, 'beforeunload', flushData);

/* ============================================================
 * 22. 数据状态与备份提醒
 * ========================================================== */
/** 备份状态：总记录天数、距上次备份后新增天数、上次备份时间 */
function backupStatus() {
    const total = Object.keys(state.data).length;
    const base = parseInt(store.read(KEY.backupCount), 10);
    const at = parseInt(store.read(KEY.backupAt), 10);
    const backedUp = isFinite(base) && isFinite(at) && at > 0;
    return {
        total: total,
        at: backedUp ? at : 0,
        pending: backedUp ? Math.max(0, total - base) : total
    };
}
/** 刷新设置页「数据管理」顶部的状态区 */
function refreshDataStatus() {
    const el = document.getElementById('backupStatus');
    if (el) {
        const s = backupStatus();
        if (!s.total) el.textContent = '暂无打卡记录';
        else if (!s.at) el.textContent = '⚠️ 尚未备份过 · 共 ' + s.total + ' 天记录，建议立即备份';
        else {
            const d = Math.max(0, Math.round((Date.now() - s.at) / DAY));
            el.textContent = '上次备份：' + (d === 0 ? '今天' : d + ' 天前') +
                (s.pending > 0 ? ' · 此后新增 ' + s.pending + ' 天' : ' · 已同步');
        }
        el.classList.toggle('warn', s.total > 0 && (!s.at || s.pending >= BACKUP_THRESHOLD));
    }
    const modeEl = document.getElementById('storageMode');
    if (modeEl) modeEl.textContent = '数据存储：' + db.modeLabel;

    const syncEl = document.getElementById('fileSyncVal');
    const itemEl = document.getElementById('fileSyncItem');
    if (itemEl) itemEl.style.display = fileSync.supported ? '' : 'none';
    if (syncEl) {
        const t = fileSync.statusText;
        syncEl.textContent = t.length > 18 ? t.slice(0, 18) + '…' : t;
        syncEl.className = 'settings-val' + (fileSync.status === 'error' ? ' ds-err' : '');
    }
    const tipEl = document.getElementById('fileSyncTip');
    if (tipEl) {
        tipEl.style.display = fileSync.supported ? '' : 'none';
        tipEl.textContent = fileSync.supported
            ? (fileSync.linked
                ? '每次打卡自动写入该文件；清除浏览器缓存后点此重新连接即可恢复数据'
                : '开启后每次打卡自动写入本地文件，清除浏览器缓存也能恢复数据')
            : '当前浏览器不支持本地文件自动同步（需 Chrome/Edge 桌面版），请使用「下载备份文件」';
    }
}
/** 按「新增记录天数」提醒备份，比按日历天数更贴合实际使用强度 */
function autoBackupRemind() {
    const s = backupStatus();
    if (s.pending < BACKUP_THRESHOLD) return;
    if (!confirm('自上次备份后已新增 ' + s.pending + ' 天打卡记录（共 ' + s.total + ' 天）。\n' +
        '浏览器数据可能因清理缓存而丢失，建议现在备份。是否立即备份？')) return;
    downloadBackup();
}

/* ============================================================
 * 23. 初始化
 * ========================================================== */
function cacheEls() {
    Object.assign(els, {
        clock: $('#clock'),
        calGrid: $('#calGrid'),
        calTitle: $('#calTitle'),
        collapseCal: $('#collapseCal'),
        btnText: $('#btnText'),
        punchBtn: $('#punchBtn'),
        totalHours: $('#totalHours'),
        punchCount: $('#punchCount'),
        shiftBar: $('#shiftBar'),
        selDateText: $('#selDateText'),
        shiftText: $('#shiftText'),
        shiftSelect: $('#shiftSelect'),
        expandIcon: $('#expandIcon'),
        todayDetail: $('#todayDetail'),
        todayStatsCard: $('#todayStatsCard'),
        chartCanvas: $('#hoursChart'),
        chartSummary: $('#chartSummary'),
        toast: $('#appToast')
    });
}
function initChartControls() {
    const t = new Date();
    const cs = document.getElementById('chartCustomStart'), ce = document.getElementById('chartCustomEnd');
    if (cs) cs.value = toDateKey(new Date(t.getFullYear(), t.getMonth(), 1));
    if (ce) ce.value = toDateKey(t);
    const toggle = document.getElementById('chartToggle');
    if (toggle) toggle.textContent = state.chart.type === 'bar' ? '趋势线' : '柱状图';
    $$('.chart-range-opt').forEach((o) => o.classList.toggle('selected', o.dataset.val === state.chart.range));
    const custom = document.getElementById('chartCustom');
    if (custom) custom.style.display = state.chart.range === 'custom' ? 'flex' : 'none';
    updateChartLegend();
}
function init() {
    cacheEls();
    bindEvents();
    initChartControls();
    startClock();

    /* 今日统计默认展开 */
    if (els.todayDetail) els.todayDetail.style.display = 'block';
    if (els.expandIcon) els.expandIcon.textContent = '△';

    if (!store.available) showToast('⚠️ 当前以 file:// 打开，数据仅存内存，建议用 http(s) 打开', true);

    setCalView(state.calExpanded, false);
    initTabbar();
    invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart');
    loadAboutData();
    refreshDataStatus();

    /* 数据恢复优先级：本地备份文件 > IndexedDB > localStorage 镜像
       —— 浏览器缓存被清除后，仍能通过重新连接备份文件把数据找回来 */
    hydrate().then(async (r) => {
        let restored = r.restored;
        try {
            const fromFile = await fileSync.tryRestore();
            if (fromFile && Object.keys(state.data).length > (r.count || 0)) {
                restored = Object.keys(state.data).length;
                showToast('🔄 已从备份文件恢复 ' + restored + ' 条记录');
            }
        } catch (e) { /* 文件恢复失败不影响主流程 */ }

        refreshDataStatus();
        invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart');
        /* 明确告知恢复来源，让用户知道数据是从本地数据库捞回来的 */
        if (restored > 0) {
            showToast(fileSync.linked
                ? '🔄 已从备份文件恢复 ' + restored + ' 条记录'
                : '🔄 已从本地数据库恢复 ' + restored + ' 条记录');
        }
        autoBackupRemind();
    });
}

/* 调试桥接：暴露关键能力与只读数据，生产环境无副作用 */
try {
    window.__app = {
        get state() { return state; },
        get data() { return state.data; },
        get selectedDate() { return state.selected; },
        setSelectedDate(d) { selectDate(d); },
        monthStats: monthStats,
        weekStats: weekStats,
        dayHours: dayHours,
        durationHours: durationHours,
        toDateKey: toDateKey,
        refresh: invalidate,
        drawChart: () => invalidate('chart'),
        storageMode: () => db.mode,
        storageLabel: () => db.modeLabel,
        backupStatus: backupStatus,
        flush: flushData
    };
} catch (e) {}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
