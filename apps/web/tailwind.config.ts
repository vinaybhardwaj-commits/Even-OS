import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Even Healthcare brand palette
        'even-navy': '#002054',
        'even-blue': '#0055FF',
        'even-light': '#E8F0FE',
        'even-green': '#059669',
        'even-amber': '#D97706',
        'even-red': '#DC2626',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
