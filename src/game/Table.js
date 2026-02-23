/**
 * Table.js – All static geometry for the Space Pinball table.
 *
 * Logical canvas size: TABLE_W × TABLE_H pixels.
 * Y=0 is the TOP; Y increases downward.
 *
 * Layout overview (not to scale):
 *   • Main play field  : x=25 … x=358, y=25 … y=540
 *   • Plunger launch   : ball spawns inside field at lower-right (x=315, y=558)
 *   • 3 bumpers        : upper-centre triangle (y≈180–255)
 *   • 5 targets        : curved row mid-field (y≈358–388)
 *   • 2 lanes          : rollover circles near top (y≈72)
 *   • Slingshots       : angled kicker walls above flippers
 *   • Left flipper     : pivot (90, 623)
 *   • Right flipper    : pivot (270, 623)
 *   • Drain            : centre gap at y=660, x=90–270
 */

export const TABLE_W = 400;
export const TABLE_H = 700;

export class Table {
  constructor() {
    this.walls       = this._buildWalls();
    this.slingshots  = this._buildSlingshots();
    this.bumpers     = this._buildBumpers();
    this.targets     = this._buildTargets();
    this.lanes       = this._buildLanes();
    this.leftFlipper  = this._buildFlipper('left');
    this.rightFlipper = this._buildFlipper('right');
    this.plunger     = this._buildPlunger();

    // Drain / ball-out detection
    this.drainY     = 658;
    this.drainLeft  = 92;
    this.drainRight = 268;
  }

  // ─── Walls (line segments) ──────────────────────────────────────────────
  _buildWalls() {
    return [
      // ── Top boundary ─────────────────────────────────────────────────
      { x1:  25, y1: 25, x2: 358, y2:  25 }, // top wall

      // ── Outer walls ───────────────────────────────────────────────────
      { x1:  25, y1: 25, x2:  25, y2: 540 }, // left wall
      { x1: 358, y1: 25, x2: 358, y2: 540 }, // right wall

      // ── Lower angled walls → flippers ────────────────────────────────
      { x1:  25, y1: 540, x2:  92, y2: 620 }, // left lower
      { x1: 358, y1: 540, x2: 268, y2: 620 }, // right lower

      // ── Drain side walls ─────────────────────────────────────────────
      { x1:  92, y1: 620, x2:  92, y2: 660 }, // left drain wall
      { x1: 268, y1: 620, x2: 268, y2: 660 }, // right drain wall
    ];
  }

  // ─── Slingshots (higher restitution angled kickers) ────────────────────
  _buildSlingshots() {
    return [
      { x1: 46, y1: 472, x2:  92, y2: 540, restitution: 1.5, score: 10, hitFlash: 0 },
      { x1: 308, y1: 472, x2: 268, y2: 540, restitution: 1.5, score: 10, hitFlash: 0 },
    ];
  }

  // ─── Bumpers (pop bumpers – circles) ───────────────────────────────────
  _buildBumpers() {
    return [
      { x: 118, y: 188, r: 18, score: 100, label: 'A', litTimer: 0 },
      { x: 212, y: 178, r: 18, score: 100, label: 'B', litTimer: 0 },
      { x: 165, y: 252, r: 18, score: 100, label: 'C', litTimer: 0 },
    ];
  }

  // ─── Drop targets (5 in a curve) ───────────────────────────────────────
  _buildTargets() {
    // positions mirrored around x=182 for a gentle arc
    const pts = [
      { x:  60, y: 388 },
      { x: 110, y: 370 },
      { x: 182, y: 360 },
      { x: 254, y: 370 },
      { x: 304, y: 388 },
    ];
    return pts.map((p, i) => ({
      x: p.x, y: p.y,
      w: 28, h: 9,
      label: String(i + 1),
      lit: false,
      score: 200,
      hitFlash: 0,
    }));
  }

  // ─── Lane rollovers (2 circles near the top) ───────────────────────────
  _buildLanes() {
    return [
      { x:  58, y: 72, r: 14, lit: false, label: 'L' },
      { x: 295, y: 72, r: 14, lit: false, label: 'R' },
    ];
  }

  // ─── Flipper descriptors ────────────────────────────────────────────────
  _buildFlipper(side) {
    const isLeft = side === 'left';
    return {
      side,
      px:          isLeft ?  90 : 270,  // pivot x
      py:          623,                  // pivot y
      length:      64,
      restAngle:   isLeft ?  28 : 152,  // degrees – resting (pointing down)
      activeAngle: isLeft ? -28 : 208,  // degrees – active  (pointing up)
      angle:       isLeft ?  28 : 152,  // current angle
      angularVel:  0,                    // deg / s
      active:      false,
      thickness:   5,                    // half-thickness for rendering
    };
  }

  // ─── Plunger descriptor ─────────────────────────────────────────────────
  _buildPlunger() {
    return {
      // Ball spawns inside the main field on the right side.
      // The spring is drawn below this point as a visual cue.
      x:          315,   // launch x (inside right side of field)
      y:          558,   // launch y
      charge:      0,    // 0–1
      charging:    false,
      maxLaunch:  1250,  // px / s at full charge
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Returns the tip (non-pivot end) of a flipper in world-space. */
  flipperTip(flipper) {
    const r = flipper.angle * (Math.PI / 180);
    return {
      x: flipper.px + Math.cos(r) * flipper.length,
      y: flipper.py + Math.sin(r) * flipper.length,
    };
  }

  /** Resets targets / lanes for a new game or new ball. */
  resetTargets() {
    for (const t of this.targets) { t.lit = false; t.hitFlash = 0; }
    for (const l of this.lanes)   { l.lit = false; }
    for (const b of this.bumpers) { b.litTimer = 0; }
  }
}
