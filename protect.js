// protect.js — 禁用右键与开发者工具（仅作威慑，无法真正阻止查看源码）
(function () {
  'use strict';
  ['contextmenu', 'selectstart', 'dragstart', 'copy'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
    }, true);
  });

  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toUpperCase();
    var ctrl = e.ctrlKey || e.metaKey;
    if (
      k === 'F12' ||
      (ctrl && e.shiftKey && ['I', 'J', 'C', 'K'].indexOf(k) > -1) ||
      (ctrl && e.altKey && ['I', 'J', 'C'].indexOf(k) > -1) ||
      (ctrl && ['U', 'S', 'P'].indexOf(k) > -1)
    ) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  var tripped = false;
  function lock() {
    if (tripped) return;
    tripped = true;
    document.documentElement.innerHTML =
      '<body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">' +
      '请关闭开发者工具后刷新页面</body>';
  }
  function check() {
    var gap = 160;
    if (window.outerWidth - window.innerWidth > gap ||
        window.outerHeight - window.innerHeight > gap) { lock(); return; }
    var t = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (performance.now() - t > 100) lock();
  }
  setInterval(check, 1000);

  var s = document.createElement('style');
  s.textContent = '*{-webkit-user-select:none;user-select:none}input,textarea{-webkit-user-select:text;user-select:text}';
  (document.head || document.documentElement).appendChild(s);
})();
