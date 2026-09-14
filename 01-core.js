'use strict';
/*!
 * 工时记录 · 01-core.js（常量 + 工具函数）
 */
(function () {

/* ============================================================
 * 1. 常量
 * ========================================================== */
const CONST = {};

CONST.KEY = {
    data: 'attendanceData',
    shifts: 'shiftSchedules',
    shiftType: 'defaultShiftType',
    calExpanded: 'calendarDefaultExpanded',
    target: 'chartTargetHours',
    backupAt: 'lastBackupRemind',
    backupCount: 'lastBackupCount',
    fileSync: 'fileSyncName',
    schedule: 'scheduleRule'
};

CONST.IDB_NAME = 'worktime-db';
CONST.IDB_VER = 3;
CONST.IDB_STORE = 'days';
CONST.IDB_HANDLES = 'handles';
CONST.IDB_OT = 'overtime';
CONST.IDB_LEAVE = 'leave';
CONST.BACKUP_THRESHOLD = 10;

CONST.PUNCH_KEYS = ['s1', 'e1', 's2', 'e2'];
CONST.RE_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
CONST.RE_HMS = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
CONST.RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

CONST.FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
CONST.C = {
    primary: '#4a90e2', success: '#34c759', grid: '#eef0f3',
    axis: '#a8a8ae', tip: '#8e8e93', text: '#1c1c1e'
};
/* 打卡按钮颜色：由 CSS 类控制（浅色/深色主题自动适配），与 init 中的 STEP 顺序一一对应 */
CONST.PUNCH_COLOR_CLASS = ['punch-blue', 'punch-orange', 'punch-green', 'punch-green', 'punch-disabled'];

CONST.TARGET_DEFAULT = 6;
CONST.TARGET_MIN = 0.5;
CONST.TARGET_MAX = 24;
CONST.EXPORT_W = 720;
CONST.EXPORT_H = 420;
CONST.DAY = 86400000;

CONST.DEFAULT_SCHEDULES = {
    day: {
        name: '白班',
        periods: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }],
        steps: ['上午上班', '上午下班', '下午上班', '下午下班'],
        keys: ['s1', 'e1', 's2', 'e2'],
        labels: ['上午工时', '下午工时']
    },
    night: {
        name: '夜班',
        periods: [{ start: '19:30', end: '23:59' }, { start: '00:00', end: '05:00' }],
        steps: ['夜班上班', '午夜下班', '凌晨上班', '凌晨下班'],
        keys: ['s1', 'e1', 's2', 'e2'],
        labels: ['前半段工时', '后半段工时']
    },
    /* 注：'mid'(中班) 时段与 'rest'(休息) 由排班模块（10-schedule.js）管理，
     *  此处保留 day/night 供既有工时计算逻辑使用；SHIFTS_FOR_WORK 为可打卡班次。 */
};
CONST.SHIFT_TYPES = ['day', 'night'];
CONST.SHIFTS_FOR_WORK = ['day', 'mid', 'night'];  // 可打卡班次（含中班）
CONST.SHIFT_REST = 'rest';                         // 休息标记

/* 加班/请假/工资相关常量 */
CONST.OT_RATE = { normal: 1.5, weekend: 2, holiday: 3 };
CONST.OT_NAME = { normal: 'G1 · 平时 1.5×', weekend: 'G2 · 周休日 2×', holiday: 'G3 · 节假日 3×' };

CONST.LEAVE_TYPES = [
    { key: 'personal', name: '事假', deduct: true },
    { key: 'sick', name: '病假', deduct: true },
    { key: 'annual', name: '年休假', deduct: false },
    { key: 'other', name: '其他', deduct: true }
];
CONST.HOLIDAY_DEFAULTS = [];

CONST.KEY_OT = 'otData';
CONST.KEY_LEAVE = 'leaveData';
CONST.KEY_HOLIDAY = 'holidayDates';
CONST.KEY_SALARY = 'salaryConfig';
CONST.KEY_PAYSLIP = 'payslipData';
CONST.DAY_HOURS = 8;

CONST.DEFAULT_SALARY = {
    baseSalary: 6000,
    subsidies: [{ name: '餐补', amount: 300 }],
    customDeductions: [],
    socialInsurance: 400,
    housingFund: 200,
    nightAllowance: 30,
    workDaysPerMonth: 21.75
};

CONST.FLUSH_DELAY = 200;

/* ============================================================
 * 2. 工具函数
 * ========================================================== */
const util = {};

util.pad2 = (n) => String(n).padStart(2, '0');
util.$ = (sel, root) => (root || document).querySelector(sel);
util.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

util.toDateKey = function (d) {
    return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
};
util.parseDateKey = function (s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], day = +m[3];
    const d = new Date(y, mo - 1, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
};
util.startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
util.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
util.today = () => util.startOfDay(new Date());
util.isSameDay = (a, b) => a && b && util.startOfDay(a).getTime() === util.startOfDay(b).getTime();
util.toTimeStr = (d) => util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes()) + ':' + util.pad2(d.getSeconds());

util.timeToSec = function (s) {
    const p = String(s || '').split(':');
    return (+(p[0] || 0)) * 3600 + (+(p[1] || 0)) * 60 + (+(p[2] || 0));
};
util.isValidHM = (s) => CONST.RE_HM.test(String(s || ''));
util.isValidHMS = (s) => CONST.RE_HMS.test(String(s || ''));
util.isValidDateKey = (s) => CONST.RE_DATE.test(String(s || '')) && !!util.parseDateKey(s);
util.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

util.esc = function (s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};
util.debounce = function (fn, ms) {
    let t = 0;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
};
util.weekRange = function (d) {
    const base = util.startOfDay(d), w = base.getDay() || 7;
    const mon = util.addDays(base, 1 - w), sun = util.addDays(mon, 6);
    sun.setHours(23, 59, 59, 999);
    return { mon: mon, sun: sun };
};
util.eachDay = function (start, end, fn) {
    for (let d = util.startOfDay(start); d.getTime() <= util.startOfDay(end).getTime(); d = util.addDays(d, 1)) fn(d);
};
util.durationHours = function (a, b) {
    if (!a || !b) return 0;
    let s = util.timeToSec(b) - util.timeToSec(a);
    if (s < 0) s += CONST.DAY / 1000;
    return s / 3600;
};
util.inPeriods = (periods, hm) => periods.some((p) => hm >= p.start && hm <= p.end);
util.round2 = (n) => Math.round((n || 0) * 100) / 100;

/* 加班/请假记录 ID：Date.now()*1000 + 计数器，避免同毫秒冲突 */
let _idSeq = 0;
util.nextRecordId = function () { return Date.now() * 1000 + (_idSeq = (_idSeq + 1) % 1000); };

util.isWorkday = (d) => { const w = d.getDay(); return w !== 0 && w !== 6; };

util.defaultOtType = function (dateKey) {
    if (!dateKey) return 'normal';
    const ds = util.parseDateKey(dateKey);
    if (!ds) return 'normal';
    if (App.state.holidayDates.has(dateKey)) return 'holiday';
    const w = ds.getDay();
    if (w === 0 || w === 6) return 'weekend';
    return 'normal';
};
util.rateColor = function (t) { return t === 'holiday' ? '#ff3b30' : (t === 'weekend' ? '#ff9500' : '#4a90e2'); };

/* ============================================================
 * 3. 渲染调度系统（基础设施，前置定义供所有模块注册）
 * ========================================================== */
const renderFns = {};   // 注册的渲染函数表
const dirtyMap = {};    // 待渲染标记
let _rafId = 0;

const _raf = (fn) => (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 0);

function registerRender(name, fn) {
    if (typeof fn === 'function') renderFns[name] = fn;
}

function invalidate() {
    for (let i = 0; i < arguments.length; i++) dirtyMap[arguments[i]] = true;
    if (!_rafId) _rafId = _raf(flushRender);
}

function flushRender() {
    _rafId = 0;
    Object.keys(renderFns).forEach((name) => {
        if (!dirtyMap[name]) return;
        delete dirtyMap[name];
        try { renderFns[name](); } catch (e) { console.error('[render:' + name + ']', e); }
    });
}

/* 挂载到全局 App 对象 */
window.App = window.App || {};
App.CONST = CONST;
App.util = util;
App.registerRender = registerRender;
App.invalidate = invalidate;
App.flushRender = flushRender;
App._renderFns = renderFns;
App._dirtyMap = dirtyMap;

})();
