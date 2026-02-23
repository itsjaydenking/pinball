/**
 * Effects.js – Visual effects and WebAudio sound stubs.
 *
 * Responsibilities:
 *   • Procedural starfield background
 *   • Particle system (bumper/target hits)
 *   • Screen-shake
 *   • Ball glow trail rendering helper
 *   • WebAudio simple tones (bumper pop, target ding, launch whoosh, drain thud)
 */
export class Effects {
  constructor() {
    this.particles = [];
    this.shakeX = 0;
    this.shakeY = 0;

    this._stars = this._initStars(90);
    this._audio = this._initAudio();
  }

  // ─── Stars ────────────────────────────────────────────────────────────────

  _initStars(count) {
    const stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x:           Math.random() * 400,
        y:           Math.random() * 700,
        r:           Math.random() * 1.4 + 0.2,
        alpha:       Math.random() * 0.55 + 0.15,
        twinkle:     Math.random() * Math.PI * 2,
        twinkleSpd:  Math.random() * 1.8 + 0.5,
      });
    }
    return stars;
  }

  // ─── WebAudio ─────────────────────────────────────────────────────────────

  _initAudio() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      return { ctx };
    } catch (_) {
      // AudioContext unavailable (e.g. sandboxed iframe) – all sound methods
      // will be no-ops. This is expected fallback behaviour.
      return null;
    }
  }

  /**
   * Play a short tone.
   * @param {number} freq   Hz
   * @param {number} dur    seconds
   * @param {number} vol    0–1
   * @param {'sine'|'square'|'triangle'} type
   */
  _tone(freq, dur, vol = 0.18, type = 'sine') {
    if (!this._audio) return; // audio unavailable – silent fallback
    try {
      const { ctx } = this._audio;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur + 0.01);
    } catch (_) {
      // Silently ignore playback errors (e.g. context closed during navigation)
    }
  }

  soundBumper()    { this._tone(420, 0.08, 0.22, 'square'); }
  soundTarget()    { this._tone(660, 0.1,  0.18, 'sine');   }
  soundSlingshot() { this._tone(280, 0.06, 0.15, 'triangle'); }
  soundLane()      { this._tone(880, 0.12, 0.2,  'sine');   }
  soundLaunch()    { this._tone(180, 0.25, 0.2,  'triangle'); }
  soundDrain()     { this._tone(130, 0.4,  0.22, 'sine');   }
  soundMultiplier(){ this._tone(1100, 0.18, 0.25, 'sine');  }

  // ─── Update ───────────────────────────────────────────────────────────────

  update(dt) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  += 180 * dt; // mild gravity on particles
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Screen shake decay
    const decay = 0.82;
    this.shakeX *= decay;
    this.shakeY *= decay;
    if (Math.abs(this.shakeX) < 0.05) this.shakeX = 0;
    if (Math.abs(this.shakeY) < 0.05) this.shakeY = 0;

    // Star twinkle
    for (const s of this._stars) {
      s.twinkle += s.twinkleSpd * dt;
    }
  }

  // ─── Spawn effects ────────────────────────────────────────────────────────

  spawnBumperParticles(x, y) {
    this._spawnBurst(x, y, 14, '#ff8800', 100, 180, 0.5);
  }

  spawnTargetParticles(x, y) {
    this._spawnBurst(x, y, 8, '#ffff00', 70, 130, 0.38);
  }

  spawnSlingshotParticles(x, y) {
    this._spawnBurst(x, y, 6, '#ff4400', 60, 110, 0.28);
  }

  _spawnBurst(cx, cy, count, color, minSpd, maxSpd, life) {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const spd = minSpd + Math.random() * (maxSpd - minSpd);
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r:  1.5 + Math.random() * 2.5,
        color,
        life,
        maxLife: life,
      });
    }
  }

  shake(intensity) {
    this.shakeX = (Math.random() - 0.5) * intensity * 2;
    this.shakeY = (Math.random() - 0.5) * intensity * 2;
  }

  // ─── Draw helpers ─────────────────────────────────────────────────────────

  drawStarfield(ctx) {
    for (const s of this._stars) {
      const a = s.alpha * (0.65 + 0.35 * Math.sin(s.twinkle));
      ctx.globalAlpha = a;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = t * t; // quadratic fade
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * t + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBallTrail(ctx, trail, radius) {
    if (trail.length < 2) return;
    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length; // 0→1, older→newer
      ctx.globalAlpha = t * 0.35;
      ctx.fillStyle   = '#00aaff';
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, radius * t * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
