'use strict';
/*!
 * 工时记录 · 03-state.js（状态 + 数据层 + 计算）
 */
(function () {

const { util, store, db, CONST } = App;
const { KEY, PUNCH_KEYS, SHIFT_TYPES, SHIFTS_FOR_WORK, DEFAULT_SCHEDULES, TARGET_DEFAULT, TARGET_MIN, TARGET_MAX,
        FLUSH_DELAY, OT_RATE, LEAVE_TYPES, HOLIDAY_DEFAULTS,
        KEY_OT, KEY_LEAVE, KEY_HOLIDAY, KEY_SALARY, KEY_PAYSLIP,
        DAY_HOURS, DEFAULT_SALARY, DAY, IDB_OT, IDB_LEAVE } = CONST;

/* ============================================================
 * 1. 班别配置辅助
 * ========================================================== */
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
function loadShiftSchedules() {
    const out = { day: cloneSchedule(DEFAULT_SCHEDULES.day), night: cloneSchedule(DEFAULT_SCHEDULES.night) };
    const custom = store.readJSON(KEY.shifts, null);
    if (!custom || typeof custom !== 'object') return out;
    SHIFT_TYPES.forEach((t) => {
        const c = custom[t];
        if (!c || !Array.isArray(c.periods)) return;
        const ps = c.periods.filter((p) => p && util.isValidHM(p.start) && util.isValidHM(p.end)).slice(0, 2);
        if (!ps.length) return;
        out[t].periods = ps;
        out[t].text = buildShiftText(ps);
    });
    out._loadedFromStore = true;  // 标记已从 store 加载，防止排班模块覆盖
    return out;
}
function saveShiftSchedules() {
    store.writeJSON(KEY.shifts, {
        day: { periods: App.shifts.day.periods },
        night: { periods: App.shifts.night.periods }
    });
}
function resetShiftSchedules() {
    App.shifts.day = cloneSchedule(DEFAULT_SCHEDULES.day);
    App.shifts.night = cloneSchedule(DEFAULT_SCHEDULES.night);
}

/* ============================================================
 * 2. 数据规范化
 * ========================================================== */
function normalizeShiftType(t) {
    // 兼容排班模块引入的 mid(中班)/rest(休息)；其余归为 day
    if (t === 'mid' || t === 'rest') return t;
    return SHIFT_TYPES.indexOf(t) >= 0 ? t : 'day';
}
function emptyStatus() { return { s1: null, e1: null, s2: null, e2: null }; }
function normalizeData(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((ds) => {
        if (!util.isValidDateKey(ds)) return;
        const rec = raw[ds];
        if (!rec || typeof rec !== 'object') return;
        const src = rec.status && typeof rec.status === 'object' ? rec.status : rec;
        const status = emptyStatus();
        let any = false;
        PUNCH_KEYS.forEach((k) => {
            const v = src[k];
            if (typeof v === 'string' && util.isValidHMS(v)) { status[k] = v; any = true; }
            else if (typeof v === 'string' && util.isValidHM(v)) { status[k] = v + ':00'; any = true; }
        });
        if (!any) return;
        out[ds] = { shiftType: normalizeShiftType(rec.shiftType), status: status };
    });
    return out;
}

/* ============================================================
 * 3. 初始化状态对象（挂载到 App.state）
 * ========================================================== */
App.shifts = loadShiftSchedules();

const S = {
    data: {},
    selected: util.today(),
    view: { y: 0, m: 0 },
    shiftType: 'day',
    calExpanded: false,
    chart: { type: 'line', range: 'month', customStart: '', customEnd: '' },
    targetHours: TARGET_DEFAULT,
    version: 0,
    statsView: null
};

function loadMirror() {
    return normalizeData(store.readJSON(KEY.data, null));
}
function loadTargetHours() {
    const v = parseFloat(store.read(KEY.target));
    return (!isNaN(v) && v > 0) ? util.clamp(v, TARGET_MIN, TARGET_MAX) : TARGET_DEFAULT;
}

S.data = loadMirror();
S.view.y = S.selected.getFullYear();
S.view.m = S.selected.getMonth();
S.shiftType = normalizeShiftType(store.read(KEY.shiftType));
S.calExpanded = store.read(KEY.calExpanded) === '1';
S.targetHours = loadTargetHours();

App.state = S;

/* ============================================================
 * 4. 打卡数据层（mirror + flush）
 * ========================================================== */
let dirtyKeys = null;
let dirtyAll = false;
let flushTimer = 0;
let syncHook = null;

function markDirty(ds) { if (!dirtyKeys) dirtyKeys = new Set(); dirtyKeys.add(ds); }
function markAllDirty() { dirtyAll = true; }

function writeMirror(data) {
    if (!store.available) return;
    try { localStorage.setItem(KEY.data, JSON.stringify(data)); } catch (e) {}
}

function saveData() {
    S.version++;
    writeMirror(S.data);
    scheduleFlush();
    if (syncHook) { try { syncHook(); } catch (e) {} }
    App.invalidate('dataStatus');
}
function setSyncHook(fn) { syncHook = fn; }
function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = 0; flushData(); }, FLUSH_DELAY);
}
function flushData() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    if (dirtyAll) {
        dirtyAll = false;
        dirtyKeys = null;
        return db.replaceAll(S.data).catch(() => false);
    }
    if (!dirtyKeys || !dirtyKeys.size) return Promise.resolve(true);
    const puts = {}, dels = [];
    dirtyKeys.forEach((ds) => {
        if (S.data[ds]) puts[ds] = S.data[ds];
        else dels.push(ds);
    });
    dirtyKeys = null;
    return db.saveMany(puts, dels).catch(() => false);
}

function hydrate() {
    return db.ready
        .then(() => db.loadAll())
        .then((raw) => {
            const remote = normalizeData(raw);
            const remoteCount = Object.keys(remote).length;
            const mirrorCount = Object.keys(S.data).length;
            if (remoteCount > 0) {
                S.data = remote;
                S.version++;
                if (remoteCount !== mirrorCount) writeMirror(S.data);
            } else if (mirrorCount > 0) {
                db.replaceAll(S.data).catch(() => {});
            }
            return { count: remoteCount || mirrorCount, restored: Math.max(0, remoteCount - mirrorCount) };
        })
        .catch((err) => {
            console.error('[hydrate] 数据恢复失败：', err && (err.stack || err.message || err));
            App.ui.showToast('⚠️ 数据加载异常，已降级为本地缓存', true);
            return { count: Object.keys(S.data).length, restored: 0 };
        });
}

/* ============================================================
 * 5. 打卡记录 CRUD
 * ========================================================== */
function getRecord(ds) { return S.data[ds] || null; }

function ensureRecord(ds, shiftType) {
    let r = S.data[ds];
    if (!r) {
        r = S.data[ds] = { shiftType: normalizeShiftType(shiftType || S.shiftType), status: emptyStatus() };
    } else if (!r.shiftType) {
        r.shiftType = normalizeShiftType(shiftType || S.shiftType);
    }
    markDirty(ds);
    return r;
}
function removeRecord(ds) {
    if (!S.data[ds]) return false;
    delete S.data[ds];
    markDirty(ds);
    S.version++;
    writeMirror(S.data);
    scheduleFlush();
    App.invalidate('dataStatus');
    return true;
}
function replaceAllData(next) {
    S.data = next;
    markAllDirty();
    S.version++;
    writeMirror(S.data);
    scheduleFlush();
    App.invalidate('dataStatus');
}
function currentRecord() { return getRecord(util.toDateKey(S.selected)); }
function currentStatus() { const r = currentRecord(); return r ? r.status : emptyStatus(); }
function getShift(t) {
    const nt = normalizeShiftType(t || S.shiftType);
    if (App.shifts[nt]) return App.shifts[nt];   // day / night（已初始化）
    // mid(中班)：从排班模块取时段；rest(休息)：退化为白班模板（仅用于显示打卡步骤）
    if (nt === 'mid') {
        const periods = (S.schedule && S.schedule.shifts && S.schedule.shifts.mid && S.schedule.shifts.mid.periods) || [{ start: '14:00', end: '18:00' }];
        return { name: '中班', periods: periods, steps: ['中班上班', '午间下班', '晚间上班', '晚间下班'], keys: PUNCH_KEYS.slice(), labels: ['前半段工时', '后半段工时'] };
    }
    return App.shifts.day;                        // rest 或其他未知 → 白班模板
}

function dayHours(rec) {
    if (!rec) return 0;
    const s = rec.status;
    return util.durationHours(s.s1, s.e1) + util.durationHours(s.s2, s.e2);
}
function punchCount(rec) {
    return PUNCH_KEYS.reduce((n, k) => n + (rec && rec.status[k] ? 1 : 0), 0);
}
function nextSlot(rec) {
    if (!rec) return 0;
    for (let i = 0; i < PUNCH_KEYS.length; i++) if (!rec.status[PUNCH_KEYS[i]]) return i;
    return 4;
}

/* ============================================================
 * 6. 统计缓存
 * ========================================================== */
const memo = { version: -1, map: {} };
function cached(key, compute) {
    if (memo.version !== S.version) { memo.version = S.version; memo.map = {}; }
    if (!(key in memo.map)) memo.map[key] = compute();
    return memo.map[key];
}
function rangeStats(start, end) {
    let total = 0, days = 0;
    util.eachDay(start, end, (d) => {
        const h = dayHours(getRecord(util.toDateKey(d)));
        if (h > 0) { total += h; days++; }
    });
    return { total: total, days: days };
}
function monthStats() {
    const y = S.selected.getFullYear(), m = S.selected.getMonth();
    return cached('m' + y + '-' + m, () => rangeStats(new Date(y, m, 1), new Date(y, m + 1, 0)));
}
function weekStats() {
    const w = util.weekRange(S.selected);
    return cached('w' + util.toDateKey(w.mon), () => rangeStats(w.mon, w.sun));
}

/* ============================================================
 * 7. 加班 / 请假 / 节假日 数据（挂载到 App.state）
 * ========================================================== */
function loadJSON(k, fb) {
    const v = store.readJSON(k, null);
    return v == null ? fb : v;
}
function loadHolidayDates() {
    const v = store.readJSON(KEY_HOLIDAY, []);
    return new Set(Array.isArray(v) ? v.filter(util.isValidDateKey) : HOLIDAY_DEFAULTS);
}

S.otData = loadJSON(KEY_OT, []);
S.leaveData = loadJSON(KEY_LEAVE, []);
S.holidayDates = loadHolidayDates();

let otDirty = false, otFlushTimer = 0;

function saveOT() { store.writeJSON(KEY_OT, S.otData); scheduleOtFlush(); }
function saveLeave() { store.writeJSON(KEY_LEAVE, S.leaveData); scheduleOtFlush(); }
function saveHolidayDates() { store.writeJSON(KEY_HOLIDAY, Array.from(S.holidayDates)); }

function scheduleOtFlush() {
    if (otFlushTimer) return;
    otFlushTimer = setTimeout(() => { otFlushTimer = 0; flushOtData(); }, FLUSH_DELAY);
}

/** 把内存中的加班/请假整体同步进 IndexedDB（数据量小，全量覆盖即可） */
function flushOtData() {
    if (!otDirty) return Promise.resolve(true);
    otDirty = false;
    if (db.mode !== 'idb') return Promise.resolve(true);
    return db.ready.then(() => new Promise((resolve) => {
        let t;
        try { t = db.tx([IDB_OT, IDB_LEAVE], 'readwrite'); } catch (e) { resolve(false); return; }
        t.oncomplete = () => resolve(true);
        t.onerror = () => resolve(false);
        t.onabort = () => resolve(false);
        try {
            rewriteStore(t, IDB_OT, S.otData);
            rewriteStore(t, IDB_LEAVE, S.leaveData);
        } catch (e) { /* 事务自动 abort */ }
    })).catch(() => false);
}
function rewriteStore(t, storeName, items) {
    const os = t.objectStore(storeName);
    os.clear();
    items.forEach((it) => {
        if (it.id == null) it.id = util.nextRecordId();
        os.put(it);
    });
}

/** 从 IndexedDB 载入加班/请假（启动时校正内存） */
function hydrateOtLeave() {
    if (db.mode !== 'idb') return Promise.resolve();
    return db.ready.then(() => new Promise((resolve) => {
        let t;
        try { t = db.tx([IDB_OT, IDB_LEAVE], 'readonly'); } catch (e) { resolve(); return; }
        const readAll = (name) => new Promise((res) => {
            const arr = [];
            const req = t.objectStore(name).openCursor();
            req.onsuccess = () => {
                const cur = req.result;
                if (cur) { arr.push(cur.value); cur.continue(); } else res(arr);
            };
            req.onerror = () => res(arr);
        });
        Promise.all([readAll(IDB_OT), readAll(IDB_LEAVE)]).then(([ots, leaves]) => {
            if (ots.length) { S.otData = ots; store.writeJSON(KEY_OT, S.otData); }
            if (leaves.length) { S.leaveData = leaves; store.writeJSON(KEY_LEAVE, S.leaveData); }
            resolve();
        }).catch(() => resolve());
    })).catch(() => {});
}

/* ============================================================
 * 8. 加班 CRUD
 * ========================================================== */
function normalizeOT(rec) {
    if (!rec || !util.isValidDateKey(rec.date)) return null;
    const hours = parseFloat(rec.hours);
    if (!(hours > 0)) return null;
    const type = OT_RATE[rec.type] ? rec.type : 'normal';
    return { date: rec.date, type: type, hours: util.round2(hours) };
}
function addOvertime(rec) {
    const r = normalizeOT(rec);
    if (!r) return null;
    r.id = util.nextRecordId();
    S.otData.push(r);
    otDirty = true; saveOT();
    App.invalidate('otList', 'otSummary', 'salary');
    return r;
}
function updateOvertime(id, patch) {
    const target = S.otData.find((o) => o.id === id);
    if (!target) return false;
    if (patch.date !== undefined) target.date = patch.date;
    if (patch.type !== undefined && OT_RATE[patch.type]) target.type = patch.type;
    if (patch.hours !== undefined) {
        const h = parseFloat(patch.hours);
        if (h > 0) target.hours = util.round2(h);
    }
    otDirty = true; saveOT();
    App.invalidate('otList', 'otSummary', 'salary');
    return true;
}
function deleteOvertime(id) {
    const i = S.otData.findIndex((x) => x.id === id);
    if (i < 0) return false;
    S.otData.splice(i, 1);
    otDirty = true; saveOT();
    App.invalidate('otList', 'otSummary', 'salary');
    return true;
}
function getOtByDate(dateKey) {
    return S.otData.filter((o) => o.date === dateKey);
}
function hasOvertimeOnDay(dateKey) {
    for (let i = 0; i < S.otData.length; i++) if (S.otData[i].date === dateKey) return true;
    return false;
}

/* ============================================================
 * 9. 请假 CRUD
 * ========================================================== */
function normalizeLeave(rec) {
    if (!rec) return null;
    const type = LEAVE_TYPES.some((t) => t.key === rec.type) ? rec.type : 'personal';
    const unit = rec.unit === 'hour' ? 'hour' : 'day';
    const start = util.parseDateKey(rec.start), end = util.parseDateKey(rec.end);
    if (!start || !end) return null;
    let hours = 0;
    if (unit === 'day') {
        let days = 0;
        util.eachDay(start, end, () => days++);
        hours = util.round2(days * DAY_HOURS);
    } else {
        hours = parseFloat(rec.hours);
        if (!(hours > 0)) return null;
        hours = util.round2(hours);
    }
    return { type: type, start: util.toDateKey(start), end: util.toDateKey(end), unit: unit, hours: hours };
}
function addLeave(rec) {
    const r = normalizeLeave(rec);
    if (!r) return null;
    r.id = util.nextRecordId();
    S.leaveData.push(r);
    otDirty = true; saveLeave();
    App.invalidate('leaveList', 'salary');
    return r;
}
function updateLeave(id, patch) {
    const target = S.leaveData.find((l) => l.id === id);
    if (!target) return false;
    const candidate = Object.assign({}, target, patch);
    const normalized = normalizeLeave(candidate);
    if (!normalized) return false;
    Object.assign(target, normalized);
    target.id = id;
    otDirty = true; saveLeave();
    App.invalidate('leaveList', 'salary');
    return true;
}
function deleteLeave(id) {
    const i = S.leaveData.findIndex((x) => x.id === id);
    if (i < 0) return false;
    S.leaveData.splice(i, 1);
    otDirty = true; saveLeave();
    App.invalidate('leaveList', 'salary');
    return true;
}
function getLeaveByDate(dateKey) {
    return S.leaveData.filter((l) => l.start <= dateKey && l.end >= dateKey);
}
function getLeaveTypeName(type) {
    const t = LEAVE_TYPES.find((x) => x.key === type);
    return t ? t.name : type;
}

/* ============================================================
 * 10. 工资配置（挂载到 App.state）
 * ========================================================== */
function loadSalaryConfig() {
    const v = store.readJSON(KEY_SALARY, null);
    const subsidies = (v && Array.isArray(v.subsidies) && v.subsidies.length)
        ? v.subsidies.map((s) => ({ name: s && s.name, amount: s && s.amount }))
        : DEFAULT_SALARY.subsidies.map((s) => ({ name: s.name, amount: s.amount }));
    const customDeductions = (v && Array.isArray(v.customDeductions) && v.customDeductions.length)
        ? v.customDeductions.map((s) => ({ name: s && s.name, amount: s && s.amount }))
        : [];
    const cfg = Object.assign({}, DEFAULT_SALARY, v || {}, { subsidies: subsidies, customDeductions: customDeductions });
    if (v && v.socialInsurance !== undefined && v.housingFund === undefined) {
        const total = v.socialInsurance || 0;
        cfg.socialInsurance = Math.round(total * 0.6);
        cfg.housingFund = total - cfg.socialInsurance;
    }
    return cfg;
}
function saveSalaryConfig() { store.writeJSON(KEY_SALARY, S.salaryConfig); }

function loadPayslipData() {
    return store.readJSON(KEY_PAYSLIP, {}) || {};
}
function savePayslipData() {
    store.writeJSON(KEY_PAYSLIP, S.payslipData);
}

S.salaryConfig = loadSalaryConfig();
S.payslipData = loadPayslipData();

/* ============================================================
 * 11. 工资计算
 * ========================================================== */
function hourlyWage() { return S.salaryConfig.baseSalary / S.salaryConfig.workDaysPerMonth / DAY_HOURS; }

function rateForDate(ds) {
    if (S.holidayDates.has(ds)) return OT_RATE.holiday;
    const d = util.parseDateKey(ds);
    if (!d) return OT_RATE.normal;
    const w = d.getDay();
    if (w === 0 || w === 6) return OT_RATE.weekend;
    return OT_RATE.normal;
}

function dayOvertimePay(ds) {
    let pay = 0;
    S.otData.forEach((o) => {
        if (o.date !== ds) return;
        pay += o.hours * hourlyWage() * OT_RATE[o.type];
    });
    return util.round2(pay);
}

function rangeOvertime(start, end) {
    const r = { normal: 0, weekend: 0, holiday: 0, totalHours: 0, totalPay: 0 };
    const s = util.toDateKey(start), e = util.toDateKey(end);
    S.otData.forEach((o) => {
        if (!util.isValidDateKey(o.date)) return;
        if (o.date < s || o.date > e) return;
        r[o.type] = (r[o.type] || 0) + o.hours;
        r.totalHours += o.hours;
    });
    r.totalPay = util.round2(
        r.normal * OT_RATE.normal +
        r.weekend * OT_RATE.weekend +
        r.holiday * OT_RATE.holiday
    ) * hourlyWage();
    r.normal = util.round2(r.normal);
    r.weekend = util.round2(r.weekend);
    r.holiday = util.round2(r.holiday);
    r.totalHours = util.round2(r.totalHours);
    r.totalPay = util.round2(r.totalPay);
    return r;
}

function rangeLeaveDeduction(start, end) {
    let hours = 0;
    const s = util.toDateKey(start), e = util.toDateKey(end);
    S.leaveData.forEach((l) => {
        if (!util.isValidDateKey(l.start) || !util.isValidDateKey(l.end)) return;
        if (l.end < s || l.start > e) return;
        const cfg = LEAVE_TYPES.find((t) => t.key === l.type);
        if (cfg && cfg.deduct === false) return;
        hours += l.hours;
    });
    return util.round2(hourlyWage() * hours);
}

function rangeSubsidy(start, end) {
    let days = 0;
    util.eachDay(start, end, () => days++);
    const monthDays = S.salaryConfig.workDaysPerMonth;
    const ratio = monthDays > 0 ? days / monthDays : 0;
    let total = 0;
    (S.salaryConfig.subsidies || []).forEach((s) => { total += parseFloat(s.amount) || 0; });
    return util.round2(total * ratio);
}

function calcNightAllowance(start, end) {
    var rate = S.salaryConfig.nightAllowance || 0;
    if (rate <= 0) return 0;
    var count = 0;
    var s = util.toDateKey(start), e = util.toDateKey(end);
    Object.keys(S.data).forEach(function(ds) {
        if (ds < s || ds > e) return;
        var rec = S.data[ds];
        if (rec && rec.shiftType === 'night' && punchCount(rec) > 0) count++;
    });
    return util.round2(count * rate);
}

function calcSalary(start, end) {
    const ot = rangeOvertime(start, end);
    const leave = rangeLeaveDeduction(start, end);
    const subsidy = rangeSubsidy(start, end);
    const base = S.salaryConfig.baseSalary;
    const socialIns = S.salaryConfig.socialInsurance || 0;
    const housingFund = S.salaryConfig.housingFund || 0;
    const nightAllowance = calcNightAllowance(start, end);
    const customDeduction = (S.salaryConfig.customDeductions || []).reduce(function(sum, d) { return sum + (parseFloat(d.amount) || 0); }, 0);
    const gross = base + ot.totalPay + subsidy + nightAllowance;
    const net = util.round2(gross - socialIns - housingFund - customDeduction - leave);
    return {
        base: base, otPay: ot.totalPay, subsidy: subsidy, nightAllowance: nightAllowance,
        socialInsurance: socialIns, housingFund: housingFund, customDeduction: customDeduction,
        leaveDeduction: leave, gross: util.round2(gross), net: net, ot: ot, hourly: hourlyWage()
    };
}

function calcOtPay(start, end) {
    return rangeOvertime(start, end).totalPay;
}
function calcLeaveDeduct(start, end) {
    return rangeLeaveDeduction(start, end);
}
function calcPayslip(year) {
    const yearKey = String(year);
    const yearData = S.payslipData[yearKey] || {};
    return yearData;
}

/* ============================================================
 * 12. 目标工时
 * ========================================================== */
function saveTargetHours(v) {
    const nv = util.clamp(parseFloat(v) || TARGET_DEFAULT, TARGET_MIN, TARGET_MAX);
    S.targetHours = nv;
    store.write(KEY.target, String(nv));
    return nv;
}

/* ============================================================
 * 13. 导出到 App 命名空间
 * ========================================================== */
App.data = {
    // 打卡数据
    normalizeData: normalizeData,
    normalizeShiftType: normalizeShiftType,
    emptyStatus: emptyStatus,
    markDirty: markDirty,
    markAllDirty: markAllDirty,
    writeMirror: writeMirror,
    saveData: saveData,
    setSyncHook: setSyncHook,
    scheduleFlush: scheduleFlush,
    flushData: flushData,
    hydrate: hydrate,
    getRecord: getRecord,
    ensureRecord: ensureRecord,
    removeRecord: removeRecord,
    replaceAllData: replaceAllData,
    currentRecord: currentRecord,
    currentStatus: currentStatus,
    getShift: getShift,
    dayHours: dayHours,
    punchCount: punchCount,
    nextSlot: nextSlot,
    cached: cached,
    rangeStats: rangeStats,
    monthStats: monthStats,
    weekStats: weekStats,

    // 班别配置
    saveShiftSchedules: saveShiftSchedules,
    resetShiftSchedules: resetShiftSchedules,
    buildShiftText: buildShiftText,
    cloneSchedule: cloneSchedule,

    // 目标工时
    saveTargetHours: saveTargetHours,

    // 节假日
    saveHolidayDates: saveHolidayDates,

    // 加班
    addOvertime: addOvertime,
    updateOvertime: updateOvertime,
    deleteOvertime: deleteOvertime,
    normalizeOT: normalizeOT,
    getOtByDate: getOtByDate,
    hasOvertimeOnDay: hasOvertimeOnDay,
    rangeOvertime: rangeOvertime,
    dayOvertimePay: dayOvertimePay,
    rateForDate: rateForDate,

    // 请假
    addLeave: addLeave,
    updateLeave: updateLeave,
    deleteLeave: deleteLeave,
    normalizeLeave: normalizeLeave,
    getLeaveByDate: getLeaveByDate,
    getLeaveTypeName: getLeaveTypeName,
    rangeLeaveDeduction: rangeLeaveDeduction,

    // 加班/请假 flush
    hydrateOtLeave: hydrateOtLeave,
    flushOtData: flushOtData,
    scheduleOtFlush: scheduleOtFlush,
    saveOT: saveOT,
    saveLeave: saveLeave,

    // 工资
    saveSalaryConfig: saveSalaryConfig,
    savePayslipData: savePayslipData
};

App.salary = {
    hourlyWage: hourlyWage,
    calcSalary: calcSalary,
    calcOtPay: calcOtPay,
    calcLeaveDeduct: calcLeaveDeduct,
    calcPayslip: calcPayslip,
    calcNightAllowance: calcNightAllowance,
    rangeOvertime: rangeOvertime,
    rangeLeaveDeduction: rangeLeaveDeduction,
    rangeSubsidy: rangeSubsidy,
    getLeaveTypeName: getLeaveTypeName
};

/* 内部标记 otDirty 的辅助函数（供外部模块在直接修改数据后调用） */
App._markOtDirty = function () { otDirty = true; };

})();
