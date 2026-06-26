# Shortcut icons and colors

Give a shortcut a custom tree icon and color so a large or grouped shortcut set
is fast to scan. Set it from a shortcut's context menu with **Set Icon & Color…**.

## What you can set

- **Icon** — chosen from a curated set of VS Code product icons (codicons),
  grouped into scannable categories, or the default file-type glyph. Type to
  filter: the picker matches the icon name **and** a synonym list shown beside
  each icon, so an alternate word finds it even when you don't know the exact
  name — "settings" or "cog" surfaces the gear, "octocat" surfaces GitHub,
  "deploy" surfaces the rocket. One word can match several icons.
- **Color** — a theme-aware color applied to the icon. The available choices are
  red, orange, yellow, green, blue, purple, and neutral.

Both are theme-aware: the icon is a codicon id and the color is a `ThemeColor`
key (never a raw hex), so they render correctly in light, dark, and
high-contrast themes. Choosing the default for either reverts that aspect.

## How it renders

The custom glyph replaces the default shortcut/star glyph for the shortcut's
**resting** state. Transient state icons still take precedence, because they
convey something actionable that should not be hidden by decoration:

1. **Running** — a spinner while a background run is in progress.
2. **Missing target** — a warning glyph when the shortcut file no longer exists.
3. **Last run** — a green check (success) or red error (failure) after a
   background run completes.
4. **Custom icon/color** — your chosen glyph and tint, when none of the above
   apply.
5. **Default** — the auto-shortcut star or the standard shortcut glyph.

## Notes

- Custom icon and color persist on the shortcut (a versioned schema field), so
  they survive reloads and travel with the shortcut (project shortcuts via the
  repository file, global shortcuts via Settings Sync).
- **Auto-shortcuts cannot take a custom icon** — they are recomputed each refresh
  rather than stored, so there is nothing to persist the choice on. Add the file
  as a shortcut explicitly first if you want to customize it.
