'use strict';
/*!
 * 工时记录 · 04-calendar.js（日历渲染与交互）
 */
(function () {

const { util, state: S, shifts, data: D, CONST } = App;
const { PUNCH_KEYS, PUNCH_COLOR_CLASS, KEY } = CONST;
const { $ } = util;

/* ============================================================
 * 1. 日历渲染
 * ========================================================== */
function buildDayCell(date, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    var ds = util.toDateKey(date), rec = D.getRecord(ds), n = D.punchCount(rec);
    div.className = 'cal-date';
    div.dataset.date = ds;
    if (opts.dim) div.classList.add('dim');
    if (n === 4) div.classList.add('cal-done');
    else if (n > 0) div.classList.add('cal-partial');
    if (n > 0) div.classList.add('has-record');
    if (util.isSameDay(date, S.selected)) div.classList.add('selected');
    if (util.isSameDay(date, new Date())) div.classList.add('today');
    if (App.batchOt && App.batchOt.mode && App.batchOt.selected.has(ds)) {
        div.classList.add('batch-selected');
    }
    div.textContent = date.getDate();
    if (D.hasOvertimeOnDay(ds)) {
        var badge = document.createElement('span');
        badge.className = 'cal-ot-badge';
        badge.textContent = '+';
        div.appendChild(badge);
        div.classList.add('has-overtime');
    }
    /* 排班颜色标记：用背景色区分班次，不占用日期角标位置 */
    var sch = App.schedule && App.schedule.dayScheduleBadge && App.schedule.dayScheduleBadge(ds);
    if (sch) {
        div.classList.add('has-schedule', 'sch-day-' + sch.cls);
    } else if (S.schedule && S.schedule.enabled && App.schedule && App.schedule.isRestDay && App.schedule.isRestDay(ds)) {
        div.classList.add('sch-day-rest');
    }
    return div;
}

function renderCalendarView() {
    const grid = App.els.calGrid;
    if (!grid) return;
    let cells;
    if (S.calExpanded) {
        const y = S.view.y, m = S.view.m;
        if (App.els.calTitle) App.els.calTitle.textContent = y + '年 ' + util.pad2(m + 1) + '月';
        const first = new Date(y, m, 1), lead = (first.getDay() || 7) - 1;
        const total = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7) * 7;
        cells = [];
        for (let i = 0; i < total; i++) {
            const d = new Date(y, m, i - lead + 1);
            cells.push(buildDayCell(d, { dim: d.getMonth() !== m }));
        }
    } else {
        const w = util.weekRange(S.selected);
        if (App.els.calTitle) {
            App.els.calTitle.textContent = (w.mon.getMonth() + 1) + '月' + w.mon.getDate() + '日 - ' +
                (w.sun.getMonth() + 1) + '月' + w.sun.getDate() + '日';
        }
        cells = [];
        util.eachDay(w.mon, w.sun, (d) => cells.push(buildDayCell(d)));
    }
    const frag = document.createDocumentFragment();
    cells.forEach((c) => frag.appendChild(c));
    grid.textContent = '';
    grid.appendChild(frag);
    if (App.els.collapseCal) App.els.collapseCal.textContent = S.calExpanded ? '▽' : '△';
}

/* ============================================================
 * 2. 选中日期 / 打卡区渲染
 * ========================================================== */
function renderSelected() {
    const d = S.selected, cfg = D.getShift();
    if (App.els.selDateText) App.els.selDateText.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (App.els.shiftText) App.els.shiftText.textContent = '排班时段: ' + cfg.text;
    if (App.els.shiftSelect && App.els.shiftSelect.value !== S.shiftType) App.els.shiftSelect.value = S.shiftType;
    // 排班关联：在时段文案前标注「排班」来源
    renderScheduleBanner();
    renderShiftBadge();
}

/* 渲染选中日排休横幅（scheduleBanner 渲染区） */
function renderScheduleBanner() {
    var box = document.getElementById('scheduleBanner');
    if (!box) return;
    if (!S.schedule || !S.schedule.enabled || !App.schedule) { box.style.display = 'none'; return; }
    var key = util.toDateKey(S.selected);
    var shift = App.schedule.getCycleShift(key);
    if (!shift) { box.style.display = 'none'; return; }
    var meta = App.schedule.SHIFT_META[shift];
    if (shift === 'rest') {
        box.style.display = 'flex';
        box.className = 'schedule-banner schedule-banner-rest';
        box.innerHTML = '<span class="sb-icon">🛋️</span>' +
            '<span class="sb-text">当日排班为「排休」，如临时加班或出勤依然可直接点击下方打卡或记加班</span>';
    } else {
        box.style.display = 'flex';
        box.className = 'schedule-banner schedule-banner-shift';
        box.innerHTML = '<span class="sb-icon">' + (meta ? meta.icon : '☀️') + '</span>' +
            '<span class="sb-text">当日排班：<b>' + (meta ? meta.name : shift) +
            '</b>，班别已自动对齐，可直接打卡</span>';
    }
}

/* 给班别胶囊按钮右上角加「排班」角标（选中日为排班可打卡班次时显示） */
function renderShiftBadge() {
    var cap = document.getElementById('shiftSelectCapsule');
    if (!cap) return;
    var key = util.toDateKey(S.selected);
    var shift = App.schedule && App.schedule.getCycleShift ? App.schedule.getCycleShift(key) : null;
    var old = cap.querySelector('.shift-badge-schedule');
    if (old) old.remove();
    if (shift && shift !== 'rest' && S.schedule && S.schedule.enabled) {
        var b = document.createElement('span');
        b.className = 'shift-badge-schedule';
        b.textContent = '排班';
        cap.appendChild(b);
    }
}

function setDetailRow(key, val, label) {
    const box = App.els.todayDetail;
    if (!box) return;
    let row = box.querySelector('.detail-row[data-key="' + key + '"]');
    if (!row) {
        row = document.createElement('div');
        row.className = 'detail-row';
        row.dataset.key = key;
        row.innerHTML =
            '<span class="detail-dot"></span>' +
            '<span class="detail-label"></span>' +
            '<span class="detail-value">--:--:--</span>' +
            '<span class="detail-actions">' +
                '<button class="detail-makeup" type="button">补记</button>' +
                '<button class="detail-del" type="button" title="删除该次打卡" aria-label="删除">🗑️</button>' +
            '</span>';
        box.appendChild(row);
    }
    const lb = row.querySelector('.detail-label');
    if (lb && label) lb.textContent = label;
    const v = row.querySelector('.detail-value');
    if (v) v.textContent = val || '未打卡';
    row.classList.toggle('has', !!val);
}

function renderTodayStats() {
    const rec = D.currentRecord(), st = D.currentStatus(), cfg = D.getShift();
    const idx = D.nextSlot(rec);
    if (App.els.totalHours) App.els.totalHours.textContent = D.dayHours(rec).toFixed(2);
    if (App.els.punchCount) App.els.punchCount.textContent = idx + ' / 4';
    if (App.els.shiftBar) App.els.shiftBar.className = idx === 4 ? 'shift-bar done' : 'shift-bar';
    if (App.els.btnText) App.els.btnText.textContent = idx < 4 ? cfg.steps[idx] : '已完成';
    /* 用 CSS 类控制按钮颜色（可跟随深色模式），避免内联 style 覆盖主题 */
    if (App.els.punchBtn) {
        PUNCH_COLOR_CLASS.forEach((c) => App.els.punchBtn.classList.remove(c));
        App.els.punchBtn.classList.add(PUNCH_COLOR_CLASS[idx] || PUNCH_COLOR_CLASS[4]);
        App.els.punchBtn.disabled = idx >= 4;
    }
    const frag = document.createDocumentFragment();
    PUNCH_KEYS.forEach((k, i) => {
        setDetailRow(k, st[k], cfg.steps[i]);
        const row = App.els.todayDetail.querySelector('.detail-row[data-key="' + k + '"]');
        if (row) frag.appendChild(row);
    });
    if (App.els.todayDetail) App.els.todayDetail.appendChild(frag);
}

function toggleTodayDetails(e) {
    if (e && e.target && e.target.closest && e.target.closest('#todayDetail')) return;
    const d = App.els.todayDetail, ic = App.els.expandIcon;
    if (!d) return;
    const open = d.style.display === 'none';
    d.style.display = open ? 'block' : 'none';
    if (ic) ic.textContent = open ? '△' : '▽';
}

/* ============================================================
 * 3. 日期操作
 * ========================================================== */
function selectDate(d) {
    if (!d) return;
    S.selected = util.startOfDay(d);
    S.view.y = S.selected.getFullYear();
    S.view.m = S.selected.getMonth();
    const rec = D.currentRecord();
    S.shiftType = rec ? D.normalizeShiftType(rec.shiftType) : S.shiftType;
    // 排班自动关联：切换到排班班次（休息日不强制，由 apply 内部判断）
    if (App.schedule && App.schedule.applyScheduleToSelected) App.schedule.applyScheduleToSelected();
    App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart', 'scheduleBanner');
}

function gotoToday() {
    const t = util.today();
    S.selected = t;
    S.view.y = t.getFullYear();
    S.view.m = t.getMonth();
    const rec = D.currentRecord();
    if (rec) S.shiftType = D.normalizeShiftType(rec.shiftType);
    if (App.schedule && App.schedule.applyScheduleToSelected) App.schedule.applyScheduleToSelected();
    App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart', 'scheduleBanner');
}

function changeMonth(offset) {
    const m = S.view.m + offset;
    const d = new Date(S.view.y, m, 1);
    S.view.y = d.getFullYear();
    S.view.m = d.getMonth();
    App.invalidate('calendar', 'tabStats');
}

function changeWeek(offset) {
    const mon = util.addDays(util.weekRange(S.selected).mon, offset * 7);
    S.selected = mon;
    S.view.y = mon.getFullYear();
    S.view.m = mon.getMonth();
    App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'chart');
}

function setCalView(expanded, persist) {
    S.calExpanded = !!expanded;
    if (persist) App.store.write(KEY.calExpanded, S.calExpanded ? '1' : '0');
    if (!expanded) {
        const w = util.weekRange(S.selected);
        if (S.selected < w.mon || S.selected > w.sun) S.selected = w.mon;
    }
    syncChartWithCalView();
    App.invalidate('calendar', 'selected', 'stats');
}

function syncChartWithCalView() {
    if (S.chart.range === 'custom') return;
    App.stats.setChartRange(S.calExpanded ? 'month' : 'week');
}

/* ============================================================
 * 4. 打卡操作
 * ========================================================== */
function changeShift() {
    if (!App.els.shiftSelect) return;
    S.shiftType = D.normalizeShiftType(App.els.shiftSelect.value);
    App.store.write(KEY.shiftType, S.shiftType);
    const rec = D.currentRecord();
    if (rec) { rec.shiftType = S.shiftType; D.markDirty(util.toDateKey(S.selected)); }
    D.saveData();
    App.invalidate('selected', 'stats', 'history', 'scheduleBanner');
}

function commit() {
    D.saveData();
    App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart', 'otSummary');
}

function smartPunch() {
    const btn = App.els.punchBtn;
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    try {
        const now = new Date(), ts = util.toTimeStr(now), hm = ts.slice(0, 5);
        const cfg = D.getShift();
        if (!util.inPeriods(cfg.periods, hm) &&
            !confirm('当前时间(' + hm + ')不在【' + cfg.name + '】排班时段内，是否强制打卡/补卡？')) return;

        let target = S.selected;
        if (S.shiftType === 'night' && now.getHours() < 6 && util.isSameDay(S.selected, now)) {
            target = util.addDays(target, -1);
        }
        const ds = util.toDateKey(target);
        const rec = D.ensureRecord(ds, S.shiftType);
        const slot = D.nextSlot(rec);
        if (slot >= 4) { App.ui.showToast('该日期4次打卡已满，无法增加！', true); return; }
        rec.status[PUNCH_KEYS[slot]] = ts;

        if (!util.isSameDay(target, S.selected)) {
            S.selected = target;
            S.view.y = target.getFullYear();
            S.view.m = target.getMonth();
            S.shiftType = D.normalizeShiftType(rec.shiftType);
        }
        commit();
        if (navigator.vibrate) { try { navigator.vibrate(50); } catch (e) {} }
        App.ui.showToast('✅ 打卡成功');
    } finally {
        btn.style.opacity = '1';
        btn.disabled = false;
        App.invalidate('stats');
    }
}

/* ============================================================
 * 5. 补卡
 * ========================================================== */
function openMakeupModal(d, presetKey) {
    const date = util.startOfDay(d || S.selected);
    const ds = util.toDateKey(date);
    const dateEl = document.getElementById('makeupDate');
    const timeEl = document.getElementById('makeupTime');
    const typeEl = document.getElementById('makeupType');
    if (!dateEl || !timeEl || !typeEl) return;
    dateEl.value = ds;
    timeEl.value = util.toTimeStr(new Date());
    const rec = D.getRecord(ds);
    const cfg = D.getShift(rec ? rec.shiftType : S.shiftType);
    typeEl.textContent = '';
    cfg.steps.forEach((s, i) => {
        const o = document.createElement('option');
        o.value = cfg.keys[i];
        o.textContent = s;
        typeEl.appendChild(o);
    });
    let pick = PUNCH_KEYS.indexOf(presetKey) >= 0 ? presetKey : null;
    if (!pick) {
        const nx = D.nextSlot(D.getRecord(ds));
        pick = PUNCH_KEYS[nx < 4 ? nx : 0];
    }
    typeEl.value = pick;
    App.ui.openModal('makeupModal');
}

function submitMakeup() {
    const dateEl = document.getElementById('makeupDate');
    const typeEl = document.getElementById('makeupType');
    const timeEl = document.getElementById('makeupTime');
    if (!dateEl || !typeEl || !timeEl) return;
    const ds = dateEl.value, key = typeEl.value;
    let tm = (timeEl.value || '').trim();
    if (!util.isValidDateKey(ds)) { App.ui.showToast('请选择有效日期！', true); return; }
    if (!tm) { App.ui.showToast('请填写补卡时间！', true); return; }
    if (util.isValidHM(tm)) tm += ':00';
    if (!util.isValidHMS(tm)) { App.ui.showToast('时间格式应为 HH:MM(:SS)', true); return; }
    if (PUNCH_KEYS.indexOf(key) < 0) { App.ui.showToast('请选择打卡类型！', true); return; }

    const rec = D.ensureRecord(ds, S.shiftType);
    rec.status[key] = tm;
    const d = util.parseDateKey(ds);
    S.selected = d;
    S.view.y = d.getFullYear();
    S.view.m = d.getMonth();
    S.shiftType = D.normalizeShiftType(rec.shiftType);
    commit();
    App.ui.closeModal('makeupModal');
    App.ui.showToast('补卡成功（' + ds + ' ' + key + ': ' + tm + '）');
}

/* ============================================================
 * 6. 删除打卡时间
 * ========================================================== */
function deleteTodayTime(key) {
    if (PUNCH_KEYS.indexOf(key) < 0) return;
    const ds = util.toDateKey(S.selected), rec = D.getRecord(ds);
    if (!rec || !rec.status[key]) return;
    const cfg = D.getShift(rec.shiftType);
    const idx = PUNCH_KEYS.indexOf(key);
    const label = (cfg.steps[idx] || key) + ' · ' + rec.status[key];
    const msgEl = document.getElementById('confirmMsg');
    if (msgEl) msgEl.textContent = '确定删除「' + label + '」吗？删除后不可恢复。';
    App.ui.pendingDelete = { key: key, ds: ds };
    App.ui.openModal('confirmModal');
}

function executePunchDelete(p) {
    const rec = D.getRecord(p.ds);
    if (rec && rec.status[p.key]) {
        rec.status[p.key] = null;
        if (D.punchCount(rec) === 0) D.removeRecord(p.ds);
        else { D.markDirty(p.ds); commit(); }
        return true;
    }
    return false;
}

/* ============================================================
 * 7. 注册渲染函数
 * ========================================================== */
App.registerRender('calendar', renderCalendarView);
App.registerRender('selected', renderSelected);
App.registerRender('stats', renderTodayStats);
App.registerRender('scheduleBanner', renderScheduleBanner);

/* ============================================================
 * 8. 导出到 App 命名空间
 * ========================================================== */
App.calendar = {
    renderCalendarView: renderCalendarView,
    renderSelected: renderSelected,
    renderTodayStats: renderTodayStats,
    buildDayCell: buildDayCell,
    setDetailRow: setDetailRow,
    toggleTodayDetails: toggleTodayDetails,
    selectDate: selectDate,
    gotoToday: gotoToday,
    changeMonth: changeMonth,
    changeWeek: changeWeek,
    setCalView: setCalView,
    syncChartWithCalView: syncChartWithCalView,
    changeShift: changeShift,
    smartPunch: smartPunch,
    commit: commit,
    openMakeupModal: openMakeupModal,
    submitMakeup: submitMakeup,
    deleteTodayTime: deleteTodayTime,
    executePunchDelete: executePunchDelete
};

})();
