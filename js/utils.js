(function () {
  'use strict';

  /* ==================== 配置区 ==================== */

  // 点击时依次弹出的词语
  const WORDS = [
    '富强', '民主', '文明', '和谐',
    '自由', '平等', '公正', '法治',
    '爱国', '敬业', '诚信', '友善'
  ];

  // 点击文字的颜色池
  const WORD_COLORS = ['#ff4d6d', '#ff8fab', '#ff9f1c', '#c77dff', '#7ae582', '#4cc9f0'];

  // 鼠标轨迹细小颗粒的颜色池
  const TRAIL_COLORS = [
    '#ff4d6d', '#ff8fab', '#ffb703', '#8ecae6',
    '#90e0ef', '#c77dff', '#7ae582', '#ff9f1c',
    '#ffffff', '#ffd6e0'
  ];

  const TRAIL_SIZE_MIN = 1.5;       // 颗粒最小直径(px)
  const TRAIL_SIZE_MAX = 3.5;       // 颗粒最大直径(px)
  const TRAIL_PER_MOVE = 2;         // 每次移动生成几颗
  const TRAIL_MIN_INTERVAL = 8;     // 两次生成的最小间隔(ms)
  const TRAIL_MAX_PARTICLES = 260;  // 同屏最多多少颗，防止卡顿
  const TRAIL_SPREAD = 6;           // 生成时在鼠标周围散开的半径(px)

  const WORD_MIN_DURATION = 1300;   // 文字最短飘散时长(ms)
  const WORD_MAX_DURATION = 1900;   // 文字最长飘散时长(ms)

  /* ================================================= */

  /* ---------- 注入样式（无需额外写 CSS） ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .ce-word {
      position: fixed;
      z-index: 99999;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      font-weight: bold;
      font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
      will-change: transform, opacity;
    }
    .ce-particle {
      position: fixed;
      z-index: 99998;
      border-radius: 50%;
      pointer-events: none;
      user-select: none;
      transform: translate(-50%, -50%);
      animation: ce-trail-fade 0.7s ease-out forwards;
      will-change: transform, opacity;
    }
    @keyframes ce-trail-fade {
      0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
      30%  { opacity: 0.7; transform: translate(-50%, -50%) scale(0.8); }
      100% { opacity: 0;   transform: translate(-50%, -50%) scale(0.05); }
    }
  `;
  document.head.appendChild(style);

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* ================= 一、点击文字特效 ================= */

  let wordIndex = 0;

  function createWord(x, y) {
    const word = WORDS[wordIndex];
    wordIndex = (wordIndex + 1) % WORDS.length;

    const el = document.createElement('span');
    el.className = 'ce-word';
    el.textContent = word;

    const fontSize = random(18, 30);
    const color = pick(WORD_COLORS);
    const rise = random(80, 150);
    const drift = random(-40, 40);
    const rotate = random(-15, 15);
    const duration = random(WORD_MIN_DURATION, WORD_MAX_DURATION);

    Object.assign(el.style, {
      left: x + 'px',
      top: y + 'px',
      fontSize: fontSize + 'px',
      color: color,
      textShadow: '0 0 8px ' + color + '66'
    });

    document.body.appendChild(el);

    const keyframes = [
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.2 },
      {
        transform:
          'translate(calc(-50% + ' + drift + 'px), calc(-50% - ' + rise + 'px)) ' +
          'scale(0.9) rotate(' + rotate + 'deg)',
        opacity: 0
      }
    ];

    const options = {
      duration: duration,
      easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      fill: 'forwards'
    };

    if (typeof el.animate === 'function') {
      const anim = el.animate(keyframes, options);
      anim.onfinish = function () { el.remove(); };
      anim.oncancel = function () { el.remove(); };
    } else {
      el.style.transition =
        'transform ' + duration + 'ms ease-out, opacity ' + duration + 'ms ease-out';
      requestAnimationFrame(function () {
        el.style.transform =
          'translate(calc(-50% + ' + drift + 'px), calc(-50% - ' + rise + 'px)) ' +
          'scale(0.9) rotate(' + rotate + 'deg)';
        el.style.opacity = '0';
      });
      setTimeout(function () { el.remove(); }, duration);
    }
  }

  document.addEventListener('click', function (e) {
    createWord(e.clientX, e.clientY);
  });

  /* ================= 二、鼠标细小颗粒拖尾 ================= */

  let lastTrailTime = 0;
  let particleCount = 0;

  function createParticle(x, y) {
    const p = document.createElement('div');
    p.className = 'ce-particle';

    const size = random(TRAIL_SIZE_MIN, TRAIL_SIZE_MAX);
    const color = pick(TRAIL_COLORS);

    Object.assign(p.style, {
      left: x + 'px',
      top: y + 'px',
      width: size + 'px',
      height: size + 'px',
      background: color,
      boxShadow: '0 0 3px ' + color
    });

    document.body.appendChild(p);
    particleCount++;

    p.addEventListener('animationend', function () {
      p.remove();
      particleCount--;
    });
  }

  function emitTrail(x, y) {
    for (let i = 0; i < TRAIL_PER_MOVE; i++) {
      if (particleCount >= TRAIL_MAX_PARTICLES) return;
      const ox = random(-TRAIL_SPREAD, TRAIL_SPREAD);
      const oy = random(-TRAIL_SPREAD, TRAIL_SPREAD);
      createParticle(x + ox, y + oy);
    }
  }

  document.addEventListener('mousemove', function (e) {
    const now = Date.now();
    if (now - lastTrailTime < TRAIL_MIN_INTERVAL) return;
    lastTrailTime = now;
    emitTrail(e.clientX, e.clientY);
  });

  // 移动端触摸也能有拖尾
  document.addEventListener('touchmove', function (e) {
    const touch = e.touches[0];
    if (!touch) return;
    const now = Date.now();
    if (now - lastTrailTime < TRAIL_MIN_INTERVAL) return;
    lastTrailTime = now;
    emitTrail(touch.clientX, touch.clientY);
  }, { passive: true });

})();