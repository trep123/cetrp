// protect.js — 禁用右键、选中复制与部分快捷键（仅作威慑）；F12 可正常打开开发者工具
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
      (ctrl && e.shiftKey && ['I', 'J', 'C', 'K'].indexOf(k) > -1) ||
      (ctrl && e.altKey && ['I', 'J', 'C'].indexOf(k) > -1) ||
      (ctrl && ['U', 'S', 'P'].indexOf(k) > -1)
    ) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  var s = document.createElement('style');
  s.textContent = '*{-webkit-user-select:none;user-select:none}input,textarea{-webkit-user-select:text;user-select:text}';
  (document.head || document.documentElement).appendChild(s);
})();
