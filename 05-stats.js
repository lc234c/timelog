'use strict';
/*!
 * 工时记录 · 05-stats.js（统计 + 图表 + 历史记录）
 */
(function () {

const { util, state: S, data: D, salary: Sal, CONST } = App;
const { EXPORT_W, EXPORT_H, C, FONT, OT_NAME } = CONST;

let chartGeo = null, chartPts = null;

/* ============================================================
 * 1. 统计面板渲染
 * ========================================================== */
function renderStatsMonthTitle() {
    if (!S.statsView) S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() };
    const el = document.getElementById('statsMonthTitle');
    if (el) el.textContent = S.statsView.y + '年 ' + (S.statsView.m + 1) + '月';
}

function changeStatsMonth(offset) {
    const sv = S.statsView || (S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() });
    const m = sv.m + offset;
    const d = new Date(sv.y, m, 1);
    S.statsView = { y: d.getFullYear(), m: d.getMonth() };
    S.selected = new Date(d.getFullYear(), d.getMonth(), 1);
    renderStatsMonthTitle();
    App.invalidate('tabStats', 'chart', 'otList', 'leaveList', 'salary', 'otSummary');
}

function statsViewRange() {
    const sv = S.statsView || (S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() });
    const start = new Date(sv.y, sv.m, 1), end = new Date(sv.y, sv.m + 1, 0);
    return { start: util.toDateKey(start), end: util.toDateKey(end) };
}

function renderTabStats() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const sv = S.statsView || (S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() });
    const y = sv.y, m = sv.m;
    const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m + 1, 0);
    const ms = D.rangeStats(monthStart, monthEnd);
    const ws = D.weekStats();
    const week = util.weekRange(S.selected);

    setVal('tabMonthTotal', ms.total.toFixed(2));
    setVal('tabMonthDays', ms.days);
    setVal('tabMonthAvg', ms.days ? (ms.total / ms.days).toFixed(2) : '0.00');
    setVal('tabWeekTotal', ws.total.toFixed(2));
    setVal('tabWeekDays', ws.days);
    setVal('tabWeekAvg', ws.days ? (ws.total / ws.days).toFixed(2) : '0.00');

    const otM = Sal.rangeOvertime(monthStart, monthEnd);
    const otW = Sal.rangeOvertime(week.mon, week.sun);
    setVal('tabMonthOT', otM.totalHours.toFixed(1));
    setVal('tabWeekOT', otW.totalHours.toFixed(1));

    const tip = document.getElementById('tabWeekTip');
    if (tip) {
        tip.textContent = '本周 ' + (week.mon.getMonth() + 1) + '/' + week.mon.getDate() + '~' +
            (week.sun.getMonth() + 1) + '/' + week.sun.getDate() + '（点击日历切换）';
    }
}

/* ============================================================
 * 2. 历史记录
 * ========================================================== */
function pairHtml(l1, l2, t1, t2) {
    return '<div class="history-pair">' +
        '<div class="history-row"><span class="history-label">' + util.esc(l1) + '</span>' +
        '<span class="history-time ' + (t1 ? 'done' : 'pending') + '">' + util.esc(t1 || '--:--:--') + '</span></div>' +
        '<div class="history-row"><span class="history-label">' + util.esc(l2) + '</span>' +
        '<span class="history-time ' + (t2 ? 'done' : 'pending') + '">' + util.esc(t2 || '--:--:--') + '</span></div>' +
        '</div>';
}

/** 通用日期范围确保：空则填「本月1日 ~ 今天」，并保证 start<=end */
function ensureRange(sId, eId) {
    const sd = document.getElementById(sId), ed = document.getElementById(eId);
    if (!sd || !ed) return { start: '', end: '' };
    if (!util.isValidDateKey(sd.value) || !util.isValidDateKey(ed.value)) {
        const t = new Date();
        sd.value = util.toDateKey(new Date(t.getFullYear(), t.getMonth(), 1));
        ed.value = util.toDateKey(t);
    }
    if (sd.value > ed.value) { const tmp = sd.value; sd.value = ed.value; ed.value = tmp; }
    return { start: sd.value, end: ed.value };
}
const ensureHistoryRange = () => ensureRange('historyStartDate', 'historyEndDate');

function renderHistoryList() {
    const box = document.getElementById('historyList');
    if (!box) return;
    const range = ensureHistoryRange();
    if (!range.start) { box.textContent = '组件未就绪'; return; }
    const keys = Object.keys(S.data)
        .filter((ds) => util.isValidDateKey(ds) && ds >= range.start && ds <= range.end && D.punchCount(S.data[ds]) > 0)
        .sort((a, b) => b.localeCompare(a));
    if (!keys.length) {
        box.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">在 ' +
            util.esc(range.start) + ' 至 ' + util.esc(range.end) + ' 期间，暂无打卡记录</div>';
        return;
    }
    const frag = document.createDocumentFragment();
    keys.forEach((ds) => {
        const rec = S.data[ds], st = rec.status, cfg = D.getShift(rec.shiftType);
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML =
            '<div class="history-item-header"><div class="history-head-left">' +
            '<span class="history-date">' + util.esc(ds) + '</span>' +
            '<span class="history-shift-tag ' + (rec.shiftType === 'night' ? 'night' : (rec.shiftType === 'mid' ? 'mid' : 'day')) + '">' + util.esc(cfg.name) + '</span>' +
            '</div></div>' +
            '<div class="history-item-body">' +
            '<div class="history-col">' + pairHtml(cfg.steps[0], cfg.steps[1], st.s1, st.e1) + '</div>' +
            '<div class="history-col">' + pairHtml(cfg.steps[2], cfg.steps[3], st.s2, st.e2) + '</div>' +
            '</div>' +
            '<div class="history-item-footer"><span class="history-footer-label">当日总工时</span>' +
            '<span class="history-footer-hours"><b>' + D.dayHours(rec).toFixed(2) + '</b> h</span></div>';
        frag.appendChild(item);
    });
    box.textContent = '';
    box.appendChild(frag);
}

function bindCollapse(headerId, bodyId, sectionId) {
    const hdr = document.getElementById(headerId);
    if (!hdr) return;
    hdr.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.cs-add, button, a, input, select')) return;
        const sec = document.getElementById(sectionId);
        if (!sec) return;
        const open = sec.classList.toggle('is-open');
        const body = document.getElementById(bodyId);
        if (body) body.style.display = open ? 'block' : 'none';
        const arrow = sec.querySelector('.cs-arrow');
        if (arrow) arrow.textContent = open ? '▾' : '▸';
    });
}

/* ============================================================
 * 3. 图表
 * ========================================================== */
function chartRange() {
    const sel = S.selected, y = sel.getFullYear(), m = sel.getMonth();
    if (S.chart.range === 'week') { const w = util.weekRange(sel); return { start: w.mon, end: w.sun }; }
    if (S.chart.range === 'custom') {
        const s = util.parseDateKey(S.chart.customStart), e = util.parseDateKey(S.chart.customEnd);
        if (s && e) return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
}
function chartSeries() {
    const r = chartRange(), arr = [];
    util.eachDay(r.start, r.end, (d) => {
        const ds = util.toDateKey(d), rec = D.getRecord(ds);
        if (D.punchCount(rec) > 0) {
            arr.push({ date: d.getDate(), ds: ds, total: D.dayHours(rec), hasRecord: true });
        }
    });
    return arr;
}
function chartRangeLabel() {
    const sel = S.selected;
    if (S.chart.range === 'week') {
        const w = util.weekRange(sel);
        return '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '-' + (w.sun.getMonth() + 1) + '/' + w.sun.getDate();
    }
    if (S.chart.range === 'custom' && S.chart.customStart && S.chart.customEnd) {
        return S.chart.customStart.slice(5) + ' ~ ' + S.chart.customEnd.slice(5);
    }
    return (sel.getMonth() + 1) + '月';
}
function setupCanvas(canvas, dpr) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: rect.width, h: rect.height };
}
function xLabelStep(n) { return n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2)); }

function paintChart(ctx, W, H, series, opt) {
    opt = opt || {};
    ctx.clearRect(0, 0, W, H);
    if (opt.background) { ctx.fillStyle = opt.background; ctx.fillRect(0, 0, W, H); }

    /* 关键兜底：pad 缺省时给默认值，避免直接读取 undefined.left 崩溃 */
    const pad = opt.pad || { top: 18, right: 14, bottom: 26, left: 34 };
    const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
    if (cw <= 0 || ch <= 0) return null;
    if (!series || !series.length) return null;

    let maxV = 0;
    series.forEach(function(d) { if (d.total > maxV) maxV = d.total; });
    maxV = Math.max(maxV, opt.minMax || 8, S.targetHours) * 1.15;

    if (opt.title) {
        ctx.fillStyle = C.text; ctx.font = '600 15px ' + FONT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(opt.title, Math.max(8, pad.left - 20), 16);
    }

    /* ===== 1. 灰色虚线网格 ===== */
    var yTicks = 5;
    ctx.strokeStyle = '#e8eaed';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (var t = 0; t <= yTicks; t++) {
        var gv = maxV * t / yTicks;
        var gy = pad.top + ch - (gv / maxV) * ch;
        ctx.beginPath();
        ctx.moveTo(pad.left, gy);
        ctx.lineTo(W - pad.right, gy);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    /* Y轴数值标签 */
    ctx.fillStyle = '#a8a8ae';
    ctx.font = '11px ' + FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var t = 0; t <= yTicks; t++) {
        var gv = maxV * t / yTicks;
        var gy = pad.top + ch - (gv / maxV) * ch;
        ctx.fillText(gv.toFixed(0) + 'h', pad.left - 6, gy);
    }

    /* ===== 2. 红色虚线目标线 ===== */
    var yT = pad.top + ch - (S.targetHours / maxV) * ch;
    if (S.targetHours <= maxV) {
        ctx.strokeStyle = '#e86058';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, yT);
        ctx.lineTo(W - pad.right, yT);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(232,96,88,.75)';
        ctx.font = '11px ' + FONT;
        ctx.textAlign = 'left';
        ctx.fillText(S.targetHours + 'h', W - pad.right + 2, yT);
    }

    /* ===== 3. X轴标签 ===== */
    var n = series.length, bw = cw / n;
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px ' + FONT;
    var step = xLabelStep(n);
    for (var x = 0; x < n; x++) {
        if ((x + 1) % step === 0 || x === 0 || x === n - 1) {
            ctx.fillText(series[x].date, pad.left + bw * (x + 0.5), H - pad.bottom + 6);
        }
    }

    /* 数据点坐标 */
    var pts = series.map(function(d, i) {
        return {
            x: pad.left + bw * (i + 0.5),
            y: pad.top + ch - (d.total / maxV) * ch,
            d: d
        };
    });

    /* ===== 4. 蓝色圆角柱状图 ===== */
    var barW = Math.max(3, bw * 0.52);
    series.forEach(function(d, i) {
        var bh = (d.total / maxV) * ch;
        if (bh <= 0) return;
        var bx = pts[i].x - barW / 2, by = pts[i].y;
        var r = Math.min(barW / 2, 5);

        /* 蓝色渐变填充 */
        var grad = ctx.createLinearGradient(0, by, 0, by + bh);
        grad.addColorStop(0, '#5b8ff9');
        grad.addColorStop(1, 'rgba(91,143,249,.55)');
        ctx.fillStyle = grad;

        /* 圆角矩形（仅顶部圆角） */
        if (bh > r) {
            ctx.beginPath();
            ctx.moveTo(bx, by + bh);
            ctx.lineTo(bx, by + r);
            ctx.quadraticCurveTo(bx, by, bx + r, by);
            ctx.lineTo(bx + barW - r, by);
            ctx.quadraticCurveTo(bx + barW, by, bx + barW, by + r);
            ctx.lineTo(bx + barW, by + bh);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(bx, by, barW, bh);
        }

        /* 柱顶数值标签 */
        ctx.fillStyle = '#3b6cd9';
        ctx.font = 'bold 11px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(d.total.toFixed(1), pts[i].x, by - 4);
    });

    /* ===== 5. 绿色趋势折线 ===== */
    var validPts = pts.filter(function(p) { return p.d.total > 0; });
    if (validPts.length > 1) {
        ctx.strokeStyle = '#30bf78';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        validPts.forEach(function(p, i) {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        /* 双层圆节点（白底描边 + 绿色实心） */
        validPts.forEach(function(p) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#30bf78';
            ctx.lineWidth = 2;
            ctx.stroke();
            /* 内圆 */
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#30bf78';
            ctx.fill();
        });
    }

    /* 图例（导出用） */
    if (opt.legend) {
        ctx.font = '11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        var lx = pad.left + 6, ly = H - 14;
        ctx.fillStyle = '#5b8ff9'; ctx.fillRect(lx, ly - 4, 12, 8);
        ctx.fillStyle = C.tip; ctx.fillText('每日工时', lx + 18, ly);
        ctx.fillStyle = '#30bf78'; ctx.fillRect(lx + 86, ly - 4, 12, 8);
        ctx.fillStyle = C.tip; ctx.fillText('趋势线', lx + 104, ly);
        ctx.strokeStyle = '#e86058'; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
        ctx.beginPath(); ctx.moveTo(lx + 152, ly); ctx.lineTo(lx + 164, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.tip; ctx.fillText('目标(≥' + S.targetHours + 'h)', lx + 170, ly);
    }
    return { pad: pad, bw: bw, cw: cw, ch: ch, maxV: maxV, pts: pts };
}

function drawChart() {
    const canvas = App.els.chartCanvas;
    if (!canvas) return;
    const titleEl = document.getElementById('chartTitle');
    if (titleEl) titleEl.textContent = '📊 工时趋势 · ' + chartRangeLabel();

    const series = chartSeries();
    const hasAny = series.some((d) => d.total > 0);
    const emptyEl = document.getElementById('chartEmpty');

    if (!hasAny) {
        if (emptyEl) emptyEl.style.display = 'flex';
        canvas.style.display = 'none';
        chartGeo = null; chartPts = null;
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        canvas.style.display = 'block';
    }
    renderChartSummary();

    const setup = setupCanvas(canvas, window.devicePixelRatio || 1);
    if (!setup) return;
    if (!hasAny) return;

    const geo = paintChart(setup.ctx, setup.w, setup.h, series, {
        pad: { top: 18, right: 14, bottom: 26, left: 34 },
        minMax: 8
    });
    chartGeo = geo;
    chartPts = geo ? geo.pts : null;
}

function showChartTooltip(e) {
    const canvas = App.els.chartCanvas, tip = document.getElementById('chartTooltip');
    if (!canvas || !chartGeo || !chartPts || !tip) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - rect.left;
    let idx = Math.floor((cx - chartGeo.pad.left) / chartGeo.bw);
    idx = util.clamp(idx, 0, chartPts.length - 1);
    const d = chartPts[idx].d;
    if (d.total <= 0 && !d.hasRecord) { tip.style.display = 'none'; return; }
    tip.innerHTML = '<b>' + util.esc(d.ds) + '</b><br>工时: ' + d.total.toFixed(2) + ' h' +
        (d.total >= S.targetHours ? ' ✅' : '');
    const tw = tip.offsetWidth || 110;
    tip.style.left = util.clamp(chartPts[idx].x - tw / 2, 8, Math.max(8, canvas.parentElement.clientWidth - tw - 8)) + 'px';
    tip.style.top = (chartPts[idx].y - 44) + 'px';
    tip.style.display = 'block';
    clearTimeout(tip._h);
    tip._h = setTimeout(() => { tip.style.display = 'none'; }, 2200);
}

/* ============================================================
 * 4. 图表摘要
 * ========================================================== */
function trendPart(prev, cur) {
    if (!(prev > 0)) return '';
    const diff = cur - prev, pct = diff / prev;
    const sign = pct >= 0.1 ? 'up' : (pct <= -0.1 ? 'down' : 'flat');
    if (sign === 'flat') {
        return '<span class="cs-item"><span class="cs-label">较上期</span><span class="cs-val">→ ' +
            (diff >= 0 ? '+' : '') + diff.toFixed(2) + 'h</span></span>';
    }
    const cls = sign === 'up' ? 'cs-trend-up' : 'cs-trend-down';
    const arrow = sign === 'up' ? '🔺' : '🔻';
    return '<span class="cs-item ' + cls + '"><span class="cs-label">较上期</span><span class="cs-val">' +
        arrow + ' ' + (diff >= 0 ? '+' : '') + diff.toFixed(2) + 'h</span></span>';
}
function punchProgress(start, end) {
    const now = util.today();
    let total = 0, done = 0;
    util.eachDay(start, end, (d) => {
        total++;
        if (d.getTime() <= now.getTime()) {
            const ds = util.toDateKey(d), rec = D.getRecord(ds);
            if (D.punchCount(rec) > 0) done++;
        }
    });
    return { elapsed: done, total: total, pct: total ? Math.round(done / total * 100) : 0 };
}
function progressPart(label, p) {
    if (!p || !p.total) return '';
    return '<span class="cs-item cs-progress">' +
        '<span class="cs-label">' + util.esc(label) + ' ' + p.elapsed + '/' + p.total + '（' + p.pct + '%）</span>' +
        '<span class="cs-bar"><i style="width:' + p.pct + '%"></i></span></span>';
}
function renderChartSummary() {
    const el = App.els.chartSummary;
    if (!el) return;
    const sel = S.selected, y = sel.getFullYear(), m = sel.getMonth();
    const html = [];

    if (S.chart.range === 'month') {
        const cur = D.rangeStats(new Date(y, m, 1), new Date(y, m + 1, 0));
        const prevEndDay = Math.min(new Date(y, m + 1, 0).getDate(), new Date(y, m, 0).getDate());
        const prev = D.rangeStats(new Date(y, m - 1, 1), new Date(y, m - 1, prevEndDay));
        html.push('<span class="cs-item cs-total"><span class="cs-label">当月累计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
        html.push(trendPart(prev.total, cur.total));
        html.push(progressPart('打卡进度', punchProgress(new Date(y, m, 1), new Date(y, m + 1, 0))));
    } else if (S.chart.range === 'week') {
        const w = util.weekRange(sel);
        const cur = D.rangeStats(w.mon, w.sun);
        const prev = D.rangeStats(util.addDays(w.mon, -7), util.addDays(w.mon, -1));
        const avg = cur.days ? cur.total / cur.days : 0;
        html.push('<span class="cs-item cs-total"><span class="cs-label">本周累计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
        html.push(trendPart(prev.total, cur.total));
        html.push('<span class="cs-item"><span class="cs-label">日均</span><span class="cs-val">' + avg.toFixed(2) + 'h</span></span>');
        html.push(progressPart('打卡进度', punchProgress(w.mon, w.sun)));
    } else {
        const s = util.parseDateKey(S.chart.customStart), e = util.parseDateKey(S.chart.customEnd);
        if (s && e) {
            const cur = D.rangeStats(s, e), avg = cur.days ? cur.total / cur.days : 0;
            html.push('<span class="cs-item cs-total"><span class="cs-label">范围总计</span><span class="cs-val">' + cur.total.toFixed(2) + 'h</span></span>');
            html.push('<span class="cs-item"><span class="cs-label">天数</span><span class="cs-val">' + cur.days + '</span></span>');
            html.push('<span class="cs-item"><span class="cs-label">日均</span><span class="cs-val">' + avg.toFixed(2) + 'h</span></span>');
            html.push(progressPart('打卡进度', punchProgress(s, e)));
        }
    }
    el.innerHTML = html.join('');
}

function updateChartLegend() {
    const sv = document.getElementById('settingsTargetVal');
    if (sv) sv.textContent = S.targetHours + 'h';
}

/* ============================================================
 * 5. 图表控件
 * ========================================================== */
function setChartRange(val) {
    S.chart.range = val;
    util.$$('.chart-range-opt').forEach((o) => o.classList.toggle('selected', o.dataset.val === val));
    const custom = document.getElementById('chartCustom');
    if (custom) custom.style.display = val === 'custom' ? 'flex' : 'none';
    App.invalidate('chart');
}

function toggleChartType() {
    S.chart.type = S.chart.type === 'bar' ? 'line' : 'bar';
    const btn = document.getElementById('chartToggle');
    if (btn) btn.textContent = S.chart.type === 'bar' ? '趋势线' : '柱状图';
    App.invalidate('chart');
}

function applyCustomRange() {
    const s = document.getElementById('chartCustomStart'), e = document.getElementById('chartCustomEnd');
    if (!s || !e) return;
    if (!util.isValidDateKey(s.value) || !util.isValidDateKey(e.value)) { App.ui.showToast('请选择完整起止日期', true); return; }
    if (s.value > e.value) { App.ui.showToast('开始日期不能晚于结束日期', true); return; }
    S.chart.customStart = s.value;
    S.chart.customEnd = e.value;
    App.invalidate('chart');
}

function initChartControls() {
    const t = new Date();
    const cs = document.getElementById('chartCustomStart'), ce = document.getElementById('chartCustomEnd');
    if (cs) cs.value = util.toDateKey(new Date(t.getFullYear(), t.getMonth(), 1));
    if (ce) ce.value = util.toDateKey(t);
    const toggle = document.getElementById('chartToggle');
    if (toggle) toggle.textContent = S.chart.type === 'bar' ? '趋势线' : '柱状图';
    util.$$('.chart-range-opt').forEach((o) => o.classList.toggle('selected', o.dataset.val === S.chart.range));
    const custom = document.getElementById('chartCustom');
    if (custom) custom.style.display = S.chart.range === 'custom' ? 'flex' : 'none';
    updateChartLegend();
}

function watchChartResize() {
    const canvas = App.els.chartCanvas;
    if (!canvas) return;
    let lastW = 0, lastH = 0;
    const handler = () => {
        const r = canvas.getBoundingClientRect();
        const w = Math.round(r.width), h = Math.round(r.height);
        if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
            lastW = w; lastH = h;
            App.invalidate('chart');
        }
    };
    if (typeof ResizeObserver === 'function') {
        try { new ResizeObserver(handler).observe(canvas); return; } catch (e) {}
    }
    window.addEventListener('resize', util.debounce(handler, 200));
    util.$$('.tabbar-item').forEach((it) => it.addEventListener('click', () => setTimeout(handler, 60)));
}

/* ============================================================
 * 6. 图表导出 / 分享
 * ========================================================== */
function chartExportName() {
    return '工时趋势图_' + chartRangeLabel().replace(/[^\w一-龥]+/g, '_') + '.png';
}
function paintChartToCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const series = chartSeries();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (!series.some((d) => d.total > 0)) {
        ctx.fillStyle = C.text; ctx.font = '600 15px ' + FONT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('工时趋势 · ' + chartRangeLabel(), 20, 16);
        ctx.fillStyle = C.tip; ctx.font = '13px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('该范围暂无打卡记录', W / 2, H / 2);
        return false;
    }
    return !!paintChart(ctx, W, H, series, {
        pad: { top: 44, right: 18, bottom: 32, left: 40 },
        background: '#ffffff',
        title: '工时趋势 · ' + chartRangeLabel(),
        legend: true,
        minMax: S.targetHours
    });
}
function buildChartBlob(cb) {
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W; canvas.height = EXPORT_H;
    if (!paintChartToCanvas(canvas)) { cb(null, 'empty'); return; }
    try {
        const dataUrl = canvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        cb(new Blob([arr], { type: 'image/png' }), null);
    } catch (e) {
        if (!canvas.toBlob) { cb(null, 'unsupported'); return; }
        canvas.toBlob((b) => cb(b, b ? null : 'fail'), 'image/png');
    }
}

function exportChartPNG() {
    buildChartBlob((blob, err) => {
        if (err === 'empty') { App.ui.showToast('该范围暂无打卡记录可导出', true); return; }
        if (!blob) { App.ui.showToast('❌ 导出失败，请重试', true); return; }
        const name = chartExportName();
        const r = App.ui.triggerDownload(name, blob);
        if (r === 'ok') { App.ui.showToast('🖼️ 图表图片已开始下载'); return; }
        shareFile(new File([blob], name, { type: 'image/png' }), blob);
    });
}

function shareChartImage() {
    buildChartBlob((blob, err) => {
        if (err === 'empty') { App.ui.showToast('该范围暂无打卡记录可分享', true); return; }
        if (!blob) { App.ui.showToast('❌ 生成图片失败，请重试', true); return; }
        shareFile(new File([blob], chartExportName(), { type: 'image/png' }), blob);
    });
}

function shareFile(file, blob) {
    const canShare = navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }));
    if (!canShare) { degradeImageSave(file, blob); return; }
    navigator.share({ title: file.name, files: [file] })
        .then(() => App.ui.showToast('✅ 分享成功'))
        .catch((e) => { if (!e || e.name !== 'AbortError') degradeImageSave(file, blob); });
}

function degradeImageSave(file, blob) {
    const dlEnv = App.ui.dlEnv;
    if (dlEnv.reliable) {
        if (App.ui.triggerDownload(file.name, blob) === 'ok') { App.ui.showToast('🖼️ 已转为下载'); return; }
        App.ui.showToast('❌ 分享与下载均不可用', true);
        return;
    }
    try {
        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');
        if (win) App.ui.showToast('已在新窗口打开，请长按图片保存', true);
        else App.ui.showToast('❌ 无法打开预览，请更换浏览器重试', true);
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
    } catch (e) {
        App.ui.showToast('❌ 无法打开预览，请更换浏览器重试', true);
    }
}

/* ============================================================
 * 7. 加班摘要
 * ========================================================== */
function renderOtSummary() {
    const sv = S.statsView || (S.statsView = { y: S.selected.getFullYear(), m: S.selected.getMonth() });
    const start = new Date(sv.y, sv.m, 1), end = new Date(sv.y, sv.m + 1, 0);
    const r = Sal.rangeOvertime(start, end);
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('otG1', r.normal + 'H');
    setTxt('otG2', r.weekend + 'H');
    setTxt('otG3', r.holiday + 'H');
    setTxt('otSummaryTotal', r.totalHours + 'H');
}

/* ============================================================
 * 8. 注册渲染函数
 * ========================================================== */
App.registerRender('tabStats', renderTabStats);
App.registerRender('history', renderHistoryList);
App.registerRender('chart', drawChart);
App.registerRender('otSummary', renderOtSummary);
App.registerRender('dataStatus', () => { if (typeof App.ui.refreshDataStatus === 'function') App.ui.refreshDataStatus(); });

/* ============================================================
 * 9. 导出到 App 命名空间
 * ========================================================== */
App.stats = {
    renderTabStats: renderTabStats,
    renderHistoryList: renderHistoryList,
    renderOtSummary: renderOtSummary,
    renderChartSummary: renderChartSummary,
    renderStatsMonthTitle: renderStatsMonthTitle,
    changeStatsMonth: changeStatsMonth,
    statsViewRange: statsViewRange,
    ensureHistoryRange: ensureHistoryRange,
    ensureRange: ensureRange,
    bindCollapse: bindCollapse,
    drawChart: drawChart,
    paintChart: paintChart,
    showChartTooltip: showChartTooltip,
    setChartRange: setChartRange,
    toggleChartType: toggleChartType,
    applyCustomRange: applyCustomRange,
    initChartControls: initChartControls,
    watchChartResize: watchChartResize,
    updateChartLegend: updateChartLegend,
    exportChartPNG: exportChartPNG,
    shareChartImage: shareChartImage,
    chartExportName: chartExportName,
    chartRangeLabel: chartRangeLabel,
    pairHtml: pairHtml
};

})();
