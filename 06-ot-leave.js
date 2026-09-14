'use strict';
/*!
 * 工时记录 · 06-ot-leave.js（加班/请假 UI）
 */
(function () {

const { util, state: S, data: D, CONST } = App;
const { OT_NAME, OT_RATE } = CONST;

const LEAVE_NAME = { personal: '事假', sick: '病假', other: '其他', annual: '年休假' };
const padId = (id) => String(id || 0).padStart(20, '0');

/* ============================================================
 * 1. 编辑状态
 * ========================================================== */
let leaveUnit = 'day';
let editingOTId = null;
let editingLeaveId = null;

/* ============================================================
 * 2. 加班列表渲染
 * ========================================================== */
function renderOvertimeList() {
    const box = document.getElementById('otList');
    if (!box) return;
    const range = App.stats.statsViewRange();
    const inRange = (o) => util.isValidDateKey(o.date) && o.date >= range.start && o.date <= range.end;
    const totalHours = S.otData.filter(inRange).reduce((s, o) => s + (o.hours || 0), 0);
    const hourEl = document.getElementById('otSectionHour');
    if (hourEl) hourEl.textContent = '(' + util.round2(totalHours).toFixed(2) + ' h)';
    const rows = S.otData.filter(inRange).sort((a, b) => (b.date + padId(b.id)).localeCompare(a.date + padId(a.id)));
    if (!rows.length) {
        box.innerHTML = '<div class="record-empty">' + util.esc(range.start) + ' ~ ' + util.esc(range.end) + ' 期间，暂无加班记录</div>';
        return;
    }
    box.textContent = '';
    const frag = document.createDocumentFragment();
    rows.forEach((o) => {
        const item = document.createElement('div');
        item.className = 'record-item';
        item.dataset.id = o.id;
        item.innerHTML =
            '<div class="record-item-left"><span class="record-dot" style="background:' + util.rateColor(o.type) + '"></span>' +
            '<div><div class="record-title">' + util.esc(OT_NAME[o.type] || o.type) + '</div>' +
            '<div class="record-sub">' + util.esc(o.date) + ' · ' + o.hours.toFixed(2) + 'h</div></div></div>' +
            '<button class="record-del" type="button" data-id="' + o.id + '" title="删除">✕</button>';
        frag.appendChild(item);
    });
    box.appendChild(frag);
}

/* ============================================================
 * 3. 请假列表渲染
 * ========================================================== */
function renderLeaveList() {
    const box = document.getElementById('leaveList');
    if (!box) return;
    const range = App.stats.statsViewRange();
    const inRange = (l) => util.isValidDateKey(l.start) && l.end >= range.start && l.start <= range.end;
    const totalHours = S.leaveData.filter(inRange).reduce((s, l) => s + (l.hours || 0), 0);
    const hourEl = document.getElementById('leaveSectionHour');
    if (hourEl) hourEl.textContent = '(' + util.round2(totalHours).toFixed(2) + ' h)';
    const rows = S.leaveData.filter(inRange).sort((a, b) => (b.start + padId(b.id)).localeCompare(a.start + padId(a.id)));
    if (!rows.length) {
        box.innerHTML = '<div class="record-empty">' + util.esc(range.start) + ' ~ ' + util.esc(range.end) + ' 期间，暂无请假/调休记录</div>';
        return;
    }
    box.textContent = '';
    const frag = document.createDocumentFragment();
    rows.forEach((l) => {
        const item = document.createElement('div');
        item.className = 'record-item';
        item.dataset.id = l.id;
        item.innerHTML =
            '<div class="record-item-left"><span class="record-dot" style="background:var(--warning)"></span>' +
            '<div><div class="record-title">' + util.esc(LEAVE_NAME[l.type] || l.type) + '</div>' +
            '<div class="record-sub">' + util.esc(l.start) + ' ~ ' + util.esc(l.end) + ' · ' + util.esc(l.unit === 'hour' ? '按小时' : '按天') + '</div></div></div>' +
            '<button class="record-del" type="button" data-id="' + l.id + '" title="删除">✕</button>';
        frag.appendChild(item);
    });
    box.appendChild(frag);
}

/* ============================================================
 * 4. 加班编辑器
 * ========================================================== */
function dateKeyToCN(s) {
    const d = util.parseDateKey(s);
    if (!d) return '';
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + weekdays[d.getDay()];
}

function openOvertimeModal(record) {
    editingOTId = record ? record.id : null;
    const fallback = util.toDateKey(new Date());
    const todayStr = util.isValidDateKey(util.toDateKey(S.selected)) ? util.toDateKey(S.selected) : fallback;
    const dateKey = record ? record.date : todayStr;

    const dEl = document.getElementById('otDate');
    if (dEl) {
        dEl.value = util.isValidDateKey(dateKey) ? dateKey : todayStr;
        dEl.onchange = function () {
            const tEl = document.getElementById('otType');
            if (tEl && dEl.value) tEl.value = util.defaultOtType(dEl.value);
            const lb = document.getElementById('otDateLabel');
            if (lb) lb.textContent = dateKeyToCN(dEl.value);
        };
    }
    const label = document.getElementById('otDateLabel');
    if (label) label.textContent = dateKeyToCN(dEl && dEl.value ? dEl.value : dateKey);

    const hEl = document.getElementById('otHours');
    if (hEl) hEl.value = record ? String(record.hours) : '2';

    const tEl = document.getElementById('otType');
    if (tEl) tEl.value = (record && record.type) || util.defaultOtType(dateKey);

    const delBtn = document.getElementById('deleteOvertimeBtn');
    if (delBtn) delBtn.style.display = record ? '' : 'none';

    const titleEl = document.getElementById('overtimeModalTitle');
    if (titleEl) titleEl.textContent = record ? '编辑加班记录' : '加班登记';
    App.ui.openModal('overtimeModal');
}

function submitOvertime() {
    const dEl = document.getElementById('otDate'),
        tEl = document.getElementById('otType'),
        hEl = document.getElementById('otHours');
    if (!tEl || !hEl) return;
    let rawDate = dEl ? dEl.value : '';
    if (!util.isValidDateKey(rawDate)) {
        rawDate = util.isValidDateKey(util.toDateKey(S.selected)) ? util.toDateKey(S.selected) : util.toDateKey(new Date());
    }
    const rec = { date: rawDate, type: tEl.value, hours: parseFloat(hEl.value) };
    if (!util.isValidDateKey(rec.date)) { App.ui.showToast('请选择有效日期！', true); return; }
    if (!(rec.hours > 0)) { App.ui.showToast('请输入有效的加班时长！', true); return; }

    if (editingOTId) {
        const target = S.otData.find((o) => o.id === editingOTId);
        if (target) {
            target.type = rec.type;
            target.hours = util.round2(rec.hours);
            target.date = rec.date;
            App._markOtDirty();
            D.saveOT();
            App.invalidate('otList', 'otSummary', 'salary');
        }
        editingOTId = null;
    } else {
        D.addOvertime(rec);
    }
    App.ui.closeModal('overtimeModal');
    App.ui.showToast('加班登记成功');
}

function deleteOvertimeFromModal() {
    if (!editingOTId) { App.ui.closeModal('overtimeModal'); return; }
    App.ui.confirmDeleteRecord('ot', editingOTId);
    App.ui.closeModal('overtimeModal');
    editingOTId = null;
}

/* ============================================================
 * 5. 请假编辑器
 * ========================================================== */
function openLeaveModal(record) {
    editingLeaveId = record ? record.id : null;
    const todayStr = util.toDateKey(S.selected);
    const s = document.getElementById('leaveStart'),
        e = document.getElementById('leaveEnd'),
        hd = document.getElementById('leaveHourDate');
    if (record) {
        if (s) s.value = record.start || todayStr;
        if (e) e.value = record.end || todayStr;
        if (hd) hd.value = record.start || todayStr;
        leaveUnit = record.unit === 'hour' ? 'hour' : 'day';
    } else {
        if (s && !s.value) s.value = todayStr;
        if (e && !e.value) e.value = todayStr;
        if (hd && !hd.value) hd.value = todayStr;
        leaveUnit = 'day';
    }
    const tEl = document.getElementById('leaveType');
    if (tEl) tEl.value = (record && record.type) || (tEl.value || 'personal');
    util.$$('.leave-unit-opt').forEach((o) => o.classList.toggle('selected', o.dataset.unit === leaveUnit));
    const dayF = document.getElementById('leaveDayFields'),
        hourF = document.getElementById('leaveHourFields');
    if (dayF) dayF.style.display = leaveUnit === 'day' ? 'block' : 'none';
    if (hourF) hourF.style.display = leaveUnit === 'hour' ? 'block' : 'none';
    const delBtn = document.getElementById('deleteLeaveBtn');
    if (delBtn) delBtn.style.display = record ? '' : 'none';
    const titleEl = document.getElementById('leaveModalTitle');
    if (titleEl) titleEl.textContent = record ? '编辑请假记录' : '请假 / 调休登记';
    App.ui.openModal('leaveModal');
}

function submitLeave() {
    const tEl = document.getElementById('leaveType');
    if (!tEl) return;
    const rec = { type: tEl.value, unit: leaveUnit };
    if (rec.unit === 'hour') {
        const hd = document.getElementById('leaveHourDate'),
            hh = document.getElementById('leaveHours');
        rec.start = hd ? hd.value : '';
        rec.end = rec.start;
        rec.hours = parseFloat(hh && hh.value);
    } else {
        const s = document.getElementById('leaveStart'),
            e = document.getElementById('leaveEnd');
        rec.start = s ? s.value : '';
        rec.end = e ? e.value : '';
    }
    const r = D.normalizeLeave(rec);
    if (!r) { App.ui.showToast('请完整填写请假信息！', true); return; }
    if (editingLeaveId) {
        const target = S.leaveData.find((l) => l.id === editingLeaveId);
        if (target) {
            Object.assign(target, r);
            target.id = editingLeaveId;
            App._markOtDirty();
            D.saveLeave();
            App.invalidate('leaveList', 'salary');
        }
        editingLeaveId = null;
    } else {
        D.addLeave(r);
    }
    App.ui.closeModal('leaveModal');
    App.ui.showToast('请假登记成功');
}

function deleteLeaveFromModal() {
    if (!editingLeaveId) { App.ui.closeModal('leaveModal'); return; }
    App.ui.confirmDeleteRecord('leave', editingLeaveId);
    App.ui.closeModal('leaveModal');
    editingLeaveId = null;
}

function setLeaveUnit(unit) {
    leaveUnit = unit;
    util.$$('.leave-unit-opt').forEach((o) => o.classList.toggle('selected', o.dataset.unit === unit));
    const dayF = document.getElementById('leaveDayFields');
    const hourF = document.getElementById('leaveHourFields');
    if (dayF) dayF.style.display = unit === 'day' ? 'block' : 'none';
    if (hourF) hourF.style.display = unit === 'hour' ? 'block' : 'none';
}

/* ============================================================
 * 6. 批量加班
 * ========================================================== */
const batchOt = {
    mode: false,
    selected: new Set()
};

function toggleBatchOtMode() {
    batchOt.mode = !batchOt.mode;
    batchOt.selected.clear();
    var bar = document.getElementById('batchOtBar');
    var btn = document.getElementById('batchOtBtn');
    if (bar) bar.style.display = batchOt.mode ? 'flex' : 'none';
    if (btn) {
        btn.classList.toggle('active', batchOt.mode);
        btn.textContent = batchOt.mode ? '✓ 选择中' : '📋 批量';
    }
    updateBatchOtCount();
    App.invalidate('calendar');
}

function toggleBatchOtDate(ds) {
    if (batchOt.selected.has(ds)) batchOt.selected.delete(ds);
    else batchOt.selected.add(ds);
    updateBatchOtCount();
    App.invalidate('calendar');
}

function updateBatchOtCount() {
    var el = document.getElementById('batchOtCount');
    if (el) el.textContent = batchOt.selected.size;
}

function submitBatchOt() {
    if (!batchOt.selected.size) { App.ui.showToast('请先在日历上勾选日期', true); return; }
    var tEl = document.getElementById('batchOtType');
    var hEl = document.getElementById('batchOtHours');
    if (!tEl || !hEl) return;
    var type = tEl.value;
    var hours = parseFloat(hEl.value);
    if (!(hours > 0)) { App.ui.showToast('请输入有效的加班时长', true); return; }
    var count = 0;
    batchOt.selected.forEach(function(ds) {
        if (!util.isValidDateKey(ds)) return;
        D.addOvertime({ date: ds, type: type, hours: util.round2(hours) });
        count++;
    });
    App.ui.showToast('已批量登记 ' + count + ' 天加班');
    toggleBatchOtMode();
    App.invalidate('otList', 'otSummary', 'salary', 'calendar');
}

function cancelBatchOt() {
    if (batchOt.mode) toggleBatchOtMode();
}

/* ============================================================
 * 7. 节假日管理（数据层已有，UI 预留扩展）
 * ========================================================== */
// 节假日数据通过 S.holidayDates 访问，保存调用 D.saveHolidayDates()

/* ============================================================
 * 8. 注册渲染函数
 * ========================================================== */
App.registerRender('otList', renderOvertimeList);
App.registerRender('leaveList', renderLeaveList);

/* ============================================================
 * 9. 导出到 App 命名空间
 * ========================================================== */
App.batchOt = batchOt;

App.otLeave = {
    renderOvertimeList: renderOvertimeList,
    renderLeaveList: renderLeaveList,
    openOvertimeModal: openOvertimeModal,
    submitOvertime: submitOvertime,
    deleteOvertimeFromModal: deleteOvertimeFromModal,
    openLeaveModal: openLeaveModal,
    submitLeave: submitLeave,
    deleteLeaveFromModal: deleteLeaveFromModal,
    setLeaveUnit: setLeaveUnit,
    dateKeyToCN: dateKeyToCN,
    toggleBatchOtMode: toggleBatchOtMode,
    toggleBatchOtDate: toggleBatchOtDate,
    updateBatchOtCount: updateBatchOtCount,
    submitBatchOt: submitBatchOt,
    cancelBatchOt: cancelBatchOt,
    LEAVE_NAME: LEAVE_NAME
};

})();
