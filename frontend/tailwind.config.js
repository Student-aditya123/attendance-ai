/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  // Use class strategy (not media-query) so we can toggle dark mode programmatically
  darkMode: 'class',

  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        space: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'Fira Code', 'monospace'],
      },

      colors: {
        // Design system palette
        bg:      '#07090f',
        surface: '#0f1520',
        raised:  '#141e2e',
        rim:     '#1c2840',
        'rim-bri': '#253656',

        // Brand colours
        blue:   '#3d7fff',
        green:  '#00c48c',
        red:    '#ff4d6d',
        amber:  '#ffb020',
        purple: '#9d6fff',
        cyan:   '#00d4ff',

        // Text
        ink: '#c8d6f0',
        dim: '#5a7098',
        dmr: '#2d3f58',
      },

      borderRadius: {
        card: '12px',
        tile: '10px',
      },

      animation: {
        'fade-up':   'fadeUp 0.32s ease both',
        'fade-in':   'fadeIn 0.22s ease both',
        'slide-in':  'slideIn 0.28s ease both',
        'spin-fast': 'spin 0.7s linear infinite',
        'blink':     'blink 1.8s ease infinite',
        'scan':      'scanLine 2.2s linear infinite',
        'pulse-ring':'pulseRing 1.5s ease infinite',
      },

      keyframes: {
        fadeUp:    { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideIn:   { from: { opacity: '0', transform: 'translateX(-6px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        blink:     { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.25' } },
        scanLine:  { '0%': { top: '-2px' }, '100%': { top: '100%' } },
        pulseRing: { '0%, 100%': { transform: 'scale(1)', opacity: '0.6' }, '50%': { transform: 'scale(1.15)', opacity: '0.1' } },
      },

      boxShadow: {
        'blue-glow':  '0 0 16px rgba(61,127,255,0.30)',
        'green-glow': '0 0 16px rgba(0,196,140,0.25)',
        'red-glow':   '0 0 16px rgba(255,77,109,0.25)',
      },
    },
  },

  plugins: [],
};
