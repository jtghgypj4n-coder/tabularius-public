// The starter looks of the Themes page's "Restyle every layout" form: the same palettes as STARTER_TOKENS in
// packages/store/src/token-theme.ts (a server test keeps the two equal), kept here because the web client
// doesn't import the store.

export interface StarterTokens {
  accent: string; accentText: string; text: string; muted: string; background: string; panel: string; line: string;
  font: string; size: number; radius: number;
}

const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const LIGHT: StarterTokens = {
  accent: '#0d6e7c', accentText: '#ffffff', text: '#1a2226', muted: '#5b676e', background: '#f3f5f6', panel: '#ffffff', line: '#c6cfd4', font: SYSTEM, size: 13, radius: 6,
};

export const STARTER_LOOKS: { id: string; name: string; tokens: StarterTokens }[] = [
  { id: 'light', name: 'Light', tokens: LIGHT },
  { id: 'dark', name: 'Dark', tokens: { ...LIGHT, accent: '#4fc3d4', accentText: '#06181c', text: '#e8eef0', muted: '#9fb0b7', background: '#14191c', panel: '#1e2529', line: '#46555d' } },
  {
    id: 'plain', name: 'Plain',
    tokens: { ...LIGHT, accent: '#1a1a1a', accentText: '#ffffff', text: '#111111', muted: '#555555', background: '#ffffff', panel: '#ffffff', line: '#8a8a8a', font: '"Helvetica Neue", Helvetica, Arial, sans-serif', radius: 2 },
  },
  { id: 'warm', name: 'Warm', tokens: { ...LIGHT, accent: '#b4531f', accentText: '#ffffff', text: '#2b2118', muted: '#6e5d4e', background: '#f6f0e8', panel: '#fffdf9', line: '#d8c9b8', radius: 8 } },
];
