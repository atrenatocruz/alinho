import { defineConfig } from '@vite-pwa/assets-generator/config'

// apple-touch-icon.png and maskable-icon-512x512.png are NOT used directly
// from this generator's output — both need special handling:
//
// - apple-touch-icon.png: iOS re-applies its own squircle mask to this
//   file, and feeding it icon-mark.svg's own baked-in rounded corners +
//   transparent corner pixels makes iOS re-composite the icon oddly
//   (scales the artwork to fill its mask, cropping the ring near the
//   edges).
// - maskable-icon-512x512.png: the generator's `maskable` preset shrinks
//   the WHOLE composed icon (background included) into a safe zone and
//   leaves transparent padding around it — against the maskable icon
//   spec, which requires an opaque, full-bleed background with only the
//   foreground content inset. A browser that reads this file without
//   understanding `purpose: maskable` (observed happening on iOS Safari)
//   renders that transparent margin as a visible fade at the edges.
//
// Both are instead rendered full-bleed and fully opaque from
// src/logo/icon-mark-square.svg, e.g.:
//   node -e "require('sharp')('src/logo/icon-mark-square.svg').resize(180,180).flatten({background:'#C5DD01'}).png().toFile('public/apple-touch-icon.png')"
//   node -e "require('sharp')('src/logo/icon-mark-square.svg').resize(512,512).flatten({background:'#C5DD01'}).png().toFile('public/maskable-icon-512x512.png')"
export default defineConfig({
  images: ['src/logo/icon-mark.svg'],
  preset: {
    transparent: {
      sizes: [192, 512],
      favicons: [[48, 'favicon.ico']],
    },
    // Generated but not used directly (see note above) — the generator's
    // internal instructions resolver errors if the `maskable`/`apple`
    // preset keys are missing entirely, so these stay populated as
    // harmless no-ops; their output files are discarded after each run.
    maskable: {
      sizes: [512],
    },
    apple: {
      sizes: [180],
      padding: 0,
    },
  },
})
