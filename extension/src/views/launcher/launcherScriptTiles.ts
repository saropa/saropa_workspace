// Fragment of the Saropa Workspace panel webview client script; concatenated by
// launcherScript.ts into ONE <script>, so it shares the global scope launcherScriptCore.ts
// sets up (`vscode`, `store`, `cssVar`, `tintHexes`). Runs right after the split fragment
// because its boot statement must apply the saved mode before the first card is painted.
//
// Tile view is a restyle, not a second renderer: the cards keep the same DOM, listeners and
// menus (built by makeCard), and a class on <body> lays them out as colored squares
// (launcherAssetsTiles.ts). That way no action can exist in one view and be missing in the other.
// The three tile sizes work the same way: one more body class, no rebuild.

/** Client script for the launcher's tile view: saved mode and size, and each tile's color. */
export const LAUNCHER_SCRIPT_TILES = `
// Colors handed to an item that has none of its own: the extension's tint tokens. The chart
// tokens are avoided because on this board they read as status (blue is an unseen watch, red
// an error, green and yellow a pass or a warning).
var TILE_PALETTE = ['teal', 'violet', 'purple', 'magenta', 'pink', 'brown'].map(function (name) {
  return 'saropaWorkspace.tint.' + name;
});

function isTileView() { return store.tiles === true; }

// Smallest first: icon only, then icon and name, then icon, name and subtitle. The order is
// also the cycle order of the title-bar size action.
var TILE_SIZES = ['small', 'medium', 'large'];

// Saved state can be stale or hand-edited, so anything unknown (and no value at all) is the
// large tile, which is the layout tile view had before sizes existed.
function tileSize() { return TILE_SIZES.indexOf(store.tileSize) >= 0 ? store.tileSize : 'large'; }

// Puts the saved mode and size on the page. Class toggles only, so no card is rebuilt and an
// open drawer or a keyboard focus survives the switch. A size class may stay on in rows
// mode: every rule that reads one also requires the tiles class.
function applyTileView() {
  document.body.classList.toggle('tiles', isTileView());
  var size = tileSize();
  TILE_SIZES.forEach(function (name) { document.body.classList.toggle('tiles-' + name, name === size); });
}

// Steps to the next size, wrapping after large. Kept apart from store.tiles so the size
// survives a trip through rows mode.
function cycleTileSize() {
  // The action is hidden in rows mode; ignored there so a late click cannot change the size
  // with nothing on screen to show it.
  if (!isTileView()) { return; }
  store.tileSize = TILE_SIZES[(TILE_SIZES.indexOf(tileSize()) + 1) % TILE_SIZES.length];
  vscode.setState(store);
  applyTileView();
}

// The host cannot read the webview's saved state, so it is told which title-bar icon to show.
function reportTileView() { vscode.postMessage({ type: 'tileViewState', enabled: isTileView() }); }

function toggleTileView() {
  store.tiles = !isTileView();
  vscode.setState(store);
  applyTileView();
  reportTileView();
}

// An item keeps its own color. The two neutral foreground ids are "no color" here (they would
// draw a gray square), so those items get a palette color hashed from the id, which stays the
// same across repaints, reloads, sorting and filtering.
function tileTint(it) {
  if (it.color && it.color !== 'foreground' && it.color !== 'charts.foreground') {
    return cssVar(it.color, tintHexes[it.color]);
  }
  var key = String(it.id);
  var hash = 0;
  for (var i = 0; i < key.length; i++) { hash = (hash * 31 + key.charCodeAt(i)) >>> 0; }
  var pick = TILE_PALETTE[hash % TILE_PALETTE.length];
  // The host's hex keeps the color if the webview does not expose a contributed variable.
  return cssVar(pick, tintHexes[pick]);
}

applyTileView();
// Reported in both modes: the context key outlives the page, so a rebuilt webview in rows
// mode would otherwise leave the icon from an earlier tiles session.
reportTileView();
`;
