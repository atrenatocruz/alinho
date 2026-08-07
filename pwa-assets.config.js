import { defineConfig } from '@vite-pwa/assets-generator/config'

// apple-touch-icon.png is NOT generated from here — iOS re-applies its own
// squircle mask to that file, and feeding it icon-mark.svg's own baked-in
// rounded corners + transparent corner pixels makes iOS re-composite the
// icon oddly (scales the artwork to fill its mask, cropping the ring near
// the edges). It's rendered separately, full-bleed (no radius, no
// transparency), from src/logo/icon-mark-square.svg — e.g. via:
//   node -e "require('sharp')('src/logo/icon-mark-square.svg').resize(180,180).flatten({background:'#C5DD01'}).png().toFile('public/apple-touch-icon.png')"
export default defineConfig({
  images: ['src/logo/icon-mark.svg'],
  preset: {
    transparent: {
      sizes: [192, 512],
      favicons: [[48, 'favicon.ico']],
    },
    maskable: {
      sizes: [512],
    },
  },
})
