import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0b0c',
        accent: '#ff2d6f',
        accenttext: '#b3084a',
        muted: '#a1a1aa',
        hair: '#e4e4e7',
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        vshimmer: { '0%': { backgroundPosition: '-320px 0' }, '100%': { backgroundPosition: '320px 0' } },
        vspin: { to: { transform: 'rotate(360deg)' } },
        vpulse: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.35' } },
        vrise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        vshimmer: 'vshimmer 1.2s linear infinite',
        vspin: 'vspin .7s linear infinite',
        vpulse: 'vpulse 1.8s ease-in-out infinite',
        vrise: 'vrise .35s ease both',
      },
    },
  },
  plugins: [],
};

export default config;
