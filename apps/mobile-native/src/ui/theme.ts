// @ts-nocheck
/**
 * theme.ts — Notion-style light + dark palettes behind a system-driven hook.
 *
 * Notion mobile defaults to a warm, near-monochrome look: off-white surfaces, a
 * warm near-black text (#37352F), warm grays, hairline dividers, and a sparing
 * blue accent. Dark mode is Notion's #191919 family. `useThemeColors()` follows
 * the OS appearance (Light / Dark / System) via React Native's useColorScheme.
 *
 * Colors are READ THROUGH THE HOOK (not a static export) so a system appearance
 * change re-themes the whole app live — every component calls useThemeColors().
 */
import { Dimensions, Platform, StatusBar as RNStatusBar, useColorScheme } from 'react-native';

export const light = {
  mode: 'light',
  bg: '#ffffff',
  sidebar: '#f7f6f3', // Notion's warm off-white sidebar
  surface: '#ffffff',
  surfaceAlt: '#f7f6f3',
  hover: '#efefed',
  pressed: '#e8e8e6',
  text: '#37352f', // Notion warm near-black
  textHi: '#37352f',
  muted: '#787774',
  faint: '#9b9a97',
  border: '#e9e9e7',
  divider: '#ededeb',
  accent: '#2383e2',
  accentSoft: '#eaf3fb',
  onAccent: '#ffffff',
  danger: '#eb5757',
  green: '#0f7b6c',
  overlay: 'rgba(15,15,15,0.35)',
  codeBg: '#f4f3f0',
  codeText: '#c2543a',
  shadow: '#000000',
};

export const dark = {
  mode: 'dark',
  bg: '#191919',
  sidebar: '#202020',
  surface: '#191919',
  surfaceAlt: '#202020',
  hover: '#2c2c2c',
  pressed: '#333333',
  text: '#d4d4d4',
  textHi: '#ffffff',
  muted: '#979797',
  faint: '#6f6f6f',
  border: '#2f2f2f',
  divider: '#2a2a2a',
  accent: '#2383e2',
  accentSoft: '#1c3a52',
  onAccent: '#ffffff',
  danger: '#ff7369',
  green: '#4dab9a',
  overlay: 'rgba(0,0,0,0.5)',
  codeBg: '#2c2c2c',
  codeText: '#e6b673',
  shadow: '#000000',
};

export function useThemeColors() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

// Top safe-area inset without the native safe-area-context dep: status-bar height
// on Android; a notch/Dynamic-Island estimate by screen height on iOS.
const SCREEN_H = Dimensions.get('window').height;
export const TOP_INSET =
  Platform.OS === 'android'
    ? RNStatusBar.currentHeight || 24
    : SCREEN_H >= 850
      ? 59
      : SCREEN_H >= 812
        ? 47
        : 20;

export const radius = { sm: 6, md: 8, lg: 12, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// Notion mobile body/UI is the system sans (SF Pro on iOS). Mono only for code.
export const FONT = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
export const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Default page-icon colors Notion offers for "Add icon" (monochrome-friendly accents).
export const ICON_COLORS = ['#787774', '#eb5757', '#e09b3b', '#0f7b6c', '#2383e2', '#9a6dd7', '#c14c8a'];
// Notion's default cover color bands.
export const COVER_COLORS = ['#e3e2df', '#f3d9c0', '#d8e3d2', '#d2e0ec', '#e6d8ec', '#f0d8df', '#2f3437'];
