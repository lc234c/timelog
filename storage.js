/* ============================================================
 * storage.js - 工时记录 PWA
 * 职责：工具函数 + 数据层（localStorage / 排班配置 / 统计缓存）
 * 通过 window.WT.util 与 window.WT.data 暴露 API
 * ============================================================ */
(function (global) {
    'use strict';

    var WT = global.WT = global.WT || {};

    /* ---------- 工具函数 ---------- */
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
        var mon = new Date(d); mon.setDate(d.getDate() - w + 1);
        var sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999);
        return { mon: mon, sun: sun };
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function getDuration(a, b) {
        if (!a || !b) return 0;
        var ah = parseTimeParts(a), bh = parseTimeParts(b);
        var s = (bh[0] * 3600 + bh[1] * 60 + bh[2]) - (ah[0] * 3600 + ah[1] * 60 + ah[2]);
        if (s < 0) s += 86400;
        return s / 3600;
    }

    WT.util = { getLocalDateStr: getLocalDateStr, getCurrentTimeStr: getCurrentTimeStr, parseTimeParts: parseTimeParts, getWeekRange: getWeekRange, pad: pad, getDuration: getDuration };

    /* ---------- 数据层 ---------- */
    var storageAvailable = true;
    var allData = loadData();
    function loadData() { try { var s = localStorage.getItem('attendanceData'); return s ? JSON.parse(s) : {}; } catch (e) { storageAvailable = false; return {}; } }
    function saveData() { if (!storageAvailable) return; try { localStorage.setItem('attendanceData', JSON.stringify(allData)); } catch (e) { storageAvailable = false; } }

    var DEFAULT_SCHEDULES = {
        day: { name: "白班", periods: [{ start: "08:00", end: "12:00" }, { start: "13:30", end: "17:30" }], steps: ["上午上班", "上午下班", "下午上班", "下午下班"], keys: ["s1", "e1", "s2", "e2"], labels: ["上午工时", "下午工时"] },
        night: { name: "夜班", periods: [{ start: "19:30", end: "23:59" }, { start: "00:00", end: "05:00" }], steps: ["夜班上班", "午夜下班", "凌晨上班", "凌晨下班"], keys: ["s1", "e1", "s2", "e2"], labels: ["前半段工时", "后半段工时"] }
    };
    function buildShiftText(periods) { return periods.map(function (p) { return p.start + "~" + p.end; }).join(" (午休) "); }
    function cloneSchedule(s) { return { name: s.name, periods: (s.periods || []).map(function (p) { return { start: p.start, end: p.end }; }), steps: s.steps, keys: s.keys, labels: s.labels }; }
    function isValidPeriod(p) { return p && typeof p.start === 'string' && typeof p.end === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.end); }

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

    /* 月统计缓存 */
    var _monthCache = { key: '', total: 0, days: 0 };
    function invalidateMonthCache() { _monthCache.key = ''; invalidateTodayCache(); }
    /* 今日工时缓存（优化 #2） */
    var _todayCache = { key: '', total: 0 };
    function invalidateTodayCache() { _todayCache.key = ''; }
    function getTodayTotal() {
        var ds = getLocalDateStr(WT._selectedDate || new Date());
        if (_todayCache.key === ds) return _todayCache.total;
        var st = WT._currentStatus || {};
        var s1 = getDuration(st.s1, st.e1), s2 = getDuration(st.s2, st.e2);
        _todayCache = { key: ds, total: s1 + s2 };
        return _todayCache.total;
    }
    function getMonthStats() {
        var sel = WT._selectedDate || new Date();
        var y = sel.getFullYear(), m = sel.getMonth(), key = y + '-' + m;
        if (_monthCache.key === key) return { total: _monthCache.total, days: _monthCache.days };
        var start = getLocalDateStr(new Date(y, m, 1)), end = getLocalDateStr(new Date(y, m + 1, 0));
        var mt = 0, md = 0;
        for (var d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
            var ds = getLocalDateStr(d);
            if (allData[ds]) { var d2 = allData[ds].status, dtot = getDuration(d2.s1, d2.e1) + getDuration(d2.s2, d2.e2); if (dtot > 0) { mt += dtot; md++; } }
        }
        _monthCache = { key: key, total: mt, days: md };
        return { total: mt, days: md };
    }
    function getMonthRange() { var sel = WT._selectedDate || new Date(); var y = sel.getFullYear(), m = sel.getMonth(); return { start: getLocalDateStr(new Date(y, m, 1)), end: getLocalDateStr(new Date(y, m + 1, 0)) }; }

    WT.data = {
        allData: allData, get storageAvailable() { return storageAvailable; },
        shiftsConfig: shiftsConfig, DEFAULT_SCHEDULES: DEFAULT_SCHEDULES, buildShiftText: buildShiftText, isValidPeriod: isValidPeriod,
        saveShiftSchedules: saveShiftSchedules, saveDefaultShiftType: saveDefaultShiftType,
        loadCalDefaultExpanded: loadCalDefaultExpanded, saveCalDefaultExpanded: saveCalDefaultExpanded,
        get calDefaultExpanded() { return calDefaultExpanded; }, set calDefaultExpanded(v) { calDefaultExpanded = v; },
        get currentShiftType() { return currentShiftType; }, set currentShiftType(v) { currentShiftType = v; },
        invalidateMonthCache: invalidateMonthCache, invalidateTodayCache: invalidateTodayCache,
        getTodayTotal: getTodayTotal, getMonthStats: getMonthStats, getMonthRange: getMonthRange,
        saveData: saveData, loadData: loadData
    };

})(window);
