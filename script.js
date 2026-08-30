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
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - w + 1);
    var sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - w + 7);
    return { mon: mon, sun: sun };
}
function pad(n) { return String(n).padStart(2, '0'); }
/* 本地日期 +1 天的字符串表示：统一口径，规避时区/DST 导致的日期漂移 */
function nextDayStr(str) {
    var p = str.split('-').map(Number); var dt = new Date(p[0], p[1] - 1, p[2] + 1);
    return getLocalDateStr(dt);
}
/* 安全访问当前选中日期的 status：始终取最新对象，避免切换/导入后持有旧引用 */
function getCurrentStatus() { return getCurrentData().status; }

/* ============ 数据层 ============ */
var allData = loadData(), storageAvailable = true;
function loadData() { try { var s = localStorage.getItem('attendanceData'); return s ? JSON.parse(s) : {}; } catch (e) { storageAvailable = false; return {}; } }
function saveData() { if (!storageAvailable) return; try { localStorage.setItem('attendanceData', JSON.stringify(allData)); } catch (e) { storageAvailable = false; } }

/* 排班配置：时段收敛到 periods，消灭魔法数字。 */
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
function buildShiftText(periods) {
    return periods.map(function (p) { return p.start + "~" + p.end; }).join(" (午休) ");
}
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
function loadCalDefaultExpanded() { if (storageAvailable) { var v = localStorage.getItem('calendarDefaultExpanded'); if (v === '1') return true; if (v === '0') return false; } return false; }
function saveCalDefaultExpanded(v) { if (storageAvailable) localStorage.setItem('calendarDefaultExpanded', v ? '1' : '0'); }
var calDefaultExpanded = loadCalDefaultExpanded();

/* 选中「最近一个有打卡数据的日期」：让记录页的本月/本周统计首次打开即有有意义数据。
   完全遵循「跟随日历选中日」——此后用户在日历上点任一天，周/月统计立即跟随切换；
   仅影响初始默认值，不改变任何交互行为。无任何打卡数据时回退为今天。 */
function findLatestRecordDate() {
    var keys = Object.keys(allData).filter(function (k) { var d = allData[k]; return d && d.status && (d.status.s1 || d.status.e1 || d.status.s2 || d.status.e2); });
    if (!keys.length) return null;
    keys.sort(); /* 字符串 YYYY-MM-DD 字典序即日期序 */
    var p = keys[keys.length - 1].split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
}
var selectedDate = findLatestRecordDate() || new Date();
var currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
function getCurrentData() {
    var ds = getLocalDateStr(selectedDate);
    if (!allData[ds]) allData[ds] = { shiftType: currentShiftType, status: { s1: null, e1: null, s2: null, e2: null } };
    return allData[ds];
}
/* 兼容旧代码对全局 `status` 的读取：定义为 getter 始终指向当前日期，杜绝陈旧引用 */
var status = getCurrentStatus();
try { Object.defineProperty(window, 'status', { get: getCurrentStatus, set: function (v) { getCurrentData().status = v; }, configurable: true }); } catch (e) { /* 严格/嵌入环境不支持时回退为普通变量，需手动同步 */ }

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
        d_s2: document.getElementById('d_s2'), d_e2: document.getElementById('d_e2')
        /* 首页「平均工时/打卡天数/总工时」已迁移至记录页（history-stats），首页不再缓存对应 id */
    };
}
var els = cacheEls();
/* 安全取值：首页若不存在则跳过赋值（统计已迁至记录页，首页 DOM 已移除） */
function setText(el, val) { if (el) el.innerText = val; }

/* ============ Toast ============ */
function showToast(msg, isError) {
    var t = ensureToast();
    t.innerText = msg; t.className = 'app-toast show' + (isError ? ' err' : '');
    clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'app-toast'; }, 2400);
}
/* 确保 toast 容器存在：优先取现有元素，否则在 .app 内兜底创建 */
function ensureToast() {
    var t = document.getElementById('appToast');
    if (!t) {
        t = document.createElement('div'); t.id = 'appToast'; t.className = 'app-toast';
        var host = document.querySelector('.app') || document.body;
        host.appendChild(t);
    }
    return t;
}

/* ============ 时钟 ============ */
function updateClock() { els.clock.innerText = new Date().toLocaleTimeString('en-GB', { hour12: false }); }
var clockTimer = setInterval(updateClock, 1000); updateClock();
document.addEventListener('visibilitychange', function () { if (document.hidden) { clearInterval(clockTimer); } else { updateClock(); clockTimer = setInterval(updateClock, 1000); } });

/* ============ 月/周统计计算 ============ */
function getMonthRange() { var y = selectedDate.getFullYear(), m = selectedDate.getMonth(); return { start: getLocalDateStr(new Date(y, m, 1)), end: getLocalDateStr(new Date(y, m + 1, 0)) }; }
/* 统计某日期区间：返回 {total, days}。days = 有有效工时(>0)的天数；口径统一，供月/周/报表复用。
   注意：区间用「本地日期字符串」比较（getLocalDateStr 为 YYYY-MM-DD），
   故遍历基于字符串 +1 天构造，避免时区偏移导致跨日错一位。 */
function getRangeStats(startStr, endStr) {
    var total = 0, days = 0;
    var cur = startStr;
    while (cur <= endStr) {
        var dy = allData[cur];
        if (dy) {
            var st = dy.status, tot = getDuration(st.s1, st.e1) + getDuration(st.s2, st.e2);
            if (tot > 0) { total += tot; days++; }
        }
        /* 用本地日期 +1 天后再格式化为字符串，规避 DST / 时区导致的日期漂移 */
        cur = nextDayStr(cur);
    }
    return { total: total, days: days };
}
/* 月统计（带缓存） */
function getMonthStats() {
    var y = selectedDate.getFullYear(), m = selectedDate.getMonth(), key = y + '-' + m;
    if (_monthCache.key === key) return { total: _monthCache.total, days: _monthCache.days };
    var r = getMonthRange(), ms = getRangeStats(r.start, r.end);
    _monthCache = { key: key, total: ms.total, days: ms.days };
    return ms;
}
/* 本周统计（不缓存，周随日期变化更频繁） */
function getWeekStats() {
    var w = getWeekRange(selectedDate);
    return getRangeStats(getLocalDateStr(w.mon), getLocalDateStr(w.sun));
}
/* 填充记录页的统计卡片：月总工时 / 月打卡天数 / 月平均 + 周同三项 */
function renderHistoryStats() {
    var ms = getMonthStats();
    setText(document.getElementById('histMonthTotal'), ms.total.toFixed(2));
    setText(document.getElementById('histMonthDays'), ms.days);
    setText(document.getElementById('histMonthAvg'), ms.days > 0 ? (ms.total / ms.days).toFixed(2) : '0.00');
    var ws = getWeekStats();
    setText(document.getElementById('histWeekTotal'), ws.total.toFixed(2));
    setText(document.getElementById('histWeekDays'), ws.days);
    setText(document.getElementById('histWeekAvg'), ws.days > 0 ? (ws.total / ws.days).toFixed(2) : '0.00');
    /* 同步本周范围提示（周一~周日），让用户清楚「周平均」的口径，避免本周无打卡时困惑 */
    var tip = document.getElementById('histWeekTip');
    if (tip) {
        var w = getWeekRange(selectedDate);
        var fmt = function (d) { return (d.getMonth() + 1) + '/' + d.getDate(); };
        tip.innerText = '本周 ' + fmt(w.mon) + ' ~ ' + fmt(w.sun) + '（点击日历切换）';
    }
}

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
            var cd = getCurrentData(); currentShiftType = cd.shiftType || currentShiftType;
            els.shiftSelect.value = currentShiftType; renderCalendar(); updateButtonText(); updateStats(); updateSelectedLabel(); renderHistoryStats();
        });
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
    drawChart();
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
            var cd = getCurrentData(); currentShiftType = cd.shiftType || currentShiftType;
            els.shiftSelect.value = currentShiftType; renderWeekView(); updateButtonText(); updateStats(); updateSelectedLabel(); renderHistoryStats();
        });
        div._dt = dt; grid.appendChild(div);
    }
}

function changeMonth(o) { currentMonth.month += o; if (currentMonth.month < 0) { currentMonth.month = 11; currentMonth.year--; } if (currentMonth.month > 11) { currentMonth.month = 0; currentMonth.year++; } renderCalendar(); renderHistoryStats(); }
function changeWeek(o) { var t = new Date(getWeekRange(selectedDate).mon); t.setDate(t.getDate() + o * 7); selectedDate = t; currentMonth = { year: t.getFullYear(), month: t.getMonth() }; renderWeekView(); updateSelectedLabel(); updateButtonText(); updateStats(); renderHistoryStats(); }

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
    updateButtonText(); updateStats();
}

/* ============ 打卡步骤（含智能提示） ============ */
function getSmartStepIndex() {
    var st = getCurrentStatus();
    var done = [st.s1, st.e1, st.s2, st.e2].filter(Boolean).length;
    return done >= 4 ? 4 : done;
}
function updateButtonText() {
    var cs = getSmartStepIndex();
    els.btnText.innerText = cs < 4 ? shiftsConfig[currentShiftType].steps[cs] : "已完成";
    applyPunchButtonColor(cs);
}
/* 打卡按钮随进度变色：0/4 蓝 → 1~2 橙 → 3~4 绿 → 满 4 灰(disabled) */
function applyPunchButtonColor(done) {
    var btn = els.punchBtn; if (!btn) return;
    btn.classList.remove('punch-blue', 'punch-orange', 'punch-green', 'punch-disabled');
    if (done >= 4) btn.classList.add('punch-disabled');
    else if (done >= 3) btn.classList.add('punch-green');
    else if (done >= 1) btn.classList.add('punch-orange');
    else btn.classList.add('punch-blue');
}

/* ============ 打卡（防连点） ============ */
function isInPeriods(periods, hm) {
    for (var i = 0; i < periods.length; i++) { var p = periods[i]; if (hm >= p.start && hm <= p.end) return true; }
    return false;
}
function smartPunch() {
    var btn = els.punchBtn; if (btn.disabled) return; btn.disabled = true; btn.style.opacity = '0.5';
    var now = new Date(), ts = getCurrentTimeStr(now), tshm = ts.slice(0, 5), cfg = shiftsConfig[currentShiftType], ok = false;
    if (isInPeriods(cfg.periods, tshm)) ok = true;
    if (!ok) { if (!confirm('当前时间(' + tshm + ')不在【' + cfg.name + '】排班时段内，是否强制打卡/补卡？')) { btn.disabled = false; btn.style.opacity = '1'; return; } }
    var today = new Date(), isToday = selectedDate.toDateString() === today.toDateString();
    var td = new Date(selectedDate);
    if (currentShiftType === 'night' && now.getHours() < 6) td.setDate(td.getDate() - 1);
    var tds = getLocalDateStr(td);
    if (!allData[tds]) allData[tds] = { shiftType: currentShiftType, status: { s1: null, e1: null, s2: null, e2: null } };
    else if (!allData[tds].shiftType) allData[tds].shiftType = currentShiftType;
    if (td.toDateString() !== selectedDate.toDateString()) { selectedDate = td; currentShiftType = allData[tds].shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; renderCalendar(); updateSelectedLabel(); }
    var st = getCurrentStatus(), cs = getSmartStepIndex();
    if (cs === 0) st.s1 = ts; else if (cs === 1) st.e1 = ts; else if (cs === 2) st.s2 = ts; else if (cs === 3) st.e2 = ts;
    else { btn.disabled = false; btn.style.opacity = '1'; showToast("该日期4次打卡已满，无法增加！", true); return; }
    invalidateMonthCache(); saveData(); renderCalendar(); updateStats(); updateButtonText(); drawChart(); renderHistoryStats();
    if (navigator.vibrate) try { navigator.vibrate(50); } catch (e) {}
    showToast("✅ 打卡成功"); btn.disabled = false; btn.style.opacity = '1';
}
function deleteRecordByDate(ds, key) {
    if (!confirm('确定删除 ' + ds + ' 的这条记录吗？')) return;
    if (!allData[ds]) return;
    allData[ds].status[key] = null; invalidateMonthCache(); saveData();
    renderHistoryList(); renderCalendar(); updateStats(); updateSelectedLabel(); drawChart(); renderHistoryStats(); showToast("删除成功");
}

function getDuration(a, b) {
    if (!a || !b) return 0;
    var ah = parseTimeParts(a), bh = parseTimeParts(b);
    var s = (bh[0] * 3600 + bh[1] * 60 + bh[2]) - (ah[0] * 3600 + ah[1] * 60 + ah[2]);
    if (s < 0) s += 86400; /* 统一处理跨天（含夜班跨零点） */
    return s / 3600;
}
function toggleTodayDetails(e) { if (e.target.closest('#todayDetail')) return; var d = els.todayDetail, ic = els.expandIcon; if (d.style.display === 'none') { d.style.display = 'block'; ic.innerText = '△'; } else { d.style.display = 'none'; ic.innerText = '▽'; } }

/* ============ 统计刷新 ============ */
function updateStats() {
    var st = getCurrentStatus();
    var s1 = getDuration(st.s1, st.e1), s2 = getDuration(st.s2, st.e2), tot = s1 + s2;
    setText(els.totalHours, tot.toFixed(2));
    setText(els.punchCount, getSmartStepIndex() + ' / 4');
    if (els.shiftBar) els.shiftBar.className = getSmartStepIndex() === 4 ? 'shift-bar done' : 'shift-bar';
    setText(els.d_s1, st.s1 || '--:--:--'); setText(els.d_e1, st.e1 || '--:--:--');
    setText(els.d_s2, st.s2 || '--:--:--'); setText(els.d_e2, st.e2 || '--:--:--');
    /* 月/周统计统一由 renderHistoryStats 刷新（记录页卡片） */
    renderHistoryStats();
}

/* ============ 设置 / 历史 ============ */
function openSettings() { document.getElementById('settingsModal').classList.add('show'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }
function openRecordHistory() {
    closeSettings();
    var m = document.getElementById('historyModal'); m.classList.add('show');
    var t = new Date();
    document.getElementById('historyStartDate').value = getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1));
    document.getElementById('historyEndDate').value = getLocalDateStr(t);
    renderHistoryStats(); /* 打开即刷新月/周统计 */
    renderHistoryList();
}
function closeHistory() { document.getElementById('historyModal').classList.remove('show'); }

/* ============ 关于 / 更新记录（数据驱动） ============ */
var APP_VERSION = '1.8.1';
var CHANGELOG = [
    { version: '1.7.2', date: '2026-08-26', tag: '新增', items: [
        '首页「平均工时/打卡天数/总工时」迁移至记录页，并新增周统计（周平均/周总工时/周打卡天数）',
        '打卡按钮随进度变色：蓝→橙→绿→灰(disabled)'
    ]},
    { version: '1.7.1', date: '2026-08-26', tag: '修复', items: [
        '修复 PWA/GitHub Pages/移动端下备份导出、报表 CSV、图表 PNG 下载无响应',
        'Service Worker 改为导航网络优先，动态请求透传，避免干扰下载与分享'
    ]},
    { version: '1.7.0', date: '2026-08-26', tag: '新增', items: [
        '图表支持长按保存为 PNG 图片',
        '补卡弹窗默认时间改为当前时间',
        '适配系统深色模式（跟随 prefers-color-scheme）'
    ]},
    { version: '1.6.0', date: '2026-08-26', tag: '新增', items: [
        '支持自定义白/夜班时间段（设置 → 自定义班别时间段），即时生效并持久化'
    ]},
    { version: '1.4.0', date: '2026-08-26', tag: '新增', items: [
        '新增「关于 / 更新记录」入口，更新日志改为 JSON 外部维护',
        '新增「检查更新」功能'
    ]},
    { version: '1.3.0', date: '2026-08-19', tag: '优化', items: [
        '备份拆分为「下载备份文件」与「复制备份数据」两项独立功能'
    ]},
    { version: '1.2.0', date: '2026-08-12', tag: '新增', items: [
        '新增本月工时趋势图表（柱状图/趋势线可切换）'
    ]},
    { version: '1.1.0', date: '2026-08-05', tag: '优化', items: [
        '修复夜班跨天日期归属与删除记录后状态引用问题',
        '日期点击不再弹补卡，改为长按 600ms 触发'
    ]},
    { version: '1.0.0', date: '2026-07-29', tag: '发布', items: [
        '首发：日历打卡、白/夜排班、补卡、每日记录查看',
        '本月工时统计、报表 CSV 导出与分享、数据备份与导入'
    ]}
];
function loadAboutData(cb) {
    cb = cb || function () {};
    var done = 0, total = 2, ready = function () { if (++done >= total) { renderChangelog(); cb(); } };
    fetch('version.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && j.version) APP_VERSION = String(j.version); }).catch(function () {}).then(ready);
    fetch('changelog.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && Array.isArray(j) && j.length) CHANGELOG = j; }).catch(function () {}).then(ready);
}
function renderChangelog() {
    var box = document.getElementById('changelogList'); if (!box) return;
    box.innerHTML = '';
    CHANGELOG.forEach(function (log) {
        var item = document.createElement('div'); item.className = 'changelog-item';
        var tagVal = log.tag || log.type || '优化';
        var tagCls = 'tag-' + ({'新增':'new','优化':'opt','修复':'fix','发布':'rel'}[tagVal] || 'opt');
        var html = '<div class="changelog-head"><span class="changelog-version">v' + log.version + '</span><span class="changelog-tag ' + tagCls + '">' + tagVal + '</span><span class="changelog-date">' + log.date + '</span></div><ul class="changelog-items">';
        (log.items || []).forEach(function (t) { html += '<li>' + (typeof t === 'string' ? t : t.text || '') + '</li>'; });
        html += '</ul>'; item.innerHTML = html; box.appendChild(item);
    });
}
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

function renderHistoryList() {
    var ld = document.getElementById('historyList'); ld.innerHTML = ""; var sd = document.getElementById('historyStartDate').value, ed = document.getElementById('historyEndDate').value;
    if (!sd || !ed) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">请选择日期范围后点击查询</div>'; return; }
    var fds = Object.keys(allData).sort(function (a, b) { return b.localeCompare(a); }).filter(function (d) { return d >= sd && d <= ed; });
    if (fds.length === 0) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">在 ' + sd + ' 至 ' + ed + ' 期间，暂无打卡记录</div>'; return; }
    fds.forEach(function (ds) {
        var dy = allData[ds], st = dy.status, dt = dy.shiftType || 'day', d1 = getDuration(st.s1, st.e1), d2 = getDuration(st.s2, st.e2), th = (d1 + d2).toFixed(2);
        var steps = shiftsConfig[dt].steps, keys = ['s1', 'e1', 's2', 'e2'], it = document.createElement('div'); it.className = 'history-item';
        var h = '<div class="history-item-header"><span class="history-date">' + ds + '</span><span class="history-total">总工时: ' + th + ' h</span></div><div class="history-item-body">';
        for (var i = 0; i < steps.length; i++) { var k = keys[i], tm = st[k]; h += '<div class="history-row"><span class="history-label">' + steps[i] + '</span><span class="history-time ' + (tm ? 'done' : 'pending') + '">' + (tm || '--:--:--') + '</span>' + (tm ? '<span class="history-del" data-date="' + ds + '" data-key="' + k + '">删除</span>' : '') + '</div>'; }
        h += '</div>'; it.innerHTML = h; ld.appendChild(it);
    });
    ld.querySelectorAll('.history-del').forEach(function (b) { b.addEventListener('click', function () { deleteRecordByDate(b.dataset.date, b.dataset.key); }); });
    /* 查询后同步刷新统计卡片（范围变化可能影响展示语义；月/周统计固定按日历当前月/周） */
    renderHistoryStats();
}

/* ============ 下载触发（兼容移动端 / Safari / standalone） ============ */
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
function downloadFile(fn, ct, mt) { triggerDownload(fn, ct, mt); }

/* ============ 备份 ============ */
function buildBackupJSON() { return JSON.stringify(allData, null, 0); }
function buildBackupFileName() { var t = new Date(); return '工时记录备份_' + t.getFullYear() + pad(t.getMonth() + 1) + pad(t.getDate()) + '_' + pad(t.getHours()) + pad(t.getMinutes()) + '.json'; }
function downloadBackup() {
    var dlOk = triggerDownload(buildBackupFileName(), buildBackupJSON(), 'application/json');
    closeSettings();
    if (dlOk) showToast("✅ 备份文件已开始下载");
    else showToast("❌ 下载失败，请重试", true);
}
function copyData() {
    var ds = buildBackupJSON();
    var showFallback = function () { var m = document.getElementById('copyFallbackModal'); document.getElementById('copyFallbackText').value = ds; m.classList.add('show'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ds).then(function () { closeSettings(); showToast("📋 备份数据已复制到剪贴板"); }).catch(function () { showFallback(); });
    } else { showFallback(); }
}
function openImportFromFile() {
    closeSettings();
    var inp = document.getElementById('importFileInput');
    if (!inp) { openImportModal(); return; }
    inp.value = '';
    if (inp._bound) { inp.click(); return; }
    inp._bounded = true;
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
                var cd = getCurrentData(); currentShiftType = cd.shiftType || currentShiftType;
                els.shiftSelect.value = currentShiftType;
                (calDefaultExpanded ? renderCalendar() : renderWeekView());
                document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△';
                syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); drawChart(); renderHistoryStats();
                showToast("✅ 已从备份文件导入 " + dayCount + " 条记录");
            } catch (e) { showToast("❌ 导入失败：文件不是合法 JSON", true); }
        };
        reader.onerror = function () { showToast("❌ 读取文件失败", true); };
        reader.readAsText(f);
    });
    inp.click();
}
function openImportModal() {
    closeSettings(); var v = prompt("请粘贴之前备份的 JSON 数据："); if (!v) return;
    try {
        var id = JSON.parse(v); if (!id || typeof id !== 'object' || Array.isArray(id)) { showToast("❌ 备份格式不正确", true); return; }
        var dayCount = Object.keys(id).length;
        if (confirm("导入将覆盖当前所有数据（共 " + dayCount + " 条日期记录），确定继续吗？")) {
            allData = id; invalidateMonthCache(); saveData();
            var cd = getCurrentData(); currentShiftType = cd.shiftType || currentShiftType; els.shiftSelect.value = currentShiftType;
            (calDefaultExpanded ? renderCalendar() : renderWeekView());
            document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△';
            syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); drawChart(); renderHistoryStats();
            showToast("✅ 数据导入成功（" + dayCount + " 条）");
        }
    } catch (e) { showToast("❌ 导入失败：格式不正确", true); }
}
function clearAllData() {
    if (!confirm("【警告】将删除本地所有打卡记录！\n建议先备份。是否继续？")) return;
    if (!confirm("最后确认：真的清空所有数据吗？不可撤销！")) return;
    allData = {}; if (storageAvailable) localStorage.removeItem('attendanceData'); invalidateMonthCache(); saveData();
    renderCalendar(); updateSelectedLabel(); updateStats(); drawChart(); renderHistoryStats(); showToast("所有数据已清空"); closeSettings();
}

/* ============ 补卡 ============ */
function openMakeupModal(pd) {
    var dt = pd || new Date(), dv = getLocalDateStr(dt);
    document.getElementById('makeupDate').value = dv;
    document.getElementById('makeupTime').value = getCurrentTimeStr();
    var es = (allData[dv] && allData[dv].shiftType) || currentShiftType, sl = document.getElementById('makeupType');
    sl.innerHTML = "";
    shiftsConfig[es].steps.forEach(function (s, i) { var o = document.createElement('option'); o.value = shiftsConfig[es].keys[i]; o.innerText = s; sl.appendChild(o); });
    document.getElementById('makeupModal').classList.add('show');
}
function closeMakeupModal() { document.getElementById('makeupModal').classList.remove('show'); }
function submitMakeup() {
    var dt = document.getElementById('makeupDate').value, ky = document.getElementById('makeupType').value, tm = document.getElementById('makeupTime').value;
    if (!dt || !tm) { showToast("请完整选择日期和时间！", true); return; }
    var es = (allData[dt] && allData[dt].shiftType) || currentShiftType;
    if (!allData[dt]) allData[dt] = { shiftType: es, status: { s1: null, e1: null, s2: null, e2: null } };
    allData[dt].status[ky] = tm;
    var p2 = dt.split('-'); selectedDate = new Date(+p2[0], +p2[1] - 1, +p2[2]);
    currentShiftType = allData[dt].shiftType || currentShiftType; els.shiftSelect.value = currentShiftType;
    currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
    invalidateMonthCache(); saveData(); renderCalendar(); updateSelectedLabel(); updateStats(); drawChart(); renderHistoryStats(); closeMakeupModal();
    showToast("补卡成功（" + dt + " " + ky + ": " + tm + "）");
}

/* ============ 自定义班别时间段 ============ */
function openShiftSettings() {
    closeSettings();
    var m = document.getElementById('shiftSettingsModal'); if (!m) return;
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
    els.shiftText.innerText = '排班时段: ' + shiftsConfig[currentShiftType].text;
    updateButtonText(); updateStats(); drawChart(); renderHistoryStats();
    closeShiftSettings(); showToast("✅ 班别时间段已更新");
}
function resetShiftSettings() {
    if (!confirm("确定恢复白/夜班时间段为系统默认吗？")) return;
    shiftsConfig.day = cloneSchedule(DEFAULT_SCHEDULES.day); shiftsConfig.night = cloneSchedule(DEFAULT_SCHEDULES.night);
    saveShiftSchedules();
    els.shiftText.innerText = '排班时段: ' + shiftsConfig[currentShiftType].text;
    updateButtonText(); updateStats(); drawChart(); renderHistoryStats();
    closeShiftSettings(); showToast("已恢复默认班别时间段");
}

/* ============ 图表可视化（Canvas，零依赖） ============ */
var chartState = { type: 'line', range: 'month', customStart: '', customEnd: '' };
var TARGET_DEFAULT = 6;
function getTargetHours() {
    try { var v = parseFloat(localStorage.getItem('chartTargetHours')); if (!isNaN(v) && v > 0) return v; } catch (e) {}
    return TARGET_DEFAULT;
}
function setTargetHours(v) {
    var nv = Math.max(0.5, Math.min(24, v));
    if (storageAvailable) try { localStorage.setItem('chartTargetHours', String(nv)); } catch (e) {}
    return nv;
}
var chartTargetHours = getTargetHours();
function getChartSeries() {
    var range = chartState.range, t = new Date(), y = t.getFullYear(), m = t.getMonth();
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
    var range = chartState.range, t = new Date(), y = t.getFullYear(), m = t.getMonth();
    if (range === 'month') return (m + 1) + '月';
    if (range === 'week') { var w = getWeekRange(t); return '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '-' + (w.sun.getMonth() + 1) + '/' + w.sun.getDate(); }
    if (chartState.customStart && chartState.customEnd) return chartState.customStart.slice(5) + ' ~ ' + chartState.customEnd.slice(5);
    return (m + 1) + '月';
}
function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null; /* canvas 上下文不可用时（被隐藏、沙箱环境、上下文丢失）安全退出 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
}
function drawChart() {
    var canvas = document.getElementById('hoursChart');
    var emptyEl = document.getElementById('chartEmpty');
    var titleEl = document.getElementById('chartTitle');
    if (titleEl) titleEl.innerText = '📊 工时趋势 · ' + getChartRangeLabel();
    var series = getChartSeries();
    var hasAny = series.some(function (d) { return d.total > 0; });
    if (!hasAny) { emptyEl.style.display = 'flex'; canvas.style.display = 'none'; return; }
    emptyEl.style.display = 'none'; canvas.style.display = 'block';
    var setup = setupCanvas(canvas);
    if (!setup) return; /* 上下文不可用时跳过绘制，不阻断后续逻辑（统计刷新等） */
    var ctx = setup.ctx, W = setup.w, H = setup.h;
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
    customEl.style.display = val === 'custom' ? 'flex' : 'none';
    drawChart();
}
function updateChartLegend() {
    var el = document.getElementById('chartLegend达标'); if (el) el.innerText = '当日达标(≥' + chartTargetHours + 'h)';
    var sv = document.getElementById('settingsTargetVal'); if (sv) sv.innerText = chartTargetHours + 'h';
}
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
    var chartResizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(chartResizeTimer);
        chartResizeTimer = setTimeout(drawChart, 200);
    });
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

/* ============ 报表 ============ */
function openReportRangeModal(mode) { var m = document.getElementById('reportRangeModal'); m.classList.add('show'); m.dataset.mode = mode; document.querySelectorAll('.rpt-option').forEach(function (o) { o.classList.remove('selected'); }); document.querySelector('.rpt-option[data-val="month"]').classList.add('selected'); document.getElementById('rptRangeCustom').style.display = 'none'; }
function closeReportRangeModal() { document.getElementById('reportRangeModal').classList.remove('show'); }
function getReportRange(op) {
    var t = new Date(), y = t.getFullYear(), m = t.getMonth();
    if (op === 'month') return { start: getLocalDateStr(new Date(y, m, 1)), end: getLocalDateStr(new Date(y, m + 1, 0)), label: '本月' };
    if (op === 'week') { var w = t.getDay(); if (w === 0) w = 7; var mn = new Date(t); mn.setDate(t.getDate() - w + 1); var su = new Date(mn); su.setDate(mn.getDate() + 6); return { start: getLocalDateStr(mn), end: getLocalDateStr(su), label: '本周' }; }
    var s = document.getElementById('rptRangeStart').value, e = document.getElementById('rptRangeEnd').value;
    if (!s || !e) { showToast("请选择完整起止日期", true); return null; } if (s > e) { showToast("开始日期不能晚于结束日期", true); return null; }
    return { start: s, end: e, label: '自定义_' + s + '_' + e };
}
function buildReport(range) {
    var thr = chartTargetHours;
    var hd = ['日期', '排班', '上午上班', '上午下班', '下午上班', '下午下班', '上午工时', '下午工时', '当日总工时', '是否达标(≥' + thr + 'h)'], rows = [hd], lines = ['📊 工时报表 ' + range.start + ' ~ ' + range.end + '  (达标线 ' + thr + 'h)', ''], mt = 0, md = 0,达标Days = 0;
    for (var cur = range.start; cur <= range.end; ) {
        var ds = cur, dy = allData[ds]; if (!dy) { cur = nextDayStr(cur); continue; } var st = dy.status; if (!st.s1 && !st.e1 && !st.s2 && !st.e2) { cur = nextDayStr(cur); continue; }
        var dt = dy.shiftType || 'day', d1 = getDuration(st.s1, st.e1), d2 = getDuration(st.s2, st.e2), tot = (d1 + d2), totStr = tot.toFixed(2); mt += tot; md++;
        var ok2 = tot >= thr; if (ok2)达标Days++;
        lines.push(ds + ' [' + (dt === 'night' ? '夜班' : '白班') + ']' + (ok2 ? ' ✅达标' : ''), '  ' + shiftsConfig[dt].steps[0] + ': ' + (st.s1 || '--'), '  ' + shiftsConfig[dt].steps[1] + ': ' + (st.e1 || '--'), '  ' + shiftsConfig[dt].steps[2] + ': ' + (st.s2 || '--'), '  ' + shiftsConfig[dt].steps[3] + ': ' + (st.e2 || '--'), '  当日工时: ' + totStr + 'h' + (ok2 ? ' ✅' : ''), '');
        rows.push([ds, dt === 'night' ? '夜班' : '白班', st.s1 || '', st.e1 || '', st.s2 || '', st.e2 || '', d1.toFixed(2), d2.toFixed(2), totStr, ok2 ? '达标' : '未达标']);
        cur = nextDayStr(cur);
    }
    if (md === 0) return null;
    lines.push('─── 合计 ───', '打卡天数: ' + md + ' 天', '达标天数: ' +达标Days+ ' 天', '总工时: ' + mt.toFixed(2) + ' h', '平均工时: ' + (mt / md).toFixed(2) + ' h');
    rows.push(['', '', '', '', '', '合计', md + '天(' +达标Days+ '天达标)', '', mt.toFixed(2),达标Days+ '/' + md]);
    return { text: lines.join('\n'), rows: rows, monthDays: md, monthTotal: mt,达标Days:达标Days };
}
function exportMonthCSV() { var r = getMonthRange(), res = buildReport(r); if (!res) { showToast("本月暂无打卡记录可导出", true); return; } var csv = res.rows.map(function (r2) { return r2.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'), t = new Date(), fn = '工时报表_' + t.getFullYear() + '年' + pad(t.getMonth() + 1) + '月.csv'; downloadFile(fn, '\uFEFF' + csv, 'text/csv;charset=utf-8'); showToast("📤 报表已开始下载"); }
function shareMonthReport() { var r = getMonthRange(), res = buildReport(r); if (!res) { showToast("本月暂无打卡记录可分享", true); return; } if (navigator.share) navigator.share({ title: '工时报表', text: res.text }).then(function () { showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') fallbackCopyText(res.text); }); else fallbackCopyText(res.text); }
function fallbackCopyText(txt) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("📋 报表内容已复制到剪贴板"); }).catch(function () { textareaFallback(txt); }); else textareaFallback(txt); }
function textareaFallback(txt) { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showToast("📋 报表内容已复制到剪贴板"); } catch (e) { showToast("❌ 复制失败，请手动导出 CSV", true); } document.body.removeChild(ta); }

/* ============ 初始化 ============ */
els.shiftSelect.value = currentShiftType;
ensureToast(); /* 确保 toast 容器就绪（HTML 中已预置，此处为兜底） */
if (!storageAvailable && !sessionStorage.getItem('warnedNoStorage')) { showToast("⚠️ 当前以 file:// 打开，数据仅存内存，建议用 http(s) 打开", true); sessionStorage.setItem('warnedNoStorage', '1'); }
var todayTag = document.getElementById('todayTag'); if (todayTag) { todayTag.style.cursor = 'pointer'; todayTag.title = '点击回到今天'; todayTag.addEventListener('click', function () { selectedDate = new Date(); currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() }; var cd = getCurrentData(); currentShiftType = cd.shiftType || currentShiftType; els.shiftSelect.value = currentShiftType; (calDefaultExpanded ? renderCalendar() : renderWeekView()); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; syncChartWithCalView(calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); }); }
updateButtonText(); (calDefaultExpanded ? renderCalendar() : renderWeekView()); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; updateSelectedLabel(); initChart();
renderHistoryStats(); /* 初始化即计算一次，供记录页打开时即时展示 */
loadAboutData();

/* ============ 自动备份提醒 ============ */
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
document.getElementById('openHistoryItem').addEventListener('click', openRecordHistory);
document.getElementById('closeHistoryBtn').addEventListener('click', closeHistory);
document.getElementById('historyQueryBtn').addEventListener('click', renderHistoryList);
document.getElementById('downloadBackupItem').addEventListener('click', downloadBackup);
document.getElementById('copyDataItem').addEventListener('click', copyData);
document.getElementById('importFileItem').addEventListener('click', openImportFromFile);
document.getElementById('openImportItem').addEventListener('click', openImportModal);
document.getElementById('clearDataItem').addEventListener('click', clearAllData);
var exportReportItem = document.getElementById('exportReportItem');
if (exportReportItem) exportReportItem.addEventListener('click', function () { closeSettings(); openReportRangeModal('export'); });
var shareReportItem = document.getElementById('shareReportItem');
if (shareReportItem) shareReportItem.addEventListener('click', function () { closeSettings(); openReportRangeModal('share'); });
var openAboutItem = document.getElementById('openAboutItem');
if (openAboutItem) openAboutItem.addEventListener('click', openAbout);
var calSwitch = document.getElementById('calDefaultSwitch');
function refreshCalDefaultSwitch() { if (!calSwitch) return; calSwitch.classList.toggle('on', !!calDefaultExpanded); calSwitch.setAttribute('aria-checked', calDefaultExpanded ? 'true' : 'false'); }
function syncChartWithCalView(expanded) {
    if (!chartState || chartState.range === 'custom') return;
    var target = expanded ? 'month' : 'week';
    if (chartState.range !== target) setChartRange(target);
}
function toggleCalDefault() { calDefaultExpanded = !calDefaultExpanded; saveCalDefaultExpanded(calDefaultExpanded); refreshCalDefaultSwitch(); document.getElementById('collapseCal').innerText = calDefaultExpanded ? '▽' : '△'; (calDefaultExpanded ? renderCalendar() : renderWeekView()); syncChartWithCalView(calDefaultExpanded); showToast(calDefaultExpanded ? '✅ 月历已展开为月视图' : '✅ 月历已折叠为周视图'); }
if (calSwitch) { calSwitch.addEventListener('click', toggleCalDefault); calSwitch.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCalDefault(); } }); }
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
document.getElementById('makeupModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeMakeupModal(); });
document.getElementById('settingsModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeSettings(); });
document.getElementById('historyModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeHistory(); });
document.getElementById('reportRangeModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeReportRangeModal(); });
document.querySelectorAll('.rpt-option').forEach(function (opt) { opt.addEventListener('click', function () { document.querySelectorAll('.rpt-option').forEach(function (o) { o.classList.remove('selected'); }); opt.classList.add('selected'); document.getElementById('rptRangeCustom').style.display = opt.dataset.val === 'custom' ? 'flex' : 'none'; }); });
document.getElementById('rptRangeCancel').addEventListener('click', closeReportRangeModal);
document.getElementById('rptRangeCancel2').addEventListener('click', closeReportRangeModal);
document.getElementById('rptRangeConfirm').addEventListener('click', function () {
    var m = document.getElementById('reportRangeModal'), mode = m.dataset.mode, op = document.querySelector('.rpt-option.selected').dataset.val, range = getReportRange(op); if (!range) return; closeReportRangeModal();
    var res = buildReport(range); if (!res) { showToast("该范围内暂无打卡记录", true); return; }
    if (mode === 'export') { var csv = res.rows.map(function (r2) { return r2.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'), fn = '工时报表_' + range.label + '.csv'; downloadFile(fn, '\uFEFF' + csv, 'text/csv;charset=utf-8'); showToast("📤 报表已开始下载"); }
    else { if (navigator.share) navigator.share({ title: '工时报表 ' + range.label, text: res.text }).then(function () { showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') fallbackCopyText(res.text); }); else fallbackCopyText(res.text); }
});
document.getElementById('copyFallbackClose').addEventListener('click', function () { document.getElementById('copyFallbackModal').classList.remove('show'); });
document.getElementById('copyFallbackClose2').addEventListener('click', function () { document.getElementById('copyFallbackModal').classList.remove('show'); });
document.getElementById('copyFallbackRetry').addEventListener('click', function () { var txt = document.getElementById('copyFallbackText').value; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("📋 已复制到剪贴板"); }).catch(function () { showToast("❌ 复制失败，请手动长按复制", true); }); else showToast("❌ 复制失败，请手动长按复制", true); });
document.getElementById('shiftSettingsCancel').addEventListener('click', closeShiftSettings);
document.getElementById('shiftSettingsClose').addEventListener('click', closeShiftSettings);
document.getElementById('shiftSettingsConfirm').addEventListener('click', applyShiftSettings);
document.getElementById('shiftSettingsReset').addEventListener('click', resetShiftSettings);
document.getElementById('shiftSettingsModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeShiftSettings(); });

/* 调试桥接：将关键函数/状态挂到 window，便于排查与单元测试；生产环境无副作用 */
window.renderCalendar = renderCalendar;
window.getLocalDateStr = getLocalDateStr;
window.renderWeekView = renderWeekView;
window.renderHistoryStats = renderHistoryStats;
window.renderHistoryList = renderHistoryList;
window.updateStats = updateStats;
window.drawChart = drawChart;
window.getMonthStats = getMonthStats;
window.getWeekStats = getWeekStats;
window.getStatus = getCurrentStatus;
window.getSelectedDate = function () { return selectedDate; };

}); // end DOMContentLoaded
