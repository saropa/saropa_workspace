// Where a pop-up menu goes: below its button when it fits, above it when there is more room
// there, and never taller than the room it has (the menu then scrolls inside). All numbers are
// viewport pixels except the returned top and left, which are page coordinates. The function
// stands alone (no outside names) because the page script is built from its source text.
export interface MenuPlace {
  top: number;
  left: number;
  maxHeight: number;
}

export function placeMenu(btn: { top: number; bottom: number; right: number }, w: number, h: number, vw: number, vh: number, sx: number, sy: number): MenuPlace {
  const below = vh - btn.bottom - 6;
  const above = btn.top - 6;
  const flip = h > below && above > below;
  const maxHeight = Math.max(0, Math.min(h, flip ? above : below));
  const top = flip ? btn.top - 2 - maxHeight : btn.bottom + 2;
  return { top: top + sy, left: Math.max(4, Math.min(btn.right - w, vw - w - 4)) + sx, maxHeight };
}

// The page script's copy of the function.
export const PLACE_SCRIPT = `const placeMenu=${placeMenu.toString()};`;
