import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a2540',
          900: '#0f3060',
          800: '#1a3d66',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          fg: '#e8f3ff',
          muted: '#5eb0ff',
        },
      },
      boxShadow: {
        bar: '0 1px 0 rgba(15,23,42,0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
