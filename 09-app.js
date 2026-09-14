'use strict';
/*!
 * 工时记录 · 09-app.js（事件绑定 + 初始化 + 启动入口）
 */
(function () {

const { util, state: S, store, db, data: D, CONST, calendar: Cal, stats: St,
        otLeave: OL, salaryUI: SalUI, ui: UI } = App;
const { $, $$, on: _onStub } = util;

/* ============================================================
 * 1. DOM 元素缓存
 * ========================================================== */
App.els = {};

function cacheEls() {
    Object.assign(App.els, {
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

/* ============================================================
 * 2. 事件绑定辅助
 * ========================================================== */
function on(target, ev, fn, opt) {
    if (!target) { console.warn('[bind] 元素不存在，跳过：' + ev); return; }
    target.addEventListener(ev, fn, opt);
}
const onId = (id, ev, fn, opt) => on(document.getElementById(id), ev, fn, opt);

/* ============================================================
 * 3. Tab 切换
 * ========================================================== */
function initTabbar() {
    const items = $$('.tabbar-item');
    const panels = {
        tabPunch: document.getElementById('tabPunch'),
        tabStats: document.getElementById('tabStats'),
        tabSalary: document.getElementById('tabSalary')
    };
    function activate(name) {
        items.forEach((it) => it.classList.toggle('active', it.getAttribute('data-tab') === name));
        Object.keys(panels).forEach((k) => {
            if (panels[k]) panels[k].classList.toggle('active', k === name);
        });
        if (name === 'tabStats') {
            St.ensureHistoryRange();
            App.invalidate('tabStats', 'history', 'chart', 'otList', 'leaveList');
        } else if (name === 'tabSalary') {
            SalUI.renderSalaryMonth();
            if (SalUI.payslipActive) SalUI.renderPayslip();
            App.invalidate('salary');
        } else {
            App.invalidate('stats');
        }
    }
    items.forEach((it) => on(it, 'click', () => activate(it.getAttribute('data-tab'))));
    activate('tabPunch');
}

/* ============================================================
 * 4. 时钟
 * ========================================================== */
let clockTimer = 0;
function tickClock() {
    if (App.els.clock) App.els.clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}
function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 1000); }
function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; } }

/* ============================================================
 * 5. 事件绑定
 * ========================================================== */
function bindEvents() {
    /* ---- 日历：事件委托 ---- */
    const grid = App.els.calGrid;
    if (grid) {
        grid.addEventListener('click', (e) => {
            var cell = e.target.closest ? e.target.closest('.cal-date') : null;
            if (!cell || !cell.dataset.date) return;
            if (App.batchOt && App.batchOt.mode) {
                OL.toggleBatchOtDate(cell.dataset.date);
            } else {
                Cal.selectDate(util.parseDateKey(cell.dataset.date));
            }
        });
    }

    /* ---- 日历导航 / 视图 ---- */
    on(App.els.collapseCal, 'click', () => Cal.setCalView(!S.calExpanded, false));
    onId('prevMonth', 'click', () => (S.calExpanded ? Cal.changeMonth(-1) : Cal.changeWeek(-1)));
    onId('nextMonth', 'click', () => (S.calExpanded ? Cal.changeMonth(1) : Cal.changeWeek(1)));

    /* ---- 打卡区 ---- */
    on(App.els.shiftSelect, 'change', Cal.changeShift);
    on(App.els.punchBtn, 'click', Cal.smartPunch);
    on(App.els.todayStatsCard, 'click', Cal.toggleTodayDetails);
    on(App.els.todayDetail, 'click', (e) => {
        const makeupBtn = e.target.closest ? e.target.closest('.detail-makeup') : null;
        const delBtn = e.target.closest ? e.target.closest('.detail-del') : null;
        const row = (makeupBtn || delBtn) && (makeupBtn || delBtn).closest('.detail-row');
        if (!row || !row.dataset.key) return;
        e.stopPropagation();
        if (makeupBtn) { Cal.openMakeupModal(S.selected, row.dataset.key); return; }
        if (delBtn) Cal.deleteTodayTime(row.dataset.key);
    });

    /* ---- 补卡：仅一次绑定，避免重复回调 ---- */
    onId('cancelMakeup', 'click', UI.closeMakeupModal);
    onId('cancelMakeup2', 'click', UI.closeMakeupModal);
    onId('confirmMakeup', 'click', Cal.submitMakeup);

    /* ---- 删除确认弹窗 ---- */
    onId('confirmDeleteBtn', 'click', UI.doConfirmedDelete);
    onId('cancelDeleteBtn', 'click', UI.closeConfirmModal);

    /* ---- 设置 ---- */
    [['openSettingsBtn', UI.openSettings], ['closeSettingsBtn', UI.closeSettings], ['closeSettingsBtn2', UI.closeSettings],
     ['openShiftSettingsItem', UI.openShiftSettings], ['openScheduleItem', UI.openScheduleSettings], ['downloadBackupItem', UI.downloadBackup],
     ['copyDataItem', UI.copyData], ['importFileItem', UI.openImportFromFile], ['openImportItem', UI.openImportModal],
     ['clearDataItem', UI.clearAllData], ['openAboutItem', UI.openAbout], ['targetSettingItem', UI.promptTargetHours]
    ].forEach((p) => onId(p[0], 'click', p[1]));

    /* ---- 清空数据密码验证弹窗 ---- */
    onId('clearPwdClose', 'click', () => UI.closeModal('clearPasswordModal'));
    onId('clearPwdCancel', 'click', () => UI.closeModal('clearPasswordModal'));
    onId('clearPwdConfirm', 'click', UI.executeClearAllData);
    const clearPwdInput = document.getElementById('clearPwdInput');
    on(clearPwdInput, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); UI.executeClearAllData(); } });

    onId('fileSyncItem', 'click', () => {
        if (!UI.fileSync.supported) {
            UI.showToast('❌ 当前浏览器不支持本地文件同步，请用「下载备份文件」', true);
            return;
        }
        if (!UI.fileSync.linked) { UI.fileSync.link(); return; }
        if (UI.fileSync.status !== 'linked') { UI.fileSync.reconnect(); return; }
        if (confirm('本地文件自动同步已开启\n文件：' + UI.fileSync.fileName + '\n\n' +
            '【确定】立即同步一次\n【取消】关闭自动同步')) {
            UI.fileSync.writeNow().then((ok) => UI.showToast(ok ? '✅ 已同步到文件' : '❌ 同步失败', !ok));
        } else {
            UI.fileSync.unlink();
        }
    });

    const calSwitch = document.getElementById('calDefaultSwitch');
    on(calSwitch, 'click', UI.toggleCalDefault);
    on(calSwitch, 'keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); UI.toggleCalDefault(); }
    });

    /* ---- 班别设置弹窗 ---- */
    onId('shiftSettingsCancel', 'click', UI.closeShiftSettings);
    onId('shiftSettingsClose', 'click', UI.closeShiftSettings);
    onId('shiftSettingsConfirm', 'click', UI.applyShiftSettings);
    onId('shiftSettingsReset', 'click', UI.resetShiftSettingsAction);

    /* ---- 排班周期规则配置 ---- */
    onId('scheduleClose', 'click', UI.closeScheduleSettings);
    onId('scheduleCancel', 'click', UI.closeScheduleSettings);
    onId('scheduleConfirm', 'click', UI.applyScheduleSettings);
    onId('scheduleReset', 'click', UI.resetScheduleSettings);
    onId('scheduleAddDay', 'click', () => {
        App.schedule.cycleAddDay();
        UI.renderScheduleCycle();
        UI.renderSchedulePreview();
        UI.refreshScheduleStatusTag();
    });
    const schSwitch = document.getElementById('scheduleEnableSwitch');
    on(schSwitch, 'click', UI.toggleScheduleEnable);
    on(schSwitch, 'keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); UI.toggleScheduleEnable(); } });
    UI.bindScheduleBaseDate();
    UI.bindScheduleRangeInputs();

    /* ---- 关于 ---- */
    onId('closeAboutBtn', 'click', UI.closeAbout);
    onId('closeAboutBtn2', 'click', UI.closeAbout);
    onId('checkUpdateBtn', 'click', UI.checkForUpdates);
    onId('clearCacheItem', 'click', UI.clearCacheAndReload);

    /* ---- 复制兜底 ---- */
    onId('copyFallbackClose', 'click', UI.closeCopyFallback);
    onId('copyFallbackClose2', 'click', UI.closeCopyFallback);
    onId('copyFallbackRetry', 'click', () => {
        const ta = document.getElementById('copyFallbackText');
        if (!ta) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value)
                .then(() => UI.showToast('📋 已复制到剪贴板'))
                .catch(() => UI.showToast('❌ 复制失败，请手动长按复制', true));
        } else UI.showToast('❌ 复制失败，请手动长按复制', true);
    });

    /* ---- 工时记录：查询 ---- */
    onId('historyQueryBtn', 'click', () => { St.ensureHistoryRange(); App.invalidate('history'); });

    /* ---- 图表 ---- */
    on(App.els.chartCanvas, 'click', St.showChartTooltip);
    on(App.els.chartCanvas, 'touchstart', St.showChartTooltip, { passive: true });
    onId('chartToggle', 'click', St.toggleChartType);
    onId('chartExport', 'click', St.exportChartPNG);
    onId('chartExport', 'contextmenu', (e) => { e.preventDefault(); St.shareChartImage(); });
    onId('chartCustomApply', 'click', St.applyCustomRange);
    $$('.chart-range-opt').forEach((opt) => on(opt, 'click', () => St.setChartRange(opt.dataset.val)));

    /* ---- 遮罩点击关闭（通用） ---- */
    on(document, 'click', (e) => {
        const mask = e.target.closest && e.target.closest('.modal-mask');
        if (!mask || !mask.classList.contains('show')) return;
        if (e.target !== mask) return;
        if (mask.id === 'confirmModal') { UI.closeConfirmModal(); return; }
        UI.closeModal(mask.id);
    });

    on(window, 'resize', util.debounce(() => App.invalidate('chart'), 200));

    /* ---- 加班登记 ---- */
    onId('openOvertimeBtn', 'click', OL.openOvertimeModal);
    /* ---- 批量加班 ---- */
    onId('batchOtBtn', 'click', OL.toggleBatchOtMode);
    onId('batchOtCancel', 'click', OL.cancelBatchOt);
    onId('batchOtConfirm', 'click', OL.submitBatchOt);

    St.bindCollapse('historyHeader', 'historyBody', 'historySection');
    St.bindCollapse('otHeader', 'otBody', 'overtimeSection');
    St.bindCollapse('leaveHeader', 'leaveBody', 'leaveSection');
    onId('closeOvertimeBtn', 'click', () => UI.closeModal('overtimeModal'));
    onId('cancelOvertimeBtn', 'click', () => UI.closeModal('overtimeModal'));
    onId('confirmOvertimeBtn', 'click', OL.submitOvertime);

    /* 统计页月份切换 */
    if (!S.statsView) S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() };
    St.renderStatsMonthTitle();
    onId('statsPrevMonth', 'click', () => St.changeStatsMonth(-1));
    onId('statsNextMonth', 'click', () => St.changeStatsMonth(1));

    /* ---- 请假/调休登记 ---- */
    onId('openLeaveBtn', 'click', OL.openLeaveModal);
    onId('deleteOvertimeBtn', 'click', OL.deleteOvertimeFromModal);
    onId('closeLeaveBtn', 'click', () => UI.closeModal('leaveModal'));
    onId('cancelLeaveBtn', 'click', () => UI.closeModal('leaveModal'));
    onId('confirmLeaveBtn', 'click', OL.submitLeave);
    onId('deleteLeaveBtn', 'click', OL.deleteLeaveFromModal);

    $$('.leave-unit-opt').forEach((opt) => on(opt, 'click', () => {
        OL.setLeaveUnit(opt.dataset.unit);
    }));

    /* ---- 加班列表：删除（✕）→ 二次确认；行点击 → 编辑 ---- */
    on(document.getElementById('otList'), 'click', (e) => {
        const del = e.target.closest && e.target.closest('.record-del');
        if (del) { UI.confirmDeleteRecord('ot', +del.dataset.id); return; }
        const row = e.target.closest && e.target.closest('.record-item');
        if (!row) return;
        const rec = S.otData.find((o) => o.id === +row.dataset.id);
        if (rec) OL.openOvertimeModal(rec);
    });
    /* ---- 请假列表：同上 ---- */
    on(document.getElementById('leaveList'), 'click', (e) => {
        const del = e.target.closest && e.target.closest('.record-del');
        if (del) { UI.confirmDeleteRecord('leave', +del.dataset.id); return; }
        const row = e.target.closest && e.target.closest('.record-item');
        if (!row) return;
        const rec = S.leaveData.find((l) => l.id === +row.dataset.id);
        if (rec) OL.openLeaveModal(rec);
    });

    /* ---- 工资 ---- */
    onId('salarySettingsBtn', 'click', SalUI.openSalarySettings);
    onId('closeSalarySettingsBtn', 'click', () => UI.closeModal('salarySettingsModal'));
    onId('cancelSalarySettingsBtn', 'click', () => UI.closeModal('salarySettingsModal'));
    onId('confirmSalarySettingsBtn', 'click', SalUI.applySalarySettings);
    onId('salaryExpandBtn', 'click', SalUI.toggleSalaryDetail);
    /* ---- 工资条 ---- */
    onId('salaryPayslipBtn', 'click', () => SalUI.togglePayslip(true));
    onId('payslipBackBtn', 'click', () => SalUI.togglePayslip(false));
    onId('payslipPrevYear', 'click', () => { SalUI.changePayslipYear(-1); });
    onId('payslipNextYear', 'click', () => { SalUI.changePayslipYear(1); });
    onId('payslipBonusSave', 'click', SalUI.savePayslipBonus);
    onId('closePayslipMonth', 'click', () => UI.closeModal('payslipMonthModal'));
    onId('cancelPayslipMonth', 'click', () => UI.closeModal('payslipMonthModal'));
    onId('confirmPayslipMonth', 'click', SalUI.savePayslipMonth);
    on(document.getElementById('payslipGrid'), 'click', (e) => {
        var card = e.target.closest && e.target.closest('.payslip-month-card');
        if (card) SalUI.openPayslipMonthModal(parseInt(card.dataset.month));
    });

    on(document.getElementById('salSubsidyEditor'), 'click', (e) => {
        const del = e.target.closest && e.target.closest('.sub-del');
        if (!del) return;
        const i = +del.dataset.i;
        SalUI.removeSubsidy(i);
    });
    onId('addSubsidyRow', 'click', () => {
        SalUI.addSubsidyRow();
    });
    /* ---- 扣款编辑器 ---- */
    on(document.getElementById('salDeductEditor'), 'click', (e) => {
        const del = e.target.closest && e.target.closest('.ded-del');
        if (!del) return;
        const i = +del.dataset.i;
        SalUI.removeDeduct(i);
    });
    onId('addDeductRow', 'click', () => {
        SalUI.addDeductRow();
    });

    [['overtimeModal', () => UI.closeModal('overtimeModal')],
     ['leaveModal', () => UI.closeModal('leaveModal')],
     ['salarySettingsModal', () => UI.closeModal('salarySettingsModal')],
     ['payslipMonthModal', () => UI.closeModal('payslipMonthModal')]
    ].forEach((p) => onId(p[0], 'click', (e) => { if (e.target === e.currentTarget) p[1](); }));

    App.invalidate('salary');
}

/* ============================================================
 * 6. 初始化
 * ========================================================== */
function init() {
    cacheEls();
    bindEvents();
    // 排班模块初始化（需在 App.state 挂载后、日历渲染前执行）
    if (App.schedule && App.schedule.init) App.schedule.init();
    St.initChartControls();
    startClock();

    if (App.els.todayDetail) App.els.todayDetail.style.display = 'block';
    if (App.els.expandIcon) App.els.expandIcon.textContent = '△';

    if (!store.available) UI.showToast('⚠️ 当前以 file:// 打开，数据仅存内存，建议用 http(s) 打开', true);

    Cal.setCalView(S.calExpanded, false);
    initTabbar();
    St.watchChartResize();
    App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart', 'otList', 'leaveList', 'salary');
    UI.loadAboutData();
    UI.refreshDataStatus();

    D.hydrate().then(async (r) => {
        let restored = r.restored;
        try {
            const fromFile = await UI.fileSync.tryRestore();
            if (fromFile && Object.keys(S.data).length > (r.count || 0)) {
                restored = Object.keys(S.data).length;
                UI.showToast('🔄 已从备份文件恢复 ' + restored + ' 条记录');
            }
        } catch (e) {}

        await D.hydrateOtLeave();

        UI.refreshDataStatus();
        App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart', 'otList', 'leaveList', 'salary');
        if (restored > 0) {
            UI.showToast(UI.fileSync.linked
                ? '🔄 已从备份文件恢复 ' + restored + ' 条记录'
                : '🔄 已从本地数据库恢复 ' + restored + ' 条记录');
        }
        UI.autoBackupRemind();
    });
}

/* ============================================================
 * 7. 调试桥接
 * ========================================================== */
try {
    window.__app = {
        get state() { return S; },
        get data() { return S.data; },
        get selectedDate() { return S.selected; },
        setSelectedDate(d) { Cal.selectDate(d); },
        monthStats: D.monthStats,
        weekStats: D.weekStats,
        dayHours: D.dayHours,
        durationHours: util.durationHours,
        toDateKey: util.toDateKey,
        refresh: App.invalidate,
        drawChart: () => App.invalidate('chart'),
        storageMode: () => db.mode,
        storageLabel: () => db.modeLabel,
        backupStatus: UI.backupStatus,
        flush: D.flushData
    };
} catch (e) {}

/* ============================================================
 * 8. 启动
 * ========================================================== */
function boot() {
    try {
        init();
    } catch (e) {
        console.error('[init]', e);
        const msg = '初始化失败：' + (e && e.message ? e.message : e);
        try { UI.showToast('❌ ' + msg, true); } catch (e2) {}
        try {
            App.invalidate('calendar', 'selected', 'stats', 'tabStats', 'history', 'chart', 'otSummary');
        } catch (e3) {}
        try { St.renderOtSummary(); } catch (e4) {}
    }
}

/* 设置 syncHook（文件同步钩子） */
D.setSyncHook(() => UI.fileSync.scheduleWrite());

/* 可见性变化时的时钟与 flush */
on(document, 'visibilitychange', () => {
    if (document.hidden) { stopClock(); D.flushData(); } else startClock();
});
on(window, 'pagehide', () => { D.flushData(); });
on(window, 'beforeunload', () => { D.flushData(); });

/* 启动 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
