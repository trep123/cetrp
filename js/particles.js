/* 轻量粒子背景：PC 约 80 个，移动端约 20 个；鼠标靠近时连线 */
(function () {
  'use strict';
  window.startParticles = function (canvas) {
    const ctx = canvas.getContext('2d');
    const COLORS = ['#1fd1b5', '#f39c12', '#8a8a8a', '#e67e22', '#16a6a0'];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w, h, dpr, pts = [], mouse = { x: -9999, y: -9999 }, raf = null;

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
        r: Math.random() * 2.2 + 1, c: COLORS[(Math.random() * COLORS.length) | 0],
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
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(230,126,34,${(1 - d / LINK) * 0.35})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < 180) {
          ctx.strokeStyle = `rgba(31,209,181,${(1 - dm / 180) * 0.6})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
      for (const p of pts) {
        ctx.fillStyle = p.c; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = reduce ? null : requestAnimationFrame(frame);
    }
    addEventListener('resize', resize);
    addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    addEventListener('mouseout', () => { mouse.x = mouse.y = -9999; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
      else if (!raf && !reduce) raf = requestAnimationFrame(frame);
    });
    resize(); frame();
  };
})();
