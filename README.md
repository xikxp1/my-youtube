# My YouTube

A small, dependency-free Chrome extension that add minimal extra goodies

## Features

- Independently configurable played/buffered progress bar and current/total
  time, shown while native video controls are hidden.
- A custom default playback speed from 0.05× to 4× in 0.05 increments.
- A preferred video quality with closest-lower fallback.
- Optional auto-liking after the playhead passes 50%, without overriding an
  existing like or dislike and without repeating within the browser session.

## Building

```sh
npm run build          # Chrome + Firefox
npm run build:firefox  # Firefox only
```

The packages are written to `dist/<browser>/`, and the zips go to
`dist/my-youtube-<browser>-<version>.zip`. The Firefox build replaces the
background service worker with `background.scripts` and adds
`browser_specific_settings.gecko` (Firefox 128 or later).
