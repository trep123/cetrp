/* 轻量粒子背景：PC 约 80 个，移动端约 20 个；鼠标靠近时连线
 * 颜色读取 CSS 变量（随主题变化）：
 *   --particle-1..3   粒子颜色
 *   --particle-line   粒子之间连线的 RGB（如 230, 126, 34）
 *   --particle-mouse  粒子与鼠标连线的 RGB
 *   --particle-alpha  粒子整体不透明度（浅色主题更淡）
 */
(function () {
  'use strict';
  window.startParticles = function (canvas) {
    const ctx = canvas.getContext('2d');
    const mq = q => (window.matchMedia ? matchMedia(q) : { matches: false });
    const reduce = mq('(prefers-reduced-motion: reduce)').matches;
    let w, h, dpr, pts = [], mouse = { x: -9999, y: -9999 }, raf = null;
    let colors = ['#1fd1b5', '#f39c12', '#8a8a8a'], line = '230,126,34', mouseLine = '31,209,181', alpha = 0.75;

    function readTheme() {
      const cs = getComputedStyle(document.documentElement);
      const v = (k, d) => (cs.getPropertyValue(k) || '').trim() || d;
      colors = [v('--particle-1', colors[0]), v('--particle-2', colors[1]), v('--particle-3', colors[2])];
      line = v('--particle-line', line);
      mouseLine = v('--particle-mouse', mouseLine);
      const a = parseFloat(v('--particle-alpha', String(alpha)));
      alpha = isNaN(a) ? 0.75 : Math.min(1, Math.max(0, a));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = w < 768 ? 20 : Math.round(Math.min(80, (w * h) / 16000));
      while (pts.length < n) pts.push(make());
      pts.length = n;
    }
    function make() {
      return {
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 2.2 + 1, ci: (Math.random() * 3) | 0,   // 只存颜色序号，主题切换后自动换色
      };
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const LINK = w < 768 ? 110 : 150;
      for (const p of pts) {
        if (!reduce) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }
      ctx.lineWidth = 0.6;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${line},${(1 - d / LINK) * 0.4 * alpha})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < 180) {
          ctx.strokeStyle = `rgba(${mouseLine},${(1 - dm / 180) * 0.7 * alpha})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
      ctx.globalAlpha = alpha;
      for (const p of pts) {
        ctx.fillStyle = colors[p.ci] || colors[0];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = reduce ? null : requestAnimationFrame(frame);
    }
    function onTheme() { readTheme(); if (reduce) frame(); }

    addEventListener('resize', () => { resize(); if (reduce) frame(); });
    addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    addEventListener('mouseout', () => { mouse.x = mouse.y = -9999; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
      else if (!raf && !reduce) raf = requestAnimationFrame(frame);
    });
    // 主题变化：app.js 派发 pixie:themechange；同时监听 data-theme 属性，兼容其它方式改主题
    addEventListener('pixie:themechange', onTheme);
    if (window.MutationObserver) {
      new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    readTheme(); resize(); frame();
  };
})();
