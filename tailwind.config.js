/** @type {import('tailwindcss').Config} */

// ─── Design tokens live in src/index.css (:root) ────────────────────────────
// This config maps Tailwind utilities onto those CSS variables, so the whole
// theme can be tweaked in ONE place: the token block at the top of index.css.

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Headings — Outfit, weights bold/semibold/medium per level (see src/index.css base layer)
        display: ['Alinho Ordinais', 'Outfit', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        // Body/UI text — Geist Sans, replacing Manrope
        sans: ['Alinho Ordinais', 'Geist Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        // Small uppercase labels (badges, section eyebrows) — Geist Mono, tracked-wide at call sites
        mono: ['Alinho Ordinais', 'Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Ink — near-black + neutral grays (primary family, was: court)
        ink: {
          50: 'rgb(var(--ink-50) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
        },
        // Lime (single sharp accent — the ball, was: volt)
        lime: {
          100: 'rgb(var(--lime-100) / <alpha-value>)',
          400: 'rgb(var(--lime-400) / <alpha-value>)',
          600: 'rgb(var(--lime-600) / <alpha-value>)',
        },
        canvas: 'rgb(var(--canvas) / <alpha-value>)',    // pure-white app background (was: sand)
        surface: 'rgb(var(--surface) / <alpha-value>)',  // light-gray cards (was: white cards)
        line: 'rgb(var(--line) / <alpha-value>)',        // hairline borders
        muted: 'rgb(var(--muted) / <alpha-value>)',      // secondary text
        ok: 'rgb(var(--ok) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',  // new, not yet consumed by any component
      },
      borderRadius: {
        card: 'var(--radius-card)',   // 16px — cards
        ctrl: 'var(--radius-ctrl)',   // 12px — buttons, inputs, chips
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
      },
    },
  },
  plugins: [],
}
