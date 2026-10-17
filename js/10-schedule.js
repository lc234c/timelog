'use strict';
/*!
 * 工时记录 · 10-schedule.js（排班周期规则：模板 / 周期序列 / 预览 / 日历关联）
 *
 * 设计：排班规则（schedule rule）描述一个「周期序列」，据此推算任意日期应上的班次。
 *   班次取值：'day'(白班) / 'mid'(中班) / 'night'(夜班) / 'rest'(休息)
 *   排班只决定「当天该上什么班」，实际工时仍由打卡记录（s1/e1/s2/e2）计算，互不干扰。
 *
 * 数据持久化：state.schedule = {
 *   enabled: true,                 // 是否启用排班自动关联
 *   baseDate: 'YYYY-MM-DD',        // 周期基准日（该日对应序列第 0 天）
 *   cycle: ['day','day','day','rest', ...],  // 周期序列（长度 >=1）
 *   shifts: {                      // 各班次时段（沿用并扩展 DEFAULT_SCHEDULES）
 *     day:   { periods:[{start,end},{start,end}] },
 *     mid:   { periods:[...] },
 *     night: { periods:[...] }
 *   }
 * }
 */
(function () {

const { util, state: S, store, data: D, CONST } = App;
const KEY = CONST.KEY;

/* ============================================================
 * 1. 班次元信息（图标 / 颜色 / 名称）
 * ========================================================== */
const SHIFT_META = {
    day:   { name: '白班',   icon: '☀️', color: '#4a90e2', cls: 'day' },
    mid:   { name: '中班',   icon: '⛅', color: '#ff9500', cls: 'mid' },
    night: { name: '夜班',   icon: '🌙', color: '#5e5ce6', cls: 'night' },
    rest:  { name: '休息',   icon: '🛋️', color: '#8e8e93', cls: 'rest' }
};
const SHIFT_KEYS = ['day', 'mid', 'night', 'rest'];

/* 默认时段：白 / 中 / 夜 三个可打卡班次 */
const DEFAULT_SHIFT_PERIODS = {
    day:   [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }],
    mid:   [{ start: '14:00', end: '18:00' }],                      // 中班默认单时段（可扩展为两段）
    night: [{ start: '19:30', end: '23:59' }, { start: '00:00', end: '05:00' }]
};

/* 各班次默认打卡步骤（4 槽，与 PUNCH_KEYS 对齐；休息为空） */
const SHIFT_STEPS = {
    day:   ['上午上班', '上午下班', '下午上班', '下午下班'],
    mid:   ['中班上班', '午间下班', '晚间上班', '晚间下班'],
    night: ['夜班上班', '午夜下班', '凌晨上班', '凌晨下班'],
    rest:  ['休息', '休息', '休息', '休息']
};

/* ============================================================
 * 2. 预设模板（7 款）
 * ========================================================== */
const TEMPLATES = [
    { id: 'd6r1',  name: '常白班（做六休一）', desc: '周一至周六白班，周日休1天', cycle: ['day','day','day','day','day','day','rest'] },
    { id: 'dndt',  name: '两班倒（白/夜/休）', desc: '白→夜→休',             cycle: ['day','night','rest'] },
    { id: '2d2n2r',name: '两班倒（2白2夜2休）', desc: '2白→2夜→2休',         cycle: ['day','day','night','night','rest','rest'] },
    { id: 'd5r2',  name: '常白班（做五休二）', desc: '周一至周五白班，周末连休2天', cycle: ['day','day','day','day','day','rest','rest'] },
    { id: 'd2r1',  name: '上二休一（白班）', desc: '连续2天白班→休1天',       cycle: ['day','day','rest'] },
    { id: 'n2r1',  name: '上二休一（夜班）', desc: '连续2天夜班→休1天',       cycle: ['night','night','rest'] }
];

/* ============================================================
 * 3. 默认排班状态（含迁移）
 * ========================================================== */
function defaultSchedule() {
    return {
        enabled: false,
        baseDate: util.toDateKey(new Date()),
        cycle: ['day', 'day', 'day', 'day', 'day', 'day', 'rest'],  // 默认做六休一
        rangeMode: 'infinite',   // 'infinite' | '1w' | '2w' | '4w' | 'custom'
        rangeStart: '',           // custom 模式生效起始日（空=用 baseDate）
        rangeEnd: '',             // custom 模式生效结束日
        shifts: {
            day:   { periods: clonePeriods(DEFAULT_SHIFT_PERIODS.day) },
            mid:   { periods: clonePeriods(DEFAULT_SHIFT_PERIODS.mid) },
            night: { periods: clonePeriods(DEFAULT_SHIFT_PERIODS.night) }
        }
    };
}
function clonePeriods(ps) { return ps.map((p) => ({ start: p.start, end: p.end })); }

function loadSchedule() {
    const v = store.readJSON(KEY.schedule, null);
    if (!v || typeof v !== 'object') return defaultSchedule();
    const def = defaultSchedule();
    const out = {
        enabled: !!v.enabled,
        baseDate: util.isValidDateKey(v.baseDate) ? v.baseDate : def.baseDate,
        cycle: Array.isArray(v.cycle) && v.cycle.length ? v.cycle.filter((c) => SHIFT_KEYS.indexOf(c) >= 0) : def.cycle,
        rangeMode: ['infinite','1w','2w','4w','custom'].indexOf(v.rangeMode) >= 0 ? v.rangeMode : 'infinite',
        rangeStart: util.isValidDateKey(v.rangeStart) ? v.rangeStart : '',
        rangeEnd: util.isValidDateKey(v.rangeEnd) ? v.rangeEnd : '',
        shifts: {
            day:   { periods: readPeriods(v.shifts && v.shifts.day,   def.shifts.day) },
            mid:   { periods: readPeriods(v.shifts && v.shifts.mid,   def.shifts.mid) },
            night: { periods: readPeriods(v.shifts && v.shifts.night, def.shifts.night) }
        }
    };
    if (!out.cycle.length) out.cycle = def.cycle.slice();
    return out;
}
function readPeriods(src, fallback) {
    if (!src || !Array.isArray(src.periods)) return clonePeriods(fallback);
    const ps = src.periods.filter((p) => p && util.isValidHM(p.start) && util.isValidHM(p.end)).slice(0, 4);
    return ps.length ? ps : clonePeriods(fallback);
}

/* 启动时迁移：若已存在旧 shiftType 偏好，保留；否则启用排班 */
function initSchedule() {
    S.schedule = loadSchedule();
    // 向后兼容：把排班的 day/night 时段同步进 App.shifts（供工时计算/打卡时段使用）
    syncShiftsToApp();
}

/* 将排班的 day/night 时段回写 App.shifts — 仅在首次初始化时同步，
   后续不覆盖用户通过「自定义班别时间段」设置的时段 */
function syncShiftsToApp() {
    const sch = S.schedule;
    if (!App.shifts) return;
    // 仅在 App.shifts 尚未从 store 加载自定义时段时才同步默认值
    // 通过检查 App.shifts 是否已有 _loadedFromStore 标记
    if (!App.shifts._loadedFromStore) {
        if (sch.shifts.day)   App.shifts.day.periods   = sch.shifts.day.periods;
        if (sch.shifts.night) App.shifts.night.periods = sch.shifts.night.periods;
        if (App.shifts.day)   App.shifts.day.text   = buildShiftText(App.shifts.day.periods);
        if (App.shifts.night) App.shifts.night.text = buildShiftText(App.shifts.night.periods);
    }
}
function buildShiftText(periods) {
    return periods.map((p) => p.start + '~' + p.end).join(' (午休) ');
}

function saveSchedule() {
    store.writeJSON(KEY.schedule, S.schedule);
    syncShiftsToApp();
}

/* ============================================================
 * 4. 周期推算：任意日期 → 计划班次
 * ========================================================== */

/* 根据生效范围模式，返回排班生效的起止日期（null 表示无限制） */
function getRangeBounds() {
    const sch = S.schedule;
    if (!sch) return null;
    const mode = sch.rangeMode || 'infinite';
    if (mode === 'infinite') return null;
    const base = util.parseDateKey(sch.baseDate);
    if (!base) return null;
    if (mode === 'custom') {
        const start = util.parseDateKey(sch.rangeStart) || base;
        const end = util.parseDateKey(sch.rangeEnd);
        if (!end) return null;
        return { start: start, end: end };
    }
    const days = mode === '1w' ? 7 : mode === '2w' ? 14 : mode === '4w' ? 28 : 7;
    return { start: base, end: util.addDays(base, days - 1) };
}

/* 检查某日期是否在排班生效范围内 */
function isDateInRange(dateKey) {
    const bounds = getRangeBounds();
    if (!bounds) return true;  // infinite
    const d = util.parseDateKey(dateKey);
    if (!d) return false;
    const start = util.startOfDay(bounds.start), end = util.startOfDay(bounds.end);
    const day = util.startOfDay(d);
    return day >= start && day <= end;
}

function getCycleShift(dateKey) {
    if (!S.schedule || !S.schedule.enabled) return null;
    if (!isDateInRange(dateKey)) return null;
    const base = util.parseDateKey(S.schedule.baseDate);
    const cur  = util.parseDateKey(dateKey);
    if (!base || !cur) return null;
    const cycle = S.schedule.cycle.length ? S.schedule.cycle : ['day'];
    // 天数差（可正可负），对周期长度取模
    const diff = Math.round((cur.getTime() - base.getTime()) / CONST.DAY);
    let idx = ((diff % cycle.length) + cycle.length) % cycle.length;
    return cycle[idx];
}

/* 某日期是否为休息日 */
function isRestDay(dateKey) { return getCycleShift(dateKey) === 'rest'; }

/* 前 N 天预览（从基准日或指定日起，遵循生效范围） */
function previewDays(startDate, count) {
    const start = util.startOfDay(startDate || util.parseDateKey(S.schedule.baseDate) || new Date());
    const bounds = getRangeBounds();
    // 如果有范围限制，从范围起始日开始预览
    const previewStart = bounds ? util.startOfDay(bounds.start) : start;
    const out = [];
    const maxDays = count || 7;
    for (let i = 0; i < maxDays; i++) {
        const d = util.addDays(previewStart, i);
        const key = util.toDateKey(d);
        const inRange = isDateInRange(key);
        const shift = inRange ? getCycleShift(key) : null;
        out.push({ date: key, day: d, shift: shift, weekday: d.getDay(), inRange: inRange });
    }
    return out;
}

/* ============================================================
 * 5. 自动关联：进入/切换日期时，把班别切换器对齐排班班次
 *    - 仅对可打卡班次（day/mid/night）生效；休息日不强切
 *    - 若当天已有打卡记录，以记录为准（不覆盖用户已打的班别）
 * ========================================================== */
function applyScheduleToSelected() {
    if (!S.schedule || !S.schedule.enabled) return null;
    const key = util.toDateKey(S.selected);
    const shift = getCycleShift(key);
    if (!shift || shift === 'rest') return shift;          // 休息：返回但不变更 shiftType
    const rec = D.getRecord(key);
    if (rec && rec.shiftType) return shift;                 // 已有记录：尊重既有班别
    // 排班班别 → 映射到 day/night（mid 视为 day 的时段变体，用 day 槽位打卡）
    const mapped = (shift === 'mid') ? 'day' : shift;
    if (S.shiftType !== mapped) {
        S.shiftType = mapped;
        store.write(KEY.shiftType, mapped);
    }
    return shift;
}

/* 排班徽标（供日历渲染）：返回班次 meta 或 null */
function dayScheduleBadge(dateKey) {
    if (!S.schedule || !S.schedule.enabled) return null;
    const shift = getCycleShift(dateKey);
    if (!shift || shift === 'rest') return null;            // 休息不叠加加班徽标
    return SHIFT_META[shift] || null;
}

/* ============================================================
 * 6. 模板与周期编辑（供排班设置弹窗调用）
 * ========================================================== */
function getTemplates() { return TEMPLATES.slice(); }

function loadTemplate(id) {
    const t = TEMPLATES.find((x) => x.id === id);
    return t ? t.cycle.slice() : null;
}

/* 往周期序列添加一天（默认白班） */
function cycleAddDay() { S.schedule.cycle.push('day'); }

/* 删除周期序列指定索引的一天 */
function cycleRemoveDay(i) {
    if (S.schedule.cycle.length <= 1) return false;
    S.schedule.cycle.splice(i, 1);
    return true;
}

/* 循环切换某一天班次：day→night→rest→day */
function cycleRotateDay(i) {
    const cur = S.schedule.cycle[i];
    if (cur == null) return;
    // 中班已从设置中移除，轮转顺序：day→night→rest→day
    // 若当前为 mid（旧数据），直接切到 day
    const order = ['day', 'night', 'rest'];
    const idx = order.indexOf(cur);
    S.schedule.cycle[i] = order[idx >= 0 ? (idx + 1) % order.length : 0];
}

/* ============================================================
 * 7. 导出到 App 命名空间
 * ========================================================== */
App.schedule = {
    SHIFT_META: SHIFT_META,
    SHIFT_KEYS: SHIFT_KEYS,
    TEMPLATES: TEMPLATES,
    DEFAULT_SHIFT_PERIODS: DEFAULT_SHIFT_PERIODS,
    SHIFT_STEPS: SHIFT_STEPS,

    init: initSchedule,
    defaultSchedule: defaultSchedule,
    loadSchedule: loadSchedule,
    saveSchedule: saveSchedule,
    syncShiftsToApp: syncShiftsToApp,

    getCycleShift: getCycleShift,
    isRestDay: isRestDay,
    isDateInRange: isDateInRange,
    getRangeBounds: getRangeBounds,
    previewDays: previewDays,
    applyScheduleToSelected: applyScheduleToSelected,
    dayScheduleBadge: dayScheduleBadge,

    getTemplates: getTemplates,
    loadTemplate: loadTemplate,
    cycleAddDay: cycleAddDay,
    cycleRemoveDay: cycleRemoveDay,
    cycleRotateDay: cycleRotateDay
};

/* ============================================================
 * 启动初始化：确保排班配置（S.schedule）在模块加载时即被填充，
 * 避免依赖 09-app.js 的惰性调用（P0-2 修复）
 * ========================================================== */
initSchedule();


})();
