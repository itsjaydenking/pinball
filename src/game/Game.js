/**
 * Game.js – Core game controller.
 *
 * Responsibilities:
 *   • Canvas sizing / responsive scaling (CSS + logical coordinates)
 *   • Game loop: requestAnimationFrame + fixed-timestep accumulator
 *   • State machine: READY → PLAYING → BALL_LOST → READY | GAME_OVER
 *   • Scoring: score, multiplier (max 5×), combo streak
 *   • Ball-save timer (3 s after launch)
 *   • Coordinates all subsystems: Physics, Table, Input, UI, Effects
 *   • Render pipeline: starfield → table → trail → particles → ball → UI
 */

import { Table, TABLE_W, TABLE_H } from './Table.js';
import { Physics, createBall }     from './Physics.js';
import { Input }                   from './Input.js';
import { UI }                      from './UI.js';
import { Effects }                 from './Effects.js';

const TOTAL_BALLS    = 3;
const BALL_SAVE_TIME = 3.0;  // seconds of ball-save after launch
const COMBO_WINDOW   = 1.5;  // seconds between hits to extend combo
const MAX_MULTIPLIER = 5;
const FIXED_DT       = 1 / 60;
const TILT_LIMIT     = 6;    // nudges before TILT triggers drain

// Game states
const STATE = Object.freeze({
  READY:     'READY',
  PLAYING:   'PLAYING',
  BALL_LOST: 'BALL_LOST',
  GAME_OVER: 'GAME_OVER',
  PAUSED:    'PAUSED',
});

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Subsystems
    this.table   = new Table();
    this.physics = new Physics(this.table);
    this.input   = new Input(canvas);
    this.ui      = new UI();
    this.fx      = new Effects();

    // Game state
    this.state        = STATE.READY;
    this.score        = 0;
    this.multiplier   = 1;
    this.balls        = TOTAL_BALLS;
    this.combo        = 1;
    this.comboTimer   = 0;
    this.ballSaveTimer = 0;

    // Bonus-claimed flags (reset each new ball)
    this._targetBonusClaimed = false;
    this._laneBonusClaimed   = false;

    // Ball-lost intermediate timer (brief pause before READY)
    this._ballLostPause = 0;

    // Loop timing
    this._lastTimestamp = 0;
    this._accumulator   = 0;

    // Ball object (null between drain and next READY)
    this.ball = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindRestartClick();

    // Place ball in plunger to begin
    this._spawnBall();
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  start() {
    requestAnimationFrame((ts) => this._loop(ts));
  }

  // ─── Canvas scaling ───────────────────────────────────────────────────────

  _resize() {
    const scaleX = window.innerWidth  / TABLE_W;
    const scaleY = window.innerHeight / TABLE_H;
    const scale  = Math.min(scaleX, scaleY);

    this.canvas.width  = TABLE_W;
    this.canvas.height = TABLE_H;
    this.canvas.style.width  = `${TABLE_W * scale}px`;
    this.canvas.style.height = `${TABLE_H * scale}px`;

    const container = document.getElementById('game-container');
    if (container) {
      container.style.width  = `${TABLE_W * scale}px`;
      container.style.height = `${TABLE_H * scale}px`;
    }
  }

  // ─── Restart click / tap ──────────────────────────────────────────────────

  _bindRestartClick() {
    const handler = (clientX, clientY) => {
      if (this.state !== STATE.GAME_OVER) return;
      const rect   = this.canvas.getBoundingClientRect();
      const scaleX = TABLE_W / rect.width;
      const scaleY = TABLE_H / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top)  * scaleY;
      if (this.ui.isRestartHit(x, y)) this._newGame();
    };

    this.canvas.addEventListener('click',     (e) => handler(e.clientX, e.clientY));
    this.canvas.addEventListener('touchend',  (e) => {
      if (e.changedTouches.length) {
        const t = e.changedTouches[0];
        handler(t.clientX, t.clientY);
      }
    });
  }

  // ─── Game-flow helpers ────────────────────────────────────────────────────

  _newGame() {
    this.score        = 0;
    this.multiplier   = 1;
    this.balls        = TOTAL_BALLS;
    this.combo        = 1;
    this.comboTimer   = 0;
    this.ballSaveTimer = 0;
    this._targetBonusClaimed = false;
    this._laneBonusClaimed   = false;
    this.input.tiltCount     = 0;
    this.table.resetTargets();
    this.state = STATE.READY;
    this._spawnBall();
  }

  /** Place a fresh ball in the plunger lane (held, no physics). */
  _spawnBall() {
    const p  = this.table.plunger;
    this.ball = createBall(p.x, p.y);
    this.ball.held = true;
    this.table.plunger.charge   = 0;
    this.table.plunger.charging = false;
    this._targetBonusClaimed = false;
    this._laneBonusClaimed   = false;
  }

  // ─── Main loop ────────────────────────────────────────────────────────────

  _loop(timestamp) {
    let dt = (timestamp - this._lastTimestamp) / 1000;
    this._lastTimestamp = timestamp;
    dt = Math.min(dt, 0.05); // cap at 50 ms (handles tab-hidden stutters)

    if (this.state !== STATE.PAUSED) {
      this._accumulator += dt;
      while (this._accumulator >= FIXED_DT) {
        this._update(FIXED_DT);
        this._accumulator -= FIXED_DT;
      }
    }

    this.fx.update(dt);
    this._render();
    requestAnimationFrame((ts) => this._loop(ts));
  }

  // ─── Fixed-timestep update ────────────────────────────────────────────────

  _update(dt) {
    this._handleInput(dt);

    switch (this.state) {
      case STATE.PLAYING:
        this._updatePlaying(dt);
        break;
      case STATE.BALL_LOST:
        this._updateBallLost(dt);
        break;
      default:
        break;
    }
  }

  // ─── Input processing ─────────────────────────────────────────────────────

  _handleInput(dt) {
    const inp = this.input;

    // Pause toggle
    if (inp.consumePausePress()) {
      if (this.state === STATE.PLAYING) {
        this.state = STATE.PAUSED;
      } else if (this.state === STATE.PAUSED) {
        this.state = STATE.PLAYING;
      }
    }

    // Flipper control (always update so they return to rest while paused too)
    this.table.leftFlipper.active  = inp.leftFlipper;
    this.table.rightFlipper.active = inp.rightFlipper;
    this.physics.updateFlipper(this.table.leftFlipper,  dt);
    this.physics.updateFlipper(this.table.rightFlipper, dt);

    // Plunger charging (only available before launch)
    const canCharge = (this.state === STATE.READY || this.state === STATE.BALL_LOST)
                   && this.ball && this.ball.held;

    if (canCharge) {
      const p = this.table.plunger;
      if (inp.plungerHeld) {
        p.charging = true;
        p.charge   = Math.min(1, p.charge + dt / 1.6);
      }
      if (inp.consumePlungerRelease() && p.charge > 0.05) {
        this.physics.launchBall(this.ball, p);
        this.ballSaveTimer = BALL_SAVE_TIME;
        this.fx.soundLaunch();
        this.state = STATE.PLAYING;
      }
    }

    // Nudge / tilt
    const nudge = inp.consumeNudge();
    if ((nudge.x !== 0 || nudge.y !== 0) && this.state === STATE.PLAYING) {
      if (inp.tiltCount > TILT_LIMIT) {
        // TILT! – drain the ball
        this._drainBall();
      } else if (this.ball && !this.ball.held) {
        this.ball.vx += nudge.x;
        this.ball.vy += nudge.y;
      }
    }
  }

  // ─── PLAYING update ───────────────────────────────────────────────────────

  _updatePlaying(dt) {
    if (!this.ball) return;

    // Timers
    if (this.ballSaveTimer > 0) this.ballSaveTimer -= dt;
    if (this.comboTimer    > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }

    // Decay bumper / target / slingshot flash timers
    for (const b of this.table.bumpers)     if (b.litTimer  > 0) b.litTimer  -= dt;
    for (const t of this.table.targets)     if (t.hitFlash  > 0) t.hitFlash  -= dt;
    for (const s of this.table.slingshots)  if (s.hitFlash  > 0) s.hitFlash  -= dt;

    // Physics step (fills physics.hits)
    this.physics.step(this.ball, dt);

    // Process hit results
    this._processHits();

    // Bonus checks
    this._checkTargetBonus();
    this._checkLaneBonus();

    // Drain detection
    if (this._isDrained()) {
      if (this.ballSaveTimer > 0) {
        this._ballSaved();
      } else {
        this._drainBall();
      }
    }
  }

  // ─── BALL_LOST update ─────────────────────────────────────────────────────

  _updateBallLost(dt) {
    this._ballLostPause -= dt;
    if (this._ballLostPause <= 0) {
      this.state = STATE.READY;
      this._spawnBall();
    }
  }

  // ─── Hit processing ───────────────────────────────────────────────────────

  _processHits() {
    const h = this.physics.hits;

    for (const i of h.bumpers) {
      const b   = this.table.bumpers[i];
      const pts = b.score * this.multiplier * this.combo;
      this.score += pts;
      this._hit();
      this.fx.spawnBumperParticles(b.x, b.y);
      this.fx.shake(4);
      this.fx.soundBumper();
    }

    for (const i of h.targets) {
      const t   = this.table.targets[i];
      const pts = t.score * this.multiplier * this.combo;
      this.score += pts;
      this._hit();
      this.fx.spawnTargetParticles(t.x, t.y);
      this.fx.soundTarget();
    }

    for (const i of h.lanes) {
      this.score += 50 * this.multiplier;
      this.fx.soundLane();
    }

    for (const i of h.slingshots) {
      const s = this.table.slingshots[i];
      this.score += s.score * this.multiplier;
      this.fx.spawnSlingshotParticles(
        (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2,
      );
      this.fx.shake(2.5);
      this.fx.soundSlingshot();
    }
  }

  /** Increment combo streak. */
  _hit() {
    this.combo     = Math.min(this.combo + 1, 8);
    this.comboTimer = COMBO_WINDOW;
  }

  // ─── Bonus checks ─────────────────────────────────────────────────────────

  _checkTargetBonus() {
    if (this._targetBonusClaimed) return;
    if (!this.table.targets.every((t) => t.lit)) return;

    this._targetBonusClaimed = true;
    const bonus = 1000 * this.multiplier;
    this.score += bonus;
    this.fx.shake(6);
    this.fx.soundMultiplier();

    // Reset targets after short delay
    setTimeout(() => {
      this.table.targets.forEach((t) => { t.lit = false; t.hitFlash = 0; });
      this._targetBonusClaimed = false;
    }, 2200);
  }

  _checkLaneBonus() {
    if (this._laneBonusClaimed) return;
    if (!this.table.lanes.every((l) => l.lit)) return;

    this._laneBonusClaimed = true;
    if (this.multiplier < MAX_MULTIPLIER) this.multiplier++;
    const bonus = 500 * this.multiplier;
    this.score += bonus;
    this.fx.soundMultiplier();

    // Reset lanes after short delay
    setTimeout(() => {
      this.table.lanes.forEach((l) => { l.lit = false; });
      this._laneBonusClaimed = false;
    }, 1800);
  }

  // ─── Ball drain / save ────────────────────────────────────────────────────

  _isDrained() {
    if (!this.ball || this.ball.held) return false;
    // Catch any ball that falls off the bottom of the canvas
    if (this.ball.y > TABLE_H + 20) return true;
    // Standard drain gap between flippers
    return (
      this.ball.y > this.table.drainY &&
      this.ball.x > this.table.drainLeft &&
      this.ball.x < this.table.drainRight
    );
  }

  _ballSaved() {
    // Return ball to plunger lane
    const p = this.table.plunger;
    this.ball.x    = p.x;
    this.ball.y    = p.y;
    this.ball.vx   = 0;
    this.ball.vy   = 0;
    this.ball.held = true;
    this.ball.trail = [];
    p.charge   = 0;
    p.charging = false;
    this.ballSaveTimer = 0;
    this.state = STATE.READY;
  }

  _drainBall() {
    this.fx.soundDrain();
    this.fx.shake(7);
    this.balls--;
    this.combo      = 1;
    this.comboTimer = 0;
    this.ball       = null;

    if (this.balls <= 0) {
      this.state = STATE.GAME_OVER;
    } else {
      this.state          = STATE.BALL_LOST;
      this._ballLostPause = 1.8; // seconds before READY again
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  _render() {
    const ctx = this.ctx;

    // Screen-shake transform
    ctx.save();
    ctx.translate(
      Math.round(this.fx.shakeX),
      Math.round(this.fx.shakeY),
    );

    // Background
    ctx.fillStyle = '#04040f';
    ctx.fillRect(-4, -4, TABLE_W + 8, TABLE_H + 8);

    // Starfield
    this.fx.drawStarfield(ctx);

    // Table geometry + plunger lane background (drawn before ball so ball renders on top)
    this._drawTable(ctx);
    this._drawPlunger(ctx);

    // Ball trail + ball (drawn after plunger so ball is visible in lane)
    if (this.ball) {
      this.fx.drawBallTrail(ctx, this.ball.trail, this.ball.radius);
      this._drawBall(ctx, this.ball);
    }

    // Particles (on top of everything)
    this.fx.drawParticles(ctx);

    ctx.restore();

    // UI is drawn without shake
    this.ui.draw(ctx, {
      state:         this.state,
      score:         this.score,
      multiplier:    this.multiplier,
      balls:         this.balls,
      totalBalls:    TOTAL_BALLS,
      combo:         this.combo,
      comboTimer:    this.comboTimer,
      ballSaveTimer: this.ballSaveTimer,
      plungerCharge: this.table.plunger.charge,
    });
  }

  // ─── Table drawing ────────────────────────────────────────────────────────

  _drawTable(ctx) {
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // ── Walls ────────────────────────────────────────────────────────────
    ctx.lineWidth   = 3;
    ctx.strokeStyle = '#0044aa';
    ctx.shadowColor = '#0066ff';
    ctx.shadowBlur  = 7;
    for (const w of this.table.walls) {
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }

    // ── Slingshots ───────────────────────────────────────────────────────
    ctx.lineWidth = 4;
    for (const s of this.table.slingshots) {
      const lit     = s.hitFlash > 0;
      ctx.strokeStyle = lit ? '#ffffff' : '#ff5500';
      ctx.shadowColor = lit ? '#ffffff' : '#ff4400';
      ctx.shadowBlur  = lit ? 18 : 9;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }

    // ── Bumpers ───────────────────────────────────────────────────────────
    for (const b of this.table.bumpers) {
      const lit   = b.litTimer > 0;
      const fill  = lit ? '#ff9900' : '#331100';
      const glow  = lit ? '#ffcc00' : '#ff6600';

      ctx.shadowColor = glow;
      ctx.shadowBlur  = lit ? 22 : 9;
      ctx.fillStyle   = fill;
      ctx.strokeStyle = glow;
      ctx.lineWidth   = 2.5;

      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner ring
      ctx.fillStyle  = lit ? '#ffffff' : glow;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.38, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.font      = `bold 9px ${'"Courier New"'}`;
      ctx.fillStyle = lit ? '#ffffff' : '#ff9900';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x, b.y + b.r * 0.6);
    }
    ctx.textBaseline = 'alphabetic';

    // ── Targets ───────────────────────────────────────────────────────────
    for (const t of this.table.targets) {
      const flash  = t.hitFlash > 0;
      const fill   = t.lit ? '#cccc00' : '#002800';
      const stroke = t.lit ? (flash ? '#ffffff' : '#ffff00') : '#005500';

      ctx.shadowColor = stroke;
      ctx.shadowBlur  = t.lit ? 12 : 4;
      ctx.fillStyle   = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 1.5;

      const rx = t.x - t.w / 2;
      const ry = t.y - t.h / 2;
      ctx.fillRect(rx, ry, t.w, t.h);
      ctx.strokeRect(rx, ry, t.w, t.h);

      ctx.font      = `bold 7px "Courier New"`;
      ctx.fillStyle = t.lit ? '#ffff44' : '#00aa00';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(t.label, t.x, t.y);
    }
    ctx.textBaseline = 'alphabetic';

    // ── Lanes (rollover circles) ──────────────────────────────────────────
    for (const l of this.table.lanes) {
      const fill   = l.lit ? 'rgba(255,0,255,0.35)' : 'rgba(60,0,60,0.5)';
      const stroke = l.lit ? '#ff00ff' : '#550055';

      ctx.shadowColor = stroke;
      ctx.shadowBlur  = l.lit ? 14 : 4;
      ctx.fillStyle   = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 2;

      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font      = `bold 9px "Courier New"`;
      ctx.fillStyle = l.lit ? '#ffffff' : '#aa44aa';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(l.label, l.x, l.y);
    }
    ctx.textBaseline = 'alphabetic';

    // ── Flippers ─────────────────────────────────────────────────────────
    this._drawFlipper(ctx, this.table.leftFlipper);
    this._drawFlipper(ctx, this.table.rightFlipper);

    ctx.shadowBlur = 0;
    ctx.textAlign  = 'left';
  }

  _drawFlipper(ctx, fl) {
    const tip    = this.table.flipperTip(fl);
    const active = fl.active;
    const color  = active ? '#00ffff' : '#0077bb';

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = active ? 14 : 6;
    ctx.lineWidth   = fl.thickness * 2;
    ctx.lineCap     = 'round';

    ctx.beginPath();
    ctx.moveTo(fl.px, fl.py);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    // Pivot dot
    ctx.fillStyle  = '#aaddff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(fl.px, fl.py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Ball drawing ─────────────────────────────────────────────────────────

  _drawBall(ctx, ball) {
    const { x, y, radius } = ball;

    // Soft outer glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.8);
    grd.addColorStop(0,   'rgba(80, 180, 255, 0.55)');
    grd.addColorStop(0.5, 'rgba(0, 100, 220, 0.22)');
    grd.addColorStop(1,   'rgba(0, 30, 80, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Ball body
    ctx.shadowColor = '#00aaff';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#b8ddff';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  // ─── Plunger / spring drawing ─────────────────────────────────────────────

  _drawPlunger(ctx) {
    // Only draw the spring indicator when ball is held at the launch position
    if (!this.ball || !this.ball.held) return;

    const p       = this.table.plunger;
    const charge  = p.charge;
    const bx      = p.x;
    const by      = this.ball.y;       // ball centre
    const botY    = by + 14 + charge * 40; // spring bottom moves down as charged
    const topY    = by + 14;              // spring top just below ball

    const hue = 120 - charge * 120;    // green → red
    ctx.strokeStyle = `hsl(${hue}, 100%, 55%)`;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur  = 5 + charge * 10;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';

    const segments = 7;
    const segH     = (botY - topY) / segments;

    ctx.beginPath();
    ctx.moveTo(bx, topY);
    for (let i = 0; i < segments; i++) {
      const sy = topY + (i + 0.5) * segH;
      const sx = bx + (i % 2 === 0 ? 5 : -5);
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(bx, botY);
    ctx.stroke();

    ctx.shadowBlur = 0;
  }
}
