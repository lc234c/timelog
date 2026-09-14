'use strict';
/*!
 * 工时记录 · 08-ui.js（UI组件 + 设置 + 导入导出 + 文件同步）
 */
(function () {

const { util, store, db, state: S, data: D, CONST } = App;
const { KEY, BACKUP_THRESHOLD, DAY } = CONST;
/* 班次元信息（图标/颜色/名称）：由 10-schedule.js 挂载到 App.schedule.SHIFT_META，
   用函数式惰性读取，避免受 10-schedule.js 加载顺序影响（调用处：SCH_META() 与 SCH_META[c]）。 */
function SCH_META() { return App.schedule && App.schedule.SHIFT_META; }

/* ============================================================
 * 1. Toast
 * ========================================================== */
const elsToast = { toast: null };

function showToast(msg, isError) {
    let t = elsToast.toast;
    if (!t) {
        t = document.createElement('div');
        t.id = 'appToast';
        t.className = 'app-toast';
        (util.$('.app') || document.body).appendChild(t);
        elsToast.toast = t;
    }
    t.textContent = msg;
    t.className = 'app-toast show' + (isError ? ' err' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'app-toast'; }, 2400);
}

/* ============================================================
 * 2. 弹窗
 * ========================================================== */
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('show'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('show'); }

function closeConfirmModal() { closeModal('confirmModal'); pendingDelete = null; pendingRecordDel = null; }

/* ============================================================
 * 3. 删除确认（通用）
 * ========================================================== */
let pendingDelete = null;
let pendingRecordDel = null;

function confirmDeleteRecord(kind, id) {
    if (!id) return;
    const label = kind === 'ot' ? '该条加班记录' : '该条请假记录';
    const msgEl = document.getElementById('confirmMsg');
    if (msgEl) msgEl.textContent = '确定删除「' + label + '」吗？删除后不可恢复。';
    pendingRecordDel = { kind: kind, id: id };
    openModal('confirmModal');
}

function doConfirmedDelete() {
    const p = pendingDelete;
    if (p) {
        App.calendar.executePunchDelete(p);
    }
    const pr = pendingRecordDel;
    if (pr) {
        if (pr.kind === 'ot') D.deleteOvertime(pr.id);
        else if (pr.kind === 'leave') D.deleteLeave(pr.id);
    }
    pendingDelete = null;
    pendingRecordDel = null;
    closeConfirmModal();
    if (p || pr) showToast('删除成功');
}

/* ============================================================
 * 4. 设置面板
 * ========================================================== */
const openSettings = () => { refreshCalDefaultSwitch(); refreshDataStatus(); openModal('settingsModal'); };
const closeSettings = () => closeModal('settingsModal');
const closeAbout = () => closeModal('aboutModal');
const closeMakeupModal = () => closeModal('makeupModal');
const closeShiftSettings = () => closeModal('shiftSettingsModal');
const closeCopyFallback = () => closeModal('copyFallbackModal');

function refreshCalDefaultSwitch() {
    const sw = document.getElementById('calDefaultSwitch');
    if (!sw) return;
    sw.classList.toggle('on', !!S.calExpanded);
    sw.setAttribute('aria-checked', S.calExpanded ? 'true' : 'false');
}

function toggleCalDefault() {
    App.calendar.setCalView(!S.calExpanded, true);
    refreshCalDefaultSwitch();
    showToast(S.calExpanded ? '✅ 月历已展开为月视图' : '✅ 月历已折叠为周视图');
}

function openShiftSettings() {
    closeSettings();
    const fill = (prefix, periods) => {
        for (let i = 0; i < 2; i++) {
            const p = periods[i] || { start: '00:00', end: '00:00' };
            const s = document.getElementById(prefix + 'Start' + (i + 1));
            const e = document.getElementById(prefix + 'End' + (i + 1));
            if (s) s.value = p.start;
            if (e) e.value = p.end;
        }
    };
    fill('day', App.shifts.day.periods);
    fill('night', App.shifts.night.periods);
    const err = document.getElementById('shiftSettingsErr');
    if (err) err.style.display = 'none';
    openModal('shiftSettingsModal');
}

function readShiftPeriods(prefix) {
    const ps = [];
    for (let i = 0; i < 2; i++) {
        const s = util.$('#' + prefix + 'Start' + (i + 1)), e = util.$('#' + prefix + 'End' + (i + 1));
        const sv = s ? s.value : '', ev = e ? e.value : '';
        if (!util.isValidHM(sv) || !util.isValidHM(ev)) {
            return { ok: false, msg: '请完整填写起止时间（HH:MM）' };
        }
        ps.push({ start: sv, end: ev });
    }
    return { ok: true, periods: ps };
}

function applyShiftSettings() {
    const day = readShiftPeriods('day'), night = readShiftPeriods('night');
    const errEl = document.getElementById('shiftSettingsErr');
    const fail = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
    if (!day.ok) { fail('白班：' + day.msg); return; }
    if (!night.ok) { fail('夜班：' + night.msg); return; }
    CONST.SHIFT_TYPES.forEach((t) => {
        const ps = t === 'day' ? day.periods : night.periods;
        App.shifts[t].periods = ps;
        App.shifts[t].text = D.buildShiftText(ps);
    });
    D.saveShiftSchedules();
    closeShiftSettings();
    App.invalidate('selected', 'stats', 'history', 'chart');
    showToast('✅ 班别时间段已更新');
}

function resetShiftSettingsAction() {
    if (!confirm('确定恢复白/夜班时间段为系统默认吗？')) return;
    D.resetShiftSchedules();
    D.saveShiftSchedules();
    closeShiftSettings();
    App.invalidate('selected', 'stats', 'history', 'chart');
    showToast('已恢复默认班别时间段');
}

/* ============================================================
 * 排班周期规则配置 UI
 * ========================================================== */
let schDirty = false;          // 弹窗内是否有未保存改动
let schSnapshot = null;         // 打开弹窗时的快照，取消时恢复

function openScheduleSettings() {
    closeSettings();
    schDirty = false;
    // 保存快照，取消时恢复
    schSnapshot = JSON.parse(JSON.stringify(S.schedule));
    renderScheduleTemplates();
    renderScheduleCycle();
    renderScheduleRangeMode();
    renderSchedulePreview();
    // 基准日
    const baseEl = document.getElementById('scheduleBaseDate');
    if (baseEl) baseEl.value = S.schedule.baseDate || util.toDateKey(new Date());
    // 自定义范围日期
    const rsEl = document.getElementById('scheduleRangeStart');
    const reEl = document.getElementById('scheduleRangeEnd');
    if (rsEl) rsEl.value = S.schedule.rangeStart || S.schedule.baseDate || '';
    if (reEl) reEl.value = S.schedule.rangeEnd || '';
    // 启用开关
    const sw = document.getElementById('scheduleEnableSwitch');
    if (sw) sw.classList.toggle('on', !!S.schedule.enabled);
    refreshScheduleStatusTag();
    bindScheduleBaseDate();
    bindScheduleRangeInputs();
    // 一次性绑定弹窗内固定按钮（多次开关不重复绑）
    if (!openScheduleSettings._bound) {
        openScheduleSettings._bound = true;
        const $ = (id) => document.getElementById(id);
        const addBtn = $('scheduleAddDay');
        if (addBtn) addBtn.addEventListener('click', () => {
            App.schedule.cycleAddDay();
            renderScheduleCycle();
            renderSchedulePreview();
            refreshScheduleStatusTag();
            schDirty = true;
        });
        const saveBtn = $('scheduleConfirm');
        if (saveBtn) saveBtn.addEventListener('click', applyScheduleSettings);
        const closeBtn = $('scheduleClose');
        if (closeBtn) closeBtn.addEventListener('click', closeScheduleSettings);
        const cancelBtn = $('scheduleCancel');
        if (cancelBtn) cancelBtn.addEventListener('click', closeScheduleSettings);
        const resetBtn = $('scheduleReset');
        if (resetBtn) resetBtn.addEventListener('click', resetScheduleSettings);
        // 注意：scheduleEnableSwitch 的 click 绑定由 09-app.js bindEvents() 统一处理，
        // 此处不再重复绑定，避免双回调互相抵消。
        // 范围模式选择
        const rangeBox = $('scheduleRangeMode');
        if (rangeBox) {
            rangeBox.addEventListener('click', (e) => {
                const opt = e.target.closest && e.target.closest('.schedule-range-opt');
                if (!opt) return;
                S.schedule.rangeMode = opt.dataset.range;
                renderScheduleRangeMode();
                renderSchedulePreview();
                schDirty = true;
            });
        }
    }
    openModal('scheduleModal');
}

function closeScheduleSettings() {
    // 如果有未保存的改动，恢复快照
    if (schDirty && schSnapshot) {
        S.schedule = schSnapshot;
        App.invalidate('calendar', 'selected', 'scheduleBanner');
    }
    schSnapshot = null;
    schDirty = false;
    closeModal('scheduleModal');
}

/* 启用开关切换 */
function toggleScheduleEnable() {
    S.schedule.enabled = !S.schedule.enabled;
    const sw = document.getElementById('scheduleEnableSwitch');
    if (sw) sw.classList.toggle('on', S.schedule.enabled);
    refreshScheduleStatusTag();
    renderSchedulePreview();
    App.invalidate('calendar', 'scheduleBanner');
    schDirty = true;
}

/* ① 渲染预设模板列表 */
function renderScheduleTemplates() {
    const box = document.getElementById('scheduleTemplates');
    if (!box) return;
    const tpls = App.schedule.getTemplates();
    box.textContent = '';
    const frag = document.createDocumentFragment();
    tpls.forEach((t) => {
        const item = document.createElement('div');
        item.className = 'schedule-tpl';
        item.dataset.id = t.id;
        item.innerHTML =
            '<div class="schedule-tpl-left">' +
                '<div class="schedule-tpl-name">' + util.esc(t.name) + '</div>' +
                '<div class="schedule-tpl-desc">' + util.esc(t.desc) + '</div>' +
            '</div>' +
            '<div class="schedule-tpl-cycle">' +
                t.cycle.slice(0, 14).map((c) => '<span class="tpl-chip tpl-' + c + '">' + ((SCH_META()[c] || {}).icon || '') + '</span>').join('') +
                (t.cycle.length > 14 ? '<span class="tpl-chip tpl-more">…</span>' : '') +
            '</div>' +
            '<button class="schedule-tpl-load" type="button">载入</button>';
        frag.appendChild(item);
    });
    box.appendChild(frag);
    // 事件委托：载入模板
    box.onclick = (e) => {
        const btn = e.target.closest && e.target.closest('.schedule-tpl-load');
        if (!btn) return;
        const item = btn.closest('.schedule-tpl');
        const tpl = App.schedule.getTemplates().find((x) => x.id === item.dataset.id);
        if (!tpl) return;
        // 用当前序列长度对齐：直接替换周期
        S.schedule.cycle = tpl.cycle.slice();
        // 基准日设为今天（让模板立即生效从今天开始）
        const today = util.toDateKey(new Date());
        const baseEl = document.getElementById('scheduleBaseDate');
        if (baseEl && !util.isValidDateKey(baseEl.value)) baseEl.value = today;
        renderScheduleCycle();
        renderSchedulePreview();
        refreshScheduleStatusTag();
        schDirty = true;
        showToast('已载入模板：' + tpl.name);
    };
}

/* ② 渲染周期序列卡片 */
function renderScheduleCycle() {
    const box = document.getElementById('scheduleCycleCards');
    if (!box) return;
    const cycle = S.schedule.cycle;
    box.textContent = '';
    const frag = document.createDocumentFragment();
    cycle.forEach((c, i) => {
        const meta = SCH_META()[c] || SCH_META().day;
        const card = document.createElement('div');
        card.className = 'sch-card sch-' + c;
        card.dataset.idx = i;
        card.innerHTML =
            '<button class="sch-card-del" type="button" title="删除该天" aria-label="删除该天">🗑️</button>' +
            '<div class="sch-card-icon">' + meta.icon + '</div>' +
            '<div class="sch-card-name">' + util.esc(meta.name) + '</div>' +
            '<div class="sch-card-day">第' + (i + 1) + '天</div>';
        frag.appendChild(card);
    });
    box.appendChild(frag);
    // 更新周期长度
    const lenEl = document.getElementById('cycleLen');
    if (lenEl) lenEl.textContent = cycle.length;

    // 卡片点击 → 循环切换班次；删除按钮 → 删除
    box.onclick = (e) => {
        const del = e.target.closest && e.target.closest('.sch-card-del');
        if (del) {
            const card = del.closest('.sch-card');
            const i = +card.dataset.idx;
            if (S.schedule.cycle.length <= 1) { showToast('周期至少保留 1 天', true); return; }
            App.schedule.cycleRemoveDay(i);
            renderScheduleCycle();
            renderSchedulePreview();
            refreshScheduleStatusTag();
            schDirty = true;
            return;
        }
        const card = e.target.closest && e.target.closest('.sch-card');
        if (!card) return;
        const i = +card.dataset.idx;
        App.schedule.cycleRotateDay(i);
        renderScheduleCycle();
        renderSchedulePreview();
        refreshScheduleStatusTag();
        schDirty = true;
    };
}

/* ③ 排班预览（根据生效范围调整天数） */
function renderSchedulePreview() {
    const box = document.getElementById('schedulePreview');
    if (!box) return;
    if (!S.schedule.enabled) {
        box.innerHTML = '<div class="schedule-preview-empty">启用排班后，此处将呈现连续排班结果</div>';
        return;
    }
    const baseStr = (document.getElementById('scheduleBaseDate') || {}).value;
    const baseDate = util.parseDateKey(baseStr) || util.parseDateKey(S.schedule.baseDate) || new Date();
    // 根据范围模式决定预览天数
    const mode = S.schedule.rangeMode || 'infinite';
    let previewCount;
    if (mode === 'infinite') previewCount = 7;
    else if (mode === '1w') previewCount = 7;
    else if (mode === '2w') previewCount = 14;
    else if (mode === '4w') previewCount = 28;
    else if (mode === 'custom') {
        const bounds = App.schedule.getRangeBounds();
        if (bounds) {
            const diff = Math.round((util.startOfDay(bounds.end).getTime() - util.startOfDay(bounds.start).getTime()) / DAY);
            previewCount = Math.min(Math.max(diff + 1, 7), 31);  // 最多预览31天
        } else previewCount = 7;
    } else previewCount = 7;
    const days = App.schedule.previewDays(baseDate, previewCount);
    const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
    box.textContent = '';
    const frag = document.createDocumentFragment();
    days.forEach((d) => {
        const meta = SCH_META()[d.shift] || SCH_META().day;
        const cell = document.createElement('div');
        cell.className = 'sch-prev-cell sch-' + (d.shift || 'rest');
        if (!d.inRange) cell.classList.add('sch-prev-out');
        cell.innerHTML =
            '<div class="sch-prev-date">' + (d.day.getMonth() + 1) + '/' + d.day.getDate() + '</div>' +
            '<div class="sch-prev-week">周' + WEEK[d.weekday] + '</div>' +
            '<div class="sch-prev-icon">' + (d.shift ? meta.icon : '⏸') + '</div>' +
            '<div class="sch-prev-name">' + (d.shift ? util.esc(meta.name) : '范围外') + '</div>';
        frag.appendChild(cell);
    });
    box.appendChild(frag);
}

/* 渲染范围模式选择器 */
function renderScheduleRangeMode() {
    const box = document.getElementById('scheduleRangeMode');
    if (!box) return;
    const opts = box.querySelectorAll('.schedule-range-opt');
    const mode = S.schedule.rangeMode || 'infinite';
    opts.forEach((opt) => opt.classList.toggle('selected', opt.dataset.range === mode));
    const customBox = document.getElementById('scheduleRangeCustom');
    if (customBox) customBox.style.display = mode === 'custom' ? 'flex' : 'none';
}

/* 绑定自定义范围日期输入 */
function bindScheduleRangeInputs() {
    const rsEl = document.getElementById('scheduleRangeStart');
    const reEl = document.getElementById('scheduleRangeEnd');
    if (rsEl && !rsEl._bound) {
        rsEl._bound = true;
        rsEl.addEventListener('change', () => {
            if (util.isValidDateKey(rsEl.value)) {
                S.schedule.rangeStart = rsEl.value;
                renderSchedulePreview();
                schDirty = true;
            }
        });
    }
    if (reEl && !reEl._bound) {
        reEl._bound = true;
        reEl.addEventListener('change', () => {
            if (util.isValidDateKey(reEl.value)) {
                S.schedule.rangeEnd = reEl.value;
                renderSchedulePreview();
                schDirty = true;
            }
        });
    }
}

/* 基准日变化 → 重算预览 */
function bindScheduleBaseDate() {
    const el = document.getElementById('scheduleBaseDate');
    if (!el || el._bound) return;
    el._bound = true;
    el.addEventListener('change', () => {
        if (!util.isValidDateKey(el.value)) return;
        S.schedule.baseDate = el.value;
        renderSchedulePreview();
        schDirty = true;
    });
}

/* 刷新设置入口右侧状态标签 */
function refreshScheduleStatusTag() {
    const tag = document.getElementById('scheduleStatusTag');
    if (!tag) return;
    if (S.schedule.enabled) {
        const len = S.schedule.cycle.length;
        const mode = S.schedule.rangeMode || 'infinite';
        const modeLabel = mode === 'infinite' ? '永久' :
            mode === '1w' ? '一周' : mode === '2w' ? '两周' : mode === '4w' ? '四周' :
            mode === 'custom' ? '自定义' : '';
        tag.textContent = '已启用 · ' + len + '天周期' + (modeLabel && modeLabel !== '永久' ? ' · ' + modeLabel : '');
        tag.classList.add('on');
    } else {
        tag.textContent = '未启用';
        tag.classList.remove('on');
    }
}

/* 保存 */
function applyScheduleSettings() {
    if (!S.schedule.cycle.length) { showToast('周期不能为空', true); return; }
    // 读取自定义范围日期
    if (S.schedule.rangeMode === 'custom') {
        const rsEl = document.getElementById('scheduleRangeStart');
        const reEl = document.getElementById('scheduleRangeEnd');
        const rs = rsEl ? rsEl.value : '';
        const re = reEl ? reEl.value : '';
        if (!util.isValidDateKey(rs) || !util.isValidDateKey(re)) {
            showToast('请选择自定义范围的起止日期', true); return;
        }
        if (rs > re) { showToast('起始日期不能晚于结束日期', true); return; }
        S.schedule.rangeStart = rs;
        S.schedule.rangeEnd = re;
    }
    App.schedule.saveSchedule();
    schDirty = false;
    schSnapshot = null;
    closeScheduleSettings();
    App.invalidate('calendar', 'selected', 'stats', 'scheduleBanner');
    showToast(S.schedule.enabled ? '✅ 排班规则已保存并启用' : '排班规则已保存（未启用）');
}

function resetScheduleSettings() {
    if (!confirm('确定恢复为默认「做六休一」排班吗？')) return;
    const def = App.schedule.defaultSchedule();
    S.schedule.cycle = def.cycle.slice();
    S.schedule.enabled = false;
    S.schedule.baseDate = util.toDateKey(new Date());
    S.schedule.rangeMode = 'infinite';
    S.schedule.rangeStart = '';
    S.schedule.rangeEnd = '';
    App.schedule.saveSchedule();
    renderScheduleCycle();
    renderScheduleRangeMode();
    renderSchedulePreview();
    refreshScheduleStatusTag();
    const sw = document.getElementById('scheduleEnableSwitch');
    if (sw) sw.classList.remove('on');
    const baseEl = document.getElementById('scheduleBaseDate');
    if (baseEl) baseEl.value = S.schedule.baseDate;
    schDirty = true;
    showToast('已恢复默认排班');
}

function promptTargetHours() {
    closeSettings();
    const raw = prompt('设置每日达标线（小时，' + CONST.TARGET_MIN + '~' + CONST.TARGET_MAX + '）\n当前值：' + S.targetHours + 'h', String(S.targetHours));
    if (raw === null) return;
    const nv = parseFloat(raw);
    if (isNaN(nv) || nv <= 0) { showToast('❌ 输入无效，已保持 ' + S.targetHours + 'h', true); return; }
    D.saveTargetHours(nv);
    App.stats.updateChartLegend();
    App.invalidate('chart');
    showToast('达标线已设为 ' + S.targetHours + 'h');
}

/* ============================================================
 * 5. 关于 / 更新日志
 * ========================================================== */
const FALLBACK_CHANGELOG = [
    {
        version: '2.5.4', date: '2026-09-13', tag: '修复', items: [
            '【重要】修复 KEY_PAYSLIP 未定义导致整个应用启动崩溃：工资条功能依赖该常量但从未声明，触发 ReferenceError 使 script.js 完全无法执行',
            '修复工资设置弹窗中扣款编辑器事件处理器被错误嵌套在添加补贴按钮回调内，导致扣款删除/添加按钮仅在先点击添加补贴后才生效',
            '移除引用不存在的 DOM 元素 chartLegend达标 的死代码',
            '修复切换到统计 Tab 时 ensureLeaveRange 覆盖请假表单日期输入的问题'
        ]
    },
    {
        version: '2.4.0', date: '2026-09-13', tag: '优化', items: [
            '修复 script.js 版本号硬编码错误（原 2.1.1 与 version.json 不一致），检查更新与设置页版本显示现已正确',
            '统一文件头版本标注与 APP_VERSION 常量，消除版本信息不一致隐患',
            'Service Worker SW_BUILD 同步升级，确保浏览器触发更新检查，用户可立即获取修复后的代码'
        ]
    },
    {
        version: '2.3.0', date: '2026-09-12', tag: '修复', items: [
            '修复部署新版本后界面仍是旧的、显示死数据：Service Worker 静态资源缓存策略改为网络优先',
            '新增设置→关于→清除缓存并刷新；状态区显示实际版本号',
            '工作日进度条扩展到本周/自定义范围，视觉强化为绿色独占一行'
        ]
    },
    {
        version: '2.2.0', date: '2026-09-02', tag: '新增', items: [
            '新增本地数据库（IndexedDB）：容量大幅提升，按日分条存储；清理 localStorage 后自动恢复记录',
            '新增本地文件自动同步：绑定文件后每次打卡自动写入，清缓存后可重新选文件找回（桌面版 Chrome/Edge）',
            '设置页新增数据状态区，显示备份时间与存储方式；备份提醒改为按新增 10 天记录触发'
        ]
    },
    {
        version: '2.1.1', date: '2026-09-02', tag: '修复', items: [
            '修复「下载备份文件」提示已开始下载、实际没有文件：iOS/PWA/内置浏览器不支持 <a download>，原逻辑却无条件报成功',
            '改为下载前探测环境能力，不可靠时直接弹出可复制的备份数据并说明原因，不再谎报成功',
            '修复 Service Worker 可能拦截 blob 下载请求；修复 iOS 上图表分享被拒绝（改同步生成图片）'
        ]
    },
    {
        version: '2.1.0', date: '2026-09-02', tag: '优化', items: [
            'script.js 全面重构：单一数据源 + 统一渲染调度，代码量减少约 35%',
            '修复：点击日历会产生「空打卡记录」，导致统计天数与日均被稀释',
            '修复：new Date("YYYY-MM-DD") 按 UTC 解析，东八区下自定义图表范围首尾各差一天',
            '修复：切换班别会在备份数据中留下空壳记录',
            '修复：夜班时「今日统计」仍显示白班步骤名（上午上班/下午下班）',
            '修复：初始化时图表切到本周但范围按钮仍高亮「本月」',
            '优化：日历改用事件委托，监听器数量从 200+ 降到 5 个',
            '优化：一次操作只重绘一次（原来同一次打卡会触发 5~6 次图表重绘）',
            '安全：记录列表与更新日志统一 HTML 转义，脏数据导入时自动清洗'
        ]
    }
];
let APP_VERSION = '2.5.4';
let CHANGELOG = FALLBACK_CHANGELOG;

function renderChangelog() {
    const box = document.getElementById('changelogList');
    if (!box) return;
    const TAG_CLS = { '新增': 'new', '优化': 'opt', '修复': 'fix', '发布': 'rel', '移除': 'opt', '文档': 'opt' };
    const frag = document.createDocumentFragment();
    CHANGELOG.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'changelog-item';
        const tag = log.tag || log.type || '优化';
        const cls = 'tag-' + (TAG_CLS[tag] || 'opt');
        let html = '<div class="changelog-head"><span class="changelog-version">v' + util.esc(log.version) + '</span>' +
            '<span class="changelog-tag ' + cls + '">' + util.esc(tag) + '</span>' +
            '<span class="changelog-date">' + util.esc(log.date) + '</span></div><ul class="changelog-items">';
        (log.items || []).forEach((t) => {
            const text = typeof t === 'string' ? t : (t && t.text) || '';
            html += '<li>' + util.esc(text) + '</li>';
        });
        html += '</ul>';
        item.innerHTML = html;
        frag.appendChild(item);
    });
    box.textContent = '';
    box.appendChild(frag);
}

function openAbout() {
    closeSettings();
    const v = document.getElementById('aboutVersion');
    if (v) v.textContent = APP_VERSION;
    renderChangelog();
    openModal('aboutModal');
}

function loadAboutData() {
    if (typeof fetch !== 'function') { renderChangelog(); return; }
    const getJSON = (url) => fetch(url, { cache: 'no-cache' })
        .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error(url))));
    Promise.all([
        getJSON('version.json').then((j) => { if (j && j.version) APP_VERSION = String(j.version); }).catch(() => {}),
        getJSON('changelog.json').then((j) => { if (j && Array.isArray(j) && j.length) CHANGELOG = j; }).catch(() => {})
    ]).then(renderChangelog);
}

function checkForUpdates() {
    const btn = document.getElementById('checkUpdateBtn');
    const done = (msg) => {
        showToast(msg);
        if (btn) { btn.disabled = false; btn.textContent = '检查更新'; }
    };
    if (btn) { btn.disabled = true; btn.textContent = '检查中…'; }
    if (typeof fetch !== 'function') { done('⚠️ 当前环境不支持检查更新'); return; }
    fetch('version.json', { cache: 'no-cache' })
        .then((r) => (r && r.ok ? r.json() : Promise.reject(new Error('bad response'))))
        .then((j) => {
            if (!j || !j.version) { done('⚠️ 无法读取版本信息'); return; }
            const remote = String(j.version).replace(/^v/, ''), cur = String(APP_VERSION).replace(/^v/, '');
            if (cur === remote) done('✅ 当前已是最新版本 v' + cur);
            else done('🆕 发现新版本 v' + remote + '（当前 v' + cur + '），请前往更新');
        })
        .catch(() => done('⚠️ 检查更新失败（可能以 file:// 打开，建议用 http server）'));
}

function clearCacheAndReload() {
    if (!confirm('将清除本站缓存并重新加载，用于解决「更新后界面仍是旧版」的问题。\n\n打卡数据不会受影响。是否继续？')) return;
    const done = () => {
        try { location.replace(location.pathname + '?t=' + Date.now()); }
        catch (e) { try { location.reload(); } catch (e2) {} }
    };
    let pending = 0;
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            pending = 1;
            navigator.serviceWorker.getRegistrations().then((regs) => {
                Promise.all((regs || []).map((r) => {
                    try { r.postMessage('clearCache'); } catch (e) {}
                    return r.unregister().catch(() => false);
                })).then(done, done);
            }).catch(done);
        }
    } catch (e) {}
    if (!pending) {
        try {
            if (window.caches && window.caches.keys) {
                window.caches.keys().then((keys) =>
                    Promise.all(keys.map((k) => window.caches.delete(k)))
                ).then(done, done);
                return;
            }
        } catch (e) {}
        done();
    }
}

/* ============================================================
 * 6. 下载环境检测
 * ========================================================== */
const dlEnv = (function () {
    let isIOS = false, isStandalone = false, isInApp = false, supportsAttr = false;
    try {
        const ua = navigator.userAgent || '';
        const isIPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
        isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS;
        isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true;
        isInApp = /MicroMessenger|Weibo|QQ\/|Alipay|baiduboxapp|DingTalk/i.test(ua);
        supportsAttr = 'download' in document.createElement('a');
    } catch (e) { supportsAttr = false; }
    return {
        isIOS: isIOS, isStandalone: isStandalone, isInApp: isInApp, supportsAttr: supportsAttr,
        reliable: supportsAttr && !isIOS && !isInApp
    };
})();

function triggerDownload(filename, blob) {
    if (!dlEnv.reliable) return 'unsupported';
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            try { document.body.removeChild(a); } catch (e) {}
            try { URL.revokeObjectURL(url); } catch (e) {}
        }, 30000);
        return 'ok';
    } catch (e) {
        return 'fail';
    }
}

/* ============================================================
 * 7. 备份 / 导入 / 清空
 * ========================================================== */
const buildBackupJSON = () => JSON.stringify({
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: S.data,
    salaryConfig: S.salaryConfig,
    payslipData: S.payslipData,
    schedule: S.schedule,
    shiftSchedules: App.shifts ? {
        day: App.shifts.day,
        night: App.shifts.night
    } : null,
    targetHours: S.targetHours
});
function buildBackupFileName() {
    const t = new Date();
    return '工时记录备份_' + t.getFullYear() + util.pad2(t.getMonth() + 1) + util.pad2(t.getDate()) +
        '_' + util.pad2(t.getHours()) + util.pad2(t.getMinutes()) + '.json';
}

function showCopyFallback(text, tip) {
    closeSettings();
    const ta = document.getElementById('copyFallbackText');
    if (!ta) { showToast('❌ 无法展示备份数据，请刷新后重试', true); return; }
    ta.value = text;
    let el = document.getElementById('copyFallbackTip');
    if (!el && ta.parentNode) {
        el = document.createElement('div');
        el.id = 'copyFallbackTip';
        ta.parentNode.insertBefore(el, ta);
    }
    if (el) {
        if (tip) {
            el.textContent = tip;
            el.style.cssText = 'font-size:12px;line-height:1.6;color:#8a6d00;background:#fff8e1;' +
                'border:1px solid #ffe082;border-radius:8px;padding:9px 11px;margin:0 0 10px;';
            el.style.display = 'block';
        } else {
            el.style.display = 'none';
        }
    }
    openModal('copyFallbackModal');
    try { ta.focus(); ta.select(); } catch (e) {}
}

function markBackedUp() {
    store.write(KEY.backupAt, String(Date.now()));
    store.write(KEY.backupCount, String(Object.keys(S.data).length));
    refreshDataStatus();
}

function downloadBackup() {
    const text = buildBackupJSON();
    const result = triggerDownload(buildBackupFileName(), new Blob([text], { type: 'application/json' }));
    if (result === 'ok') {
        closeSettings();
        markBackedUp();
        showToast('✅ 备份文件已开始下载');
        return;
    }
    if (result === 'fail') {
        showCopyFallback(text, '下载失败，请复制下方数据自行保存。');
        showToast('❌ 下载失败，已转为手动复制', true);
        return;
    }
    const why = dlEnv.isInApp ? '当前在 App 内置浏览器中' : '当前环境（iOS/PWA）不支持直接下载文件';
    showCopyFallback(text, why + '，请全选复制下方数据，粘贴到备忘录或文件中保存。' +
        '也可在 Safari / Chrome 中打开本页后重试下载。');
    markBackedUp();
    showToast('⚠️ 无法直接下载，已生成备份数据', true);
}

function copyData() {
    const text = buildBackupJSON();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => { closeSettings(); markBackedUp(); showToast('📋 备份数据已复制到剪贴板'); })
            .catch(() => showCopyFallback(text, '自动复制被浏览器拦截，请手动全选复制。'));
    } else {
        showCopyFallback(text, '当前环境不支持自动复制，请手动全选复制。');
    }
}

function applyImportData(obj) {
    if (!obj || typeof obj !== 'object') { showToast('❌ 备份格式不正确', true); return; }
    // 兼容新旧格式：新格式含 {version,data,salaryConfig,...}，旧格式为纯 data 对象
    var data, salaryConfig, payslipData, schedule, shiftSchedules, targetHours;
    if (obj.data && typeof obj.data === 'object' && (obj.version || obj.exportedAt)) {
        data = obj.data;
        salaryConfig = obj.salaryConfig;
        payslipData = obj.payslipData;
        schedule = obj.schedule;
        shiftSchedules = obj.shiftSchedules;
        targetHours = obj.targetHours;
    } else {
        data = obj;
    }
    const clean = D.normalizeData(data);
    const count = Object.keys(clean).length;
    if (!count) { showToast('❌ 备份中没有可导入的打卡记录', true); return; }
    var extraInfo = '';
    if (salaryConfig) extraInfo += ' + 工资配置';
    if (payslipData) extraInfo += ' + 工资条';
    if (schedule) extraInfo += ' + 排班';
    if (shiftSchedules) extraInfo += ' + 班别时段';
    if (!confirm('导入将覆盖当前数据（共 ' + count + ' 条记录' + extraInfo + '），确定继续吗？')) return;
    D.replaceAllData(clean);
    if (salaryConfig) { S.salaryConfig = salaryConfig; D.saveSalaryConfig(); }
    if (payslipData) { S.payslipData = payslipData; D.savePayslipData(); }
    if (schedule) { S.schedule = schedule; App.schedule.saveSchedule(); }
    if (shiftSchedules) {
        if (shiftSchedules.day) App.shifts.day = shiftSchedules.day;
        if (shiftSchedules.night) App.shifts.night = shiftSchedules.night;
        D.saveShiftSchedules();
    }
    if (targetHours) { D.saveTargetHours(targetHours); }
    S.selected = util.today();
    S.view.y = S.selected.getFullYear();
    S.view.m = S.selected.getMonth();
    const rec = D.currentRecord();
    S.shiftType = rec ? D.normalizeShiftType(rec.shiftType) : S.shiftType;
    App.calendar.commit();
    closeSettings();
    showToast('✅ 已导入 ' + count + ' 条记录' + extraInfo);
}

function openImportFromFile() {
    closeSettings();
    const inp = document.getElementById('importFileInput');
    if (!inp) { openImportModal(); return; }
    inp.value = '';
    if (!inp._bound) {
        inp._bound = true;
        inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target && ev.target.result;
                if (!text) { showToast('❌ 读取文件为空', true); return; }
                try { applyImportData(JSON.parse(text)); }
                catch (e) { showToast('❌ 导入失败：文件不是合法 JSON', true); }
            };
            reader.onerror = () => showToast('❌ 读取文件失败', true);
            reader.readAsText(f);
        });
    }
    inp.click();
}

function openImportModal() {
    closeSettings();
    const v = prompt('请粘贴之前备份的 JSON 数据：');
    if (!v) return;
    try { applyImportData(JSON.parse(v)); }
    catch (e) { showToast('❌ 导入失败：格式不正确', true); }
}

function clearAllData() {
    if (!confirm('【第1次确认 · 共3步】\n将删除本地所有打卡记录、工资配置、排班规则！\n建议先备份。是否继续？')) return;
    if (!confirm('【第2次确认 · 共3步】\n再次提醒：所有数据将被永久删除，不可恢复！\n是否继续？')) return;
    // 第3次：密码验证
    const pwdInput = document.getElementById('clearPwdInput');
    if (pwdInput) pwdInput.value = '';
    openModal('clearPasswordModal');
    setTimeout(() => { if (pwdInput) { pwdInput.focus(); } }, 200);
}

function executeClearAllData() {
    const pwdInput = document.getElementById('clearPwdInput');
    if (!pwdInput) return;
    const pwd = (pwdInput.value || '').trim();
    const stored = store.read('wt_clear_pwd') || '1234';
    if (pwd !== stored) {
        showToast('❌ 密码错误，清空已取消', true);
        pwdInput.value = '';
        pwdInput.focus();
        return;
    }
    closeModal('clearPasswordModal');
    D.replaceAllData({});
    store.remove(KEY.backupCount);
    store.remove(KEY.backupAt);
    App.calendar.commit();
    closeSettings();
    showToast('所有数据已清空');
}

/* ============================================================
 * 8. 本地文件自动落盘（fileSync）
 * ========================================================== */
const fileSync = (function () {
    const supported = typeof window !== 'undefined' &&
        typeof window.showSaveFilePicker === 'function' &&
        typeof window.showOpenFilePicker === 'function';

    let handle = null;
    let status = 'off';
    let fileName = '';
    let lastError = '';
    let lastSyncAt = 0;
    let timer = 0;

    async function permit(h, mode) {
        if (!h || typeof h.queryPermission !== 'function') return false;
        const opt = { mode: mode || 'readwrite' };
        try {
            if (await h.queryPermission(opt) === 'granted') return true;
            return await h.requestPermission(opt) === 'granted';
        } catch (e) { return false; }
    }
    function setStatus(s, err) {
        status = s; lastError = err || '';
        refreshDataStatus();
    }
    function suggestedName() { return store.read(KEY.fileSync) || buildBackupFileName(); }

    async function readHandle(h) {
        try {
            const f = await h.getFile();
            fileName = f.name || fileName;
            const txt = await f.text();
            return { text: txt, name: f.name, mtime: f.lastModified || 0 };
        } catch (e) { return null; }
    }
    async function writeNow() {
        if (!handle) return false;
        if (!(await permit(handle, 'readwrite'))) {
            setStatus('need-tap', '文件访问权限已失效');
            return false;
        }
        let w = null;
        try {
            w = await handle.createWritable();
            await w.write(JSON.stringify(S.data));
            await w.close();
            lastSyncAt = Date.now();
            setStatus('linked');
            return true;
        } catch (e) {
            try { if (w) await w.close(); } catch (e2) {}
            setStatus('error', '写入文件失败（文件可能已被删除或移动）');
            return false;
        }
    }
    function scheduleWrite() {
        if (!supported || !handle) return;
        clearTimeout(timer);
        timer = setTimeout(() => { timer = 0; writeNow(); }, 800);
    }

    return {
        get supported() { return supported; },
        get status() { return status; },
        get fileName() { return fileName; },
        get lastError() { return lastError; },
        get lastSyncAt() { return lastSyncAt; },
        get linked() { return !!handle; },
        get statusText() {
            if (!supported) return '当前浏览器不支持（需 Chrome/Edge 桌面版）';
            if (status === 'linked') return '已同步到 ' + fileName;
            if (status === 'need-tap') return '需点击重新授权';
            if (status === 'error') return lastError || '同步异常';
            return '未开启';
        },

        async link() {
            if (!supported) { showToast('❌ 当前浏览器不支持本地文件同步', true); return false; }
            let h;
            try {
                h = await window.showSaveFilePicker({
                    suggestedName: suggestedName(),
                    types: [{ description: '工时备份数据', accept: { 'application/json': ['.json'] } }],
                    excludeAcceptAllOption: true
                });
            } catch (e) {
                if (!e || e.name !== 'AbortError') showToast('❌ 未选择文件', true);
                return false;
            }
            if (!(await permit(h, 'readwrite'))) {
                showToast('❌ 未获得文件写入权限', true);
                return false;
            }
            handle = h;
            let restoredCount = 0;
            const got = await readHandle(h);
            if (got && got.text) {
                let parsed = null;
                try { parsed = JSON.parse(got.text); } catch (e) { parsed = null; }
                const clean = D.normalizeData(parsed);
                const n = Object.keys(clean).length;
                if (n > 0 && confirm('文件「' + (got.name || '备份') + '」中已有 ' + n +
                    ' 条打卡记录。\n\n【确定】用文件内容恢复当前数据\n【取消】用当前数据覆盖该文件')) {
                    D.replaceAllData(clean);
                    App.calendar.commit();
                    restoredCount = n;
                }
            }
            let persisted = false;
            try { persisted = await db.setHandle(h); } catch (e) { persisted = false; }
            store.write(KEY.fileSync, fileName || '工时记录备份.json');
            const ok = await writeNow();
            setStatus(ok ? 'linked' : 'error', ok ? '' : '首次写入失败');

            if (!ok) {
                showToast(restoredCount ? '❌ 已恢复 ' + restoredCount + ' 条，但写入文件失败' : '❌ 绑定成功但写入失败', true);
            } else if (restoredCount) {
                showToast('✅ 已从文件恢复 ' + restoredCount + ' 条记录，并开启自动同步');
            } else {
                showToast(persisted ? '✅ 已开启本地文件自动同步' : '✅ 已开启同步（本次有效，重开需重新选文件）');
            }
            return ok;
        },

        async tryRestore() {
            if (!supported) return false;
            let h = null;
            try { h = await db.getHandle(); } catch (e) { h = null; }
            if (!h) return false;
            handle = h;
            if ((await permit(h, 'read')) !== true) {
                setStatus('need-tap', '');
                return false;
            }
            const got = await readHandle(h);
            if (!got) { setStatus('error', '备份文件已失效，请重新绑定'); return false; }
            let parsed = null;
            try { parsed = JSON.parse(got.text); } catch (e) { parsed = null; }
            const clean = D.normalizeData(parsed);
            const n = Object.keys(clean).length;
            const cur = Object.keys(S.data).length;
            if (n > cur) {
                D.replaceAllData(clean);
                App.calendar.commit();
                showToast('🔄 已从备份文件恢复 ' + n + ' 条记录');
            }
            setStatus('linked');
            return true;
        },

        async reconnect() {
            if (!supported) { showToast('❌ 当前浏览器不支持本地文件同步', true); return false; }
            if (handle && (await permit(handle, 'readwrite'))) return await writeNow();
            return await this.link();
        },

        async unlink() {
            clearTimeout(timer); timer = 0;
            handle = null; fileName = ''; lastSyncAt = 0;
            try { await db.dropHandle(); } catch (e) {}
            store.remove(KEY.fileSync);
            setStatus('off');
            showToast('已关闭本地文件同步');
        },

        scheduleWrite: scheduleWrite,
        writeNow: writeNow
    };
})();

/* ============================================================
 * 9. 数据状态与备份提醒
 * ========================================================== */
function backupStatus() {
    const total = Object.keys(S.data).length;
    const base = parseInt(store.read(KEY.backupCount), 10);
    const at = parseInt(store.read(KEY.backupAt), 10);
    const backedUp = isFinite(base) && isFinite(at) && at > 0;
    return {
        total: total,
        at: backedUp ? at : 0,
        pending: backedUp ? Math.max(0, total - base) : total
    };
}

function refreshDataStatus() {
    const el = document.getElementById('backupStatus');
    if (el) {
        const s = backupStatus();
        if (!s.total) el.textContent = '暂无打卡记录';
        else if (!s.at) el.textContent = '⚠️ 尚未备份过 · 共 ' + s.total + ' 天记录，建议立即备份';
        else {
            const d = Math.max(0, Math.round((Date.now() - s.at) / DAY));
            el.textContent = '上次备份：' + (d === 0 ? '今天' : d + ' 天前') +
                (s.pending > 0 ? ' · 此后新增 ' + s.pending + ' 天' : ' · 已同步');
        }
        el.classList.toggle('warn', s.total > 0 && (!s.at || s.pending >= BACKUP_THRESHOLD));
    }
    const modeEl = document.getElementById('storageMode');
    if (modeEl) modeEl.textContent = '数据存储：' + db.modeLabel;

    const verEl = document.getElementById('cacheVerVal');
    if (verEl) verEl.textContent = 'v' + APP_VERSION;

    const syncEl = document.getElementById('fileSyncVal');
    const itemEl = document.getElementById('fileSyncItem');
    if (itemEl) itemEl.style.display = fileSync.supported ? '' : 'none';
    if (syncEl) {
        const t = fileSync.statusText;
        syncEl.textContent = t.length > 18 ? t.slice(0, 18) + '…' : t;
        syncEl.className = 'settings-val' + (fileSync.status === 'error' ? ' ds-err' : '');
    }
    const tipEl = document.getElementById('fileSyncTip');
    if (tipEl) {
        tipEl.style.display = fileSync.supported ? '' : 'none';
        tipEl.textContent = fileSync.supported
            ? (fileSync.linked
                ? '每次打卡自动写入该文件；清除浏览器缓存后点此重新连接即可恢复数据'
                : '开启后每次打卡自动写入本地文件，清除浏览器缓存也能恢复数据')
            : '当前浏览器不支持本地文件自动同步（需 Chrome/Edge 桌面版），请使用「下载备份文件」';
    }
}

function autoBackupRemind() {
    const s = backupStatus();
    if (s.pending < BACKUP_THRESHOLD) return;
    if (!confirm('自上次备份后已新增 ' + s.pending + ' 天打卡记录（共 ' + s.total + ' 天）。\n' +
        '浏览器数据可能因清理缓存而丢失，建议现在备份。是否立即备份？')) return;
    downloadBackup();
}

/* ============================================================
 * 10. 导出到 App 命名空间
 * ========================================================== */
App.ui = {
    // Toast
    showToast: showToast,

    // 弹窗
    openModal: openModal,
    closeModal: closeModal,
    closeConfirmModal: closeConfirmModal,

    // 删除确认
    confirmDeleteRecord: confirmDeleteRecord,
    doConfirmedDelete: doConfirmedDelete,
    pendingDelete: null,
    pendingRecordDel: null,

    // 设置
    openSettings: openSettings,
    closeSettings: closeSettings,
    closeAbout: closeAbout,
    closeMakeupModal: closeMakeupModal,
    closeShiftSettings: closeShiftSettings,
    closeCopyFallback: closeCopyFallback,
    refreshCalDefaultSwitch: refreshCalDefaultSwitch,
    toggleCalDefault: toggleCalDefault,
    openShiftSettings: openShiftSettings,
    applyShiftSettings: applyShiftSettings,
    resetShiftSettingsAction: resetShiftSettingsAction,
    promptTargetHours: promptTargetHours,

    // 排班周期规则
    openScheduleSettings: openScheduleSettings,
    closeScheduleSettings: closeScheduleSettings,
    toggleScheduleEnable: toggleScheduleEnable,
    renderScheduleTemplates: renderScheduleTemplates,
    renderScheduleCycle: renderScheduleCycle,
    renderSchedulePreview: renderSchedulePreview,
    renderScheduleRangeMode: renderScheduleRangeMode,
    bindScheduleBaseDate: bindScheduleBaseDate,
    bindScheduleRangeInputs: bindScheduleRangeInputs,
    applyScheduleSettings: applyScheduleSettings,
    resetScheduleSettings: resetScheduleSettings,

    // 关于
    openAbout: openAbout,
    loadAboutData: loadAboutData,
    checkForUpdates: checkForUpdates,
    clearCacheAndReload: clearCacheAndReload,
    renderChangelog: renderChangelog,
    get APP_VERSION() { return APP_VERSION; },

    // 下载/备份/导入
    dlEnv: dlEnv,
    triggerDownload: triggerDownload,
    buildBackupJSON: buildBackupJSON,
    buildBackupFileName: buildBackupFileName,
    showCopyFallback: showCopyFallback,
    downloadBackup: downloadBackup,
    copyData: copyData,
    applyImportData: applyImportData,
    openImportFromFile: openImportFromFile,
    openImportModal: openImportModal,
    clearAllData: clearAllData,
    executeClearAllData: executeClearAllData,
    markBackedUp: markBackedUp,

    // 文件同步
    fileSync: fileSync,

    // 数据状态
    backupStatus: backupStatus,
    refreshDataStatus: refreshDataStatus,
    autoBackupRemind: autoBackupRemind
};

// 设置 pendingDelete 的 setter（供日历模块使用）
Object.defineProperty(App.ui, 'pendingDelete', {
    get: () => pendingDelete,
    set: (v) => { pendingDelete = v; }
});
Object.defineProperty(App.ui, 'pendingRecordDel', {
    get: () => pendingRecordDel,
    set: (v) => { pendingRecordDel = v; }
});

})();
