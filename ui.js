/* ============================================================
 * ui.js - 工时记录 PWA
 * 职责：UI 渲染 / 交互 / 初始化（依赖 storage.js + chart.js）
 * 通过 window.WT.ui 暴露 API
 * ============================================================ */
(function (global) {
    'use strict';
    var WT = global.WT = global.WT || {};
    var util = WT.util, data = WT.data, chart = WT.chart;

    /* ---------- 状态（由 storage 模块共享） ---------- */
    var selectedDate = new Date();
    var currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
    var status = null;
    WT._selectedDate = selectedDate;
    function refreshStatusRef() { status = data.allData[util.getLocalDateStr(selectedDate)] ? data.allData[util.getLocalDateStr(selectedDate)].status : null; WT._currentStatus = status; }
    refreshStatusRef();

    /* ---------- DOM 缓存 ---------- */
    var els = {};
    function cacheEls() {
        els = {
            clock: document.getElementById('clock'), calGrid: document.getElementById('calGrid'), calTitle: document.getElementById('calTitle'),
            btnText: document.getElementById('btnText'), punchBtn: document.getElementById('punchBtn'), totalHours: document.getElementById('totalHours'),
            punchCount: document.getElementById('punchCount'), shiftBar: document.getElementById('shiftBar'), selDateText: document.getElementById('selDateText'),
            shiftText: document.getElementById('shiftText'), shiftSelect: document.getElementById('shiftSelect'), expandIcon: document.getElementById('expandIcon'),
            todayDetail: document.getElementById('todayDetail'), d_s1: document.getElementById('d_s1'), d_e1: document.getElementById('d_e1'),
            d_s2: document.getElementById('d_s2'), d_e2: document.getElementById('d_e2'), monthAvg: document.getElementById('monthAvg'),
            monthDays: document.getElementById('monthDays'), monthTotalHours: document.getElementById('monthTotalHours')
        };
    }

    /* ---------- Toast ---------- */
    function showToast(msg, isError) {
        var t = document.getElementById('appToast');
        if (!t) { t = document.createElement('div'); t.id = 'appToast'; t.className = 'app-toast'; document.querySelector('.app').appendChild(t); }
        t.innerText = msg; t.className = 'app-toast show' + (isError ? ' err' : '');
        clearTimeout(t._timer); t._timer = setTimeout(function () { t.className = 'app-toast'; }, 2400);
    }
    function closeSettings() { var m = document.getElementById('settingsModal'); if (m) m.classList.remove('show'); }
    WT.ui = WT.ui || {}; WT.ui.showToast = showToast; WT.ui.closeSettings = closeSettings;

    /* ---------- 时钟 ---------- */
    function updateClock() { if (els.clock) els.clock.innerText = new Date().toLocaleTimeString('en-GB', { hour12: false }); }
    var clockTimer = null;
    function startClock() { updateClock(); clockTimer = setInterval(updateClock, 1000); }
    function stopClock() { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }

    /* ---------- 日历 DOM 复用池（优化 #4） ---------- */
    var _calCells = []; /* 缓存池，最多 42 个 cell（6 行 × 7 列） */
    function _ensureCalCells(count) {
        var grid = els.calGrid; if (!grid) return [];
        while (_calCells.length < count) {
            var div = document.createElement('div'); div.className = 'cal-date';
            div.addEventListener('click', function (ev) { var d = ev.currentTarget._dt; if (!d) return; selectedDate = d; WT._selectedDate = d; var cd = data.allData[util.getLocalDateStr(d)]; if (cd) { status = cd.status; data.currentShiftType = cd.shiftType || data.currentShiftType; } WT._currentStatus = status; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; renderCalendar(); updateButtonText(); updateStats(); updateSelectedLabel(); });
            (function (dCell) { var timer = null; var start = function () { timer = setTimeout(function () { if (typeof openMakeupModal === 'function') openMakeupModal(selectedDate); }, 600); }; var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } }; dCell.addEventListener('touchstart', start, { passive: true }); dCell.addEventListener('touchend', cancel); dCell.addEventListener('touchmove', cancel); dCell.addEventListener('mousedown', start); dCell.addEventListener('mouseup', cancel); dCell.addEventListener('mouseleave', cancel); })(div);
            grid.appendChild(div); _calCells.push(div);
        }
        return _calCells;
    }
    function _applyCell(div, dn, dt, opts) {
        div.innerText = dn; div._dt = dt;
        div.classList.remove('dim', 'cal-done', 'cal-partial', 'has-record', 'selected', 'today');
        if (opts.dim) div.classList.add('dim');
        var ds = util.getLocalDateStr(dt), dd = data.allData[ds];
        if (dd) { var c = [dd.status.s1, dd.status.e1, dd.status.s2, dd.status.e2].filter(Boolean).length; if (c === 4) div.classList.add('cal-done'); else if (c > 0) div.classList.add('cal-partial'); }
        if (dd && (dd.status.s1 || dd.status.e1 || dd.status.s2 || dd.status.e2)) div.classList.add('has-record');
        if (opts.isSelected) div.classList.add('selected');
        if (opts.isToday) div.classList.add('today');
    }
    function renderCalendar() {
        var y = currentMonth.year, m = currentMonth.month;
        if (els.calTitle) els.calTitle.innerText = y + '年 ' + util.pad(m + 1) + '月';
        var firstDay = new Date(y, m, 1), startDay = firstDay.getDay(); if (startDay === 0) startDay = 7; startDay -= 1;
        var daysInMonth = new Date(y, m + 1, 0).getDate(), prevMonthDays = new Date(y, m, 0).getDate();
        var totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
        var today = new Date();
        var cells = _ensureCalCells(totalCells);
        for (var i = 0; i < totalCells; i++) {
            var div = cells[i]; div.style.display = '';
            var dn = i - startDay + 1, dt = new Date(y, m, dn);
            var dim = false; if (dn <= 0) { dim = true; dn = prevMonthDays + dn; } else if (dn > daysInMonth) { dim = true; dn = dn - daysInMonth; }
            _applyCell(div, dn, dt, { dim: dim, isSelected: dt.toDateString() === selectedDate.toDateString(), isToday: dt.toDateString() === today.toDateString() });
        }
        /* 隐藏池中多余的 cell（缩容时复用，不销毁） */
        for (var j = totalCells; j < _calCells.length; j++) { _calCells[j].style.display = 'none'; }
        if (chart && chart.drawChart) chart.drawChart();
    }
    function renderWeekView() {
        var w = util.getWeekRange(selectedDate), grid = els.calGrid; if (!grid) return;
        if (els.calTitle) els.calTitle.innerText = (w.mon.getMonth() + 1) + '月' + w.mon.getDate() + '日 - ' + (w.sun.getMonth() + 1) + '月' + w.sun.getDate() + '日';
        var today = new Date(); var cells = _ensureCalCells(7);
        var idx = 0;
        for (var d = new Date(w.mon); d <= w.sun; d.setDate(d.getDate() + 1)) {
            var div = cells[idx++]; div.style.display = '';
            var dt = new Date(d), ds = util.getLocalDateStr(dt);
            _applyCell(div, dt.getDate(), dt, { dim: false, isSelected: dt.toDateString() === selectedDate.toDateString(), isToday: dt.toDateString() === today.toDateString() });
        }
        for (; idx < _calCells.length; idx++) _calCells[idx].style.display = 'none';
    }
    function changeMonth(o) { currentMonth.month += o; if (currentMonth.month < 0) { currentMonth.month = 11; currentMonth.year--; } if (currentMonth.month > 11) { currentMonth.month = 0; currentMonth.year++; } renderCalendar(); }
    function changeWeek(o) { var t = new Date(util.getWeekRange(selectedDate).mon); t.setDate(t.getDate() + o * 7); selectedDate = t; WT._selectedDate = t; currentMonth = { year: t.getFullYear(), month: t.getMonth() }; renderWeekView(); updateSelectedLabel(); updateButtonText(); updateStats(); }
    function collapseCalendar() { var ic = document.getElementById('collapseCal'); if (!ic) return; if (ic.innerText === '▽') { renderWeekView(); ic.innerText = '△'; if (chart) chart.syncChartWithCalView(false); } else { renderCalendar(); ic.innerText = '▽'; if (chart) chart.syncChartWithCalView(true); } }
    function updateSelectedLabel() { if (els.selDateText) els.selDateText.innerText = selectedDate.getFullYear() + '年' + (selectedDate.getMonth() + 1) + '月' + selectedDate.getDate() + '日'; }
    function changeShift() {
        data.currentShiftType = els.shiftSelect.value; data.saveDefaultShiftType();
        var cd = data.allData[util.getLocalDateStr(selectedDate)]; if (cd) cd.shiftType = data.currentShiftType;
        if (els.shiftText) els.shiftText.innerText = '排班时段: ' + data.shiftsConfig[data.currentShiftType].text;
        refreshStatusRef(); updateButtonText(); updateStats();
    }
    /* 打卡步骤（优化 #1：去掉多余守卫） */
    function getSmartStepIndex() { return [status.s1, status.e1, status.s2, status.e2].filter(Boolean).length; }
    function updateButtonText() { if (els.btnText) els.btnText.innerText = getSmartStepIndex() < 4 ? data.shiftsConfig[data.currentShiftType].steps[getSmartStepIndex()] : "已完成"; }

    /* ---------- 打卡 ---------- */
    function isInPeriods(periods, hm) { for (var i = 0; i < periods.length; i++) { var p = periods[i]; if (hm >= p.start && hm <= p.end) return true; } return false; }
    function smartPunch() {
        var btn = els.punchBtn; if (!btn || btn.disabled) return; btn.disabled = true; btn.style.opacity = '0.5';
        var now = new Date(), ts = util.getCurrentTimeStr(now), tshm = ts.slice(0, 5), cfg = data.shiftsConfig[data.currentShiftType], ok = false;
        if (isInPeriods(cfg.periods, tshm)) ok = true;
        if (!ok) { if (!confirm('当前时间(' + tshm + ')不在【' + cfg.name + '】排班时段内，是否强制打卡/补卡？')) { btn.disabled = false; btn.style.opacity = '1'; return; } }
        var td = new Date(selectedDate);
        if (data.currentShiftType === 'night' && now.getHours() < 6) td.setDate(td.getDate() - 1);
        var tds = util.getLocalDateStr(td);
        if (!data.allData[tds]) data.allData[tds] = { shiftType: data.currentShiftType, status: { s1: null, e1: null, s2: null, e2: null } };
        else if (!data.allData[tds].shiftType) data.allData[tds].shiftType = data.currentShiftType;
        if (td.toDateString() !== selectedDate.toDateString()) { selectedDate = td; WT._selectedDate = td; data.currentShiftType = data.allData[tds].shiftType || data.currentShiftType; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; renderCalendar(); updateSelectedLabel(); }
        refreshStatusRef(); var cs = getSmartStepIndex();
        if (cs === 0) status.s1 = ts; else if (cs === 1) status.e1 = ts; else if (cs === 2) status.s2 = ts; else if (cs === 3) status.e2 = ts;
        else { btn.disabled = false; btn.style.opacity = '1'; showToast("该日期4次打卡已满，无法增加！", true); return; }
        data.invalidateMonthCache(); data.saveData(); renderCalendar(); updateStats(); updateButtonText(); if (chart) chart.drawChart();
        if (navigator.vibrate) try { navigator.vibrate(50); } catch (e) {}
        showToast("✅ 打卡成功"); btn.disabled = false; btn.style.opacity = '1';
    }
    function deleteRecordByDate(ds, key) {
        if (!confirm('确定删除 ' + ds + ' 的这条记录吗？')) return;
        if (!data.allData[ds]) return;
        data.allData[ds].status[key] = null; data.invalidateMonthCache(); data.saveData();
        if (ds === util.getLocalDateStr(selectedDate)) refreshStatusRef();
        renderHistoryList(); renderCalendar(); updateStats(); updateSelectedLabel(); if (chart) chart.drawChart(); showToast("删除成功");
    }
    function toggleTodayDetails(e) { if (e.target.closest && e.target.closest('#todayDetail')) return; var d = els.todayDetail, ic = els.expandIcon; if (!d) return; if (d.style.display === 'none') { d.style.display = 'block'; if (ic) ic.innerText = '△'; } else { d.style.display = 'none'; if (ic) ic.innerText = '▽'; } }
    function updateStats() {
        var tot = data.getTodayTotal();
        if (els.totalHours) els.totalHours.innerText = tot.toFixed(2);
        if (els.punchCount) els.punchCount.innerText = getSmartStepIndex() + ' / 4';
        if (els.shiftBar) els.shiftBar.className = getSmartStepIndex() === 4 ? 'shift-bar done' : 'shift-bar';
        if (els.d_s1) els.d_s1.innerText = status.s1 || '--:--:--'; if (els.d_e1) els.d_e1.innerText = status.e1 || '--:--:--';
        if (els.d_s2) els.d_s2.innerText = status.s2 || '--:--:--'; if (els.d_e2) els.d_e2.innerText = status.e2 || '--:--:--';
        var ms = data.getMonthStats();
        if (els.monthTotalHours) els.monthTotalHours.innerText = ms.total.toFixed(2); if (els.monthDays) els.monthDays.innerText = ms.days; if (els.monthAvg) els.monthAvg.innerText = ms.days > 0 ? (ms.total / ms.days).toFixed(2) : "0.00";
    }

    /* ---------- 设置 / 历史 / 关于 ---------- */
    function openSettings() { var m = document.getElementById('settingsModal'); if (m) { var sw = document.getElementById('calDefaultSwitch'); if (sw) { sw.classList.toggle('on', !!data.calDefaultExpanded); sw.setAttribute('aria-checked', data.calDefaultExpanded ? 'true' : 'false'); } m.classList.add('show'); } }
    function openRecordHistory() { closeSettings(); var m = document.getElementById('historyModal'); if (m) m.classList.add('show'); var t = new Date(); var sd = document.getElementById('historyStartDate'), ed = document.getElementById('historyEndDate'); if (sd) sd.value = util.getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1)); if (ed) ed.value = util.getLocalDateStr(t); renderHistoryList(); }
    function closeHistory() { var m = document.getElementById('historyModal'); if (m) m.classList.remove('show'); }
    var APP_VERSION = '1.7.3'; /* 兜底值；loadAboutData 成功时会用 version.json 覆盖 */
    var CHANGELOG = []; /* 由 loadAboutData 填充 */
    function loadAboutData(cb) {
        cb = cb || function () {};
        var done = 0, total = 2, ready = function () { if (++done >= total) { renderChangelog(); cb(); } };
        fetch('version.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && j.version) APP_VERSION = String(j.version); }).catch(function () {}).then(ready);
        fetch('changelog.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (j && Array.isArray(j) && j.length) CHANGELOG = j; }).catch(function () {}).then(ready);
    }
    function renderChangelog() { var box = document.getElementById('changelogList'); if (!box) return; box.innerHTML = ''; CHANGELOG.forEach(function (log) { var item = document.createElement('div'); item.className = 'changelog-item'; var tagVal = log.tag || log.type || '优化', tagDisp = log.tag || log.type || '优化'; var tagCls = 'tag-' + ({'新增':'new','优化':'opt','修复':'fix','发布':'rel'}[tagVal] || 'opt'); var html = '<div class="changelog-head"><span class="changelog-version">v' + log.version + '</span><span class="changelog-tag ' + tagCls + '">' + tagDisp + '</span><span class="changelog-date">' + log.date + '</span></div><ul class="changelog-items">'; (log.items || []).forEach(function (t) { html += '<li>' + (typeof t === 'string' ? t : t.text || '') + '</li>'; }); html += '</ul>'; item.innerHTML = html; box.appendChild(item); }); }
    function checkForUpdates() { var btn = document.getElementById('checkUpdateBtn'); if (btn) { btn.disabled = true; btn.innerText = '检查中…'; } var onDone = function (msg) { showToast(msg); if (btn) { btn.disabled = false; btn.innerText = '🔄 检查更新'; } }; fetch('version.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) { if (!j || !j.version) { onDone("⚠️ 无法读取版本信息"); return; } var remote = String(j.version), cur = APP_VERSION; if (cur.replace(/^v/, '') === remote.replace(/^v/, '')) onDone("✅ 当前已是最新版本 v" + cur); else onDone("🆕 发现新版本 v" + remote + "（当前 v" + cur + "），请前往更新"); }).catch(function () { onDone("⚠️ 检查更新失败（可能以 file:// 打开，建议用 http server）"); }); }
    function openAbout() { closeSettings(); var av = document.getElementById('aboutVersion'); if (av) av.innerText = APP_VERSION; renderChangelog(); var m = document.getElementById('aboutModal'); if (m) m.classList.add('show'); }
    function closeAbout() { var m = document.getElementById('aboutModal'); if (m) m.classList.remove('show'); }
    function renderHistoryList() {
        var ld = document.getElementById('historyList'); if (!ld) return; ld.innerHTML = ""; var sd = document.getElementById('historyStartDate').value, ed = document.getElementById('historyEndDate').value;
        if (!sd || !ed) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">请选择日期范围后点击查询</div>'; return; }
        var fds = Object.keys(data.allData).sort(function (a, b) { return b.localeCompare(a); }).filter(function (d) { return d >= sd && d <= ed; });
        if (fds.length === 0) { ld.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">在 ' + sd + ' 至 ' + ed + ' 期间，暂无打卡记录</div>'; return; }
        fds.forEach(function (ds) {
            var dy = data.allData[ds], st = dy.status, dt = dy.shiftType || 'day', d1 = util.getDuration(st.s1, st.e1), d2 = util.getDuration(st.s2, st.e2), th = (d1 + d2).toFixed(2);
            var steps = data.shiftsConfig[dt].steps, keys = ['s1', 'e1', 's2', 'e2'], it = document.createElement('div'); it.className = 'history-item';
            var h = '<div class="history-item-header"><span class="history-date">' + ds + '</span><span class="history-total">总工时: ' + th + ' h</span></div><div class="history-item-body">';
            for (var i = 0; i < steps.length; i++) { var k = keys[i], tm = st[k]; h += '<div class="history-row"><span class="history-label">' + steps[i] + '</span><span class="history-time ' + (tm ? 'done' : 'pending') + '">' + (tm || '--:--:--') + '</span>' + (tm ? '<span class="history-del" data-date="' + ds + '" data-key="' + k + '">删除</span>' : '') + '</div>'; }
            h += '</div>'; it.innerHTML = h; ld.appendChild(it);
        });
        ld.querySelectorAll('.history-del').forEach(function (b) { b.addEventListener('click', function () { deleteRecordByDate(b.dataset.date, b.dataset.key); }); });
    }
    function triggerDownload(fn, ct, mt) { try { var b = (ct instanceof Blob) ? ct : new Blob([ct], { type: mt }), u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = fn; a.rel = 'noopener'; document.body.appendChild(a); var clicked = false; try { a.click(); clicked = true; } catch (e) { clicked = false; } if (clicked) setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} }, 0); else { try { document.body.removeChild(a); } catch (e) {} window.open(u, '_blank', 'noopener'); } setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000); return true; } catch (e) { return false; } }
    function buildBackupJSON() { return JSON.stringify(data.allData, null, 0); }
    function buildBackupFileName() { var t = new Date(); return '工时记录备份_' + t.getFullYear() + util.pad(t.getMonth() + 1) + util.pad(t.getDate()) + '_' + util.pad(t.getHours()) + util.pad(t.getMinutes()) + '.json'; }
    function downloadBackup() { var dlOk = triggerDownload(buildBackupFileName(), buildBackupJSON(), 'application/json'); closeSettings(); showToast(dlOk ? "✅ 备份文件已开始下载" : "❌ 下载失败，请重试", !dlOk); }
    function copyData() {
        var ds = buildBackupJSON(); var showFallback = function () { var m = document.getElementById('copyFallbackModal'); if (m) { var t = document.getElementById('copyFallbackText'); if (t) t.value = ds; m.classList.add('show'); } };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ds).then(function () { closeSettings(); showToast("📋 备份数据已复制到剪贴板"); }).catch(function () { showFallback(); }); else showFallback();
    }
    function openImportFromFile() {
        closeSettings(); var inp = document.getElementById('importFileInput'); if (!inp) { openImportModal(); return; } inp.value = ''; if (inp._bound) { inp.click(); return; } inp._bound = true;
        inp.addEventListener('change', function () {
            var f = inp.files && inp.files[0]; if (!f) return; var reader = new FileReader();
            reader.onload = function (ev) { var text = ev.target && ev.target.result; if (!text) { showToast("❌ 读取文件为空", true); return; } try { var id = JSON.parse(text); if (!id || typeof id !== 'object' || Array.isArray(id)) { showToast("❌ 备份格式不正确（应为 JSON 对象）", true); return; } var dayCount = Object.keys(id).length; if (!confirm("导入将用该备份覆盖当前所有数据（共 " + dayCount + " 条日期记录），确定继续吗？")) return; data.allData = id; data.invalidateMonthCache(); data.saveData(); refreshStatusRef(); data.currentShiftType = data.allData[util.getLocalDateStr(selectedDate)] ? (data.allData[util.getLocalDateStr(selectedDate)].shiftType || data.currentShiftType) : data.currentShiftType; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; (data.calDefaultExpanded ? renderCalendar() : renderWeekView()); var ic = document.getElementById('collapseCal'); if (ic) ic.innerText = data.calDefaultExpanded ? '▽' : '△'; if (chart) chart.syncChartWithCalView(data.calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); if (chart) chart.drawChart(); showToast("✅ 已从备份文件导入 " + dayCount + " 条记录"); } catch (e) { showToast("❌ 导入失败：文件不是合法 JSON", true); } };
            reader.onerror = function () { showToast("❌ 读取文件失败", true); }; reader.readAsText(f);
        }); inp.click();
    }
    function openImportModal() { closeSettings(); var v = prompt("请粘贴之前备份的 JSON 数据："); if (!v) return; try { var id = JSON.parse(v); if (!id || typeof id !== 'object' || Array.isArray(id)) { showToast("❌ 备份格式不正确", true); return; } var dayCount = Object.keys(id).length; if (confirm("导入将覆盖当前所有数据（共 " + dayCount + " 条日期记录），确定继续吗？")) { data.allData = id; data.invalidateMonthCache(); data.saveData(); refreshStatusRef(); data.currentShiftType = data.allData[util.getLocalDateStr(selectedDate)] ? (data.allData[util.getLocalDateStr(selectedDate)].shiftType || data.currentShiftType) : data.currentShiftType; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; (data.calDefaultExpanded ? renderCalendar() : renderWeekView()); var ic = document.getElementById('collapseCal'); if (ic) ic.innerText = data.calDefaultExpanded ? '▽' : '△'; if (chart) chart.syncChartWithCalView(data.calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); if (chart) chart.drawChart(); showToast("✅ 数据导入成功（" + dayCount + " 条）"); } } catch (e) { showToast("❌ 导入失败：格式不正确", true); } }
    function clearAllData() { if (!confirm("【警告】将删除本地所有打卡记录！\n建议先备份。是否继续？")) return; if (!confirm("最后确认：真的清空所有数据吗？不可撤销！")) return; data.allData = {}; if (data.storageAvailable) localStorage.removeItem('attendanceData'); data.invalidateMonthCache(); refreshStatusRef(); data.saveData(); renderCalendar(); updateSelectedLabel(); updateStats(); if (chart) chart.drawChart(); showToast("所有数据已清空"); closeSettings(); }

    /* ---------- 补卡 ---------- */
    function openMakeupModal(pd) { var dt = pd || new Date(), dv = util.getLocalDateStr(dt); var md = document.getElementById('makeupDate'); if (md) md.value = dv; var mt = document.getElementById('makeupTime'); if (mt) mt.value = "12:00:00"; var es = (data.allData[dv] && data.allData[dv].shiftType) || data.currentShiftType, sl = document.getElementById('makeupType'); if (sl) { sl.innerHTML = ""; data.shiftsConfig[es].steps.forEach(function (s, i) { var o = document.createElement('option'); o.value = data.shiftsConfig[es].keys[i]; o.innerText = s; sl.appendChild(o); }); } var m = document.getElementById('makeupModal'); if (m) m.classList.add('show'); }
    function closeMakeupModal() { var m = document.getElementById('makeupModal'); if (m) m.classList.remove('show'); }
    function submitMakeup() { var dt = document.getElementById('makeupDate').value, ky = document.getElementById('makeupType').value, tm = document.getElementById('makeupTime').value; if (!dt || !tm) { showToast("请完整选择日期和时间！", true); return; } var es = (data.allData[dt] && data.allData[dt].shiftType) || data.currentShiftType; if (!data.allData[dt]) data.allData[dt] = { shiftType: es, status: { s1: null, e1: null, s2: null, e2: null } }; data.allData[dt].status[ky] = tm; var p2 = dt.split('-'); selectedDate = new Date(+p2[0], +p2[1] - 1, +p2[2]); WT._selectedDate = selectedDate; data.currentShiftType = data.allData[dt].shiftType || data.currentShiftType; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; refreshStatusRef(); currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() }; data.invalidateMonthCache(); data.saveData(); renderCalendar(); updateSelectedLabel(); updateStats(); if (chart) chart.drawChart(); closeMakeupModal(); showToast("补卡成功（" + dt + " " + ky + ": " + tm + "）"); }

    /* ---------- 自定义班别时间段 ---------- */
    function openShiftSettings() {
        closeSettings(); var m = document.getElementById('shiftSettingsModal'); if (!m) return;
        var fill = function (prefix, periods) { for (var i = 0; i < 2; i++) { var p = periods[i] || { start: '00:00', end: '00:00' }; var sEl = document.getElementById(prefix + 'Start' + (i + 1)), eEl = document.getElementById(prefix + 'End' + (i + 1)); if (sEl) sEl.value = p.start; if (eEl) eEl.value = p.end; } };
        fill('day', data.shiftsConfig.day.periods); fill('night', data.shiftsConfig.night.periods);
        var errEl = document.getElementById('shiftSettingsErr'); if (errEl) errEl.style.display = 'none'; m.classList.add('show');
    }
    function closeShiftSettings() { var m = document.getElementById('shiftSettingsModal'); if (m) m.classList.remove('show'); }
    function readShiftPeriods(prefix) { var ps = []; for (var i = 0; i < 2; i++) { var s = document.getElementById(prefix + 'Start' + (i + 1)).value, e = document.getElementById(prefix + 'End' + (i + 1)).value; if (!s || !e) return { ok: false, msg: '请完整填写所有起止时间（HH:MM）' }; if (!data.isValidPeriod({ start: s, end: e })) return { ok: false, msg: '时间格式应为 HH:MM（如 08:00）' }; ps.push({ start: s, end: e }); } return { ok: true, periods: ps }; }
    function applyShiftSettings() { var dayR = readShiftPeriods('day'), nightR = readShiftPeriods('night'), errEl = document.getElementById('shiftSettingsErr'); if (!dayR.ok) { if (errEl) { errEl.innerText = '白班：' + dayR.msg; errEl.style.display = 'block'; } return; } if (!nightR.ok) { if (errEl) { errEl.innerText = '夜班：' + nightR.msg; errEl.style.display = 'block'; } return; } data.shiftsConfig.day.periods = dayR.periods; data.shiftsConfig.day.text = data.buildShiftText(dayR.periods); data.shiftsConfig.night.periods = nightR.periods; data.shiftsConfig.night.text = data.buildShiftText(nightR.periods); data.saveShiftSchedules(); if (els.shiftText) els.shiftText.innerText = '排班时段: ' + data.shiftsConfig[data.currentShiftType].text; updateButtonText(); updateStats(); if (chart) chart.drawChart(); closeShiftSettings(); showToast("✅ 班别时间段已更新"); }
    function resetShiftSettings() { if (!confirm("确定恢复白/夜班时间段为系统默认吗？")) return; var def = data.DEFAULT_SCHEDULES; data.shiftsConfig.day = { name: def.day.name, periods: def.day.periods.slice(), steps: def.day.steps, keys: def.day.keys, labels: def.day.labels }; data.shiftsConfig.night = { name: def.night.name, periods: def.night.periods.slice(), steps: def.night.steps, keys: def.night.keys, labels: def.night.labels }; data.shiftsConfig.day.text = data.buildShiftText(data.shiftsConfig.day.periods); data.shiftsConfig.night.text = data.buildShiftText(data.shiftsConfig.night.periods); data.saveShiftSchedules(); if (els.shiftText) els.shiftText.innerText = '排班时段: ' + data.shiftsConfig[data.currentShiftType].text; updateButtonText(); updateStats(); if (chart) chart.drawChart(); closeShiftSettings(); showToast("已恢复默认班别时间段"); }

    /* ---------- 报表 ---------- */
    function openReportRangeModal(mode) { var m = document.getElementById('reportRangeModal'); if (!m) return; m.classList.add('show'); m.dataset.mode = mode; document.querySelectorAll('.rpt-option').forEach(function (o) { o.classList.remove('selected'); }); var def = document.querySelector('.rpt-option[data-val="month"]'); if (def) def.classList.add('selected'); var rc = document.getElementById('rptRangeCustom'); if (rc) rc.style.display = 'none'; }
    function closeReportRangeModal() { var m = document.getElementById('reportRangeModal'); if (m) m.classList.remove('show'); }
    function getReportRange(op) { var t = new Date(), y = t.getFullYear(), m = t.getMonth(); if (op === 'month') return { start: util.getLocalDateStr(new Date(y, m, 1)), end: util.getLocalDateStr(new Date(y, m + 1, 0)), label: '本月' }; if (op === 'week') { var w = t.getDay(); if (w === 0) w = 7; var mn = new Date(t); mn.setDate(t.getDate() - w + 1); var su = new Date(mn); su.setDate(mn.getDate() + 6); return { start: util.getLocalDateStr(mn), end: util.getLocalDateStr(su), label: '本周' }; } var s = document.getElementById('rptRangeStart').value, e = document.getElementById('rptRangeEnd').value; if (!s || !e) { showToast("请选择完整起止日期", true); return null; } if (s > e) { showToast("开始日期不能晚于结束日期", true); return null; } return { start: s, end: e, label: '自定义_' + s + '_' + e }; }
    function buildReport(range) { var thr = chart ? chart.chartTargetHours : 6; var hd = ['日期', '排班', '上午上班', '上午下班', '下午上班', '下午下班', '上午工时', '下午工时', '当日总工时', '是否达标(≥' + thr + 'h)'], rows = [hd], lines = ['📊 工时报表 ' + range.start + ' ~ ' + range.end + '  (达标线 ' + thr + 'h)', ''], mt = 0, md = 0, okd = 0; for (var d = new Date(range.start); d <= new Date(range.end); d.setDate(d.getDate() + 1)) { var ds = util.getLocalDateStr(d), dy = data.allData[ds]; if (!dy) continue; var st = dy.status; if (!st.s1 && !st.e1 && !st.s2 && !st.e2) continue; var dt = dy.shiftType || 'day', d1 = util.getDuration(st.s1, st.e1), d2 = util.getDuration(st.s2, st.e2), tot = (d1 + d2), totStr = tot.toFixed(2); mt += tot; md++; var ok = tot >= thr; if (ok) okd++; lines.push(ds + ' [' + (dt === 'night' ? '夜班' : '白班') + ']' + (ok ? ' ✅达标' : ''), '  ' + data.shiftsConfig[dt].steps[0] + ': ' + (st.s1 || '--'), '  ' + data.shiftsConfig[dt].steps[1] + ': ' + (st.e1 || '--'), '  ' + data.shiftsConfig[dt].steps[2] + ': ' + (st.s2 || '--'), '  ' + data.shiftsConfig[dt].steps[3] + ': ' + (st.e2 || '--'), '  当日工时: ' + totStr + 'h' + (ok ? ' ✅' : ''), ''); rows.push([ds, dt === 'night' ? '夜班' : '白班', st.s1 || '', st.e1 || '', st.s2 || '', st.e2 || '', d1.toFixed(2), d2.toFixed(2), totStr, ok ? '达标' : '未达标']); } if (md === 0) return null; lines.push('─── 合计 ───', '打卡天数: ' + md + ' 天', '达标天数: ' + okd + ' 天', '总工时: ' + mt.toFixed(2) + ' h', '平均工时: ' + (mt / md).toFixed(2) + ' h'); rows.push(['', '', '', '', '', '合计', md + '天(' + okd + '天达标)', '', mt.toFixed(2), okd + '/' + md]); return { text: lines.join('\n'), rows: rows, monthDays: md, monthTotal: mt, okDays: okd }; }
    function exportMonthCSV() { var r = data.getMonthRange(), res = buildReport(r); if (!res) { showToast("本月暂无打卡记录可导出", true); return; } var csv = res.rows.map(function (r2) { return r2.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'), t = new Date(), fn = '工时报表_' + t.getFullYear() + '年' + util.pad(t.getMonth() + 1) + '月.csv'; triggerDownload(fn, '\uFEFF' + csv, 'text/csv;charset=utf-8'); showToast("📤 报表已开始下载"); }
    function shareMonthReport() { var r = data.getMonthRange(), res = buildReport(r); if (!res) { showToast("本月暂无打卡记录可分享", true); return; } if (navigator.share) navigator.share({ title: '工时报表', text: res.text }).then(function () { showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') fallbackCopyText(res.text); }); else fallbackCopyText(res.text); }
    function fallbackCopyText(txt) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("📋 报表内容已复制到剪贴板"); }).catch(function () { textareaFallback(txt); }); else textareaFallback(txt); }
    function textareaFallback(txt) { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); showToast("📋 报表内容已复制到剪贴板"); } catch (e) { showToast("❌ 复制失败，请手动导出 CSV", true); } document.body.removeChild(ta); }

    /* ---------- 初始化 ---------- */
    function init() {
        cacheEls();
        if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType;
        if (!document.getElementById('appToast')) { var t2 = document.createElement('div'); t2.id = 'appToast'; t2.className = 'app-toast'; var app = document.querySelector('.app'); if (app) app.appendChild(t2); }
        if (!data.storageAvailable && !sessionStorage.getItem('warnedNoStorage')) { showToast("⚠️ 当前以 file:// 打开，数据仅存内存，建议用 http(s) 打开", true); sessionStorage.setItem('warnedNoStorage', '1'); }
        var todayTag = document.getElementById('todayTag'); if (todayTag) { todayTag.style.cursor = 'pointer'; todayTag.title = '点击回到今天'; todayTag.addEventListener('click', function () { selectedDate = new Date(); WT._selectedDate = selectedDate; currentMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() }; refreshStatusRef(); data.currentShiftType = data.allData[util.getLocalDateStr(selectedDate)] ? (data.allData[util.getLocalDateStr(selectedDate)].shiftType || data.currentShiftType) : data.currentShiftType; if (els.shiftSelect) els.shiftSelect.value = data.currentShiftType; (data.calDefaultExpanded ? renderCalendar() : renderWeekView()); var ic = document.getElementById('collapseCal'); if (ic) ic.innerText = data.calDefaultExpanded ? '▽' : '△'; if (chart) chart.syncChartWithCalView(data.calDefaultExpanded); updateSelectedLabel(); updateButtonText(); updateStats(); }); }
        updateButtonText(); (data.calDefaultExpanded ? renderCalendar() : renderWeekView()); var ic = document.getElementById('collapseCal'); if (ic) ic.innerText = data.calDefaultExpanded ? '▽' : '△'; updateSelectedLabel(); if (chart) chart.initChart();
        loadAboutData();
        bindEvents(); startClock();
        document.addEventListener('visibilitychange', function () { if (document.hidden) stopClock(); else startClock(); });
    }
    function toggleCalDefault() { data.calDefaultExpanded = !data.calDefaultExpanded; data.saveCalDefaultExpanded(data.calDefaultExpanded); var sw = document.getElementById('calDefaultSwitch'); if (sw) { sw.classList.toggle('on', !!data.calDefaultExpanded); sw.setAttribute('aria-checked', data.calDefaultExpanded ? 'true' : 'false'); } var ic = document.getElementById('collapseCal'); if (ic) ic.innerText = data.calDefaultExpanded ? '▽' : '△'; (data.calDefaultExpanded ? renderCalendar() : renderWeekView()); if (chart) chart.syncChartWithCalView(data.calDefaultExpanded); showToast(data.calDefaultExpanded ? '✅ 月历已展开为月视图' : '✅ 月历已折叠为周视图'); }

    /* ---------- 事件绑定 ---------- */
    function bindEvents() {
        if (els.shiftSelect) els.shiftSelect.addEventListener('change', changeShift);
        if (els.punchBtn) els.punchBtn.addEventListener('click', smartPunch);
        var cancelM = document.getElementById('cancelMakeup'); if (cancelM) cancelM.addEventListener('click', closeMakeupModal);
        var cancelM2 = document.getElementById('cancelMakeup2'); if (cancelM2) cancelM2.addEventListener('click', closeMakeupModal);
        var confM = document.getElementById('confirmMakeup'); if (confM) confM.addEventListener('click', submitMakeup);
        var setBtn = document.getElementById('openSettingsBtn'); if (setBtn) setBtn.addEventListener('click', openSettings);
        var closeS = document.getElementById('closeSettingsBtn'); if (closeS) closeS.addEventListener('click', closeSettings);
        var closeS2 = document.getElementById('closeSettingsBtn2'); if (closeS2) closeS2.addEventListener('click', closeSettings);
        var histItem = document.getElementById('openHistoryItem'); if (histItem) histItem.addEventListener('click', openRecordHistory);
        var closeH = document.getElementById('closeHistoryBtn'); if (closeH) closeH.addEventListener('click', closeHistory);
        var histQ = document.getElementById('historyQueryBtn'); if (histQ) histQ.addEventListener('click', renderHistoryList);
        var dlB = document.getElementById('downloadBackupItem'); if (dlB) dlB.addEventListener('click', downloadBackup);
        var cpD = document.getElementById('copyDataItem'); if (cpD) cpD.addEventListener('click', copyData);
        var impF = document.getElementById('importFileItem'); if (impF) impF.addEventListener('click', openImportFromFile);
        var impP = document.getElementById('openImportItem'); if (impP) impP.addEventListener('click', openImportModal);
        var clrD = document.getElementById('clearDataItem'); if (clrD) clrD.addEventListener('click', clearAllData);
        var expR = document.getElementById('exportReportItem'); if (expR) expR.addEventListener('click', function () { closeSettings(); openReportRangeModal('export'); });
        var shrR = document.getElementById('shareReportItem'); if (shrR) shrR.addEventListener('click', function () { closeSettings(); openReportRangeModal('share'); });
        var aboutI = document.getElementById('openAboutItem'); if (aboutI) aboutI.addEventListener('click', openAbout);
        var calSw = document.getElementById('calDefaultSwitch'); if (calSw) { calSw.addEventListener('click', toggleCalDefault); calSw.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleCalDefault(); } }); }
        var shSet = document.getElementById('openShiftSettingsItem'); if (shSet) shSet.addEventListener('click', openShiftSettings);
        var closeA = document.getElementById('closeAboutBtn'); if (closeA) closeA.addEventListener('click', closeAbout);
        var closeA2 = document.getElementById('closeAboutBtn2'); if (closeA2) closeA2.addEventListener('click', closeAbout);
        var aboutM = document.getElementById('aboutModal'); if (aboutM) aboutM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeAbout(); });
        var chkU = document.getElementById('checkUpdateBtn'); if (chkU) chkU.addEventListener('click', checkForUpdates);
        var prevM = document.getElementById('prevMonth'); if (prevM) prevM.addEventListener('click', function () { var ic = document.getElementById('collapseCal'); if (ic && ic.innerText === '△') changeWeek(-1); else changeMonth(-1); });
        var nextM = document.getElementById('nextMonth'); if (nextM) nextM.addEventListener('click', function () { var ic = document.getElementById('collapseCal'); if (ic && ic.innerText === '△') changeWeek(1); else changeMonth(1); });
        var collC = document.getElementById('collapseCal'); if (collC) collC.addEventListener('click', collapseCalendar);
        var tSC = document.getElementById('todayStatsCard'); if (tSC) tSC.addEventListener('click', toggleTodayDetails);
        var mM = document.getElementById('makeupModal'); if (mM) mM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeMakeupModal(); });
        var sM = document.getElementById('settingsModal'); if (sM) sM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeSettings(); });
        var hM = document.getElementById('historyModal'); if (hM) hM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeHistory(); });
        var rM = document.getElementById('reportRangeModal'); if (rM) rM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeReportRangeModal(); });
        document.querySelectorAll('.rpt-option').forEach(function (opt) { opt.addEventListener('click', function () { document.querySelectorAll('.rpt-option').forEach(function (o) { o.classList.remove('selected'); }); opt.classList.add('selected'); var rc = document.getElementById('rptRangeCustom'); if (rc) rc.style.display = opt.dataset.val === 'custom' ? 'flex' : 'none'; }); });
        var rC = document.getElementById('rptRangeCancel'); if (rC) rC.addEventListener('click', closeReportRangeModal);
        var rC2 = document.getElementById('rptRangeCancel2'); if (rC2) rC2.addEventListener('click', closeReportRangeModal);
        var rConf = document.getElementById('rptRangeConfirm'); if (rConf) rConf.addEventListener('click', function () { var m = document.getElementById('reportRangeModal'), mode = m.dataset.mode, op = document.querySelector('.rpt-option.selected').dataset.val, range = getReportRange(op); if (!range) return; closeReportRangeModal(); var res = buildReport(range); if (!res) { showToast("该范围内暂无打卡记录", true); return; } if (mode === 'export') { var csv = res.rows.map(function (r2) { return r2.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'), fn = '工时报表_' + range.label + '.csv'; triggerDownload(fn, '\uFEFF' + csv, 'text/csv;charset=utf-8'); showToast("📤 报表已开始下载"); } else { if (navigator.share) navigator.share({ title: '工时报表 ' + range.label, text: res.text }).then(function () { showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') fallbackCopyText(res.text); }); else fallbackCopyText(res.text); } });
        var cpFC = document.getElementById('copyFallbackClose'); if (cpFC) cpFC.addEventListener('click', function () { var m = document.getElementById('copyFallbackModal'); if (m) m.classList.remove('show'); });
        var cpFC2 = document.getElementById('copyFallbackClose2'); if (cpFC2) cpFC2.addEventListener('click', function () { var m = document.getElementById('copyFallbackModal'); if (m) m.classList.remove('show'); });
        var cpFR = document.getElementById('copyFallbackRetry'); if (cpFR) cpFR.addEventListener('click', function () { var txt = document.getElementById('copyFallbackText').value; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("📋 已复制到剪贴板"); }).catch(function () { showToast("❌ 复制失败，请手动长按复制", true); }); else showToast("❌ 复制失败，请手动长按复制", true); });
        var shC = document.getElementById('shiftSettingsCancel'); if (shC) shC.addEventListener('click', closeShiftSettings);
        var shCl = document.getElementById('shiftSettingsClose'); if (shCl) shCl.addEventListener('click', closeShiftSettings);
        var shCf = document.getElementById('shiftSettingsConfirm'); if (shCf) shCf.addEventListener('click', applyShiftSettings);
        var shR = document.getElementById('shiftSettingsReset'); if (shR) shR.addEventListener('click', resetShiftSettings);
        var shM = document.getElementById('shiftSettingsModal'); if (shM) shM.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeShiftSettings(); });
    }

    /* 暴露公开 API（供 chart.js 回调引用） */
    WT.ui = { showToast: showToast, closeSettings: closeSettings, openMakeupModal: openMakeupModal, renderCalendar: renderCalendar, renderWeekView: renderWeekView, updateStats: updateStats, updateButtonText: updateButtonText, refreshStatusRef: refreshStatusRef, init: init };

    document.addEventListener('DOMContentLoaded', init);

})(window);
