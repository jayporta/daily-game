// How the finished game is presented in its frame, which the model has no
// other way to know.

/**
 * How the finished game is presented, which the model has no other way to
 * know. Without it a game is free to draw itself at a fixed size on its own
 * background, and the rest of the frame is left blank around it.
 *
 * Deliberately NOT in `config/guardrails.md`. That file is injected verbatim
 * into the moderation prompt too, and the moderator fails closed — a layout
 * rule there would have it rejecting games over how they look rather than
 * what they contain.
 *
 * Names no size. A model handed a number copies it, and a fixed canvas is
 * the exact failure this exists to prevent.
 */
export const DISPLAY_CONTRACT = `Your document is loaded on its own into a frame that fills the middle of the
page. Nothing outside your document paints any part of that frame, so
whatever you leave unfilled shows as blank space around your game.

- Fill the frame. Give \`html\` and \`body\` no margin and the full width and
  height available, and paint your own background across all of it.
- Size to the frame at runtime, never to a constant. If you draw on a
  canvas, set its width and height from its measured container rather than
  with fixed attributes, and redraw when the frame is resized.
- Assume nothing about its shape. It is as wide and as tall as the visitor's
  window makes it, in any proportion, on a phone or on a desktop.
- Keep the whole playfield inside it. Never require the player to scroll.`;
