import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  important: '.helios-ui',
  content: [
    './app/trello/**/*.{ts,tsx}',
    './components/trello/**/*.{ts,tsx}',
    './components/hub-home/**/*.{ts,tsx}',
    './components/hub-shell/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#FFFFFF',
          '0': '#FFFFFF',
          '1': '#FAFAFA',
          '2': '#F5F5F5',
          '3': '#EFEFEF',
          '4': '#E5E5E5',
          hairline: '#E5E5E5',
          scrim: 'rgba(23, 23, 23, 0.55)',
        },
        ink: {
          hi: '#171717',
          mid: '#525252',
          low: '#737373',
          mute: '#A3A3A3',
          faint: '#D4D4D4',
        },
        helios: {
          '50': '#FFF3EB',
          '100': '#FFDCC2',
          '200': '#FFB98A',
          '300': '#FF945C',
          '400': '#FF7A38',
          '500': '#FF5E1A',
          '600': '#E84B0C',
          '700': '#C13B06',
          '800': '#8F2A02',
          '900': '#5F1B01',
        },
        sunset: {
          gold: '#FFB347',
          orange: '#FF5E1A',
          red: '#E03C1A',
        },
        heliosGreen: {
          '50': '#E7FBE6',
          '100': '#BEF3BB',
          '200': '#8FE68A',
          '300': '#5CD556',
          '400': '#33CF2D',
          '500': '#1FA61A',
          '600': '#138510',
          '700': '#0C650B',
          '800': '#074307',
          '900': '#032803',
        },
        danger: '#E23A3A',
        warning: '#F0A64A',
      },
      borderRadius: {
        card: '16px',
        list: '22px',
        modal: '28px',
        pill: '999px',
        chip: '10px',
      },
      spacing: {
        board: '40px',
        list: '28px',
        card: '22px',
        rail: '18px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        'card-lift': '0 12px 40px -12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.04)',
        modal: '0 24px 60px -20px rgba(0,0,0,0.20), 0 8px 24px -8px rgba(0,0,0,0.10)',
        'cta-glow': '0 0 40px -10px #FF5E1A',
      },
      backgroundImage: {
        'sunset-linear':
          'linear-gradient(135deg, #FFB347 0%, #FF5E1A 55%, #E03C1A 100%)',
        'sunset-radial':
          'radial-gradient(120% 120% at 50% 100%, #FFB347 0%, #FF5E1A 45%, #E03C1A 100%)',
        'sunset-ambient':
          'radial-gradient(60% 45% at 50% 92%, rgba(255, 140, 60, 0.28) 0%, rgba(255, 94, 26, 0.12) 40%, transparent 72%), radial-gradient(50% 40% at 12% 8%, rgba(255, 180, 90, 0.14) 0%, transparent 65%), radial-gradient(45% 38% at 88% 6%, rgba(255, 130, 60, 0.10) 0%, transparent 65%)',
      },
      fontFamily: {
        display: ['var(--font-pragmatica)', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        body: ['var(--font-roboto)', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      fontSize: {
        'card-title': ['15px', { lineHeight: '1.5', letterSpacing: '-0.005em' }],
        'list-header': ['13px', { lineHeight: '1.3', letterSpacing: '0.02em' }],
        'modal-title': ['26px', { lineHeight: '1.25', letterSpacing: '-0.015em' }],
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
        smooth: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        sweep: {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        sweep: 'sweep 420ms cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
