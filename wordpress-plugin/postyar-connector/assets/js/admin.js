/**
 * Postyar Connector — اسکریپت مدیریتی (خوداتکا؛ بدون وابستگی خارجی)
 *
 * ۱) دکمهٔ «بررسی اتصال»: فراخوانی admin-ajax با نانس اختصاصی + سطح دسترسی
 *    manage_options (سرور نیز هر دو را دوباره بررسی می‌کند).
 * ۲) نمایش تاریخ‌ها به شکل جلالی با مبدل درون‌خطی کوچک (بدون کتابخانه).
 */
(function () {
        'use strict';

        /* ------------------------- ابزارهای کمکی ------------------------- */

        var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

        function toFa(value) {
                return String(value).replace(/\d/g, function (d) {
                        return FA_DIGITS[Number(d)];
                });
        }

        function pad2(n) {
                return (n < 10 ? '0' : '') + n;
        }

        /**
         * مبدل کوچک میلادی → جلالی (الگوریتم استاندارد jalaali؛ نسخهٔ فشرده).
         *
         * @param {number} gy سال میلادی
         * @param {number} gm  ماه (۱..۱۲)
         * @param {number} gd  روز (۱..۳۱)
         * @return {number[]} [jy, jm, jd]
         */
        function toJalali(gy, gm, gd) {
                var gDm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
                var jy = gy <= 1600 ? 0 : 979;
                gy -= gy <= 1600 ? 621 : 1600;

                var gy2 = gm > 2 ? gy + 1 : gy;
                var days =
                        365 * gy +
                        parseInt((gy2 + 3) / 4, 10) -
                        parseInt((gy2 + 99) / 100, 10) +
                        parseInt((gy2 + 399) / 400, 10) -
                        80 +
                        gd +
                        gDm[gm - 1];

                jy += 33 * parseInt(days / 12053, 10);
                days %= 12053;
                jy += 4 * parseInt(days / 1461, 10);
                days %= 1461;

                if (days > 365) {
                        jy += parseInt((days - 1) / 365, 10);
                        days = (days - 1) % 365;
                }

                var jm = days < 186 ? 1 + parseInt(days / 31, 10) : 7 + parseInt((days - 186) / 30, 10);
                var jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);

                return [jy, jm, jd];
        }

        /**
         * نمایش جلالی یک مهر زمان یونیکس (ثانیه) به وقت محلی.
         *
         * @param {number} ts ثانیه‌های یونیکس
         * @return {string} مانند «۱۴۰۳/۱۰/۱۵ — ۱۴:۳۰»
         */
        function jalaliDateTime(ts) {
                if (!ts || ts <= 0) {
                        return '—';
                }
                var d = new Date(ts * 1000);
                var j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
                var time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
                return (
                        toFa(j[0]) + '/' + toFa(pad2(j[1])) + '/' + toFa(pad2(j[2])) + ' — ' + toFa(time)
                );
        }

        /* ------------------------- تاریخ‌های جلالی ------------------------- */

        function renderJalaliDates() {
                var nodes = document.querySelectorAll('.postyar-jalali[data-ts]');
                Array.prototype.forEach.call(nodes, function (node) {
                        var ts = parseInt(node.getAttribute('data-ts'), 10);
                        if (!isNaN(ts) && ts > 0) {
                                node.textContent = jalaliDateTime(ts);
                        }
                });
        }

        /* ------------------------- تست اتصال ------------------------- */

        function setStatusResult(node, message, ok) {
                node.textContent = message;
                node.className = 'postyar-test-result ' + (ok ? 'is-ok' : 'is-error');
        }

        function updateStatusCard(ok, message) {
                var card = document.getElementById('postyar-status-card');
                if (!card) {
                        return;
                }
                var text = card.querySelector('.postyar-status-text');
                if (text) {
                        text.textContent = message;
                }
                card.className = 'postyar-card ' + (ok ? 'postyar-status--ok' : 'postyar-status--error');
        }

        function bindTestConnection() {
                var button = document.getElementById('postyar-test-connection');
                var result = document.getElementById('postyar-test-result');

                if (!button || !result) {
                        return;
                }

                button.addEventListener('click', function () {
                        if (!window.postyarAdmin || !window.postyarAdmin.ajaxUrl) {
                                return;
                        }

                        var previousLabel = button.textContent;
                        button.disabled = true;
                        result.textContent = window.postyarAdmin.i18n ? window.postyarAdmin.i18n.testing : '…';
                        result.className = 'postyar-test-result';

                        var body = new window.FormData();
                        body.append('action', window.postyarAdmin.action || 'postyar_test_connection');
                        body.append('nonce', window.postyarAdmin.nonce || '');

                        window
                                .fetch(window.postyarAdmin.ajaxUrl, {
                                        method: 'POST',
                                        credentials: 'same-origin',
                                        body: body,
                                })
                                .then(function (response) {
                                        return response.json().catch(function () {
                                                return { success: false, data: { message: 'پاسخ نامعتبر از سرور.' } };
                                        });
                                })
                                .then(function (json) {
                                        var data = json && json.data ? json.data : {};
                                        var message = data.message || (json && json.success ? '' : 'خطای نامشخص.');
                                        setStatusResult(result, message, !!json.success);
                                        updateStatusCard(!!json.success, message);

                                        // به‌روزرسانی زمان آخرین بررسی در کارت وضعیت.
                                        var stampNode = document.querySelector('#postyar-status-card .postyar-jalali');
                                        if (stampNode) {
                                                stampNode.setAttribute('data-ts', String(Math.floor(Date.now() / 1000)));
                                                stampNode.textContent = jalaliDateTime(Math.floor(Date.now() / 1000));
                                        }
                                })
                                .catch(function () {
                                        setStatusResult(
                                                result,
                                                window.postyarAdmin.i18n ? window.postyarAdmin.i18n.failed : 'اتصال ناموفق بود.',
                                                false
                                        );
                                })
                                .then(function () {
                                        button.disabled = false;
                                        button.textContent = previousLabel;
                                });
                });
        }

        /* ------------------------- راه‌اندازی ------------------------- */

        function init() {
                renderJalaliDates();
                bindTestConnection();
        }

        if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
        } else {
                init();
        }
})();
