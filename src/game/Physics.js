/**
 * Physics.js – Lightweight arcade-physics engine (no external libraries).
 *
 * Design:
 *   • Fixed-timestep integration with SUBSTEPS sub-steps per tick.
 *   • Ball vs. line-segment  – closest-point projection + normal reflection.
 *   • Ball vs. circle        – distance check + push-out + impulse.
 *   • Ball vs. AABB          – closest-point-on-rect + normal reflection.
 *   • Flipper                – rotating line segment; angular-velocity impulse.
 *   • Speed clamp prevents tunnelling through thin geometry.
 */

const GRAVITY    = 900;   // px / s²
const DAMPING    = 0.004; // fractional velocity loss per second (air resistance)
const SUBSTEPS   = 4;     // collision sub-steps per update tick
const MAX_SPEED  = 1450;  // px / s hard cap (tunnelling prevention)
const BALL_R     = 10;    // ball radius (px)

// ─── Ball factory ──────────────────────────────────────────────────────────
export function createBall(x, y) {
  return {
    x, y,
    vx: 0, vy: 0,
    radius: BALL_R,
    trail: [],
    held: true, // true while in the plunger lane (no physics)
  };
}

// ─── Physics engine ────────────────────────────────────────────────────────
export class Physics {
  /**
   * @param {import('./Table.js').Table} table
   */
  constructor(table) {
    this.table = table;
    // Per-frame hit results consumed by Game.js
    this.hits = {
      bumpers:    [],  // indices of bumpers hit this frame
      targets:    [],  // indices of targets hit this frame
      lanes:      [],  // indices of lanes rolled over
      slingshots: [],  // indices of slingshots hit
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance physics by `dt` seconds (fixed timestep, typically 1/60).
   * Fills `this.hits` with objects hit this frame.
   */
  step(ball, dt) {
    if (ball.held) return;

    // Reset hit records for this frame
    this.hits.bumpers    = [];
    this.hits.targets    = [];
    this.hits.lanes      = [];
    this.hits.slingshots = [];

    const subDt = dt / SUBSTEPS;

    for (let s = 0; s < SUBSTEPS; s++) {
      this._integrate(ball, subDt);
      this._collideWalls(ball);
      this._collideSlingshots(ball);
      this._collideBumpers(ball);
      this._collideTargets(ball);
      this._collideFlippers(ball);
      this._clampSpeed(ball);
    }

    // Lanes only checked once (they are large circles, no push-out needed)
    this._checkLanes(ball);

    // Update visual trail
    this._updateTrail(ball);
  }

  /**
   * Advance flipper angle toward its target (rest or active) each tick.
   * Must be called every game-tick, even while paused drawing may differ.
   */
  updateFlipper(flipper, dt) {
    const target = flipper.active ? flipper.activeAngle : flipper.restAngle;
    const diff   = target - flipper.angle;
    // Fast snap up, slower return
    const speed  = flipper.active ? 1500 : 550; // deg / s
    const maxD   = speed * dt;

    if (Math.abs(diff) <= maxD) {
      flipper.angularVel = diff / dt;
      flipper.angle      = target;
    } else {
      flipper.angularVel = Math.sign(diff) * speed;
      flipper.angle     += Math.sign(diff) * maxD;
    }
  }

  /**
   * Launch ball out of the plunger lane.
   * Ball position is already at the pulled-back position (set during charging).
   * Sets velocity and clears the `held` flag.
   */
  launchBall(ball, plunger) {
    ball.vx    = 0;
    ball.vy    = -(plunger.charge * plunger.maxLaunch);
    ball.held  = false;
    ball.trail = [];
    plunger.charge   = 0;
    plunger.charging = false;
  }

  // ─── Integration ─────────────────────────────────────────────────────────

  _integrate(ball, dt) {
    ball.vy += GRAVITY * dt;
    ball.vx *= (1 - DAMPING);
    ball.vy *= (1 - DAMPING);
    ball.x  += ball.vx * dt;
    ball.y  += ball.vy * dt;
  }

  _clampSpeed(ball) {
    const spd = Math.hypot(ball.vx, ball.vy);
    if (spd > MAX_SPEED) {
      ball.vx = (ball.vx / spd) * MAX_SPEED;
      ball.vy = (ball.vy / spd) * MAX_SPEED;
    }
  }

  _updateTrail(ball) {
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 14) ball.trail.shift();
  }

  // ─── Segment collision helper ─────────────────────────────────────────────

  /**
   * Resolve ball vs. line segment [p1→p2].
   * Returns true if a collision was detected and resolved.
   * @param {number} extraImpX  optional extra vx impulse (flipper)
   * @param {number} extraImpY  optional extra vy impulse (flipper)
   */
  _resolveSegment(ball, x1, y1, x2, y2, restitution, extraImpX = 0, extraImpY = 0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return false;

    // Project ball centre onto segment; clamp to [0,1]
    let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;

    const cx = x1 + t * dx;
    const cy = y1 + t * dy;

    const distX = ball.x - cx;
    const distY = ball.y - cy;
    const dist  = Math.hypot(distX, distY);

    if (dist < ball.radius && dist > 0.0001) {
      const nx = distX / dist;
      const ny = distY / dist;

      // Push ball out of penetration
      const pen = ball.radius - dist;
      ball.x += nx * pen;
      ball.y += ny * pen;

      // Velocity reflection
      const vDotN = ball.vx * nx + ball.vy * ny;
      if (vDotN < 0) {
        ball.vx -= (1 + restitution) * vDotN * nx;
        ball.vy -= (1 + restitution) * vDotN * ny;
        // Optional extra impulse (flipper hit)
        ball.vx += extraImpX;
        ball.vy += extraImpY;
      }
      return true;
    }
    return false;
  }

  // ─── Wall collisions ─────────────────────────────────────────────────────

  _collideWalls(ball) {
    for (const w of this.table.walls) {
      this._resolveSegment(ball, w.x1, w.y1, w.x2, w.y2, 0.5);
    }
  }

  // ─── Slingshot collisions ─────────────────────────────────────────────────

  _collideSlingshots(ball) {
    const t = this.table.slingshots;
    for (let i = 0; i < t.length; i++) {
      const s   = t[i];
      const hit = this._resolveSegment(ball, s.x1, s.y1, s.x2, s.y2, s.restitution);
      if (hit) {
        // Only record once per frame (substep de-dup)
        if (!this.hits.slingshots.includes(i)) this.hits.slingshots.push(i);
        s.hitFlash = 0.12;
      }
    }
  }

  // ─── Bumper collisions ─────────────────────────────────────────────────────

  _collideBumpers(ball) {
    const bumpList = this.table.bumpers;
    for (let i = 0; i < bumpList.length; i++) {
      const b  = bumpList[i];
      const dx = ball.x - b.x;
      const dy = ball.y - b.y;
      const dist    = Math.hypot(dx, dy);
      const minDist = ball.radius + b.r;

      if (dist < minDist && dist > 0.0001) {
        const nx = dx / dist;
        const ny = dy / dist;

        // Push out
        ball.x = b.x + nx * minDist;
        ball.y = b.y + ny * minDist;

        // Reflect
        const vDotN = ball.vx * nx + ball.vy * ny;
        if (vDotN < 0) {
          ball.vx -= (1 + 1.3) * vDotN * nx;
          ball.vy -= (1 + 1.3) * vDotN * ny;
        }

        // Ensure a minimum pop speed away from bumper
        const spd = Math.hypot(ball.vx, ball.vy);
        if (spd < 380) {
          ball.vx = nx * 380;
          ball.vy = ny * 380;
        }

        b.litTimer = 0.25;
        if (!this.hits.bumpers.includes(i)) this.hits.bumpers.push(i);
      }
    }
  }

  // ─── Target collisions (AABB) ─────────────────────────────────────────────

  _collideTargets(ball) {
    const tList = this.table.targets;
    for (let i = 0; i < tList.length; i++) {
      const tgt = tList[i];
      if (tgt.lit) continue; // already knocked down – no collision

      const hw = tgt.w / 2;
      const hh = tgt.h / 2;

      // Closest point on AABB to ball centre
      const cx = Math.max(tgt.x - hw, Math.min(ball.x, tgt.x + hw));
      const cy = Math.max(tgt.y - hh, Math.min(ball.y, tgt.y + hh));

      const dx   = ball.x - cx;
      const dy   = ball.y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < ball.radius && dist > 0.0001) {
        const nx = dx / dist;
        const ny = dy / dist;

        ball.x += nx * (ball.radius - dist);
        ball.y += ny * (ball.radius - dist);

        const vDotN = ball.vx * nx + ball.vy * ny;
        if (vDotN < 0) {
          ball.vx -= (1 + 0.6) * vDotN * nx;
          ball.vy -= (1 + 0.6) * vDotN * ny;
        }

        tgt.lit      = true;
        tgt.hitFlash = 0.35;
        if (!this.hits.targets.includes(i)) this.hits.targets.push(i);
      }
    }
  }

  // ─── Lane rollovers ──────────────────────────────────────────────────────

  _checkLanes(ball) {
    const lList = this.table.lanes;
    for (let i = 0; i < lList.length; i++) {
      const l    = lList[i];
      const dist = Math.hypot(ball.x - l.x, ball.y - l.y);
      if (dist < ball.radius + l.r) {
        if (!l.lit) {
          l.lit = true;
          if (!this.hits.lanes.includes(i)) this.hits.lanes.push(i);
        }
      }
    }
  }

  // ─── Flipper collisions ───────────────────────────────────────────────────

  _collideFlippers(ball) {
    for (const flip of [this.table.leftFlipper, this.table.rightFlipper]) {
      const tip = this.table.flipperTip(flip);
      const rad = flip.angle * (Math.PI / 180);

      // Tangential extra impulse from angular velocity (approximation)
      let extraX = 0;
      let extraY = 0;
      if (flip.active && Math.abs(flip.angularVel) > 5) {
        const omega   = flip.angularVel * (Math.PI / 180); // rad/s
        const contactR = flip.length * 0.55;               // approximate contact radius
        // Tangential velocity direction (perpendicular to flipper, pointing upward when flipping)
        const perpX = -Math.sin(rad);
        const perpY =  Math.cos(rad);
        const tangSpeed = omega * contactR * 0.28;
        extraX = perpX * tangSpeed;
        extraY = perpY * tangSpeed;
      }

      this._resolveSegment(
        ball,
        flip.px, flip.py,
        tip.x, tip.y,
        0.55,
        extraX, extraY,
      );
    }
  }
}
