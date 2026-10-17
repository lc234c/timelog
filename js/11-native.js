/* 原生安卓（Capacitor）桥接层
 * 在原生壳内为「备份 / 导入」提供原生实现；
 * 浏览器 / PWA 等非原生环境自动降级为 08-ui.js 中的原有 Web 逻辑。
 */
(function () {
    'use strict';
    var isNative = !!(window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform());

    function plugin() {
        try {
            return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackupPlugin;
        } catch (e) { return null; }
    }

    var NativeBridge = {
        get isNative() { return isNative; },
        available: function () { return isNative && !!plugin(); },

        saveBackup: function (filename, content) {
            return plugin().saveBackup({ filename: filename, content: content })
                .then(function (r) { return { ok: true, path: r.path, filename: r.filename }; })
                .catch(function (e) {
                    return { ok: false, reason: (e && e.message) ? e.message : String(e) };
                });
        },

        shareBackup: function (filename, content) {
            return plugin().shareBackup({ filename: filename, content: content })
                .then(function () { return { ok: true }; })
                .catch(function (e) {
                    return { ok: false, reason: (e && e.message) ? e.message : String(e) };
                });
        },

        pickBackup: function () {
            return plugin().pickBackup({})
                .then(function (r) { return { ok: true, content: r.content || '', name: r.name || '' }; })
                .catch(function (e) {
                    var msg = (e && e.message) ? e.message : String(e);
                    return { ok: false, cancelled: /cancel/i.test(msg), reason: msg };
                });
        },

        consumePendingImport: function () {
            return plugin().consumePendingImport({})
                .then(function (r) { return { content: r.content || '', available: !!r.available }; })
                .catch(function () { return { content: '', available: false }; });
        }
    };

    window.NativeBridge = NativeBridge;

    /* ============================================================
     * 系统返回键支持（安卓原生返回键 → 逐级返回，而非直接退出）
     * - Web 端在「有弹窗打开」或「不在默认 tab」时，通过 setBackEnabled 通知原生
     * - 原生 onBackPressed 据此把返回键交给 __doSystemBack 处理：
     *   依次关闭最上层弹窗 / 切回默认 tab，否则才允许退出应用
     * ============================================================ */
    function isDefaultTab() {
        var active = document.querySelector('.tabbar-item.active');
        return !active || active.getAttribute('data-tab') === 'tabPunch';
    }

    function syncBackEnabled() {
        if (!(window.NativeBridge && NativeBridge.available())) return;
        try {
            var anyModal = !!document.querySelector('.modal-mask.show');
            var enabled = anyModal || !isDefaultTab();
            window.Capacitor.Plugins.BackupPlugin.setBackEnabled({ value: enabled });
        } catch (e) { /* 原生插件尚未就绪时忽略 */ }
    }

    // 系统返回键统一入口：关闭最上层弹窗，或切回默认 tab
    window.__doSystemBack = function () {
        var modals = document.querySelectorAll('.modal-mask.show');
        if (modals.length) {
            var top = modals[modals.length - 1];
            var el = document.getElementById(top.id);
            if (el) el.classList.remove('show');
            syncBackEnabled();
            return;
        }
        if (!isDefaultTab()) {
            var punch = document.querySelector('.tabbar-item[data-tab="tabPunch"]');
            if (punch) punch.click();
        }
    };

    // 监听所有弹窗与底部 tab 的 class 变化，自动同步返回键可用状态
    document.querySelectorAll('.modal-mask').forEach(function (m) {
        new MutationObserver(syncBackEnabled).observe(m, { attributes: true, attributeFilter: ['class'] });
    });
    document.querySelectorAll('.tabbar-item').forEach(function (t) {
        new MutationObserver(syncBackEnabled).observe(t, { attributes: true, attributeFilter: ['class'] });
    });
    syncBackEnabled();
})();
