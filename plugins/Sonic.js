import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const GAME_TITLE = 'SPEEDY DASH v4 — LASER & BOSS EDITION';

const GAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SPEEDY DASH v4</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;background:#050817;color:#fff;
  font-family:Arial,sans-serif;text-align:center;
  overflow:hidden
}
header{padding:12px;background:#09152c}
h1{margin:5px;color:#35e8ff;font-size:25px}
#stats{
  display:flex;justify-content:space-around;
  padding:12px;font-weight:bold;color:#ffe66d
}
canvas{
  display:block;width:100%;max-width:900px;
  margin:auto;background:#09142b;
  border:2px solid #35e8ff;
  touch-action:manipulation
}
.controls{padding:12px}
button{
  padding:14px 22px;margin:5px;
  border:1px solid #35e8ff;border-radius:12px;
  background:#102746;color:#fff;font-weight:bold;
  font-size:16px
}
button:active{background:#087eaa}
#message{color:#35e8ff;padding:8px}
small{color:#a9c4df}
</style>
</head>
<body>
<header>
<h1>⚡ SPEEDY DASH</h1>
<div>LASER & BOSS EDITION</div>
</header>

<div id="stats">
<span>💍 Rings: <b id="rings">0</b></span>
<span>❤️ Lives: <b id="lives">3</b></span>
<span>🏆 Best: <b id="best">0</b></span>
</div>

<canvas id="game" width="900" height="440"></canvas>

<div id="message">Tap JUMP to start running!</div>

<div class="controls">
<button id="start">▶ START / RESTART</button>
<button id="jump">⬆ JUMP</button>
<button id="boost">⚡ BOOST</button>
</div>

<small>Collect rings • Avoid lasers • Defeat the boss!</small>

<script>
(() => {
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ringsEl = document.getElementById('rings');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const message = document.getElementById('message');

let running = false;
let rings = 0;
let lives = 3;
let speed = 5;
let frame = 0;
let boostTime = 0;
let obstacles = [];
let ringItems = [];
let particles = [];
let boss = null;

const ground = 365;

const player = {
  x: 110, y: ground - 42,
  w: 38, h: 42,
  vy: 0, jumping: false
};

let best = 0;
try {
  best = Number(localStorage.getItem('speedy_dash_best') || 0);
} catch {}
bestEl.textContent = best;

function reset() {
  rings = 0;
  lives = 3;
  speed = 5;
  frame = 0;
  boostTime = 0;
  obstacles = [];
  ringItems = [];
  particles = [];
  boss = null;

  player.y = ground - player.h;
  player.vy = 0;
  player.jumping = false;

  running = true;
  message.textContent = 'RUN! Collect rings and avoid obstacles.';
  updateStats();
}

function updateStats() {
  ringsEl.textContent = rings;
  livesEl.textContent = lives;
  bestEl.textContent = best;
}

function jump() {
  if (!running) {
    reset();
    return;
  }

  if (!player.jumping) {
    player.vy = -15;
    player.jumping = true;
  }
}

function boost() {
  if (!running) {
    reset();
    return;
  }
  boostTime = 90;
}

document.getElementById('start').addEventListener('click', reset);
document.getElementById('jump').addEventListener('click', jump);
document.getElementById('boost').addEventListener('click', boost);

canvas.addEventListener('pointerdown', jump);

document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    jump();
  }
  if (e.code === 'ShiftLeft' || e.code === 'ArrowRight') boost();
  if (e.code === 'Enter' && !running) reset();
});

function rectHit(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

function spawn() {
  if (frame % 90 === 0) {
    obstacles.push({
      x: 920,
      y: ground - 35,
      w: 28,
      h: 35,
      type: 'enemy'
    });
  }

  if (frame % 125 === 0) {
    ringItems.push({
      x: 920,
      y: ground - 80 - Math.random() * 90,
      r: 11,
      taken: false
    });
  }

  if (frame % 230 === 0) {
    obstacles.push({
      x: 920,
      y: ground - 125,
      w: 12,
      h: 125,
      type: 'laser',
      active: true
    });
  }

  if (rings >= 50 && !boss) {
    boss = {
      x: 820,
      y: 180,
      w: 72,
      h: 72,
      hp: 5,
      cooldown: 0
    };
    message.textContent = '👹 BOSS INCOMING! Jump to attack!';
  }
}

function addParticles(x, y, color) {
  for (let i = 0; i < 8; i++) {
    particles.push({
      x, y,
      vx: Math.random() * 6 - 3,
      vy: Math.random() * -5 - 1,
      life: 25,
      color
    });
  }
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, 440);
  gradient.addColorStop(0, '#07112c');
  gradient.addColorStop(1, '#102d50');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 900, 440);

  ctx.strokeStyle = '#153b61';
  ctx.lineWidth = 1;

  for (let x = -((frame * speed) % 60); x < 900; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ground);
    ctx.stroke();
  }

  ctx.fillStyle = '#10243a';
  ctx.fillRect(0, ground, 900, 75);

  ctx.fillStyle = '#35e8ff';
  ctx.fillRect(0, ground, 900, 4);
}

function drawPlayer() {
  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#35e8ff';

  ctx.fillStyle = '#168fff';
  ctx.beginPath();
  ctx.roundRect(player.x, player.y, player.w, player.h, 10);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillRect(player.x + 23, player.y + 9, 7, 7);

  ctx.fillStyle = '#10182b';
  ctx.fillRect(player.x + 26, player.y + 11, 3, 3);

  ctx.restore();
}

function drawObstacle(o) {
  if (o.type === 'laser') {
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ff2255';
    ctx.fillStyle = '#ff2255';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(o.x + 5, o.y + 7, 6, 6);
    ctx.fillRect(o.x + 17, o.y + 7, 6, 6);
  }
}

function drawBoss() {
  if (!boss) return;

  ctx.save();
  ctx.shadowBlur = 20;
  ctx.shadowColor = '#ff2255';

  ctx.fillStyle = '#a21caf';
  ctx.beginPath();
  ctx.roundRect(boss.x, boss.y, boss.w, boss.h, 14);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillRect(boss.x + 14, boss.y + 20, 12, 12);
  ctx.fillRect(boss.x + 46, boss.y + 20, 12, 12);

  ctx.fillStyle = '#ff2255';
  ctx.fillRect(boss.x, boss.y - 12, boss.w, 6);

  ctx.fillStyle = '#49ff9a';
  ctx.fillRect(boss.x, boss.y - 12, boss.w * boss.hp / 5, 6);

  ctx.restore();
}

function gameOver() {
  running = false;
  message.textContent = 'GAME OVER! Press START to try again.';
  if (rings > best) {
    best = rings;
    try {
      localStorage.setItem('speedy_dash_best', String(best));
    } catch {}
  }
  updateStats();
}

function update() {
  if (!running) return;

  frame++;

  const currentSpeed = speed + (boostTime > 0 ? 4 : 0);
  if (boostTime > 0) boostTime--;

  player.vy += 0.7;
  player.y += player.vy;

  if (player.y >= ground - player.h) {
    player.y = ground - player.h;
    player.vy = 0;
    player.jumping = false;
  }

  if (frame % 500 === 0) speed = Math.min(speed + 0.4, 10);

  spawn();

  for (const o of obstacles) {
    o.x -= currentSpeed;

    if (rectHit(player, o)) {
      if (boostTime > 0) {
        addParticles(o.x, o.y, '#35e8ff');
        o.x = -100;
      } else {
        lives--;
        o.x = -100;
        updateStats();
        addParticles(player.x, player.y, '#ff2255');

        if (lives <= 0) {
          gameOver();
          return;
        }
      }
    }
  }

  obstacles = obstacles.filter(o => o.x > -100);

  for (const r of ringItems) {
    r.x -= currentSpeed;

    const dx = player.x + player.w / 2 - r.x;
    const dy = player.y + player.h / 2 - r.y;

    if (!r.taken && Math.hypot(dx, dy) < 35) {
      r.taken = true;
      rings++;
      addParticles(r.x, r.y, '#ffe66d');
      updateStats();
    }
  }

  ringItems = ringItems.filter(r => r.x > -30 && !r.taken);

  if (boss) {
    boss.x -= 0.8;
    if (boss.x < 600) boss.x = 600;

    boss.cooldown++;

    if (player.jumping && player.x + player.w > boss.x &&
        player.x < boss.x + boss.w) {
      boss.hp--;
      player.vy = -8;
      boss.x += 45;
      addParticles(boss.x, boss.y, '#ff66dd');

      if (boss.hp <= 0) {
        addParticles(boss.x, boss.y, '#ffe66d');
        boss = null;
        rings += 10;
        message.textContent = '🏆 BOSS DEFEATED! +10 BONUS RINGS!';
        updateStats();
      }
    }
  }

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
}

function draw() {
  drawBackground();

  for (const r of ringItems) {
    ctx.save();
    ctx.strokeStyle = '#ffe66d';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ffe66d';
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  obstacles.forEach(drawObstacle);
  drawBoss();
  drawPlayer();

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 25);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 5, 5);
  }
  ctx.globalAlpha = 1;

  if (!running) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 900, 440);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#35e8ff';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('SPEEDY DASH', 450, 190);

    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.fillText('Press START to play', 450, 230);
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
})();
</script>
</body>
</html>`;

const plugin = {
  command: 'sonic',
  alias: ['speedy', 'speeddash'],

  async execute(sock, msg) {
    const chatId = msg?.key?.remoteJid;

    if (!chatId) return;

    let filePath;

    try {
      filePath = path.join(
        os.tmpdir(),
        `speedy-dash-${randomUUID()}.html`,
      );

      fs.writeFileSync(filePath, GAME_HTML, 'utf8');

      await sock.sendMessage(
        chatId,
        {
          document: fs.readFileSync(filePath),
          mimetype: 'text/html',
          fileName: 'SPEEDY_DASH_V4.html',
          caption:
            '🌀 *SPEEDY DASH v4*\n' +
            '⚡ LASER & BOSS EDITION\n\n' +
            '📥 Download the HTML file and open it in a browser to play!',
        },
        { quoted: msg },
      );
    } catch (error) {
      console.error('[SPEEDY DASH]', error);

      await sock.sendMessage(
        chatId,
        {
          text: '❌ Game එක යවන්න බැරි වුණා: ' +
            (error?.message || 'Unknown error'),
        },
        { quoted: msg },
      );
    } finally {
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
    }
  },
};

export default plugin;