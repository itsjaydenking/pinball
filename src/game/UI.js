/**
 * UI.js – HUD and overlay rendering.
 *
 * Draws directly onto the game canvas:
 *   • Score, multiplier, balls remaining, combo indicator
 *   • Ball-save flash
 *   • State overlays: READY, BALL_LOST, PAUSED, GAME_OVER
 *   • Mobile touch-zone hints (subtle)
 *
 * All coordinates are in the logical 400×700 canvas space.
 */

import { TABLE_W, TABLE_H } from './Table.js';

const FONT_MONO = '"Courier New", monospace';

export class UI {
  // ─── Main draw entry ──────────────────────────────────────────────────────

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{
   *   state: string, score: number, multiplier: number,
   *   balls: number, combo: number, comboTimer: number,
   *   ballSaveTimer: number, plungerCharge: number,
   *   totalBalls: number
   * }} gs  game-state snapshot
   */
  draw(ctx, gs) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    this._drawHUD(ctx, gs);

    if (gs.ballSaveTimer > 0) this._drawBallSave(ctx, gs.ballSaveTimer);

    switch (gs.state) {
      case 'READY':     this._drawReady(ctx, gs);    break;
      case 'BALL_LOST': this._drawBallLost(ctx);     break;
      case 'GAME_OVER': this._drawGameOver(ctx, gs); break;
      case 'PAUSED':    this._drawPaused(ctx);       break;
      default: break;
    }

    this._drawTouchHints(ctx, gs.state);

    ctx.restore();
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────

  _drawHUD(ctx, gs) {
    // Score (top-left)
    ctx.font      = `bold 18px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    this._glowText(ctx, `${gs.score}`, 35, 47, '#00ffff', 8);

    // Multiplier badge
    if (gs.multiplier > 1) {
      ctx.font = `bold 13px ${FONT_MONO}`;
      this._glowText(ctx, `×${gs.multiplier} MULTI`, 35, 63, '#ff9900', 6);
    }

    // Balls remaining (top-right)
    ctx.font      = `bold 13px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    const filled  = '●'.repeat(gs.balls);
    const empty   = '○'.repeat(gs.totalBalls - gs.balls);
    this._glowText(ctx, filled + empty, TABLE_W - 38, 47, '#aaddff', 5);

    // Combo (top-centre, only when active)
    if (gs.combo > 1) {
      ctx.font      = `bold 15px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      const pulse   = 0.75 + 0.25 * Math.sin(Date.now() / 120);
      this._glowText(ctx, `COMBO ×${gs.combo}`, TABLE_W / 2, 63, `rgba(255,0,255,${pulse})`, 10);
    }

    ctx.textAlign = 'left';
  }

  // ─── Ball save flash ──────────────────────────────────────────────────────

  _drawBallSave(ctx, timer) {
    const alpha = Math.min(1, timer / 0.4);
    ctx.font      = `bold 12px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    this._glowText(ctx, '✦ BALL SAVE ✦', TABLE_W / 2, 82, `rgba(0,255,100,${alpha})`, 10);
    ctx.textAlign = 'left';
  }

  // ─── State overlays ───────────────────────────────────────────────────────

  _drawReady(ctx, gs) {
    this._dimOverlay(ctx, TABLE_H / 2 - 95, 190, 0.55);

    ctx.font      = `bold 26px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    this._glowText(ctx, '🚀 SPACE PINBALL', TABLE_W / 2, TABLE_H / 2 - 50, '#00ffff', 14);

    ctx.font = `bold 12px ${FONT_MONO}`;
    this._glowText(ctx, 'Hold SPACE / tap centre', TABLE_W / 2, TABLE_H / 2 - 12, '#ffffff', 5);
    this._glowText(ctx, 'to charge and launch',    TABLE_W / 2, TABLE_H / 2 + 7,  '#ffffff', 5);
    this._glowText(ctx, 'A/D  or  ←/→  for flippers', TABLE_W / 2, TABLE_H / 2 + 30, '#aaaaff', 4);
    this._glowText(ctx, 'P = pause   Shift = nudge',   TABLE_W / 2, TABLE_H / 2 + 48, '#aaaaff', 4);

    // Live charge bar just above plunger ball
    if (gs.plungerCharge > 0.02) {
      this._drawChargeBar(ctx, gs.plungerCharge);
    }

    ctx.textAlign = 'left';
  }

  _drawBallLost(ctx) {
    this._dimOverlay(ctx, TABLE_H / 2 - 60, 120, 0.55);

    ctx.font      = `bold 22px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    this._glowText(ctx, 'BALL LOST', TABLE_W / 2, TABLE_H / 2 - 5,  '#ff4444', 14);

    ctx.font = `bold 12px ${FONT_MONO}`;
    this._glowText(ctx, 'Hold SPACE to charge',  TABLE_W / 2, TABLE_H / 2 + 22, '#ffffff', 5);
    this._glowText(ctx, 'then release to launch', TABLE_W / 2, TABLE_H / 2 + 39, '#ffffff', 5);

    ctx.textAlign = 'left';
  }

  _drawGameOver(ctx, gs) {
    // Full-screen dim
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, TABLE_W, TABLE_H);

    ctx.font      = `bold 32px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    this._glowText(ctx, 'GAME OVER', TABLE_W / 2, TABLE_H / 2 - 75, '#ff4400', 18);

    ctx.font = `bold 17px ${FONT_MONO}`;
    this._glowText(ctx, `SCORE: ${gs.score}`, TABLE_W / 2, TABLE_H / 2 - 38, '#ffffff', 8);

    // Restart button
    const bx = TABLE_W / 2 - 88;
    const by = TABLE_H / 2 - 5;
    const bw = 176;
    const bh = 44;

    ctx.fillStyle   = 'rgba(0,255,180,0.12)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#00ffc8';
    ctx.shadowColor = '#00ffc8';
    ctx.shadowBlur  = 10;
    ctx.lineWidth   = 2;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.font      = `bold 15px ${FONT_MONO}`;
    ctx.fillStyle = '#00ffc8';
    ctx.shadowBlur = 0;
    ctx.fillText('PLAY AGAIN', TABLE_W / 2, by + 28);

    ctx.textAlign = 'left';
  }

  _drawPaused(ctx) {
    this._dimOverlay(ctx, TABLE_H / 2 - 55, 110, 0.6);

    ctx.font      = `bold 28px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    this._glowText(ctx, 'PAUSED', TABLE_W / 2, TABLE_H / 2 - 5, '#ffff00', 14);

    ctx.font = `bold 12px ${FONT_MONO}`;
    this._glowText(ctx, 'Press P to resume', TABLE_W / 2, TABLE_H / 2 + 26, '#ffffff', 5);

    ctx.textAlign = 'left';
  }

  // ─── Mobile touch-zone hints ──────────────────────────────────────────────

  _drawTouchHints(ctx, state) {
    if (state !== 'PLAYING' && state !== 'READY' && state !== 'BALL_LOST') return;

    ctx.globalAlpha = 0.18;

    // Left flipper zone (bottom-left)
    ctx.fillStyle = '#0088ff';
    ctx.beginPath();
    ctx.arc(40, TABLE_H - 28, 22, 0, Math.PI * 2);
    ctx.fill();

    // Right flipper zone (bottom-right)
    ctx.fillStyle = '#ff6600';
    ctx.beginPath();
    ctx.arc(TABLE_W - 40, TABLE_H - 28, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  // ─── Charge bar ───────────────────────────────────────────────────────────

  _drawChargeBar(ctx, charge) {
    // Drawn to the right of the ball spawn position (x=315)
    const x  = 330;
    const yB = 590;
    const h  = charge * 55;
    const hue = 120 - charge * 120; // green→red
    ctx.fillStyle = `hsl(${hue}, 100%, 55%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur  = 6;
    ctx.fillRect(x, yB - h, 7, h);
    ctx.shadowBlur  = 0;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _glowText(ctx, text, x, y, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur  = blur;
    ctx.fillStyle   = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur  = 0;
  }

  _dimOverlay(ctx, y, h, alpha) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, y, TABLE_W, h);
  }

  // ─── Geometry helper used by Game.js ─────────────────────────────────────

  /** Returns true if (x,y) is inside the GAME OVER restart button. */
  isRestartHit(x, y) {
    const bx = TABLE_W / 2 - 88;
    const by = TABLE_H / 2 - 5;
    return x >= bx && x <= bx + 176 && y >= by && y <= by + 44;
  }
}
