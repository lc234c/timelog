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
    const el = document.getElementById('salaryMonth');
    if (!el) return;
    const y = S.selected.getFullYear(), m = S.selected.getMonth();
    el.textContent = y + '年' + util.pad2(m + 1) + '月（选中日期所在月）';
}

function renderSalary() {
    const panel = document.getElementById('tabSalary');
    if (!panel) return;
    const y = S.selected.getFullYear(), m = S.selected.getMonth();
    const start = new Date(y, m, 1), end = new Date(y, m + 1, 0);
    const s = Sal.calcSalary(start, end);
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setVal('salNet', s.net.toFixed(2));
    setVal('salHourly', s.hourly.toFixed(2));
    // 收入明细 - 统一列表（底薪、加班费、夜班补贴、自定义补贴）
    const incomeEl = document.getElementById('salIncomeDetail');
    if (incomeEl) {
        var ihtml = '';
        ihtml += '<div class="sal-row"><span>底薪</span><b>+' + s.base.toFixed(2) + ' 元</b></div>';
        if (s.otPay > 0) ihtml += '<div class="sal-row"><span>加班费</span><b>+' + s.otPay.toFixed(2) + ' 元</b></div>';
        if (s.nightAllowance > 0) ihtml += '<div class="sal-row"><span>夜班补贴 (' + S.salaryConfig.nightAllowance + '元/次)</span><b>+' + s.nightAllowance.toFixed(2) + ' 元</b></div>';
        const subs = S.salaryConfig.subsidies || [];
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
        const cds = S.salaryConfig.customDeductions || [];
        if (cds.length) cds.forEach(function(x) {
            dhtml += '<div class="sal-row"><span>' + util.esc(x.name || '扣款') + '</span><b>-' + (parseFloat(x.amount) || 0).toFixed(2) + ' 元</b></div>';
        });
        var totalDeduct = s.socialInsurance + s.housingFund + s.customDeduction + s.leaveDeduction;
        if (totalDeduct > 0) dhtml += '<div class="sal-row sal-row-total"><span>扣除合计</span><b>-' + totalDeduct.toFixed(2) + ' 元</b></div>';
        if (totalDeduct === 0 && s.socialInsurance === 0) dhtml = '<div class="sal-row sal-row-mute"><span>暂无扣款</span></div>';
        deductEl.innerHTML = dhtml;
    }
    // 加班明细（保留原有G1/G2/G3明细）
    const otEl = document.getElementById('salOTDetail');
    if (otEl) {
        otEl.innerHTML =
            '<div class="sal-row"><span>平时加班 (1.5x)</span><b>' + s.ot.normal.toFixed(2) + 'h</b></div>' +
            '<div class="sal-row"><span>周休日加班 (2x)</span><b>' + s.ot.weekend.toFixed(2) + 'h</b></div>' +
            '<div class="sal-row"><span>节假日加班 (3x)</span><b>' + s.ot.holiday.toFixed(2) + 'h</b></div>' +
            '<div class="sal-row sal-row-total"><span>加班费合计</span><b>' + s.otPay.toFixed(2) + ' 元</b></div>';
    }
}

function toggleSalaryDetail() {
    const d = document.getElementById('salaryDetail');
    if (!d) return;
    const exp = d.classList.toggle('show');
    const btn = document.getElementById('salaryExpandBtn');
    if (btn) btn.textContent = exp ? '收起明细 △' : '展开明细 ▽';
}

/* ============================================================
 * 2. 工资设置
 * ========================================================== */
function openSalarySettings() {
    const fill = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    fill('salBaseInput', S.salaryConfig.baseSalary);
    fill('salWorkDaysInput', S.salaryConfig.workDaysPerMonth);
    fill('salSocialInput', S.salaryConfig.socialInsurance);
    fill('salHousingInput', S.salaryConfig.housingFund || 0);
    fill('salNightAllowanceInput', S.salaryConfig.nightAllowance || 0);
    renderSubsidyEditor();
    renderDeductEditor();
    App.ui.openModal('salarySettingsModal');
}

function renderSubsidyEditor() {
    const box = document.getElementById('salSubsidyEditor');
    if (!box) return;
    const subs = S.salaryConfig.subsidies || [];
    box.innerHTML = subs.map((s, i) =>
        '<div class="subsidy-row"><input class="sub-name" data-i="' + i + '" value="' + util.esc(s.name) + '" placeholder="名称">' +
        '<input class="sub-amount" data-i="' + i + '" type="number" min="0" step="0.01" value="' + (parseFloat(s.amount) || 0) + '" placeholder="金额">' +
        '<button class="sub-del" data-i="' + i + '" type="button">×</button></div>'
    ).join('') + '<button id="addSubsidyRow" type="button" class="sub-add">+ 添加补贴项</button>';
}

function renderDeductEditor() {
    const box = document.getElementById('salDeductEditor');
    if (!box) return;
    const deds = S.salaryConfig.customDeductions || [];
    box.innerHTML = deds.map((s, i) =>
        '<div class="subsidy-row"><input class="ded-name" data-i="' + i + '" value="' + util.esc(s.name) + '" placeholder="名称">' +
        '<input class="ded-amount" data-i="' + i + '" type="number" min="0" step="0.01" value="' + (parseFloat(s.amount) || 0) + '" placeholder="金额">' +
        '<button class="ded-del" data-i="' + i + '" type="button">×</button></div>'
    ).join('') + '<button id="addDeductRow" type="button" class="sub-add">+ 添加扣款项</button>';
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
    S.salaryConfig = { baseSalary: base, workDaysPerMonth: workDays, socialInsurance: socialIns, housingFund: housingFund, nightAllowance: nightAllowance, subsidies: subs, customDeductions: deds };
    D.saveSalaryConfig();
    App.invalidate('salary');
    App.ui.showToast('工资设置已保存');
}

function applySalarySettings() { readSalarySettings(); App.ui.closeModal('salarySettingsModal'); }

function addSubsidyRow() {
    S.salaryConfig.subsidies.push({ name: '', amount: 0 });
    renderSubsidyEditor();
}

function removeSubsidy(i) {
    S.salaryConfig.subsidies.splice(i, 1);
    renderSubsidyEditor();
}

function addDeductRow() {
    S.salaryConfig.customDeductions.push({ name: '', amount: 0 });
    renderDeductEditor();
}

function removeDeduct(i) {
    S.salaryConfig.customDeductions.splice(i, 1);
    renderDeductEditor();
}

/* ============================================================
 * 3. 工资条
 * ========================================================== */
let payslipYear = new Date().getFullYear();
let payslipActive = false;

function togglePayslip(show) {
    payslipActive = show;
    var salCard = document.querySelector('.salary-card');
    var slipCard = document.getElementById('payslipCard');
    if (salCard) salCard.style.display = show ? 'none' : '';
    if (slipCard) slipCard.style.display = show ? '' : 'none';
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
    for (var i = 1; i <= 12; i++) {
        var m = months[String(i)];
        if (m && m.amount > 0) {
            archived++;
            totalAmount += parseFloat(m.amount) || 0;
        }
    }

    var countEl = document.getElementById('payslipArchivedCount');
    if (countEl) countEl.textContent = archived;

    // Summary
    var cumulative = totalAmount;
    var avg = archived > 0 ? totalAmount / archived : 0;
    var setPS = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    setPS('payslipTotal', totalAmount.toFixed(2));
    setPS('payslipCumulative', '¥' + cumulative.toFixed(2));
    setPS('payslipBonus', '¥' + bonus.toFixed(2));
    setPS('payslipAvg', '¥' + Math.round(avg));

    // Historical total across all years
    var historyTotal = 0;
    Object.keys(S.payslipData).forEach(function(yk) {
        var yData = S.payslipData[yk] || {};
        var yMonths = yData.months || {};
        for (var mi = 1; mi <= 12; mi++) {
            var md = yMonths[String(mi)];
            if (md && md.amount > 0) historyTotal += parseFloat(md.amount) || 0;
        }
    });
    var histEl = document.getElementById('payslipHistoryTotal');
    if (histEl) histEl.textContent = historyTotal.toFixed(2);

    // Bonus input
    var bonusInput = document.getElementById('payslipBonusInput');
    if (bonusInput && document.activeElement !== bonusInput) bonusInput.value = bonus || '';

    // Month grid
    var grid = document.getElementById('payslipGrid');
    if (!grid) return;
    var html = '';
    for (var m = 1; m <= 12; m++) {
        var mData = months[String(m)];
        var hasData = mData && mData.amount > 0;
        var amount = hasData ? parseFloat(mData.amount) : 0;
        var statusText = hasData ? '已录入' : '未录入';
        html += '<div class="payslip-month-card' + (hasData ? ' has-data' : '') + '" data-month="' + m + '">';
        html += '<div class="payslip-month-top"><span class="payslip-month-name">' + m + '月</span><span class="payslip-month-status">' + statusText + '</span></div>';
        if (hasData) {
            html += '<div class="payslip-month-amount">¥' + amount.toFixed(2) + '</div>';
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
    var note = (document.getElementById('payslipMonthNote').value || '').trim();

    var yearKey = String(payslipYear);
    if (!S.payslipData[yearKey]) S.payslipData[yearKey] = {};
    if (!S.payslipData[yearKey].months) S.payslipData[yearKey].months = {};
    S.payslipData[yearKey].months[String(month)] = { amount: amount, note: note, updatedAt: Date.now() };
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
    renderPayslip();
    App.ui.showToast('年终奖已保存');
}

function changePayslipYear(delta) {
    payslipYear += delta;
    renderPayslip();
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
    toggleSalaryDetail: toggleSalaryDetail,
    openSalarySettings: openSalarySettings,
    renderSubsidyEditor: renderSubsidyEditor,
    renderDeductEditor: renderDeductEditor,
    readSalarySettings: readSalarySettings,
    applySalarySettings: applySalarySettings,
    addSubsidyRow: addSubsidyRow,
    removeSubsidy: removeSubsidy,
    addDeductRow: addDeductRow,
    removeDeduct: removeDeduct,
    togglePayslip: togglePayslip,
    renderPayslip: renderPayslip,
    openPayslipMonthModal: openPayslipMonthModal,
    savePayslipMonth: savePayslipMonth,
    savePayslipBonus: savePayslipBonus,
    changePayslipYear: changePayslipYear,
    get payslipActive() { return payslipActive; }
};

})();
