document.addEventListener('DOMContentLoaded', function () {

/* ============ 工具函数 ============ */
function getLocalDateStr(d) {
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
}
function getCurrentTimeStr(t) {
    t = t || new Date();
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
}
function parseTimeParts(s) { if (!s) return [0, 0, 0]; var p = s.split(':').map(Number); return [p[0] || 0, p[1] || 0, p[2] || 0]; }
function getWeekRange(dateObj) {
    var d = new Date(dateObj); d.setHours(0, 0, 0, 0); var w = d.getDay(); if (w === 0) w = 7;
    var mon = new Date(d); mon.setDate(d.getDate() - w + 1);
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999);
    return { mon: mon, sun: sun };
}
function pad(n) { return String(n).padStart(2, '0'); }

/* ============ 数据层 ============ */
var allData = loadData(), storageAvailable = true;
function loadData() { try { var s = localStorage.getItem('attendanceData'); return s ? JSON.parse(s) : {}; } catch (e) { storageAvailable = false; return {}; } }
function saveData() { if (!storageAvailable) return; try { localStorage.setItem('attendanceData', JSON.stringify(allData)); } catch (e) { storageAvailable = false; } }

/* 排班配置：时段收敛到 periods，消灭魔法数字。
   班别时间段支持用户自定义：自定义值存 localStorage('shiftSchedules')，
   未设置/非法时回退到下方 DEFAULT_SCHEDULES 内置默认。 */
var DEFAULT_SCHEDULES = {
    day: {
        name: "白班",
        periods: [{ start: "08:00", end: "12:00" }, { start: "13:30", end: "17:30" }],
        steps: ["上午上班", "上午下班", "下午上班", "下午下班"], keys: ["s1", "e1", "s2", "e2"], labels: ["上午工时", "下午工时"]
    },
    night: {
        name: "夜班",
        periods: [{ start: "19:30", end: "23:59" }, { start: "00:00", end: "05:00" }],
        steps: ["夜班上班", "午夜下班", "凌晨上班", "凌晨下班"], keys: ["s1", "e1", "s2", "e2"], labels: ["前半段工时", "后半段工时"]
    }
};
/* 由 periods 派生 text 描述 */
function buildShiftText(periods) {
    return periods.map(function (p) { return p.start + "~" + p.end; }).join(" (午休) ");
}
/* 加载用户自定义班别配置（localStorage），与默认合并；非法字段回退默认 */
function loadShiftSchedules() {
    var custom = null;
    if (storageAvailable) { try { var raw = localStorage.getItem('shiftSchedules'); if (raw) custom = JSON.parse(raw); } catch (e) { custom = null; } }
    var out = { day: cloneSchedule(DEFAULT_SCHEDULES.day), night: cloneSchedule(DEFAULT_SCHEDULES.night) };
    if (custom && typeof custom === 'object') {
        ['day', 'night'].forEach(function (k) {
            if (custom[k] && Array.isArray(custom[k].periods)) {
                var ps = custom[k].periods.filter(isValidPeriod).slice(0, 2);
                if (ps.length) { out[k].periods = ps; out[k].text = buildShiftText(ps); }
            }
        });
    }
    return out;
}
function cloneSchedule(s) { return { name: s.name, periods: (s.periods || []).map(function (p) { return { start: p.start, end: p.end }; }), steps: s.steps, keys: s.keys, labels: s.labels }; }
function isValidPeriod(p) { return p && typeof p.start === 'string' && typeof p.end === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.end); }
var shiftsConfig = loadShiftSchedules();
function saveShiftSchedules() {
    if (!storageAvailable) return;
    try { localStorage.setItem('shiftSchedules', JSON.stringify({ day: { periods: shiftsConfig.day.periods }, night: { periods: shiftsConfig.night.periods } })); } catch (e) {}
}
var currentShiftType = localStorage.getItem('defaultShiftType') || 'day';
function saveDefaultShiftType() { if (storageAvailable) localStorage.setItem('defaultShiftType', currentShiftType); }
/* 月历默认展开偏好：true=默认月视图，false=默认周视图（折叠）。默认 false 以保持紧凑首屏 */
function loadCalDefaultExpanded() { if (storageAvailable) { var v = localStorage.getItem('calendarDefaultExpanded'); if (v === '1') return true; if (v === '0') return false; } return false; }
function saveCalDefaultExpanded(v) { if (storageAvailable) localStorage.setItem('calendarDefaultExpanded', v ? '1' : '0'); }
var calDefaultExpanded = loadCalDefaultExpanded();

/* 默认选中：始终为今天（new Date() 在当天 0 点附近，仅取年月日）。
   说明：此前逻辑是"优先跳到最近打卡日"，导致打开时停留在过去的日期（如 9/6）。
   现改为每次打开默认选中今天；"回到今天"按钮(#todayTag)仍可用于手动跳转。 */
function getToday() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
var selectedDate = getToday();
var currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
function getCurrentData() {
    var ds = getLocalDateStr(selectedDate);
    if (!allData[ds]) allData[ds] = { shiftType: currentShiftType, status: { s1: null, e1: null, s2: null, e2: null } };
    return allData[ds];
}
/* status 统一走 getter，始终指向当前选中日期，杜绝切换/导入后持有旧引用 */
Object.defineProperty(window, 'status', {
    get: function () { return getCurrentData().status; },
    set: function (v) { /* 兼容赋值，忽略 */ }
});
var status = getCurrentData().status;

/* 月统计缓存 */
var _monthCache = { key: '', total: 0, days: 0 };
function invalidateMonthCache() { _monthCache.key = ''; }

/* ============ DOM 缓存 ============ */
function cacheEls() {
    return {
        clock: document.getElementById('clock'),
        calGrid: document.getElementById('calGrid'),
        calTitle: document.getElementById('calTitle'),
        btnText: document.getElementById('btnText'),
        punchBtn: document.getElementById('punchBtn'),
        totalHours: document.getElementById('totalHours'),
        punchCount: document.getElementById('punchCount'),
        shiftBar: document.getElementById('shiftBar'),
        selDateText: document.getElementById('selDateText'),
        shiftText: document.getElementById('shiftText'),
        shiftSelect: document.getElementById('shiftSelect'),
        expandIcon: document.getElementById('expandIcon'),
        todayDetail: document.getElementById('todayDetail'),
        d_s1: document.getElementById('d_s1'), d_e1: document.getElementById('d_e1'),
        d_s2: document.getElementById('d_s2'), d_e2: document.getElementById('d_e2'),
        monthAvg: document.getElementById('tabMonthAvg'),
        monthDays: document.getElementById('tabMonthDays'),
        monthTotalHours: document.getElementById('tabMonthTotal')
    };
}
var els = cacheEls();

/* ============ Toast ============ */
function showToast(msg, isError) {
    var t = document.getElementById('appToast');
    if (!t) { t = document.createElement('div'); t.id = 'appToast'; t.className = 'app-toast'; document.querySelector('.app').appendChild(t); }
    t.innerText = msg; t.className = 'app-toast show' + (isError ? ' err' : '');
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'app-toast'; }, 2400);
}

/* ============ 时钟 ============ */
function updateClock() { els.clock.innerText = new Date().toLocaleTimeString('en-GB', { hour12: false }); }
var clockTimer = setInterval(updateClock, 1000); updateClock();
document.addEventListener('visibilitychange', function () { if (document.hidden) { clearInterval(clockTimer); } else { updateClock(); clockTimer = setInterval(updateClock, 1000); } });

/* ============ 月视图 ============ */
function renderCalendar() {
    var y = currentMonth.year, m = currentMonth.month;
    els.calTitle.innerText = y + '年 ' + pad(m + 1) + '月';
    var grid = els.calGrid; grid.innerHTML = "";
    var firstDay = new Date(y, m, 1), startDay = firstDay.getDay(); if (startDay === 0) startDay = 7; startDay -= 1;
    var daysInMonth = new Date(y, m + 1, 0).getDate(), prevMonthDays = new Date(y, m, 0).getDate();
    var totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    var today = new Date();
    var frag = document.createDocumentFragment();
    for (var i = 0; i < totalCells; i++) {
        var div = document.createElement('div'); div.className = 'cal-date';
        var dn = i - startDay + 1, dt = new Date(y, m, dn);
        if (dn <= 0) { div.classList.add('dim'); dn = prevMonthDays + dn; } else if (dn > daysInMonth) { div.classList.add('dim'); dn = dn - daysInMonth; }
        var ds = getLocalDateStr(dt), dd = allData[ds];
        if (dd) { var c = [dd.status.s1, dd.status.e1, dd.status.s2, dd.status.e2].filter(Boolean).length; if (c === 4) div.classList.add('cal-done'); else if (c > 0) div.classList.add('cal-partial'); }
        if (dd && (dd.status.s1 || dd.status.e1 || dd.status.s2 || dd.status.e2)) div.classList.add('has-record');
        if (dt.toDateString() === selectedDate.toDateString()) div.classList.add('selected');
        if (dt.toDateString() === today.toDateString()) div.classList.add('today');
        div.innerText = dn;
        div.addEventListener('click', function (ev) {
            var d = ev.currentTarget._dt; selectedDate = d;
            var cd = getCurrentData(); status = cd.status; currentShiftType = cd.shiftType || currentShiftType;
            els.shiftSelect.value = currentShiftType; renderCalendar(); updateButtonText(); updateStats(); updateSelectedLabel(); renderHistoryStats();
        });
        /* 长按触发补卡，避免点击查看时被弹窗打扰 */
        (function (dCell) {
            var timer = null;
            var start = function () { timer = setTimeout(function () { openMakeupModal(selectedDate); }, 600); };
            var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
            dCell.addEventListener('touchstart', start, { passive: true });
            dCell.addEventListener('touchend', cancel); dCell.addEventListener('touchmove', cancel);
            dCell.addEventListener('mousedown', start); dCell.addEventListener('mouseup', cancel); dCell.addEventListener('mouseleave', cancel);
        })(div);
        div._dt = dt; frag.appendChild(div);
    }
    grid.appendChild(frag);
    drawChart(); /* 月视图切换时，图表同步刷新为对应月份 */
}

/* ============ 周视图（折叠态） ============ */
function renderWeekView() {
    var lock = getWeekRange(selectedDate);
    els.calTitle.innerText = (lock.mon.getMonth() + 1) + '月' + lock.mon.getDate() + '日 - ' + (lock.sun.getMonth() + 1) + '月' + lock.sun.getDate() + '日';
    var grid = els.calGrid; grid.innerHTML = "";
    var today = new Date();
    for (var d = new Date(lock.mon); d <= lock.sun; d.setDate(d.getDate() + 1)) {
        var dt = new Date(d), ds = getLocalDateStr(dt), dd = allData[ds], div = document.createElement('div'); div.className = 'cal-date';
        if (dd) { var c = [dd.status.s1, dd.status.e1, dd.status.s2, dd.status.e2].filter(Boolean).length; if (c === 4) div.classList.add('cal-done'); else if (c > 0) div.classList.add('cal-partial'); }
        if (dd && (dd.status.s1 || dd.status.e1 || dd.status.s2 || dd.status.e2)) div.classList.add('has-record');
        if (dt.toDateString() === selectedDate.toDateString()) div.classList.add('selected');
        if (dt.toDateString() === today.toDateString()) div.classList.add('today');
        div.innerText = dt.getDate();
        div.addEventListener('click', function (ev) {
            var d2 = ev.currentTarget._dt; selectedDate = d2;
            var cd = getCurrentData(); status = cd.status; currentShiftType = cd.shiftType || currentShiftType;
            els.shiftSelect.value = currentShiftType; renderWeekView(); updateButtonText(); updateStats(); updateSelectedLabel(); renderHistoryStats(); drawChart();
        });
        div._dt = dt; grid.appendChild(div);
    }
}

function changeMonth(o) { currentMonth.month += o; if (currentMonth.month < 0) { currentMonth.month = 11; currentMonth.year--; } if (currentMonth.month > 11) { currentMonth.month = 0; currentMonth.year++; } renderCalendar(); renderHistoryStats(); }
function changeWeek(o) { var t = new Date(getWeekRange(selectedDate).mon); t.setDate(t.getDate() + o * 7); selectedDate = t; currentMonth = { year: t.getFullYear(), month: t.getMonth() }; renderWeekView(); updateSelectedLabel(); updateButtonText(); updateStats(); renderHistoryStats(); drawChart(); }

function collapseCalendar() {
    var ic = document.getElementById('collapseCal');
    if (ic.innerText === '▽') { renderWeekView(); ic.innerText = '△'; syncChartWithCalView(false); }
    else { renderCalendar(); ic.innerText = '▽'; syncChartWithCalView(true); }
}

function updateSelectedLabel() { els.selDateText.innerText = selectedDate.getFullYear() + '年' + (selectedDate.getMonth() + 1) + '月' + selectedDate.getDate() + '日'; }
function changeShift() {
    currentShiftType = els.shiftSelect.value; saveDefaultShiftType();
    var cd = getCurrentData(); cd.shiftType = currentShiftType;
    els.shiftText.innerText = '排班时段: ' + shiftsConfig[currentShiftType].text;
    status = cd.status; updateButtonText(); updateStats();
}

/* ============ 打卡步骤（含智能提示） ============ */
function getSmartStepIndex() {
    /* 已完成的步骤数 */
    var done = [status.s1, status.e1, status.s2, status.e2].filter(Boolean).length;
    if (done >= 4) return 4;
    return done; /* 按顺序推荐下一个未打卡节点 */
}
function updateButtonText() { var cs = getSmartStepIndex(); els.btnText.innerText = cs < 4 ? shiftsConfig[currentShiftType].steps[cs] : "已完成"; var colors = ["#4a90e2", "#ff9500", "#34c759", "#34c759"]; if (els.punchBtn) { els.punchBtn.style.background = cs < 4 ? colors[cs] : "#c7c7cc"; els.punchBtn.disabled = cs >= 4; } }

/* ============ 打卡（防连点） ============ */
function isInPeriods(periods, hm) {
    for (var i = 0; i < periods.length; i++) { var p = periods[i]; if (hm >= p.start && hm <= p.end) return true; }
    return false;
}
function smartPunch() {
    var btn = els.punchBtn; if (btn.disabled) return; btn.disabled = true; btn.style.opacity = '0.5';
    var now = new Date(), ts = getCurrentTimeStr(now), tshm = ts.slice(0, 5), cfg = shiftsConfig[currentShiftType], ok = false;
    if (currentShiftType === 'day') { if (isInPeriods(cfg.periods, tshm)) ok = true; }
    else { if (isInPeriods(cfg.periods, tshm)) ok = true; }
    if (!ok) { if (!confirm('当前时间(' + tshm + ')不在【' + cfg.name + '】排班时段内，是否强制打卡/补卡？')) { btn.disabled = false; btn.style.opacity = '1'; return; } }
    var today = new Date(), isToday = selectedDate.toDateString() === today.toDateString();
    var td = new Date(selectedDate);
    /* 夜班跨天归属规则（解决"9.1夜班、过0点后打卡"日期错乱）：
       - 当前在凌晨(00:00~05:59)且打夜班时，打卡应归属到"夜班的起始日"(前一天)
       - 仅当日历当前选中的是【今天】时才自动回退一天（凌晨本就属于昨天的夜班）
       - 若用户已手动选中了昨天/其他日期，则【保持不动】，避免重复减一天导致错归到更早日期 */
    if (currentShiftType === 'night' && now.getHours() < 6) {
        var todaysMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var selMidnight = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        if (selMidnight.getTime() === todaysMidnight.getTime()) {
            td.setDate(td.getDate() - 1);   // 选中今天 → 回退到昨天（夜班起始日）
        }
        // 否则：selectedDate 已是昨天或其他日期，保持不变，直接在其上打卡
    }
    var tds = getLocalDateStr(td);
    if (!allData[tds]) allData[tds] = { shiftType: currentShiftType, status: { s1: null, e1: null, s2: null, e2: null } };
    else if (!allData[tds].shiftType) allData[tds].shiftType = currentShiftType;
    if (td.toDateString() !== selectedDate.toDateString()) { selectedDate = td; currentShiftType = allData[tds].shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; renderCalendar(); updateSelectedLabel(); }
    status = getCurrentData().status;
    var cs = getSmartStepIndex();
    if (cs === 0) status.s1 = ts; else if (cs === 1) status.e1 = ts; else if (cs === 2) status.s2 = ts; else if (cs === 3) status.e2 = ts;
    else { btn.disabled = false; btn.style.opacity = '1'; showToast("该日期4次打卡已满，无法增加！", true); return; }
    invalidateMonthCache(); saveData(); renderCalendar(); updateStats(); updateButtonText(); drawChart();
    if (navigator.vibrate) try { navigator.vibrate(50); } catch (e) {}
    showToast("✅ 打卡成功"); btn.disabled = false; btn.style.opacity = '1';
}
function deleteRecordByDate(ds, key) {
    if (!confirm('确定删除 ' + ds + ' 的这条记录吗？')) return;
    if (!allData[ds]) return;
    allData[ds].status[key] = null; invalidateMonthCache(); saveData();
    /* 仅当删除的是当前选中日期时，才覆盖 status 引用 */
    if (ds === getLocalDateStr(selectedDate)) status = allData[ds].status;
    renderHistoryList(); renderCalendar(); updateStats(); updateSelectedLabel(); drawChart(); showToast("删除成功");
}

/* 更新「今日统计」单行：写入时间文本，并按是否有打卡值切换 .has 类（控制删除按钮显隐） */
function setDetailRow(key, val) {
    var el = document.getElementById('d_' + key), row = el && el.closest('.detail-row');
    if (!el) return;
    el.innerText = val || '--:--:--';
    if (row) row.classList.toggle('has', !!val);
}

/* 删除「今日统计」中的某一条打卡记录（上午上班/上午下班/下午上班/下午下班） */
function deleteTodayTime(key) {
    var ds = getLocalDateStr(selectedDate);
    if (!allData[ds] || !allData[ds].status[key]) return;
    if (!confirm('确定删除「' + selectedDate.getFullYear() + '年' + (selectedDate.getMonth() + 1) + '月' + selectedDate.getDate() + '日」的这次打卡记录吗？')) return;
    allData[ds].status[key] = null;
    invalidateMonthCache(); saveData();
    status = allData[ds].status;
    renderCalendar(); updateStats(); updateButtonText(); drawChart(); showToast("删除成功");
}

function getDuration(a, b) {
    if (!a || !b) return 0;
    var ah = parseTimeParts(a), bh = parseTimeParts(b);
    var s = (bh[0] * 3600 + bh[1] * 60 + bh[2]) - (ah[0] * 3600 + ah[1] * 60 + ah[2]);
    if (s < 0) s += 86400; /* 统一处理跨天 */
    return s / 3600;
}
function getMonthRange() { var y = selectedDate.getFullYear(), m = selectedDate.getMonth(); return { start: getLocalDateStr(new Date(y, m, 1)), end: getLocalDateStr(new Date(y, m + 1, 0)) }; }

function toggleTodayDetails(e) { if (e.target.closest('#todayDetail')) return; var d = els.todayDetail, ic = els.expandIcon; if (d.style.display === 'none') { d.style.display = 'block'; ic.innerText = '△'; } else { d.style.display = 'none'; ic.innerText = '▽'; } }

/* ============ 统计（月统计带缓存） ============ */
function getMonthStats() {
    var y = selectedDate.getFullYear(), m = selectedDate.getMonth(), key = y + '-' + m;
    if (_monthCache.key === key) return { total: _monthCache.total, days: _monthCache.days };
    var r = getMonthRange(), mt = 0, md = 0;
    for (var d = new Date(r.start); d <= new Date(r.end); d.setDate(d.getDate() + 1)) {
        var ds = getLocalDateStr(d); if (allData[ds]) { var d2 = allData[ds].status, dt = allData[ds].shiftType || 'day', dtot = getDuration(d2.s1, d2.e1) + getDuration(d2.s2, d2.e2); if (dtot > 0) { mt += dtot; md++; } }
    }
    _monthCache = { key: key, total: mt, days: md };
    return { total: mt, days: md };
}
function updateStats() {
    var cst = getCurrentData().shiftType || 'day';
    var s1 = getDuration(status.s1, status.e1), s2 = getDuration(status.s2, status.e2), tot = s1 + s2;
    els.totalHours.innerText = tot.toFixed(2); els.punchCount.innerText = getSmartStepIndex() + ' / 4';
    els.shiftBar.className = getSmartStepIndex() === 4 ? 'shift-bar done' : 'shift-bar';
    setDetailRow('s1', status.s1); setDetailRow('e1', status.e1);
    setDetailRow('s2', status.s2); setDetailRow('e2', status.e2);
    var ms = getMonthStats();
    /* 月统计已迁移至记录页 / 统计 Tab，此处触发同步刷新 */
    if (typeof renderHistoryStats === 'function') renderHistoryStats();
}

/* ============ 设置 / 历史 ============ */
function switchToStatsTab() { var item = document.querySelector('.tabbar-item[data-tab="tabStats"]'); if (item) item.click(); }
function openSettings() { document.getElementById('settingsModal').classList.add('show'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }
function openRecordHistory() { /* 已迁入统计 Tab，直接切到该 Tab 并刷新列表 */ switchToStatsTab(); var t = new Date(); var sd = document.getElementById('historyStartDate'), ed = document.getElementById('historyEndDate'); if (sd && !sd.value) sd.value = getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1)); if (ed && !ed.value) ed.value = getLocalDateStr(t); renderHistoryList(); }
function closeHistory() { /* 区块已迁入统计 Tab，无弹窗可关；留作兼容空函数 */ }

/* ============ 关于 / 更新记录（数据驱动，便于后续追加） ============ */
var APP_VERSION = '1.10.9';
/* 更新日志：优先从 changelog.json 异步加载（不改 JS 即可更新）；
   若 fetch 失败（如 file:// 打开被拦截），回退到下方内存兜底副本。 */
var CHANGELOG = [
    { version: '1.10.9', date: '2026-09-02', tag: '优化', items: [
        "设置弹窗移除「导出报表」「分享报表」功能，同步移除报表范围弹窗、相关CSS样式及JS死代码，代码更精简"
    ]},
    { version: '1.10.8', date: '2026-09-02', tag: '优化', items: [
        "打卡页「今日统计」每条打卡记录后增加删除按钮，可逐条删除上午/下午某次打卡（仅该时段有打卡时才显示）",
        "统计页「每日打卡记录」改名为「工时记录」，并移除整卡删除按钮，删除统一在打卡页今日统计中按条操作",
        "设置弹窗移除「导出报表」「分享报表」功能及其相关代码（报表范围弹窗、CSS样式、JS函数），图表PNG导出/分享功能保留不受影响"
    ]},
    { version: '1.10.7', date: '2026-09-02', tag: '修复', items: [
        "修复图表【本月/本周】范围不跟随日历选中日期：点击日历任意日期、切换上月/下周时，本月/本周统计与图表实时刷新为选中日所在月/周（自定义范围不受影响）"
    ]},
    { version: '1.10.6', date: '2026-09-02', tag: '修复', items: [
        "修复夜班跨天打卡日期归属：9.1夜班过0点后打卡，仅在日历选中【今天】时自动回退到夜班起始日(昨天)，已选中昨天则保持不动，避免重复减一天错归到更早日期"
    ]},
    { version: '1.10.5', date: '2026-09-01', tag: '优化', items: [
        "统计页图表视觉美化：柱状图改为渐变填充+圆角，折线图加半透明面积渐变，达标线改为绿色实线并加 🎯 图标，新增左下角图例"
    ]},
    { version: '1.10.4', date: '2026-09-01', tag: '优化', items: [
        "打卡页「今日统计」默认展开，进入即显示上午/下午四个打卡时段，无需手动点开"
    ]},
    { version: '1.10.3', date: '2026-09-01', tag: '修复', items: [
        "修复打开App时日期默认选中最近打卡日而非今天的问题，现默认始终选中当天"
    ]},
    { version: '1.10.2', date: '2026-09-01', tag: '优化', items: [
        "统计页「每日打卡记录」过滤掉无打卡记录的日期：四个打卡时段（上午上班/下班、下午上班/下班）全部为空的不显示，列表只保留有实际打卡的日期"
    ]},
    { version: '1.10.1', date: '2026-09-01', tag: '优化', items: [
        "移除统计页「每日打卡记录」区块内重复的本月/本周统计卡片，统计卡片仅在 Tab 顶部渲染一次，单一数据源避免不同步",
        "renderHistoryStats 精简为只驱动顶部 tab* 卡片，下方区块专注「日期筛选 + 打卡记录列表」，职责更清晰"
    ]},
    { version: '1.10.0', date: '2026-09-01', tag: '优化', items: [
        "script.js 全面重构：变量声明 var → const/let、状态管理移除 defineProperty Hack 改为 getCurrentStatus()、日历点击/长按改为事件委托（减少事件监听器）",
        "图表绘制引擎合并：抽取通用 renderChartToCtx，页面展示（drawChart）与导出图片（paintChartToCanvas）共用，消除重复绘图代码",
        "「查看每日打卡记录」由设置页迁入统计 Tab 内，作为常驻区块（本月/本周统计卡片 + 日期筛选 + 记录列表），进入即刷新、无需弹窗",
        "renderHistoryStats 同时驱动 Tab 顶部与记录区块的统计卡片，数据一致；删除记录弹窗相关冗余逻辑"
    ]},
    { version: '1.9.0', date: '2026-08-30', tag: '新增', items: [
        "首页底部 Tab 页：📍打卡（日历+今日统计+打卡）、📊统计（本月/本周+图表），一键切换",
        "统计页新增周平均工时、月平均工时（=总工时÷打卡天数），保留总工时与打卡天数，跟随日历选中日",
        "loadAboutData 增加 fetch 存在性防护，file:// 及无网络环境下初始化不再中断"
    ]},
    { version: '1.8.1', date: '2026-08-30', tag: '修复', items: [
        "修复记录页本周/本月统计不跟随日历选中日的异常：点击日历任意日期、切换上月/下周时，统计卡片实时刷新",
        "初始化默认选中「最近一个有数据的日期」，避免首次打开本周/本月统计恒为 0；补全记录页统计卡片样式"
    ]},
    { version: '1.8.0', date: '2026-08-26', tag: '新增', items: [
        "首页平均工时 / 打卡天数 / 总工时迁移至「记录页」，记录页顶部新增本月·本周双栏统计卡片（含月平均、周平均）"
    ]},
    { version: '1.7.2', date: '2026-08-26', tag: '修复', items: [
        "修复夜班跨零点工时计算；修复打卡按钮进度变色在部分机型不生效"
    ]},
    { version: '1.7.0', date: '2026-08-26', tag: '优化', items: [
        "打卡按钮随进度变色：蓝(0)→橙(1~2)→绿(3~4)→灰(满)"
    ]},
    { version: '1.6.0', date: '2026-08-26', tag: '新增', items: [
        "支持自定义白/夜班时间段（设置 → 自定义班别时间段），即时生效并持久化"
    ]},
    { version: '1.4.0', date: '2026-08-26', tag: '新增', items: [
        "「关于 / 更新记录」入口，更新日志改为 JSON 外部维护",
        "新增「检查更新」功能"
    ]},
    { version: '1.3.0', date: '2026-08-19', tag: '优化', items: [
        "备份拆分为「下载备份文件」与「复制备份数据」两项独立功能"
    ]},
    { version: '1.2.0', date: '2026-08-12', tag: '新增', items: [
        "新增本月工时趋势图表（柱状图/趋势线可切换）"
    ]},
    { version: '1.1.0', date: '2026-08-05', tag: '优化', items: [
        "修复夜班跨天日期归属与删除记录后状态引用问题",
        "日期点击不再弹补卡，改为长按 600ms 触发"
    ]},
    { version: '1.0.0', date: '2026-07-29', tag: '发布', items: [
        "首发：日历打卡、白/夜排班、补卡、每日记录查看",
        "本月工时统计、报表 CSV 导出与分享、数据备份与导入"
    ]}
];
/* 从外部 JSON 加载更新日志 + 当前版本号；失败则保持内存兜底 */
function loadAboutData(cb) {
    cb = cb || function () {};
    if (typeof fetch === 'undefined') { renderChangelog(); return cb(); }
    var done = 0, total = 2, ready = function () { if (++done >= total) { renderChangelog(); cb(); } };
    fetch('version.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && j.version) APP_VERSION = String(j.version); }).catch(function () {}).then(ready);
    fetch('changelog.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && Array.isArray(j) && j.length) CHANGELOG = j; }).catch(function () {}).then(ready);
}
function renderChangelog() {
    var box = document.getElementById('changelogList'); if (!box) return;
    box.innerHTML = '';
    CHANGELOG.forEach(function (log) {
        var item = document.createElement('div'); item.className = 'changelog-item';
        var tagVal = log.tag || log.type || '优化', tagDisp = log.tag || log.type || '优化';
        var tagCls = 'tag-' + ({'新增':'new','优化':'opt','修复':'fix','发布':'rel'}[tagVal] || 'opt');
        var html = '<div class="changelog-head"><span class="changelog-version">v' + log.version + '</span><span class="changelog-tag ' + tagCls + '">' + tagDisp + '</span><span class="changelog-date">' + log.date + '</span></div><ul class="changelog-items">';
        (log.items || []).forEach(function (t) { html += '<li>' + (typeof t === 'string' ? t : t.text || '') + '</li>'; });
        html += '</ul>'; item.innerHTML = html; box.appendChild(item);
    });
}
/* 比对远端 version.json，判断是否有新版本 */
function checkForUpdates() {
    var btn = document.getElementById('checkUpdateBtn'); if (btn) { btn.disabled = true; btn.innerText = '检查中…'; }
    var onDone = function (msg) { showToast(msg); if (btn) { btn.disabled = false; btn.innerText = '检查更新'; } };
    fetch('version.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) {
        if (!j || !j.version) { onDone("⚠️ 无法读取版本信息"); return; }
        var remote = String(j.version), cur = APP_VERSION;
        if (cur.replace(/^v/, '') === remote.replace(/^v/, '')) onDone("✅ 当前已是最新版本 v" + cur);
        else onDone("🆕 发现新版本 v" + remote + "（当前 v" + cur + "），请前往更新");
    }).catch(function () { onDone("⚠️ 检查更新失败（可能以 file:// 打开，建议用 http server）"); });
}
function openAbout() { closeSettings(); document.getElementById('aboutVersion').innerText = APP_VERSION; renderChangelog(); document.getElementById('aboutModal').classList.add('show'); }
function closeAbout() { document.getElementById('aboutModal').classList.remove('show'); }

/* 生成一对打卡时段（如 上午上班/上午下班）的行内 HTML：标签 + 时间，时间缺失时显示 --:--:-- 并置灰 */
function pairHtml(label1, label2, t1, t2) {
    return '<div class="history-pair">'
         +   '<div class="history-row"><span class="history-label">' + label1 + '</span><span class="history-time ' + (t1 ? 'done' : 'pending') + '">' + (t1 || '--:--:--') + '</span></div>'
         +   '<div class="history-row"><span class="history-label">' + label2 + '</span><span class="history-time ' + (t2 ? 'done' : 'pending') + '">' + (t2 || '--:--:--') + '</span></div>'
         + '</div>';
}
/* 删除某一日的全部打卡记录（整卡删除，配合卡片右上角垃圾桶图标） */
function deleteWholeRecord(ds) {
    if (!confirm('确定删除 ' + ds + ' 的全部打卡记录吗？')) return;
    if (!allData[ds]) return;
    allData[ds].status = { s1: null, e1: null, s2: null, e2: null };
    /* 若删除后四个时段全空，直接移除该日，避免列表残留空卡片 */
    var st = allData[ds].status;
    if (!st.s1 && !st.e1 && !st.s2 && !st.e2) delete allData[ds];
    invalidateMonthCache(); saveData();
    if (ds === getLocalDateStr(selectedDate)) status = allData[ds] ? allData[ds].status : { s1: null, e1: null, s2: null, e2: null };
    renderHistoryList(); renderCalendar(); updateStats(); updateSelectedLabel(); drawChart(); showToast("删除成功");
}

function renderHistoryList() {
    var ld = document.getElementById('historyList'); ld.innerHTML = ""; var sd = document.getElementById('historyStartDate').value, ed = document.getElementById('historyEndDate').value;
    if (!sd || !ed) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">请选择日期范围后点击查询</div>'; return; }
    var fds = Object.keys(allData).sort(function (a, b) { return b.localeCompare(a); }).filter(function (d) { return d >= sd && d <= ed; });
    /* 🌟 过滤掉没有打卡记录的日期：四个打卡时段全部为空才算"无记录" */
    fds = fds.filter(function (ds) {
        var st = allData[ds] && allData[ds].status;
        if (!st) return false;
        return !!(st.s1 || st.e1 || st.s2 || st.e2);
    });
    if (fds.length === 0) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">在 ' + sd + ' 至 ' + ed + ' 期间，暂无打卡记录</div>'; return; }
    fds.forEach(function (ds) {
        var dy = allData[ds], st = dy.status, dt = dy.shiftType || 'day', d1 = getDuration(st.s1, st.e1), d2 = getDuration(st.s2, st.e2), th = (d1 + d2).toFixed(2);
        var steps = shiftsConfig[dt].steps, keys = ['s1', 'e1', 's2', 'e2'], it = document.createElement('div'); it.className = 'history-item';
        var shiftName = shiftsConfig[dt] && shiftsConfig[dt].name ? shiftsConfig[dt].name : (dt === 'night' ? '夜班' : '白班');
        /* 卡片头部：日期 + 班次标签（无删除按钮，删除统一在打卡页今日统计中按条操作） */
        var h = '<div class="history-item-header">'
              +   '<div class="history-head-left">'
              +     '<span class="history-date">' + ds + '</span>'
              +     '<span class="history-shift-tag ' + (dt === 'night' ? 'night' : 'day') + '">' + shiftName + '</span>'
              +   '</div>'
              + '</div>'
              /* 中间：四个时间两两并排（上午上班/下班 与 下午上班/下午下班） */
              + '<div class="history-item-body">'
              +   '<div class="history-col">'
              +     pairHtml(steps[0], steps[1], st.s1, st.e1)
              +   '</div>'
              +   '<div class="history-col">'
              +     pairHtml(steps[2], steps[3], st.s2, st.e2)
              +   '</div>'
              + '</div>'
              /* 底部：当日总工时，数值高亮 */
              + '<div class="history-item-footer">'
              +   '<span class="history-footer-label">当日总工时</span>'
              +   '<span class="history-footer-hours"><b>' + th + '</b> h</span>'
              + '</div>';
        it.innerHTML = h; ld.appendChild(it);
    });
}

/* 触发文件下载（兼容移动端 / Safari / standalone PWA）。
   先尝试动态 <a download>.click()（桌面/多数浏览器有效）；
   若 click 后未真正开始下载（移动端/Safari/standalone 常见），兜底用 window.open(blobUrl) 触发下载/预览。 */
function triggerDownload(fn, ct, mt) {
    try {
        var b = (ct instanceof Blob) ? ct : new Blob([ct], { type: mt }), u = URL.createObjectURL(b);
        var a = document.createElement('a'); a.href = u; a.download = fn; a.rel = 'noopener';
        document.body.appendChild(a);
        var clicked = false;
        try { a.click(); clicked = true; } catch (e) { clicked = false; }
        if (clicked) { setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} }, 0); }
        else { try { document.body.removeChild(a); } catch (e) {} window.open(u, '_blank', 'noopener'); }
        setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000);
        return true;
    } catch (e) { return false; }
}
/* 下载文本/CSV/JSON。统一走 blob（GitHub Pages + PWA 下最可靠），不再用 data: URI 兜底 */
function downloadFile(fn, ct, mt) { triggerDownload(fn, ct, mt); }

/* ============ 备份：下载文件 / 复制数据 两个独立功能 ============ */
function buildBackupJSON() { return JSON.stringify(allData, null, 0); }
function buildBackupFileName() { var t = new Date(); return '工时记录备份_' + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '_' + pad(t.getHours()) + pad(t.getMinutes()) + '.json'; }
/* 仅下载备份文件 */
function downloadBackup() {
    var ds = buildBackupJSON(), fn = buildBackupFileName();
    var dlOk = triggerDownload(fn, ds, 'application/json');
    closeSettings();
    if (dlOk) showToast("✅ 备份文件已开始下载");
    else showToast("❌ 下载失败，请重试", true);
}
/* 仅复制备份数据到剪贴板（失败时弹出兜底文本框） */
function copyData() {
    var ds = buildBackupJSON();
    var showFallback = function () { var m = document.getElementById('copyFallbackModal'); document.getElementById('copyFallbackText').value = ds; m.classList.add('show'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ds).then(function () { closeSettings(); showToast("📋 备份数据已复制到剪贴板"); }).catch(function () { showFallback(); });
    } else { showFallback(); }
}
/* 从备份文件导入：点击隐藏 file input 选择本地下载的备份 .json，
   读取并解析后二次确认再覆盖当前数据，与「下载备份文件」形成闭环。 */
function openImportFromFile() {
    closeSettings();
    var inp = document.getElementById('importFileInput');
    if (!inp) { openImportModal(); return; } /* 兜底：无 file input 时走粘贴导入 */
    inp.value = ''; /* 允许重复选择同一文件 */
    if (inp._bound) { inp.click(); return; }
    inp._bound = true;
    inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
            var text = ev.target && ev.target.result; if (!text) { showToast("❌ 读取文件为空", true); return; }
            try {
                var id = JSON.parse(text);
                if (!id || typeof id !== 'object' || Array.isArray(id)) { showToast("❌ 备份格式不正确（应为 JSON 对象）", true); return; }
                var dayCount = Object.keys(id).length;
                if (!confirm("导入将用该备份覆盖当前所有数据（共 " + dayCount + " 条日期记录），确定继续吗？")) return;
                allData = id; invalidateMonthCache(); saveData();
                /* 同步当前选中日期引用 + 排班类型 */
                var cd = getCurrentData(); status = cd.status; currentShiftType = cd.shiftType || currentShiftType;
                els.shiftSelect.value = currentShiftType;
                (calDefaultExpanded ? renderCalendar() : renderWeekView());
                document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△';
                syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); drawChart();
                showToast("✅ 已从备份文件导入 " + dayCount + " 条记录");
            } catch (e) { showToast("❌ 导入失败：文件不是合法 JSON", true); }
        };
        reader.onerror = function () { showToast("❌ 读取文件失败", true); };
        reader.readAsText(f);
    });
    inp.click();
}
/* 粘贴导入（高级兜底）：手动粘贴备份 JSON 文本导入 */
function openImportModal() { closeSettings(); var v = prompt("请粘贴之前备份的 JSON 数据："); if (!v) return; try { var id = JSON.parse(v); if (!id || typeof id !== 'object' || Array.isArray(id)) { showToast("❌ 备份格式不正确", true); return; } var dayCount = Object.keys(id).length; if (confirm("导入将覆盖当前所有数据（共 " + dayCount + " 条日期记录），确定继续吗？")) { allData = id; invalidateMonthCache(); saveData(); var cd = getCurrentData(); status = cd.status; currentShiftType = cd.shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; (calDefaultExpanded ? renderCalendar() : renderWeekView()); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); drawChart(); showToast("✅ 数据导入成功（" + dayCount + " 条）"); } } catch (e) { showToast("❌ 导入失败：格式不正确", true); } }
function clearAllData() { if (!confirm("【警告】将删除本地所有打卡记录！\n建议先备份。是否继续？")) return; if (!confirm("最后确认：真的清空所有数据吗？不可撤销！")) return; allData = {}; if (storageAvailable) localStorage.removeItem('attendanceData'); invalidateMonthCache(); status = getCurrentData().status; saveData(); renderCalendar(); updateSelectedLabel(); updateStats(); drawChart(); showToast("所有数据已清空"); closeSettings(); }

/* ============ 补卡 ============ */
function openMakeupModal(pd) { var dt = pd || new Date(), dv = getLocalDateStr(dt); document.getElementById('makeupDate').value = dv; document.getElementById('makeupTime').value = getCurrentTimeStr(); var es = (allData[dv] && allData[dv].shiftType) || currentShiftType, sl = document.getElementById('makeupType'); sl.innerHTML = ""; shiftsConfig[es].steps.forEach(function (s, i) { var o = document.createElement('option'); o.value = shiftsConfig[es].keys[i]; o.innerText = s; sl.appendChild(o); }); document.getElementById('makeupModal').classList.add('show'); }
function closeMakeupModal() { document.getElementById('makeupModal').classList.remove('show'); }
function submitMakeup() { var dt = document.getElementById('makeupDate').value, ky = document.getElementById('makeupType').value, tm = document.getElementById('makeupTime').value; if (!dt || !tm) { showToast("请完整选择日期和时间！", true); return; } var es = (allData[dt] && allData[dt].shiftType) || currentShiftType; if (!allData[dt]) allData[dt] = { shiftType: es, status: { s1: null, e1: null, s2: null, e2: null } }; allData[dt].status[ky] = tm; var p2 = dt.split('-'); selectedDate = new Date(+p2[0], +p2[1] - 1, +p2[2]); currentShiftType = allData[dt].shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; status = getCurrentData().status; currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() }; invalidateMonthCache(); saveData(); renderCalendar(); updateSelectedLabel(); updateStats(); drawChart(); closeMakeupModal(); showToast("补卡成功（" + dt + " " + ky + ": " + tm + "）"); }

/* ============ 自定义班别时间段 ============ */
function openShiftSettings() {
    closeSettings();
    var m = document.getElementById('shiftSettingsModal'); if (!m) return;
    /* 用当前生效配置填充表单 */
    var fill = function (prefix, periods) {
        for (var i = 0; i < 2; i++) {
            var p = periods[i] || { start: '00:00', end: '00:00' };
            var sEl = document.getElementById(prefix + 'Start' + (i + 1)), eEl = document.getElementById(prefix + 'End' + (i + 1));
            if (sEl) sEl.value = p.start; if (eEl) eEl.value = p.end;
        }
    };
    fill('day', shiftsConfig.day.periods); fill('night', shiftsConfig.night.periods);
    document.getElementById('shiftSettingsErr').style.display = 'none';
    m.classList.add('show');
}
function closeShiftSettings() { var m = document.getElementById('shiftSettingsModal'); if (m) m.classList.remove('show'); }
/* 从表单读取并校验某个班别的时段 */
function readShiftPeriods(prefix) {
    var ps = [];
    for (var i = 0; i < 2; i++) {
        var s = document.getElementById(prefix + 'Start' + (i + 1)).value, e = document.getElementById(prefix + 'End' + (i + 1)).value;
        if (!s || !e) return { ok: false, msg: '请完整填写所有起止时间（HH:MM）' };
        if (!isValidPeriod({ start: s, end: e })) return { ok: false, msg: '时间格式应为 HH:MM（如 08:00）' };
        ps.push({ start: s, end: e });
    }
    return { ok: true, periods: ps };
}
function applyShiftSettings() {
    var dayR = readShiftPeriods('day'), nightR = readShiftPeriods('night'), errEl = document.getElementById('shiftSettingsErr');
    if (!dayR.ok) { errEl.innerText = '白班：' + dayR.msg; errEl.style.display = 'block'; return; }
    if (!nightR.ok) { errEl.innerText = '夜班：' + nightR.msg; errEl.style.display = 'block'; return; }
    shiftsConfig.day.periods = dayR.periods; shiftsConfig.day.text = buildShiftText(dayR.periods);
    shiftsConfig.night.periods = nightR.periods; shiftsConfig.night.text = buildShiftText(nightR.periods);
    saveShiftSchedules();
    /* 刷新当前选中日期的排班文本 + 按钮/统计 */
    els.shiftText.innerText = '排班时段: ' + shiftsConfig[currentShiftType].text;
    updateButtonText(); updateStats(); drawChart();
    closeShiftSettings(); showToast("✅ 班别时间段已更新");
}
function resetShiftSettings() {
    if (!confirm("确定恢复白/夜班时间段为系统默认吗？")) return;
    shiftsConfig.day = cloneSchedule(DEFAULT_SCHEDULES.day); shiftsConfig.night = cloneSchedule(DEFAULT_SCHEDULES.night);
    saveShiftSchedules();
    els.shiftText.innerText = '排班时段: ' + shiftsConfig[currentShiftType].text;
    updateButtonText(); updateStats(); drawChart();
    closeShiftSettings(); showToast("已恢复默认班别时间段");
}

/* ============ 图表可视化（Canvas，零依赖） ============ */
var chartState = { type: 'line', range: 'month', customStart: '', customEnd: '' }; /* type: bar|line; range: month|week|custom */
/* 自定义达标线（小时），默认 6，持久化到 localStorage */
var TARGET_DEFAULT = 6;
function getTargetHours() {
    try { var v = parseFloat(localStorage.getItem('chartTargetHours')); if (!isNaN(v) && v > 0) return v; } catch (e) {}
    return TARGET_DEFAULT;
}
function setTargetHours(v) {
    var nv = Math.max(0.5, Math.min(24, v)); /* 限制在 0.5~24 之间 */
    if (storageAvailable) try { localStorage.setItem('chartTargetHours', String(nv)); } catch (e) {}
    return nv;
}
var chartTargetHours = getTargetHours();
function getChartSeries() {
    /* 按当前 chartState.range 返回按日排序的 [{date,ds,total,hasRecord}] */
    /* ★ 本月/本周基于「日历选中日 selectedDate」，跟随选中日期变化；自定义则用缓存起止 */
    var range = chartState.range, t = new Date(selectedDate), y = t.getFullYear(), m = t.getMonth();
    var start, end;
    if (range === 'month') { start = new Date(y, m, 1); end = new Date(y, m + 1, 0); }
    else if (range === 'week') { var w = getWeekRange(t); start = new Date(w.mon); end = new Date(w.sun); }
    else {
        if (!chartState.customStart || !chartState.customEnd) { start = new Date(y, m, 1); end = new Date(y, m + 1, 0); }
        else { start = new Date(chartState.customStart); end = new Date(chartState.customEnd); }
    }
    var arr = []; for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        var dt = new Date(d), ds = getLocalDateStr(dt), dy = allData[ds], tot = 0;
        if (dy) { var st = dy.status; tot = getDuration(st.s1, st.e1) + getDuration(st.s2, st.e2); }
        arr.push({ date: dt.getDate(), ds: ds, total: tot, hasRecord: !!(dy && (dy.status.s1 || dy.status.e1 || dy.status.s2 || dy.status.e2)) });
    }
    return arr;
}
function getChartRangeLabel() {
    var range = chartState.range, t = new Date(selectedDate), y = t.getFullYear(), m = t.getMonth();
    if (range === 'month') return (m + 1) + '月';
    if (range === 'week') { var w = getWeekRange(t); return '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '-' + (w.sun.getMonth() + 1) + '/' + w.sun.getDate(); }
    if (chartState.customStart && chartState.customEnd) return chartState.customStart.slice(5) + ' ~ ' + chartState.customEnd.slice(5);
    return (m + 1) + '月';
}
function setupCanvas(canvas) {
    if (!canvas) return null;
    var dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: rect.width, h: rect.height, dpr: dpr };
}
function drawChart() {
    var canvas = document.getElementById('hoursChart');
    if (!canvas) return;
    var setup = setupCanvas(canvas);
    if (!setup) return;
    var ctx = setup.ctx, W = setup.w, H = setup.h;
    var emptyEl = document.getElementById('chartEmpty');
    var titleEl = document.getElementById('chartTitle');
    if (titleEl) titleEl.innerText = '📊 工时趋势 · ' + getChartRangeLabel();
    var series = getChartSeries();
    var hasAny = series.some(function (d) { return d.total > 0; });
    if (!hasAny) { emptyEl.style.display = 'flex'; canvas.style.display = 'none'; return; }
    emptyEl.style.display = 'none'; canvas.style.display = 'block';
    var pad = { top: 18, right: 14, bottom: 26, left: 34 }, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
    var maxV = Math.max.apply(null, series.map(function (d) { return d.total; }).concat([8])) * 1.15;
    var yTicks = 4;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1; ctx.fillStyle = '#a8a8ae'; ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var t = 0; t <= yTicks; t++) {
        var v = maxV * t / yTicks, y = pad.top + ch - (v / maxV) * ch;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillText(v.toFixed(0) + 'h', pad.left - 6, y);
    }
    var yT = pad.top + ch - (chartTargetHours / maxV) * ch;
    if (chartTargetHours <= maxV) { ctx.strokeStyle = 'rgba(52,199,89,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(W - pad.right, yT); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(52,199,89,.75)'; ctx.textAlign = 'left'; ctx.fillText(chartTargetHours + 'h', W - pad.right + 2, yT); }
    var n = series.length, bw = cw / n;
    ctx.fillStyle = '#a8a8ae'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif';
    var step = n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2));
    for (var x = 0; x < n; x++) { if ((x + 1) % step === 0 || x === 0 || x === n - 1) { var cx = pad.left + bw * (x + 0.5); ctx.fillText(series[x].date, cx, H - pad.bottom + 6); } }
    var pts = series.map(function (d, i) { return { x: pad.left + bw * (i + 0.5), y: pad.top + ch - (d.total / maxV) * ch, d: d }; });
    if (chartState.type === 'bar') {
        for (var i = 0; i < n; i++) {
            var d = series[i], barW = Math.max(3, bw * 0.62);
            var bx = pad.left + bw * (i + 0.5) - barW / 2, by = pad.top + ch - (d.total / maxV) * ch, bh = (d.total / maxV) * ch;
            if (bh <= 0) continue;
            var grad = ctx.createLinearGradient(0, by, 0, by + bh);
            if (d.total >= chartTargetHours) { grad.addColorStop(0, '#34c759'); grad.addColorStop(1, 'rgba(52,199,89,.55)'); }
            else { grad.addColorStop(0, '#4a90e2'); grad.addColorStop(1, 'rgba(74,144,226,.5)'); }
            ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, barW, bh, [3, 3, 0, 0]) : ctx.rect(bx, by, barW, bh); ctx.fill();
        }
    } else {
        ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke();
        pts.forEach(function (p) { if (p.d.total > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fillStyle = p.d.total >= chartTargetHours ? '#34c759' : '#4a90e2'; ctx.fill(); } });
    }
    canvas._chartPts = pts; canvas._chartSeries = series; canvas._chartGeo = { pad: pad, bw: bw, cw: cw, ch: ch, maxV: maxV };
}
function showChartTooltip(e) {
    var canvas = document.getElementById('hoursChart'), geo = canvas._chartGeo, pts = canvas._chartPts; if (!geo || !pts) return;
    var rect = canvas.getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    var idx = Math.floor((cx - geo.pad.left) / geo.bw); idx = Math.max(0, Math.min(pts.length - 1, idx));
    var d = pts[idx].d; var tip = document.getElementById('chartTooltip');
    if (d.total <= 0 && !d.hasRecord) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<b>' + d.ds + '</b><br>工时: ' + d.total.toFixed(2) + ' h' + (d.total >= chartTargetHours ? ' ✅' : '');
    var tipX = pts[idx].x, tipY = pts[idx].y; var tw = tip.offsetWidth || 110;
    tip.style.left = Math.min(Math.max(tipX - tw / 2, 8), (canvas.parentElement.clientWidth - tw - 8)) + 'px';
    tip.style.top = (tipY - 44) + 'px'; tip.style.display = 'block';
    clearTimeout(tip._h); tip._h = setTimeout(function () { tip.style.display = 'none'; }, 2200);
}
function toggleChartType() {
    chartState.type = chartState.type === 'bar' ? 'line' : 'bar';
    document.getElementById('chartToggle').innerText = chartState.type === 'bar' ? '趋势线' : '柱状图';
    drawChart();
}
function setChartRange(val) {
    chartState.range = val;
    document.querySelectorAll('.chart-range-opt').forEach(function (o) { o.classList.remove('selected'); });
    var sel = document.querySelector('.chart-range-opt[data-val="' + val + '"]'); if (sel) sel.classList.add('selected');
    var customEl = document.getElementById('chartCustom');
    if (val === 'custom') { customEl.style.display = 'flex'; }
    else { customEl.style.display = 'none'; }
    drawChart();
}
/* 动态更新图例中的达标阈值文字 */
function updateChartLegend() {
    var el = document.getElementById('chartLegend达标'); if (el) el.innerText = '当日达标(≥' + chartTargetHours + 'h)';
    var sv = document.getElementById('settingsTargetVal'); if (sv) sv.innerText = chartTargetHours + 'h';
}
/* 将图表绘制到指定 canvas（带白色背景/标题/图例），用于导出/分享 */
function paintChartToCanvas(targetCanvas) {
    var series = getChartSeries();
    var hasAny = series.some(function (d) { return d.total > 0; });
    var W = targetCanvas.width, H = targetCanvas.height, ctx = targetCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1c1c1e'; ctx.font = '600 15px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('工时趋势 · ' + getChartRangeLabel(), 20, 16);
    if (!hasAny) { ctx.fillStyle = '#8e8e93'; ctx.font = '13px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('该范围暂无打卡记录', W / 2, H / 2); return false; }
    var pad = { top: 44, right: 18, bottom: 32, left: 40 }, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
    var maxV = Math.max.apply(null, series.map(function (d) { return d.total; }).concat([chartTargetHours])) * 1.15, yTicks = 4;
    ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1; ctx.fillStyle = '#a8a8ae'; ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var t = 0; t <= yTicks; t++) { var v = maxV * t / yTicks, y = pad.top + ch - (v / maxV) * ch; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke(); ctx.fillText(v.toFixed(0) + 'h', pad.left - 8, y); }
    var yT = pad.top + ch - (chartTargetHours / maxV) * ch;
    if (chartTargetHours <= maxV) { ctx.strokeStyle = 'rgba(52,199,89,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(W - pad.right, yT); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(52,199,89,.75)'; ctx.textAlign = 'left'; ctx.fillText(chartTargetHours + 'h', W - pad.right + 4, yT); }
    var n = series.length, bw = cw / n;
    ctx.fillStyle = '#a8a8ae'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif';
    var step = n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2));
    for (var x = 0; x < n; x++) { if ((x + 1) % step === 0 || x === 0 || x === n - 1) { ctx.fillText(series[x].date, pad.left + bw * (x + 0.5), H - pad.bottom + 8); } }
    var pts = series.map(function (d, i) { return { x: pad.left + bw * (i + 0.5), y: pad.top + ch - (d.total / maxV) * ch, d: d }; });
    if (chartState.type === 'bar') { for (var i = 0; i < n; i++) { var d = series[i], barW = Math.max(4, bw * 0.6); if (d.total <= 0) continue; var bx = pad.left + bw * (i + 0.5) - barW / 2, by = pad.top + ch - (d.total / maxV) * ch, bh = (d.total / maxV) * ch; ctx.fillStyle = d.total >= chartTargetHours ? '#34c759' : '#4a90e2'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, barW, bh, [3, 3, 0, 0]) : ctx.rect(bx, by, barW, bh); ctx.fill(); } }
    else { ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke(); pts.forEach(function (p) { if (p.d.total > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = p.d.total >= chartTargetHours ? '#34c759' : '#4a90e2'; ctx.fill(); } }); }
    /* 图例 */
    ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var lx = pad.left + 6, ly = H - 14;
    ctx.fillStyle = '#4a90e2'; ctx.fillRect(lx, ly - 4, 12, 8); ctx.fillStyle = '#8e8e93'; ctx.fillText('每日工时', lx + 18, ly);
    ctx.fillStyle = '#34c759'; ctx.fillRect(lx + 86, ly - 4, 12, 8); ctx.fillStyle = '#8e8e93'; ctx.fillText('达标(≥' + chartTargetHours + 'h)', lx + 104, ly);
    return true;
}
function exportChartPNG() {
    var series = getChartSeries(); if (!series.some(function (d) { return d.total > 0; })) { showToast("该范围暂无打卡记录可导出", true); return; }
    var off = document.createElement('canvas'); off.width = 720; off.height = 420;
    paintChartToCanvas(off);
    var fn = '工时趋势图_' + getChartRangeLabel().replace(/[^\w\u4e00-\u9fa5]/g, '_') + '_' + new Date().getTime() + '.png';
    off.toBlob ? off.toBlob(function (blob) { triggerDownload(fn, blob, 'image/png'); showToast("🖼️ 图表图片已开始下载"); }, 'image/png') : (function () { var a = document.createElement('a'); a.href = off.toDataURL('image/png'); a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); showToast("🖼️ 图表图片已开始下载"); })();
}
function shareChartImage() {
    var series = getChartSeries(); if (!series.some(function (d) { return d.total > 0; })) { showToast("该范围暂无打卡记录可分享", true); return; }
    var off = document.createElement('canvas'); off.width = 720; off.height = 420;
    paintChartToCanvas(off);
    var fn = '工时趋势图_' + getChartRangeLabel().replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.png';
    var onBlob = function (blob) {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fn, { type: 'image/png' })] })) { navigator.share({ title: '工时趋势图', files: [new File([blob], fn, { type: 'image/png' })] }).then(function () { showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') { triggerDownload(fn, blob, 'image/png'); showToast("🖼️ 已转为下载"); } }); }
        else { triggerDownload(fn, blob, 'image/png'); showToast("🖼️ 分享不可用，已转为下载"); }
    };
    off.toBlob ? off.toBlob(onBlob, 'image/png') : (function () { var a = document.createElement('a'); a.href = off.toDataURL('image/png'); a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); showToast("🖼️ 图表图片已开始下载"); })();
}
function initChart() {
    var canvas = document.getElementById('hoursChart');
    canvas.addEventListener('click', showChartTooltip);
    canvas.addEventListener('touchstart', showChartTooltip, { passive: true });
    document.getElementById('chartToggle').addEventListener('click', toggleChartType);
    document.getElementById('chartExport').addEventListener('click', exportChartPNG);
    document.getElementById('chartExport').addEventListener('contextmenu', function (e) { e.preventDefault(); shareChartImage(); });
    document.querySelectorAll('.chart-range-opt').forEach(function (opt) { opt.addEventListener('click', function () { setChartRange(opt.dataset.val); }); });
    var t = new Date(); document.getElementById('chartCustomStart').value = getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1)); document.getElementById('chartCustomEnd').value = getLocalDateStr(t);
    document.getElementById('chartCustomApply').addEventListener('click', function () { var s = document.getElementById('chartCustomStart').value, e = document.getElementById('chartCustomEnd').value; if (!s || !e) { showToast("请选择完整起止日期", true); return; } if (s > e) { showToast("开始日期不能晚于结束日期", true); return; } chartState.customStart = s; chartState.customEnd = e; drawChart(); });
    // ---- 图表 resize 防抖优化 ----
    var chartResizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(chartResizeTimer);
        chartResizeTimer = setTimeout(drawChart, 200);
    });
    /* 达标线自定义输入 */
    var targetInput = document.getElementById('chartTargetInput');
    if (targetInput) {
        targetInput.value = chartTargetHours;
        targetInput.addEventListener('change', function () {
            var nv = parseFloat(targetInput.value); if (isNaN(nv) || nv <= 0) { nv = TARGET_DEFAULT; targetInput.value = nv; }
            chartTargetHours = setTargetHours(nv); targetInput.value = chartTargetHours;
            updateChartLegend(); drawChart(); showToast("达标线已设为 " + chartTargetHours + "h");
        });
    }
    updateChartLegend(); drawChart();
    /* 设置弹窗：达标线设置入口（主页输入框已移除，改为弹窗内 prompt 输入） */
    var targetSettingItem = document.getElementById('targetSettingItem');
    if (targetSettingItem) {
        targetSettingItem.addEventListener('click', function () {
            closeSettings();
            var raw = prompt("设置每日达标线（小时，0.5~24）\n当前值：" + chartTargetHours + "h", String(chartTargetHours));
            if (raw === null) return;
            var nv = parseFloat(raw);
            if (isNaN(nv) || nv <= 0) { showToast("❌ 输入无效，已保持 " + chartTargetHours + "h", true); return; }
            chartTargetHours = setTargetHours(nv);
            updateChartLegend(); drawChart();
            showToast("达标线已设为 " + chartTargetHours + "h");
        });
    }
}

/* ============ 初始化 ============ */
els.shiftSelect.value = currentShiftType;
if (!document.getElementById('appToast')) { var t2 = document.createElement('div'); t2.id = 'appToast'; t2.className = 'app-toast'; document.querySelector('.app').appendChild(t2); }
if (!storageAvailable && !sessionStorage.getItem('warnedNoStorage')) { showToast("⚠️ 当前以 file:// 打开，数据仅存内存，建议用 http(s) 打开", true); sessionStorage.setItem('warnedNoStorage', '1'); }
var todayTag = document.getElementById('todayTag'); if (todayTag) { todayTag.style.cursor = 'pointer'; todayTag.title = '点击回到今天'; todayTag.addEventListener('click', function () { selectedDate = new Date(); currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() }; var cd = getCurrentData(); status = cd.status; currentShiftType = cd.shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; (calDefaultExpanded ? renderCalendar() : renderWeekView()); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); }); }

updateButtonText(); (calDefaultExpanded ? renderCalendar() : renderWeekView()); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; updateSelectedLabel(); initChart();
loadAboutData(); /* 异步加载 version.json + changelog.json，失败回退内存兜底 */

/* ★ 今日统计默认展开：进入即显示上午/下午四个打卡时段，无需手动点开 */
els.todayDetail.style.display = 'block';
els.expandIcon.innerText = '△';

/* ============ 周统计（跟随日历选中日所在自然周） ============ */
function getWeekStats() {
    var r = getWeekRange(selectedDate), wt = 0, wd = 0;
    for (var d = new Date(r.mon); d <= r.sun; d.setDate(d.getDate() + 1)) {
        var ds = getLocalDateStr(d); if (allData[ds]) { var st = allData[ds].status, tot = getDuration(st.s1, st.e1) + getDuration(st.s2, st.e2); if (tot > 0) { wt += tot; wd++; } }
    }
    return { total: wt, days: wd };
}

/* ============ 统计 Tab 卡片刷新（月平均 / 周平均，跟随日历选中日） ============ */
function renderHistoryStats() {
    var ms = getMonthStats(), ws = getWeekStats();
    var setVal = function (id, val) { var el = document.getElementById(id); if (el) el.innerText = val; };
    setVal('tabMonthTotal', ms.total.toFixed(2));
    setVal('tabMonthDays', ms.days);
    setVal('tabMonthAvg', ms.days > 0 ? (ms.total / ms.days).toFixed(2) : '0.00');
    setVal('tabWeekTotal', ws.total.toFixed(2));
    setVal('tabWeekDays', ws.days);
    setVal('tabWeekAvg', ws.days > 0 ? (ws.total / ws.days).toFixed(2) : '0.00');
    var tip = document.getElementById('tabWeekTip');
    if (tip) {
        var r = getWeekRange(selectedDate);
        tip.innerText = '本周 ' + (r.mon.getMonth() + 1) + '/' + r.mon.getDate() + '~' + (r.sun.getMonth() + 1) + '/' + r.sun.getDate() + '（点击日历切换）';
    }
}

/* ============ 底部 Tab 切换 ============ */
function initTabbar() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.tabbar-item'));
    var panels = { tabPunch: document.getElementById('tabPunch'), tabStats: document.getElementById('tabStats') };
    function activate(name) {
        items.forEach(function (it) { it.classList.toggle('active', it.getAttribute('data-tab') === name); });
        Object.keys(panels).forEach(function (k) {
            if (panels[k]) panels[k].classList.toggle('active', k === name);
        });
        if (name === 'tabStats') {
            renderHistoryStats(); requestAnimationFrame(function () { drawChart(); });
            /* 迁入的统计区块：进入时自动带默认范围并渲染列表 */
            (function () { var t = new Date(), sd = document.getElementById('historyStartDate'), ed = document.getElementById('historyEndDate');
              if (sd && !sd.value) sd.value = getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1));
              if (ed && !ed.value) ed.value = getLocalDateStr(t); })();
            renderHistoryList();
        }
    }
    items.forEach(function (it) {
        it.addEventListener('click', function () { activate(it.getAttribute('data-tab')); });
    });
    activate('tabPunch');
}

/* 首次启动：数据迁移后统一刷新一次统计 + 初始化 Tab */
try { renderHistoryStats(); } catch (e) { console.error('renderHistoryStats error', e); }
try { initTabbar(); } catch (e) { console.error('initTabbar error', e); }

/* ============ 自动备份提醒（新增） ============ */
(function autoBackupRemind() {
    var recordDays = Object.keys(allData).length;
    if (recordDays > 30) {
        var lastBackup = localStorage.getItem('lastBackupRemind');
        if (!lastBackup || (Date.now() - parseInt(lastBackup) > 7 * 86400000)) {
            if (confirm('您已有 ' + recordDays + ' 天打卡记录，建议定期备份数据（设置→下载备份文件）。是否现在备份？')) {
                downloadBackup();
            }
            localStorage.setItem('lastBackupRemind', String(Date.now()));
        }
    }
})();

/* ============ 事件绑定 ============ */
els.shiftSelect.addEventListener('change', changeShift);
els.punchBtn.addEventListener('click', smartPunch);
document.getElementById('cancelMakeup').addEventListener('click', closeMakeupModal);
document.getElementById('cancelMakeup2').addEventListener('click', closeMakeupModal);
document.getElementById('confirmMakeup').addEventListener('click', submitMakeup);
document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
document.getElementById('closeSettingsBtn2').addEventListener('click', closeSettings);
document.getElementById('historyQueryBtn').addEventListener('click', renderHistoryList);
    var historyRefreshBtn = document.getElementById('historyRefreshBtn');
    if (historyRefreshBtn) historyRefreshBtn.addEventListener('click', renderHistoryList);
document.getElementById('downloadBackupItem').addEventListener('click', downloadBackup);
document.getElementById('copyDataItem').addEventListener('click', copyData);
document.getElementById('importFileItem').addEventListener('click', openImportFromFile);
document.getElementById('openImportItem').addEventListener('click', openImportModal);
document.getElementById('clearDataItem').addEventListener('click', clearAllData);
var openAboutItem = document.getElementById('openAboutItem');
if (openAboutItem) openAboutItem.addEventListener('click', openAbout);
/* 月历默认展开：开关初始化 + 点击切换 */
var calSwitch = document.getElementById('calDefaultSwitch');
function refreshCalDefaultSwitch() { if (!calSwitch) return; calSwitch.classList.toggle('on', !!calDefaultExpanded); calSwitch.setAttribute('aria-checked', calDefaultExpanded ? 'true' : 'false'); }
/* 图表范围跟随月历视图联动：展开(月视图)->图表切本月；折叠(周视图)->图表切本周；自定义范围不动 */
function syncChartWithCalView(expanded) {
    if (!chartState || chartState.range === 'custom') return;
    var target = expanded ? 'month' : 'week';
    if (chartState.range !== target) setChartRange(target);
}
function toggleCalDefault() { calDefaultExpanded = !calDefaultExpanded; saveCalDefaultExpanded(calDefaultExpanded); refreshCalDefaultSwitch(); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; (calDefaultExpanded ? renderCalendar() : renderWeekView()); syncChartWithCalView(calDefaultExpanded); showToast(calDefaultExpanded ? '✅ 月历已展开为月视图' : '✅ 月历已折叠为周视图'); }
if (calSwitch) { calSwitch.addEventListener('click', toggleCalDefault); calSwitch.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCalDefault(); } }); }
/* 打开设置时同步开关状态 */
var _openSettingsOrig = openSettings; openSettings = function () { refreshCalDefaultSwitch(); _openSettingsOrig(); };
var openShiftSettingsItem = document.getElementById('openShiftSettingsItem');
if (openShiftSettingsItem) openShiftSettingsItem.addEventListener('click', openShiftSettings);
document.getElementById('closeAboutBtn').addEventListener('click', closeAbout);
document.getElementById('closeAboutBtn2').addEventListener('click', closeAbout);
document.getElementById('aboutModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeAbout(); });
var checkUpdateBtn = document.getElementById('checkUpdateBtn');
if (checkUpdateBtn) checkUpdateBtn.addEventListener('click', checkForUpdates);
document.getElementById('prevMonth').addEventListener('click', function () { if (document.getElementById('collapseCal').innerText === '△') changeWeek(-1); else changeMonth(-1); });
document.getElementById('nextMonth').addEventListener('click', function () { if (document.getElementById('collapseCal').innerText === '△') changeWeek(1); else changeMonth(1); });
document.getElementById('collapseCal').addEventListener('click', collapseCalendar);
document.getElementById('todayStatsCard').addEventListener('click', toggleTodayDetails);
/* 「今日统计」每条打卡记录后的删除按钮：事件委托，点击 ✕ 删除对应时段，并阻止冒泡避免触发展开/折叠 */
document.getElementById('todayDetail').addEventListener('click', function (e) {
    var del = e.target.closest('.detail-del'); if (!del) return;
    e.stopPropagation();
    deleteTodayTime(del.closest('.detail-row').dataset.key);
});
document.getElementById('makeupModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeMakeupModal(); });
document.getElementById('settingsModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeSettings(); });
document.getElementById('copyFallbackClose').addEventListener('click', function () { document.getElementById('copyFallbackModal').classList.remove('show'); });
document.getElementById('copyFallbackClose2').addEventListener('click', function () { document.getElementById('copyFallbackModal').classList.remove('show'); });
document.getElementById('copyFallbackRetry').addEventListener('click', function () { var txt = document.getElementById('copyFallbackText').value; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("📋 已复制到剪贴板"); }).catch(function () { showToast("❌ 复制失败，请手动长按复制", true); }); else showToast("❌ 复制失败，请手动长按复制", true); });
/* 自定义班别设置弹窗：保存/取消/重置/遮罩关闭 */
document.getElementById('shiftSettingsCancel').addEventListener('click', closeShiftSettings);
document.getElementById('shiftSettingsClose').addEventListener('click', closeShiftSettings);
document.getElementById('shiftSettingsConfirm').addEventListener('click', applyShiftSettings);
document.getElementById('shiftSettingsReset').addEventListener('click', resetShiftSettings);
document.getElementById('shiftSettingsModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeShiftSettings(); });

/* 调试桥接：暴露关键函数/数据，生产环境无副作用 */
try { window.__app = { getMonthStats: getMonthStats, getWeekStats: getWeekStats, renderHistoryStats: renderHistoryStats, getDuration: getDuration, getLocalDateStr: getLocalDateStr, allData: allData, get selectedDate(){ return selectedDate; }, setSelectedDate: function(d){ selectedDate = d; currentMonth = { year: d.getFullYear(), month: d.getMonth() }; _monthCache.key = ''; }, invalidateMonthCache: invalidateMonthCache, initTabbar: initTabbar, updateStats: updateStats, drawChart: drawChart }; } catch (e) {}

}); // end DOMContentLoaded
