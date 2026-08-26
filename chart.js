/* ============================================================
 * chart.js - 工时记录 PWA
 * 职责：图表可视化（Canvas 绘制 / 导出 PNG / 分享 / 达标线）
 * 依赖：WT.util(getLocalDateStr/getDuration/getWeekRange/pad)
 * 通过 window.WT.chart 暴露 API
 * ============================================================ */
(function (global) {
    'use strict';
    var WT = global.WT = global.WT || {};
    var util = WT.util;

    var chartState = { type: 'line', range: 'month', customStart: '', customEnd: '' };
    var TARGET_DEFAULT = 6;
    var chartTargetHours = getTargetHours();
    var _chartCacheKey = ''; /* 脏检查指纹（优化 #3） */

    function getTargetHours() {
        try { var v = parseFloat(localStorage.getItem('chartTargetHours')); if (!isNaN(v) && v > 0) return v; } catch (e) {}
        return TARGET_DEFAULT;
    }
    function setTargetHours(v) { var nv = Math.max(0.5, Math.min(24, v)); try { localStorage.setItem('chartTargetHours', String(nv)); } catch (e) {} return nv; }

    function getChartSeries() {
        var range = chartState.range, t = new Date(), y = t.getFullYear(), m = t.getMonth();
        var start, end;
        if (range === 'month') { start = new Date(y, m, 1); end = new Date(y, m + 1, 0); }
        else if (range === 'week') { var w = util.getWeekRange(t); start = new Date(w.mon); end = new Date(w.sun); }
        else { if (!chartState.customStart || !chartState.customEnd) { start = new Date(y, m, 1); end = new Date(y, m + 1, 0); } else { start = new Date(chartState.customStart); end = new Date(chartState.customEnd); } }
        var arr = []; var all = WT.data.allData;
        for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            var dt = new Date(d), ds = util.getLocalDateStr(dt), dy = all[ds], tot = 0;
            if (dy) { var st = dy.status; tot = util.getDuration(st.s1, st.e1) + util.getDuration(st.s2, st.e2); }
            arr.push({ date: dt.getDate(), ds: ds, total: tot, hasRecord: !!(dy && (dy.status.s1 || dy.status.e1 || dy.status.s2 || dy.status.e2)) });
        }
        return arr;
    }
    function getChartRangeLabel() {
        var range = chartState.range, t = new Date(), y = t.getFullYear(), m = t.getMonth();
        if (range === 'month') return (m + 1) + '月';
        if (range === 'week') { var w = util.getWeekRange(t); return '本周 ' + (w.mon.getMonth() + 1) + '/' + w.mon.getDate() + '-' + (w.sun.getMonth() + 1) + '/' + w.sun.getDate(); }
        if (chartState.customStart && chartState.customEnd) return chartState.customStart.slice(5) + ' ~ ' + chartState.customEnd.slice(5);
        return (m + 1) + '月';
    }
    function setupCanvas(canvas) {
        var dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
        var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx: ctx, w: rect.width, h: rect.height, dpr: dpr };
    }
    function drawChart() {
        var canvas = document.getElementById('hoursChart'); if (!canvas) return;
        var emptyEl = document.getElementById('chartEmpty'), titleEl = document.getElementById('chartTitle');
        if (titleEl) titleEl.innerText = '📊 工时趋势 · ' + getChartRangeLabel();
        var series = getChartSeries();
        /* 脏检查：状态/数据未变则跳过全量重绘（优化 #3） */
        var key = chartState.type + '|' + chartState.range + '|' + series.map(function (d) { return d.ds + ':' + d.total.toFixed(2); }).join(',');
        if (_chartCacheKey === key && canvas.style.display !== 'none') return;
        _chartCacheKey = key;
        var hasAny = series.some(function (d) { return d.total > 0; });
        if (!hasAny) { emptyEl.style.display = 'flex'; canvas.style.display = 'none'; return; }
        emptyEl.style.display = 'none'; canvas.style.display = 'block';
        var setup = setupCanvas(canvas), ctx = setup.ctx, W = setup.w, H = setup.h;
        var pad = { top: 18, right: 14, bottom: 26, left: 34 }, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
        var maxV = Math.max.apply(null, series.map(function (d) { return d.total; }).concat([8])) * 1.15;
        var yTicks = 4;
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1; ctx.fillStyle = '#a8a8ae'; ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (var t2 = 0; t2 <= yTicks; t2++) { var v = maxV * t2 / yTicks, y = pad.top + ch - (v / maxV) * ch; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke(); ctx.fillText(v.toFixed(0) + 'h', pad.left - 6, y); }
        var yT = pad.top + ch - (chartTargetHours / maxV) * ch;
        if (chartTargetHours <= maxV) { ctx.strokeStyle = 'rgba(52,199,89,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(W - pad.right, yT); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(52,199,89,.75)'; ctx.textAlign = 'left'; ctx.fillText(chartTargetHours + 'h', W - pad.right + 2, yT); }
        var n = series.length, bw = cw / n;
        ctx.fillStyle = '#a8a8ae'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif';
        var step = n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2));
        for (var x = 0; x < n; x++) { if ((x + 1) % step === 0 || x === 0 || x === n - 1) { ctx.fillText(series[x].date, pad.left + bw * (x + 0.5), H - pad.bottom + 6); } }
        var pts = series.map(function (d, i) { return { x: pad.left + bw * (i + 0.5), y: pad.top + ch - (d.total / maxV) * ch, d: d }; });
        if (chartState.type === 'bar') {
            for (var i = 0; i < n; i++) { var d = series[i], barW = Math.max(3, bw * 0.62); if (d.total <= 0) continue; var bx = pad.left + bw * (i + 0.5) - barW / 2, by = pad.top + ch - (d.total / maxV) * ch, bh = (d.total / maxV) * ch; var grad = ctx.createLinearGradient(0, by, 0, by + bh); if (d.total >= chartTargetHours) { grad.addColorStop(0, '#34c759'); grad.addColorStop(1, 'rgba(52,199,89,.55)'); } else { grad.addColorStop(0, '#4a90e2'); grad.addColorStop(1, 'rgba(74,144,226,.5)'); } ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, barW, bh, [3, 3, 0, 0]) : ctx.rect(bx, by, barW, bh); ctx.fill(); }
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
        var tw = tip.offsetWidth || 110;
        tip.style.left = Math.min(Math.max(pts[idx].x - tw / 2, 8), (canvas.parentElement.clientWidth - tw - 8)) + 'px';
        tip.style.top = (pts[idx].y - 44) + 'px'; tip.style.display = 'block';
        clearTimeout(tip._h); tip._h = setTimeout(function () { tip.style.display = 'none'; }, 2200);
    }
    function toggleChartType() {
        chartState.type = chartState.type === 'bar' ? 'line' : 'bar';
        var el = document.getElementById('chartToggle'); if (el) el.innerText = chartState.type === 'bar' ? '趋势线' : '柱状图';
        _chartCacheKey = ''; drawChart();
    }
    function setChartRange(val) {
        chartState.range = val;
        document.querySelectorAll('.chart-range-opt').forEach(function (o) { o.classList.remove('selected'); });
        var sel = document.querySelector('.chart-range-opt[data-val="' + val + '"]'); if (sel) sel.classList.add('selected');
        var customEl = document.getElementById('chartCustom'); if (customEl) customEl.style.display = val === 'custom' ? 'flex' : 'none';
        _chartCacheKey = ''; drawChart();
    }
    function updateChartLegend() {
        var el = document.getElementById('chartLegend达标'); if (el) el.innerText = '当日达标(≥' + chartTargetHours + 'h)';
        var sv = document.getElementById('settingsTargetVal'); if (sv) sv.innerText = chartTargetHours + 'h';
    }
    function paintChartToCanvas(targetCanvas) {
        var series = getChartSeries(); var W = targetCanvas.width, H = targetCanvas.height, ctx = targetCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#1c1c1e'; ctx.font = '600 15px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('工时趋势 · ' + getChartRangeLabel(), 20, 16);
        var pad = { top: 44, right: 18, bottom: 32, left: 40 }, cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom;
        var maxV = Math.max.apply(null, series.map(function (d) { return d.total; }).concat([chartTargetHours])) * 1.15, yTicks = 4;
        ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1; ctx.fillStyle = '#a8a8ae'; ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        for (var t2 = 0; t2 <= yTicks; t2++) { var v = maxV * t2 / yTicks, y = pad.top + ch - (v / maxV) * ch; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke(); ctx.fillText(v.toFixed(0) + 'h', pad.left - 8, y); }
        var yT = pad.top + ch - (chartTargetHours / maxV) * ch;
        if (chartTargetHours <= maxV) { ctx.strokeStyle = 'rgba(52,199,89,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(W - pad.right, yT); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(52,199,89,.75)'; ctx.textAlign = 'left'; ctx.fillText(chartTargetHours + 'h', W - pad.right + 4, yT); }
        var n = series.length, bw = cw / n; ctx.fillStyle = '#a8a8ae'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '10px -apple-system,BlinkMacSystemFont,sans-serif';
        var step = n > 20 ? 5 : (n > 12 ? 4 : (n > 7 ? 3 : 2));
        for (var x = 0; x < n; x++) { if ((x + 1) % step === 0 || x === 0 || x === n - 1) ctx.fillText(series[x].date, pad.left + bw * (x + 0.5), H - pad.bottom + 8); }
        var pts = series.map(function (d, i) { return { x: pad.left + bw * (i + 0.5), y: pad.top + ch - (d.total / maxV) * ch, d: d }; });
        if (chartState.type === 'bar') { for (var i = 0; i < n; i++) { var d = series[i], barW = Math.max(4, bw * 0.6); if (d.total <= 0) continue; var bx = pad.left + bw * (i + 0.5) - barW / 2, by = pad.top + ch - (d.total / maxV) * ch, bh = (d.total / maxV) * ch; ctx.fillStyle = d.total >= chartTargetHours ? '#34c759' : '#4a90e2'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, barW, bh, [3, 3, 0, 0]) : ctx.rect(bx, by, barW, bh); ctx.fill(); } }
        else { ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke(); pts.forEach(function (p) { if (p.d.total > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = p.d.total >= chartTargetHours ? '#34c759' : '#4a90e2'; ctx.fill(); } }); }
        ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        var lx = pad.left + 6, ly = H - 14; ctx.fillStyle = '#4a90e2'; ctx.fillRect(lx, ly - 4, 12, 8); ctx.fillStyle = '#8e8e93'; ctx.fillText('每日工时', lx + 18, ly);
        ctx.fillStyle = '#34c759'; ctx.fillRect(lx + 86, ly - 4, 12, 8); ctx.fillStyle = '#8e8e93'; ctx.fillText('达标(≥' + chartTargetHours + 'h)', lx + 104, ly);
    }
    function exportChartPNG() {
        var series = getChartSeries(); if (!series.some(function (d) { return d.total > 0; })) { if (WT.ui) WT.ui.showToast("该范围暂无打卡记录可导出", true); return; }
        var off = document.createElement('canvas'); off.width = 720; off.height = 420; paintChartToCanvas(off);
        var fn = '工时趋势图_' + getChartRangeLabel().replace(/[^\w\u4e00-\u9fa5]/g, '_') + '_' + Date.now() + '.png';
        if (off.toBlob) off.toBlob(function (blob) { triggerDownload(fn, blob, 'image/png'); if (WT.ui) WT.ui.showToast("🖼️ 图表图片已开始下载"); }, 'image/png');
        else { var a = document.createElement('a'); a.href = off.toDataURL('image/png'); a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); if (WT.ui) WT.ui.showToast("🖼️ 图表图片已开始下载"); }
    }
    function shareChartImage() {
        var series = getChartSeries(); if (!series.some(function (d) { return d.total > 0; })) { if (WT.ui) WT.ui.showToast("该范围暂无打卡记录可分享", true); return; }
        var off = document.createElement('canvas'); off.width = 720; off.height = 420; paintChartToCanvas(off);
        var fn = '工时趋势图_' + getChartRangeLabel().replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.png';
        var onBlob = function (blob) {
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fn, { type: 'image/png' })] })) { navigator.share({ title: '工时趋势图', files: [new File([blob], fn, { type: 'image/png' })] }).then(function () { if (WT.ui) WT.ui.showToast("✅ 分享成功"); }).catch(function (e) { if (e.name !== 'AbortError') { triggerDownload(fn, blob, 'image/png'); if (WT.ui) WT.ui.showToast("🖼️ 已转为下载"); } }); }
            else { triggerDownload(fn, blob, 'image/png'); if (WT.ui) WT.ui.showToast("🖼️ 分享不可用，已转为下载"); }
        };
        if (off.toBlob) off.toBlob(onBlob, 'image/png'); else { var a = document.createElement('a'); a.href = off.toDataURL('image/png'); a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); if (WT.ui) WT.ui.showToast("🖼️ 图表图片已开始下载"); }
    }
    function triggerDownload(fn, ct, mt) {
        try { var b = (ct instanceof Blob) ? ct : new Blob([ct], { type: mt }), u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = fn; a.rel = 'noopener'; document.body.appendChild(a); var clicked = false; try { a.click(); clicked = true; } catch (e) { clicked = false; } if (clicked) setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} }, 0); else { try { document.body.removeChild(a); } catch (e) {} window.open(u, '_blank', 'noopener'); } setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000); return true; } catch (e) { return false; }
    }
    function initChart() {
        var canvas = document.getElementById('hoursChart'); if (!canvas) return;
        canvas.addEventListener('click', showChartTooltip); canvas.addEventListener('touchstart', showChartTooltip, { passive: true });
        var tog = document.getElementById('chartToggle'); if (tog) tog.addEventListener('click', toggleChartType);
        var exp = document.getElementById('chartExport'); if (exp) { exp.addEventListener('click', exportChartPNG); exp.addEventListener('contextmenu', function (e) { e.preventDefault(); shareChartImage(); }); }
        document.querySelectorAll('.chart-range-opt').forEach(function (opt) { opt.addEventListener('click', function () { setChartRange(opt.dataset.val); }); });
        var t = new Date(); var cs = document.getElementById('chartCustomStart'), ce = document.getElementById('chartCustomEnd');
        if (cs) cs.value = util.getLocalDateStr(new Date(t.getFullYear(), t.getMonth(), 1));
        if (ce) ce.value = util.getLocalDateStr(t);
        var capply = document.getElementById('chartCustomApply'); if (capply) capply.addEventListener('click', function () { var s = document.getElementById('chartCustomStart').value, e = document.getElementById('chartCustomEnd').value; if (!s || !e) { if (WT.ui) WT.ui.showToast("请选择完整起止日期", true); return; } if (s > e) { if (WT.ui) WT.ui.showToast("开始日期不能晚于结束日期", true); return; } chartState.customStart = s; chartState.customEnd = e; _chartCacheKey = ''; drawChart(); });
        window.addEventListener('resize', function () { _chartCacheKey = ''; drawChart(); });
        var targetInput = document.getElementById('chartTargetInput'); if (targetInput) { targetInput.value = chartTargetHours; targetInput.addEventListener('change', function () { var nv = parseFloat(targetInput.value); if (isNaN(nv) || nv <= 0) nv = TARGET_DEFAULT; chartTargetHours = setTargetHours(nv); targetInput.value = chartTargetHours; updateChartLegend(); _chartCacheKey = ''; drawChart(); if (WT.ui) WT.ui.showToast("达标线已设为 " + chartTargetHours + "h"); }); }
        var tsi = document.getElementById('targetSettingItem'); if (tsi) tsi.addEventListener('click', function () { if (WT.ui) WT.ui.closeSettings(); var raw = prompt("设置每日达标线（小时，0.5~24）\n当前值：" + chartTargetHours + "h", String(chartTargetHours)); if (raw === null) return; var nv = parseFloat(raw); if (isNaN(nv) || nv <= 0) { if (WT.ui) WT.ui.showToast("❌ 输入无效，已保持 " + chartTargetHours + "h", true); return; } chartTargetHours = setTargetHours(nv); updateChartLegend(); _chartCacheKey = ''; drawChart(); if (WT.ui) WT.ui.showToast("达标线已设为 " + chartTargetHours + "h"); });
        updateChartLegend(); drawChart();
    }
    function syncChartWithCalView(expanded) { if (!chartState || chartState.range === 'custom') return; var target = expanded ? 'month' : 'week'; if (chartState.range !== target) setChartRange(target); }

    WT.chart = { drawChart: drawChart, initChart: initChart, toggleChartType: toggleChartType, setChartRange: setChartRange, exportChartPNG: exportChartPNG, shareChartImage: shareChartImage, syncChartWithCalView: syncChartWithCalView, updateChartLegend: updateChartLegend, get chartTargetHours() { return chartTargetHours; } };

})(window);
