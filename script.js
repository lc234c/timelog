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
    data: 'attendanceData',
    shifts: 'shiftSchedules',
    shiftType: 'defaultShiftType',
    calExpanded: 'calendarDefaultExpanded',
    target: 'chartTargetHours',
    backupAt: 'lastBackupRemind'
};

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
 * 3. 存储层（统一读写 + 可用性探测 + 失败自动降级）
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
 * 4. 状态
 * ========================================================== */
const state = {
    data: loadData(),                 // { 'YYYY-MM-DD': { shiftType, status:{s1,e1,s2,e2} } }
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
/** 读取并清洗持久化数据：剔除非法日期键、非法时间、空壳记录 */
function loadData() {
    const raw = store.readJSON(KEY.data, null);
    return normalizeData(raw);
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

function saveData() {
    state.version++;
    store.writeJSON(KEY.data, state.data);
}
/** 只读取某天记录（不存在返回 null，不创建） */
function getRecord(ds) {
    const r = state.data[ds];
    return r || null;
}
/** 取（或按需创建）某天记录 */
function ensureRecord(ds, shiftType) {
    let r = state.data[ds];
    if (!r) {
        r = state.data[ds] = { shiftType: normalizeShiftType(shiftType || state.shiftType), status: emptyStatus() };
    } else if (!r.shiftType) {
        r.shiftType = normalizeShiftType(shiftType || state.shiftType);
    }
    return r;
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
    chart: drawChart
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
/** 数据变更后统一入口：保存 + 全量刷新 */
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
    if (rec) rec.shiftType = state.shiftType;
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
    rec.status[key] = null;
    if (punchCount(rec) === 0) delete state.data[ds];
    commit();
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
const openSettings = () => { refreshCalDefaultSwitch(); openModal('settingsModal'); };
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
 * 16. 备份 / 导入 / 清空
 * ========================================================== */
/** 触发下载（移动端 / PWA / Safari 兜底） */
function triggerDownload(filename, blob) {
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        document.body.appendChild(a);
        let clicked = true;
        try { a.click(); } catch (e) { clicked = false; }
        if (!clicked) window.open(url, '_blank', 'noopener');
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 60000);
        return true;
    } catch (e) { return false; }
}
const buildBackupJSON = () => JSON.stringify(state.data);
function buildBackupFileName() {
    const t = new Date();
    return '工时记录备份_' + t.getFullYear() + pad2(t.getMonth() + 1) + pad2(t.getDate()) +
        '_' + pad2(t.getHours()) + pad2(t.getMinutes()) + '.json';
}
function downloadBackup() {
    const blob = new Blob([buildBackupJSON()], { type: 'application/json' });
    const ok = triggerDownload(buildBackupFileName(), blob);
    closeSettings();
    store.write(KEY.backupAt, String(Date.now()));
    showToast(ok ? '✅ 备份文件已开始下载' : '❌ 下载失败，请重试', !ok);
}
function copyData() {
    const text = buildBackupJSON();
    const fallback = () => {
        closeSettings();
        const ta = document.getElementById('copyFallbackText');
        if (ta) ta.value = text;
        openModal('copyFallbackModal');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => { closeSettings(); showToast('📋 备份数据已复制到剪贴板'); })
            .catch(fallback);
    } else fallback();
}
/** 导入：清洗 → 二次确认 → 覆盖 → 全量刷新 */
function applyImportData(obj) {
    const clean = normalizeData(obj);
    const count = Object.keys(clean).length;
    if (!count) { showToast('❌ 备份中没有可导入的打卡记录', true); return; }
    if (!confirm('导入将用该备份覆盖当前所有数据（共 ' + count + ' 条日期记录），确定继续吗？')) return;
    state.data = clean;
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
    state.data = {};
    store.remove(KEY.data);
    commit();
    closeSettings();
    showToast('所有数据已清空');
}

/* ============================================================
 * 17. 图表交互
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
function exportChartPNG() {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W; canvas.height = EXPORT_H;
    if (!paintChartToCanvas(canvas)) { showToast('该范围暂无打卡记录可导出', true); return; }
    canvas.toBlob((blob) => {
        if (!blob) { showToast('❌ 导出失败，请重试', true); return; }
        triggerDownload(chartExportName(), blob);
        showToast('🖼️ 图表图片已开始下载');
    }, 'image/png');
}
function shareChartImage() {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W; canvas.height = EXPORT_H;
    if (!paintChartToCanvas(canvas)) { showToast('该范围暂无打卡记录可分享', true); return; }
    canvas.toBlob((blob) => {
        if (!blob) { showToast('❌ 分享失败，已转为下载', true); exportChartPNG(); return; }
        const file = new File([blob], chartExportName(), { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ title: '工时趋势图', files: [file] })
                .then(() => showToast('✅ 分享成功'))
                .catch((e) => {
                    if (e && e.name === 'AbortError') return;
                    triggerDownload(file.name, blob);
                    showToast('🖼️ 已转为下载');
                });
        } else {
            triggerDownload(file.name, blob);
            showToast('🖼️ 分享不可用，已转为下载');
        }
    }, 'image/png');
}

/* ============================================================
 * 18. 事件绑定
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
 * 19. Tab 切换
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
 * 20. 时钟
 * ========================================================== */
let clockTimer = 0;
function tickClock() {
    if (els.clock) els.clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}
function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 1000); }
function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; } }
on(document, 'visibilitychange', () => (document.hidden ? stopClock() : startClock()));

/* ============================================================
 * 21. 自动备份提醒
 * ========================================================== */
function autoBackupRemind() {
    const days = Object.keys(state.data).length;
    if (days <= 30 || !store.available) return;
    const last = parseInt(store.read(KEY.backupAt), 10);
    if (last && Date.now() - last < 7 * DAY) return;
    store.write(KEY.backupAt, String(Date.now()));
    if (confirm('您已有 ' + days + ' 天打卡记录，建议定期备份数据（设置→下载备份文件）。是否现在备份？')) downloadBackup();
}

/* ============================================================
 * 22. 初始化
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
    autoBackupRemind();
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
        drawChart: () => invalidate('chart')
    };
} catch (e) {}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
