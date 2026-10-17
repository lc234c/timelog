'use strict';
/*!
 * 工时记录 · 07-salary.js（工资与工资条 UI）
 */
(function () {

const { util, state: S, data: D, salary: Sal, CONST } = App;
const { DEFAULT_SALARY } = CONST;

/* ============================================================
 * 1. 工资面板渲染
 * ========================================================== */
function renderSalaryMonth() {
    // 工资条标题
    const el = document.getElementById('salaryMonth');
    if (el) {
        const y = S.selected.getFullYear(), m = S.selected.getMonth();
        el.textContent = y + '年' + util.pad2(m + 1) + '月';
    }
    // 月份切换器标题
    var sv = salaryView || { y: S.selected.getFullYear(), m: S.selected.getMonth() };
    var msEl = document.getElementById('salaryMonthTitle');
    if (msEl) msEl.textContent = sv.y + '年 ' + (sv.m + 1) + '月';
}

function changeSalaryMonth(offset) {
    if (!salaryView) salaryView = { y: S.selected.getFullYear(), m: S.selected.getMonth() };
    var d = new Date(salaryView.y, salaryView.m + offset, 1);
    salaryView = { y: d.getFullYear(), m: d.getMonth() };
    renderSalaryMonth();
    renderSalary();
}

function renderSalary() {
    const panel = document.getElementById('tabSalary');
    if (!panel) return;
    var sv = salaryView || { y: S.selected.getFullYear(), m: S.selected.getMonth() };
    const y = sv.y, m = sv.m;
    const start = new Date(y, m, 1), end = new Date(y, m + 1, 0);
    const s = Sal.calcSalary(start, end);
    // 获取该月生效的配置（用于显示来源月份）
    var activeCfg = D.getSalaryConfigForMonth(y, m);
    var cfgMonth = activeCfg.effectiveMonth || D.monthKey(y, m);
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setVal('salNet', s.net.toFixed(2));
    setVal('salHourly', s.hourly.toFixed(2));
    setVal('salWorkDaysLabel', (activeCfg.workDaysPerMonth || 21.75).toFixed(2));
    // 显示配置来源月份
    var cfgSourceEl = document.getElementById('salConfigSource');
    if (cfgSourceEl) cfgSourceEl.textContent = '（按 ' + cfgMonth.replace('-', '年') + '月方案计算）';
    // 收入明细 - 统一列表（底薪、加班费、夜班补贴、自定义补贴）
    const incomeEl = document.getElementById('salIncomeDetail');
    if (incomeEl) {
        var ihtml = '';
        ihtml += '<div class="sal-row"><span>底薪</span><b>+' + s.base.toFixed(2) + ' 元</b></div>';
        if (s.otPay > 0) ihtml += '<div class="sal-row"><span>加班费</span><b>+' + s.otPay.toFixed(2) + ' 元</b></div>';
        if (s.nightAllowance > 0) ihtml += '<div class="sal-row"><span>夜班补贴 (' + activeCfg.nightAllowance + '元/次)</span><b>+' + s.nightAllowance.toFixed(2) + ' 元</b></div>';
        const subs = activeCfg.subsidies || [];
        if (subs.length) subs.forEach(function(x) {
            ihtml += '<div class="sal-row"><span>' + util.esc(x.name || '补贴') + '</span><b>+' + (parseFloat(x.amount) || 0).toFixed(2) + ' 元</b></div>';
        });
        ihtml += '<div class="sal-row sal-row-total"><span>收入合计</span><b>+' + s.gross.toFixed(2) + ' 元</b></div>';
        incomeEl.innerHTML = ihtml;
    }
    // 扣除明细 - 统一列表（社保、公积金、请假、自定义扣款）
    const deductEl = document.getElementById('salDeductAllDetail');
    if (deductEl) {
        var dhtml = '';
        if (s.socialInsurance > 0) dhtml += '<div class="sal-row"><span>社保</span><b>-' + s.socialInsurance.toFixed(2) + ' 元</b></div>';
        if (s.housingFund > 0) dhtml += '<div class="sal-row"><span>公积金</span><b>-' + s.housingFund.toFixed(2) + ' 元</b></div>';
        if (s.leaveDeduction > 0) dhtml += '<div class="sal-row"><span>请假扣款</span><b>-' + s.leaveDeduction.toFixed(2) + ' 元</b></div>';
        const cds = activeCfg.customDeductions || [];
        if (cds.length) cds.forEach(function(x) {
            dhtml += '<div class="sal-row"><span>' + util.esc(x.name || '扣款') + '</span><b>-' + (parseFloat(x.amount) || 0).toFixed(2) + ' 元</b></div>';
        });
        var totalDeduct = s.socialInsurance + s.housingFund + s.customDeduction + s.leaveDeduction;
        if (totalDeduct > 0) dhtml += '<div class="sal-row sal-row-total"><span>扣除合计</span><b>-' + totalDeduct.toFixed(2) + ' 元</b></div>';
        if (totalDeduct === 0 && s.socialInsurance === 0) dhtml = '<div class="sal-row sal-row-mute"><span>暂无扣款</span></div>';
        deductEl.innerHTML = dhtml;
    }
    // 加班明细：显示每类加班时长 + 对应金额
    const otEl = document.getElementById('salOTDetail');
    if (otEl) {
        var normalPay = s.ot.normal * s.hourly * 1.5;
        var weekendPay = s.ot.weekend * s.hourly * 2;
        var holidayPay = s.ot.holiday * s.hourly * 3;
        otEl.innerHTML =
            '<div class="sal-ot-total"><span>加班费合计</span><b>+¥' + s.otPay.toFixed(2) + '</b></div>' +
            '<div class="sal-ot-row"><span>平时加班 (1.5x · ' + s.ot.normal.toFixed(1) + 'h)</span><b>¥' + normalPay.toFixed(2) + '</b></div>' +
            '<div class="sal-ot-row"><span>周休日加班 (2.0x · ' + s.ot.weekend.toFixed(1) + 'h)</span><b>¥' + weekendPay.toFixed(2) + '</b></div>' +
            '<div class="sal-ot-row"><span>节假日加班 (3.0x · ' + s.ot.holiday.toFixed(1) + 'h)</span><b>¥' + holidayPay.toFixed(2) + '</b></div>';
    }
    // 如果月工资明细区域可见，刷新数据
    var monthlySection = document.getElementById('monthlySalarySection');
    if (monthlySection && monthlySection.style.display !== 'none') {
        renderMonthlySalaryDetail();
    }
}

function toggleSalaryDetail() {
    const d = document.getElementById('salaryDetail');
    if (!d) return;
    const isHidden = d.style.display === 'none';
    d.style.display = isHidden ? 'block' : 'none';
    const icon = document.getElementById('salaryExpandIcon');
    if (icon) icon.textContent = isHidden ? '△' : '▽';
}

/* ============================================================
 * 2. 工资设置（全页形式）
 * ========================================================== */
let salarySettingsPrevTab = 'tabPunch';
let savedSalaryConfig = null;  // 编辑时保存原始配置，取消时恢复
let editingConfig = null;      // 当前正在编辑的配置副本（与 S.salaryConfig 解耦）

function openSalarySettings() {
    // 记录当前活动 Tab
    var activeTab = document.querySelector('.tabbar-item.active');
    if (activeTab) salarySettingsPrevTab = activeTab.getAttribute('data-tab');
    // 隐藏 Tab 容器和底部导航
    var tabContainer = document.querySelector('.tab-container');
    var tabbar = document.getElementById('tabbar');
    if (tabContainer) tabContainer.style.display = 'none';
    if (tabbar) tabbar.style.display = 'none';
    // 显示工资设置页
    var page = document.getElementById('salarySettingsPage');
    if (page) page.style.display = '';
    // 默认显示表单区，隐藏方案记录
    var histSection = document.getElementById('salaryHistorySection');
    if (histSection) histSection.style.display = 'none';
    var formSection = document.getElementById('salaryFormSection');
    if (formSection) formSection.style.display = '';
    // 加载月份选择器（内部会调用 loadConfigToForm 加载该月配置）
    populateEffectiveMonthSelector();
    // 保存原始默认配置，用于取消时恢复
    savedSalaryConfig = JSON.parse(JSON.stringify(S.salaryConfig));
}

function closeSalarySettings() {
    var page = document.getElementById('salarySettingsPage');
    if (page) page.style.display = 'none';
    var tabContainer = document.querySelector('.tab-container');
    var tabbar = document.getElementById('tabbar');
    if (tabContainer) tabContainer.style.display = '';
    if (tabbar) tabbar.style.display = '';
    // 如果有未保存的修改，恢复原始配置
    if (savedSalaryConfig) {
        S.salaryConfig = savedSalaryConfig;
        savedSalaryConfig = null;
    }
    editingConfig = null;
    App.invalidate('salary');
}

function toggleSalaryHistorySection() {
    var histSection = document.getElementById('salaryHistorySection');
    var formSection = document.getElementById('salaryFormSection');
    if (!histSection || !formSection) return;
    var isHidden = histSection.style.display === 'none';
    if (isHidden) {
        histSection.style.display = '';
        formSection.style.display = 'none';
        renderSalaryChangeLog();
    } else {
        histSection.style.display = 'none';
        formSection.style.display = '';
    }
}

function loadConfigToForm(config) {
    // 克隆到编辑副本，避免直接修改 S.salaryConfig 或已存储的方案
    editingConfig = JSON.parse(JSON.stringify(config));
    // 确保 subsidies 和 customDeductions 数组存在
    if (!editingConfig.subsidies) editingConfig.subsidies = [];
    if (!editingConfig.customDeductions) editingConfig.customDeductions = [];
    const fill = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    fill('salBaseInput', editingConfig.baseSalary);
    fill('salWorkDaysInput', editingConfig.workDaysPerMonth);
    fill('salSocialInput', editingConfig.socialInsurance);
    fill('salHousingInput', editingConfig.housingFund || 0);
    fill('salNightAllowanceInput', editingConfig.nightAllowance || 0);
    renderSubsidyEditor();
    renderDeductEditor();
    bindSalaryFormInputs();
    updateHourlyPreview();
}

/* 绑定表单输入事件（赋值式绑定，天然幂等）：底薪/计薪天数变化时实时刷新时薪预览 */
function bindSalaryFormInputs() {
    var base = document.getElementById('salBaseInput');
    var days = document.getElementById('salWorkDaysInput');
    if (base) base.oninput = updateHourlyPreview;
    if (days) days.oninput = updateHourlyPreview;
}

/* 实时计算并显示预估时薪：底薪 ÷ 计薪天数 ÷ 8 */
function updateHourlyPreview() {
    var el = document.getElementById('salHourlyPreview');
    if (!el) return;
    var base = parseFloat(document.getElementById('salBaseInput') && document.getElementById('salBaseInput').value);
    var days = parseFloat(document.getElementById('salWorkDaysInput') && document.getElementById('salWorkDaysInput').value);
    if (!isNaN(base) && !isNaN(days) && base > 0 && days > 0) {
        el.textContent = '¥' + (base / days / 8).toFixed(2) + ' / 小时';
    } else {
        el.textContent = '—';
    }
}

/* 将编辑器当前 DOM 输入同步回 editingConfig（避免增删行时丢失未保存的输入） */
function syncEditorsToConfig() {
    if (!editingConfig) return;
    var readRows = function(nameCls, amountCls) {
        var names = document.getElementsByClassName(nameCls);
        var amounts = document.getElementsByClassName(amountCls);
        var rows = [];
        for (var i = 0; i < names.length; i++) {
            var name = (names[i].value || '').trim();
            var amount = parseFloat(amounts[i] && amounts[i].value) || 0;
            if (name || amount) rows.push({ name: name, amount: amount });
        }
        return rows;
    };
    editingConfig.subsidies = readRows('sub-name', 'sub-amount');
    editingConfig.customDeductions = readRows('ded-name', 'ded-amount');
}

/* 填充生效月份下拉选择器 */
function populateEffectiveMonthSelector() {
    var sel = document.getElementById('salaryEffectiveMonth');
    if (!sel) return;
    var now = new Date();
    var curY = now.getFullYear(), curM = now.getMonth();
    var html = '';
    // 从当前月份往前推12个月，往后推12个月（共25个选项）
    for (var i = -12; i <= 12; i++) {
        var d = new Date(curY, curM + i, 1);
        var y = d.getFullYear(), m = d.getMonth();
        var key = D.monthKey(y, m);
        var label = y + '年' + (m + 1) + '月';
        var hasScheme = S.salarySchemes && S.salarySchemes[key];
        var isCur = (i === 0);
        html += '<option value="' + key + '"' + (isCur ? ' selected' : '') + '>';
        html += label;
        // 精简标记，避免窄屏下选项文字溢出
        if (isCur) html += ' · 当前月';
        else if (hasScheme) html += ' · 已有方案';
        html += '</option>';
    }
    sel.innerHTML = html;
    // 当选择月份变化时，加载该月生效的配置
    sel.onchange = function() {
        var monthStr = sel.value;
        var parts = monthStr.split('-');
        var cfg = D.getSalaryConfigForMonth(parseInt(parts[0]), parseInt(parts[1]) - 1);
        loadConfigToForm(cfg);
    };
    // 初始触发一次，加载当前选中月份的配置
    var parts = sel.value.split('-');
    var initCfg = D.getSalaryConfigForMonth(parseInt(parts[0]), parseInt(parts[1]) - 1);
    loadConfigToForm(initCfg);
}

function renderSubsidyEditor() {
    const box = document.getElementById('salSubsidyEditor');
    if (!box) return;
    const cfg = editingConfig || S.salaryConfig;
    const subs = cfg.subsidies || [];
    var inner = subs.map((s, i) =>
        '<div class="subsidy-row"><input class="sub-name" data-i="' + i + '" value="' + util.esc(s.name) + '" placeholder="名称（如：餐补）">' +
        '<input class="sub-amount" data-i="' + i + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + (parseFloat(s.amount) || 0) + '" placeholder="金额（元）">' +
        '<button class="sub-del" data-i="' + i + '" type="button" aria-label="删除该补贴项">×</button></div>'
    ).join('');
    if (!subs.length) {
        inner = '<div class="subsidy-empty">暂无补贴项<small>如全勤奖、餐补、交通补贴等，点击下方按钮添加</small></div>';
    }
    box.innerHTML = inner + '<button id="addSubsidyRow" type="button" class="sub-add">+ 添加补贴项</button>';
}

function renderDeductEditor() {
    const box = document.getElementById('salDeductEditor');
    if (!box) return;
    const cfg = editingConfig || S.salaryConfig;
    const deds = cfg.customDeductions || [];
    var inner = deds.map((s, i) =>
        '<div class="subsidy-row"><input class="ded-name" data-i="' + i + '" value="' + util.esc(s.name) + '" placeholder="名称（如：水电费）">' +
        '<input class="ded-amount" data-i="' + i + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + (parseFloat(s.amount) || 0) + '" placeholder="金额（元）">' +
        '<button class="ded-del" data-i="' + i + '" type="button" aria-label="删除该扣款项">×</button></div>'
    ).join('');
    if (!deds.length) {
        inner = '<div class="subsidy-empty">暂无扣款项<small>如宿舍费、水电费等固定扣款，点击下方按钮添加</small></div>';
    }
    box.innerHTML = inner + '<button id="addDeductRow" type="button" class="sub-add">+ 添加扣款项</button>';
}

function readSalarySettings() {
    const num = (id, fb) => { const el = document.getElementById(id); const v = parseFloat(el && el.value); return isNaN(v) ? fb : v; };
    const base = num('salBaseInput', DEFAULT_SALARY.baseSalary);
    const workDays = num('salWorkDaysInput', DEFAULT_SALARY.workDaysPerMonth);
    const socialIns = num('salSocialInput', 0);
    const housingFund = num('salHousingInput', 0);
    const nightAllowance = num('salNightAllowanceInput', 0);
    const subs = [];
    const names = document.getElementsByClassName('sub-name');
    const amounts = document.getElementsByClassName('sub-amount');
    for (let i = 0; i < names.length; i++) {
        const name = (names[i].value || '').trim();
        const amount = parseFloat(amounts[i] && amounts[i].value) || 0;
        if (name || amount) subs.push({ name: name || ('补贴' + (i + 1)), amount: amount });
    }
    const deds = [];
    const dedNames = document.getElementsByClassName('ded-name');
    const dedAmounts = document.getElementsByClassName('ded-amount');
    for (let i = 0; i < dedNames.length; i++) {
        const name = (dedNames[i].value || '').trim();
        const amount = parseFloat(dedAmounts[i] && dedAmounts[i].value) || 0;
        if (name || amount) deds.push({ name: name || ('扣款' + (i + 1)), amount: amount });
    }
    return { baseSalary: base, workDaysPerMonth: workDays, socialInsurance: socialIns, housingFund: housingFund, nightAllowance: nightAllowance, subsidies: subs, customDeductions: deds };
}

function applySalarySettings() {
    var newConfig = readSalarySettings();
    // 获取选择的生效月份
    var sel = document.getElementById('salaryEffectiveMonth');
    var monthStr = sel ? sel.value : null;
    if (!monthStr) {
        App.ui.showToast('请选择生效月份', true);
        return;
    }
    var parts = monthStr.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]) - 1;
    // 获取该月份当前生效的配置（用于比较）
    var oldCfg = D.getSalaryConfigForMonth(y, m);
    var oldConfig = JSON.parse(JSON.stringify(oldCfg));
    // 生成修改摘要
    var summary = buildChangeSummary(oldConfig, newConfig);
    // 按月快照存储
    D.saveSalarySchemeForMonth(y, m, newConfig);
    // 同时更新当前默认配置（最新月份时）
    var now = new Date();
    if (y === now.getFullYear() && m === now.getMonth()) {
        S.salaryConfig = newConfig;
        D.saveSalaryConfig();
    }
    // 记录修改日志
    addSalaryChangeLogEntry(summary, oldConfig, newConfig, monthStr);
    savedSalaryConfig = null;
    editingConfig = null;
    App.invalidate('salary');
    // 刷新月份选择器（标记已保存）
    populateEffectiveMonthSelector();
    // 重新选中刚才保存的月份
    if (sel) sel.value = monthStr;
    App.ui.showToast(monthStr + ' 工资方案已保存，自该月起生效');
}

/* 生成修改摘要（对比新旧配置） */
function buildChangeSummary(oldCfg, newCfg) {
    var changes = [];
    if (oldCfg.baseSalary !== newCfg.baseSalary)
        changes.push('底薪 ' + (oldCfg.baseSalary || 0) + '→' + newCfg.baseSalary);
    if (oldCfg.socialInsurance !== newCfg.socialInsurance)
        changes.push('社保 ' + (oldCfg.socialInsurance || 0) + '→' + newCfg.socialInsurance);
    if ((oldCfg.housingFund || 0) !== (newCfg.housingFund || 0))
        changes.push('公积金 ' + (oldCfg.housingFund || 0) + '→' + (newCfg.housingFund || 0));
    if ((oldCfg.nightAllowance || 0) !== (newCfg.nightAllowance || 0))
        changes.push('夜班补贴 ' + (oldCfg.nightAllowance || 0) + '→' + (newCfg.nightAllowance || 0));
    if ((oldCfg.workDaysPerMonth || 0) !== (newCfg.workDaysPerMonth || 0))
        changes.push('计薪天数 ' + (oldCfg.workDaysPerMonth || 0) + '→' + newCfg.workDaysPerMonth);
    var oldSubs = (oldCfg.subsidies || []).length;
    var newSubs = (newCfg.subsidies || []).length;
    if (oldSubs !== newSubs) changes.push('补贴项 ' + oldSubs + '→' + newSubs);
    var oldDeds = (oldCfg.customDeductions || []).length;
    var newDeds = (newCfg.customDeductions || []).length;
    if (oldDeds !== newDeds) changes.push('扣款项 ' + oldDeds + '→' + newDeds);
    if (!changes.length) return '无变更';
    return changes.join('，');
}

/* 添加修改日志条目 */
function addSalaryChangeLogEntry(summary, oldConfig, newConfig, effectiveMonth) {
    if (!S.salaryChangeLog) S.salaryChangeLog = [];
    var entry = {
        id: Date.now(),
        timestamp: Date.now(),
        effectiveMonth: effectiveMonth || '',
        summary: summary,
        config: JSON.parse(JSON.stringify(newConfig))
    };
    S.salaryChangeLog.unshift(entry);
    // 限制最多保留50条
    if (S.salaryChangeLog.length > 50) {
        S.salaryChangeLog = S.salaryChangeLog.slice(0, 50);
    }
    D.saveSalaryChangeLog();
}

/* 确认删除修改记录（二次确认） */
function confirmDeleteChangeLog(id) {
    var msgEl = document.getElementById('confirmMsg');
    if (msgEl) msgEl.textContent = '确认删除该条工资方案修改记录吗？删除后不可恢复。';
    App.ui.pendingRecordDel = { kind: 'salaryChangeLog', id: id };
    App.ui.openModal('confirmModal');
}

/* 删除修改记录 */
function deleteSalaryChangeLog(id) {
    if (!S.salaryChangeLog) return false;
    S.salaryChangeLog = S.salaryChangeLog.filter(function(e) { return e.id !== id; });
    D.saveSalaryChangeLog();
    renderSalaryChangeLog();
    return true;
}

/* 渲染工资方案修改记录 */
function renderSalaryChangeLog() {
    var container = document.getElementById('salarySchemeGrid');
    if (!container) return;
    var log = S.salaryChangeLog || [];
    if (!log.length) {
        container.innerHTML = '<div class="empty-state" style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">暂无修改记录<br><span style="font-size:11px;color:var(--dim-color);">每次保存工资设置时自动记录</span></div>';
        return;
    }
    var html = '';
    log.forEach(function(entry) {
        var d = new Date(entry.timestamp);
        var dateStr = d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
        var timeStr = util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
        var c = entry.config || {};
        var subsTotal = (c.subsidies || []).reduce(function(s, x) { return s + (parseFloat(x.amount) || 0); }, 0);
        var dedsTotal = (c.customDeductions || []).reduce(function(s, x) { return s + (parseFloat(x.amount) || 0); }, 0);
        var effMonth = entry.effectiveMonth || '';
        html += '<div class="salary-scheme-card">';
        html += '<div class="scheme-card-header">';
        var monthLabel = effMonth ? effMonth.replace('-', '年') + '月' : '未知';
        html += '<span class="scheme-card-month">' + monthLabel + ' 生效</span>';
        html += '<button class="scheme-card-delete" data-id="' + entry.id + '" type="button" title="删除">🗑️</button>';
        html += '</div>';
        html += '<div class="scheme-card-date">' + dateStr + ' ' + timeStr + ' 保存</div>';
        html += '<div class="scheme-card-summary">' + util.esc(entry.summary) + '</div>';
        html += '<div class="scheme-card-details">';
        html += '<div class="scheme-detail-row"><span>底薪</span><b>¥' + (c.baseSalary || 0).toFixed(2) + '</b></div>';
        html += '<div class="scheme-detail-row"><span>社保</span><b>¥' + (c.socialInsurance || 0).toFixed(2) + '</b></div>';
        html += '<div class="scheme-detail-row"><span>公积金</span><b>¥' + (c.housingFund || 0).toFixed(2) + '</b></div>';
        if (c.nightAllowance) html += '<div class="scheme-detail-row"><span>夜班补贴</span><b>¥' + c.nightAllowance.toFixed(2) + '/班</b></div>';
        if (subsTotal > 0) html += '<div class="scheme-detail-row"><span>补贴合计</span><b>+¥' + subsTotal.toFixed(2) + '</b></div>';
        if (dedsTotal > 0) html += '<div class="scheme-detail-row"><span>扣款合计</span><b>-¥' + dedsTotal.toFixed(2) + '</b></div>';
        html += '</div>';
        html += '</div>';
    });
    container.innerHTML = html;
}

function addSubsidyRow() {
    if (!editingConfig) return;
    syncEditorsToConfig(); // 先同步当前输入，避免重新渲染时丢失
    if (!editingConfig.subsidies) editingConfig.subsidies = [];
    editingConfig.subsidies.push({ name: '', amount: 0 });
    renderSubsidyEditor();
}

function removeSubsidy(i) {
    if (!editingConfig || !editingConfig.subsidies) return;
    syncEditorsToConfig(); // 先同步当前输入，避免重新渲染时丢失
    editingConfig.subsidies.splice(i, 1);
    renderSubsidyEditor();
}

function addDeductRow() {
    if (!editingConfig) return;
    syncEditorsToConfig(); // 先同步当前输入，避免重新渲染时丢失
    if (!editingConfig.customDeductions) editingConfig.customDeductions = [];
    editingConfig.customDeductions.push({ name: '', amount: 0 });
    renderDeductEditor();
}

function removeDeduct(i) {
    if (!editingConfig || !editingConfig.customDeductions) return;
    syncEditorsToConfig(); // 先同步当前输入，避免重新渲染时丢失
    editingConfig.customDeductions.splice(i, 1);
    renderDeductEditor();
}

/* ============================================================
 * 3. 工资条
 * ========================================================== */
let payslipYear = new Date().getFullYear();
let payslipActive = false;
let salaryView = null; // { y, m } — null means follow S.selected

function togglePayslip(show) {
    payslipActive = show;
    var salCard = document.querySelector('.salary-card');
    var slipCard = document.getElementById('payslipCard');
    var monthSwitcher = document.getElementById('salaryMonthSwitcher');
    var monthlySection = document.getElementById('monthlySalarySection');
    if (salCard) salCard.style.display = show ? 'none' : '';
    if (slipCard) slipCard.style.display = show ? '' : 'none';
    if (monthSwitcher) monthSwitcher.style.display = show ? 'none' : '';
    if (monthlySection) monthlySection.style.display = 'none';
    if (show) renderPayslip();
}

function renderPayslip() {
    var yearKey = String(payslipYear);
    var yearData = S.payslipData[yearKey] || {};
    var months = yearData.months || {};
    var bonus = parseFloat(yearData.bonus) || 0;

    // Year title
    var titleEl = document.getElementById('payslipYearTitle');
    if (titleEl) titleEl.textContent = payslipYear + ' 年';

    // Count archived months
    var archived = 0;
    var totalAmount = 0;
    var totalSubsidies = 0;
    for (var i = 1; i <= 12; i++) {
        var m = months[String(i)];
        if (m && m.amount > 0) {
            archived++;
            totalAmount += parseFloat(m.amount) || 0;
            totalSubsidies += parseFloat(m.subsidy) || 0;
        }
    }
    // 年工资 = 12个月实发 + 年终奖 + 补贴/奖金
    var yearTotal = totalAmount + bonus + totalSubsidies;

    var countEl = document.getElementById('payslipArchivedCount');
    if (countEl) countEl.textContent = archived;

    // Summary
    var avg = archived > 0 ? totalAmount / archived : 0;
    var setPS = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    setPS('payslipTotal', yearTotal.toFixed(2));
    setPS('payslipBonus', '¥' + bonus.toFixed(2));
    setPS('payslipAvg', '¥' + Math.round(avg));

    // Historical total across all years + total month count for average (含年终奖)
    var historyTotal = 0;
    var historyMonthCount = 0;
    Object.keys(S.payslipData).forEach(function(yk) {
        var yData = S.payslipData[yk] || {};
        var yMonths = yData.months || {};
        var yBonus = parseFloat(yData.bonus) || 0;
        for (var mi = 1; mi <= 12; mi++) {
            var md = yMonths[String(mi)];
            if (md && md.amount > 0) {
                historyTotal += parseFloat(md.amount) || 0;
                historyMonthCount++;
            }
        }
        historyTotal += yBonus;
    });
    var histEl = document.getElementById('payslipHistoryTotal');
    if (histEl) histEl.textContent = historyTotal.toFixed(2);
    var histAvgEl = document.getElementById('payslipHistoryAvg');
    if (histAvgEl) histAvgEl.textContent = historyMonthCount > 0 ? Math.round(historyTotal / historyMonthCount) : 0;

    // Bonus display: show "已录入" or "未录入"
    var bonusStatus = document.getElementById('payslipBonusStatus');
    var bonusAmount = document.getElementById('payslipBonusAmount');
    if (bonusStatus) bonusStatus.textContent = bonus > 0 ? '已录入' : '未录入';
    if (bonusAmount) bonusAmount.textContent = '¥' + bonus.toFixed(2);
    var bonusInput = document.getElementById('payslipBonusInput');
    if (bonusInput && document.activeElement !== bonusInput) bonusInput.value = bonus || '';
    // Reset edit row visibility
    var editRow = document.getElementById('payslipBonusEditRow');
    var displayRow = document.getElementById('payslipBonusDisplay');
    if (editRow) editRow.style.display = 'none';
    if (displayRow) displayRow.style.display = '';

    // Month grid
    var grid = document.getElementById('payslipGrid');
    if (!grid) return;
    var html = '';
    for (var m = 1; m <= 12; m++) {
        var mData = months[String(m)];
        var hasData = mData && mData.amount > 0;
        var amount = hasData ? parseFloat(mData.amount) : 0;
        var mSubsidy = parseFloat(mData && mData.subsidy) || 0;
        var statusText = hasData ? '已录入' : '未录入';
        html += '<div class="payslip-month-card' + (hasData ? ' has-data' : '') + '" data-month="' + m + '">';
        html += '<div class="payslip-month-top"><span class="payslip-month-name">' + m + '月</span><span class="payslip-month-status">' + statusText + '</span></div>';
        if (hasData) {
            html += '<div class="payslip-month-amount">¥' + amount.toFixed(2) + '</div>';
            if (mSubsidy > 0) {
                html += '<div class="payslip-month-subsidy" style="font-size:10px;color:var(--success);margin-top:2px;">+¥' + mSubsidy.toFixed(0) + ' 补贴</div>';
            }
        }
        html += '<div class="payslip-month-plus">+</div>';
        html += '</div>';
    }
    grid.innerHTML = html;
}

function openPayslipMonthModal(month) {
    var yearKey = String(payslipYear);
    var yearData = S.payslipData[yearKey] || {};
    var months = yearData.months || {};
    var mData = months[String(month)] || {};

    var titleEl = document.getElementById('payslipModalTitle');
    if (titleEl) titleEl.textContent = payslipYear + '年' + month + '月 实发工资';
    var labelEl = document.getElementById('payslipMonthLabel');
    if (labelEl) labelEl.value = payslipYear + '年' + month + '月';
    var amountEl = document.getElementById('payslipMonthAmount');
    if (amountEl) amountEl.value = mData.amount || '';
    var subsidyEl = document.getElementById('payslipMonthSubsidy');
    if (subsidyEl) subsidyEl.value = mData.subsidy || 0;
    var noteEl = document.getElementById('payslipMonthNote');
    if (noteEl) noteEl.value = mData.note || '';

    // Store which month we're editing
    document.getElementById('payslipMonthModal').dataset.month = month;
    App.ui.openModal('payslipMonthModal');
}

function savePayslipMonth() {
    var modal = document.getElementById('payslipMonthModal');
    var month = parseInt(modal.dataset.month);
    var amount = parseFloat(document.getElementById('payslipMonthAmount').value) || 0;
    var subsidy = parseFloat(document.getElementById('payslipMonthSubsidy').value) || 0;
    var note = (document.getElementById('payslipMonthNote').value || '').trim();

    var yearKey = String(payslipYear);
    if (!S.payslipData[yearKey]) S.payslipData[yearKey] = {};
    if (!S.payslipData[yearKey].months) S.payslipData[yearKey].months = {};
    S.payslipData[yearKey].months[String(month)] = { amount: amount, subsidy: subsidy, note: note, updatedAt: Date.now() };
    D.savePayslipData();
    App.ui.closeModal('payslipMonthModal');
    renderPayslip();
    App.ui.showToast(payslipYear + '年' + month + '月已保存');
}

function savePayslipBonus() {
    var bonus = parseFloat(document.getElementById('payslipBonusInput').value) || 0;
    var yearKey = String(payslipYear);
    if (!S.payslipData[yearKey]) S.payslipData[yearKey] = {};
    S.payslipData[yearKey].bonus = bonus;
    D.savePayslipData();
    // Hide edit row
    var editRow = document.getElementById('payslipBonusEditRow');
    var displayRow = document.getElementById('payslipBonusDisplay');
    if (editRow) editRow.style.display = 'none';
    if (displayRow) displayRow.style.display = '';
    renderPayslip();
    App.ui.showToast('年终奖已保存');
}

function togglePayslipBonusEdit() {
    var editRow = document.getElementById('payslipBonusEditRow');
    var displayRow = document.getElementById('payslipBonusDisplay');
    if (editRow) editRow.style.display = '';
    if (displayRow) displayRow.style.display = 'none';
    var bonusInput = document.getElementById('payslipBonusInput');
    if (bonusInput) { bonusInput.focus(); }
}

function cancelPayslipBonusEdit() {
    var editRow = document.getElementById('payslipBonusEditRow');
    var displayRow = document.getElementById('payslipBonusDisplay');
    if (editRow) editRow.style.display = 'none';
    if (displayRow) displayRow.style.display = '';
}

function changePayslipYear(delta) {
    payslipYear += delta;
    renderPayslip();
}

/* 「记月工资明细」入口：切换显示月工资明细列表（类似统计页加班明细） */
function toggleMonthlySalaryDetail() {
    var section = document.getElementById('monthlySalarySection');
    if (!section) return;
    var isHidden = section.style.display === 'none';
    section.style.display = isHidden ? '' : 'none';
    if (isHidden) {
        renderMonthlySalaryDetail();
        // 自动展开
        var body = document.getElementById('monthlySalaryBody');
        var arrow = document.getElementById('monthlySalaryArrow');
        if (body) body.style.display = 'block';
        if (arrow) arrow.textContent = '▾';
    }
}

/* 渲染月工资明细列表 */
function renderMonthlySalaryDetail() {
    var container = document.getElementById('monthlySalaryList');
    if (!container) return;
    // 获取有打卡记录的所有月份
    var months = [];
    var now = new Date();
    var dataKeys = Object.keys(S.data || {});
    var monthSet = {};
    dataKeys.forEach(function(key) {
        if (key.length >= 7) {
            var ym = key.substring(0, 7); // YYYY-MM
            if (!monthSet[ym]) {
                monthSet[ym] = true;
                var parts = ym.split('-');
                months.push({ y: parseInt(parts[0]), m: parseInt(parts[1]) - 1 });
            }
        }
    });
    // 按月份倒序排列
    months.sort(function(a, b) { return (b.y * 12 + b.m) - (a.y * 12 + a.m); });
    // 更新计数
    var countEl = document.getElementById('monthlySalaryCount');
    if (countEl) countEl.textContent = ' (' + months.length + '个月)';
    if (!months.length) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:13px;">暂无月工资明细<br><span style="font-size:11px;color:var(--dim-color);">完成打卡后将自动计算月工资</span></div>';
        return;
    }
    var html = '';
    months.forEach(function(mo) {
        var start = new Date(mo.y, mo.m, 1);
        var end = new Date(mo.y, mo.m + 1, 0);
        var s = Sal.calcSalary(start, end);
        var monthLabel = mo.y + '年' + (mo.m + 1) + '月';
        var isCurrent = (mo.y === now.getFullYear() && mo.m === now.getMonth());
        html += '<div class="record-item monthly-salary-item">';
        html += '<div class="record-item-left">';
        html += '<span class="record-dot" style="background:' + (isCurrent ? 'var(--primary)' : 'var(--text-secondary)') + '"></span>';
        html += '<div>';
        html += '<div class="record-title">' + monthLabel + (isCurrent ? ' (本月)' : '') + '</div>';
        html += '<div class="record-sub">';
        html += '底薪¥' + s.base.toFixed(0);
        if (s.otPay > 0) html += ' + 加班¥' + s.otPay.toFixed(0);
        if (s.nightAllowance > 0) html += ' + 夜班¥' + s.nightAllowance.toFixed(0);
        if (s.subsidy > 0) html += ' + 补贴¥' + s.subsidy.toFixed(0);
        html += ' - 社保¥' + s.socialInsurance.toFixed(0);
        html += ' - 公积金¥' + s.housingFund.toFixed(0);
        if (s.leaveDeduction > 0) html += ' - 请假¥' + s.leaveDeduction.toFixed(0);
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '<div class="record-amount">¥' + s.net.toFixed(2) + '</div>';
        html += '</div>';
    });
    container.innerHTML = html;
}

/* ============================================================
 * 4. 注册渲染函数
 * ========================================================== */
App.registerRender('salary', renderSalary);

/* ============================================================
 * 5. 导出到 App 命名空间
 * ========================================================== */
App.salaryUI = {
    renderSalary: renderSalary,
    renderSalaryMonth: renderSalaryMonth,
    changeSalaryMonth: changeSalaryMonth,
    toggleSalaryDetail: toggleSalaryDetail,
    openSalarySettings: openSalarySettings,
    closeSalarySettings: closeSalarySettings,
    toggleSalaryHistorySection: toggleSalaryHistorySection,
    loadConfigToForm: loadConfigToForm,
    populateEffectiveMonthSelector: populateEffectiveMonthSelector,
    renderSubsidyEditor: renderSubsidyEditor,
    renderDeductEditor: renderDeductEditor,
    readSalarySettings: readSalarySettings,
    applySalarySettings: applySalarySettings,
    updateHourlyPreview: updateHourlyPreview,
    syncEditorsToConfig: syncEditorsToConfig,
    renderSalaryChangeLog: renderSalaryChangeLog,
    confirmDeleteChangeLog: confirmDeleteChangeLog,
    deleteSalaryChangeLog: deleteSalaryChangeLog,
    addSubsidyRow: addSubsidyRow,
    removeSubsidy: removeSubsidy,
    addDeductRow: addDeductRow,
    removeDeduct: removeDeduct,
    togglePayslip: togglePayslip,
    renderPayslip: renderPayslip,
    openPayslipMonthModal: openPayslipMonthModal,
    savePayslipMonth: savePayslipMonth,
    savePayslipBonus: savePayslipBonus,
    togglePayslipBonusEdit: togglePayslipBonusEdit,
    cancelPayslipBonusEdit: cancelPayslipBonusEdit,
    changePayslipYear: changePayslipYear,
    toggleMonthlySalaryDetail: toggleMonthlySalaryDetail,
    renderMonthlySalaryDetail: renderMonthlySalaryDetail,
    get payslipActive() { return payslipActive; }
};

})();
