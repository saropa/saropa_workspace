// Where a pop-up menu goes: below its button when it fits, above it when there is more room
// there, and never taller than the room it has (the menu then scrolls inside); a menu that
// fits the window but neither side of its button slides up over the button. All numbers are
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
  // Taller than both sides but not than the window: slide up over the button so every item shows.
  const slide = h > below && h > above && h <= vh - 8;
  const flip = !slide && h > below && above > below;
  const maxHeight = Math.max(0, slide ? h : Math.min(h, flip ? above : below));
  const top = slide ? vh - h - 4 : flip ? btn.top - 2 - maxHeight : btn.bottom + 2;
  return { top: top + sy, left: Math.max(4, Math.min(btn.right - w, vw - w - 4)) + sx, maxHeight };
}

// The page script's copy of the function.
export const PLACE_SCRIPT = `const placeMenu=${placeMenu.toString()};`;
