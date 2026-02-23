/**
 * Input.js – Handles keyboard and touch input.
 *
 * Keyboard controls:
 *   A / ArrowLeft  → left flipper
 *   D / ArrowRight → right flipper
 *   Space          → plunger (hold to charge, release to launch)
 *   P              → pause toggle
 *   Shift          → nudge / tilt
 *
 * Touch controls (mapped against canvas bounding rect):
 *   Bottom-left  30 % → left flipper
 *   Bottom-right 30 % → right flipper
 *   Centre / top      → plunger
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // Current state flags
    this.leftFlipper  = false;
    this.rightFlipper = false;
    this.plungerHeld  = false;

    // One-shot events consumed by Game.js
    this._plungerReleased = false;
    this._pausePressed    = false;
    this._nudge           = { x: 0, y: 0 };
    this.tiltCount        = 0;

    this._heldKeys = new Set();
    this._activeTouchZones = new Map(); // touchId → zone

    this._bindKeyboard();
    this._bindTouch();
  }

  // ─── Public event consumers ───────────────────────────────────────────────

  /** Returns true (and resets) if the plunger was just released. */
  consumePlungerRelease() {
    const v = this._plungerReleased;
    this._plungerReleased = false;
    return v;
  }

  /** Returns true (and resets) if pause was toggled. */
  consumePausePress() {
    const v = this._pausePressed;
    this._pausePressed = false;
    return v;
  }

  /** Returns pending nudge impulse and resets it. */
  consumeNudge() {
    const v = this._nudge;
    this._nudge = { x: 0, y: 0 };
    return v;
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this._heldKeys.has(e.code)) return; // ignore auto-repeat
      this._heldKeys.add(e.code);

      switch (e.code) {
        case 'KeyA':
        case 'ArrowLeft':
          this.leftFlipper = true;
          e.preventDefault();
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.rightFlipper = true;
          e.preventDefault();
          break;
        case 'Space':
          this.plungerHeld = true;
          e.preventDefault();
          break;
        case 'KeyP':
          this._pausePressed = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this._nudge = {
            x: (Math.random() - 0.5) * 90,
            y: -35,
          };
          this.tiltCount++;
          e.preventDefault();
          break;
        default:
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this._heldKeys.delete(e.code);

      switch (e.code) {
        case 'KeyA':
        case 'ArrowLeft':
          this.leftFlipper = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.rightFlipper = false;
          break;
        case 'Space':
          if (this.plungerHeld) {
            this.plungerHeld      = false;
            this._plungerReleased = true;
          }
          break;
        default:
          break;
      }
    });
  }

  // ─── Touch ────────────────────────────────────────────────────────────────

  _bindTouch() {
    const opts = { passive: false };

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        const zone = this._zoneFor(touch);
        this._activeTouchZones.set(touch.identifier, zone);
        this._setZone(zone, true);
      }
    }, opts);

    const endHandler = (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        const zone = this._activeTouchZones.get(touch.identifier);
        if (zone !== undefined) {
          this._activeTouchZones.delete(touch.identifier);
          // Only deactivate zone if no other touch is still using it
          const stillUsed = [...this._activeTouchZones.values()].includes(zone);
          if (!stillUsed) this._setZone(zone, false);
        }
      }
    };

    this.canvas.addEventListener('touchend',    endHandler, opts);
    this.canvas.addEventListener('touchcancel', endHandler, opts);
  }

  /**
   * Map a touch to a named zone based on canvas-relative position.
   * @returns {'left'|'right'|'plunger'}
   */
  _zoneFor(touch) {
    const rect = this.canvas.getBoundingClientRect();
    const xRel = (touch.clientX - rect.left) / rect.width;
    const yRel = (touch.clientY - rect.top)  / rect.height;

    if (yRel >= 0.65) {
      if (xRel < 0.38) return 'left';
      if (xRel > 0.62) return 'right';
    }
    return 'plunger';
  }

  _setZone(zone, active) {
    switch (zone) {
      case 'left':
        this.leftFlipper = active;
        break;
      case 'right':
        this.rightFlipper = active;
        break;
      case 'plunger':
        if (active) {
          this.plungerHeld = true;
        } else if (this.plungerHeld) {
          this.plungerHeld      = false;
          this._plungerReleased = true;
        }
        break;
      default:
        break;
    }
  }
}
