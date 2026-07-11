/**
 * Semantic design tokens synced from the Ekai Support Portal web app
 * (artifacts/support-portal/src/index.css).
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0F1F3D',
    tint: '#EFB323',

    // Core surfaces
    background: '#FBF6EC',
    foreground: '#0F1F3D',

    // Cards / elevated surfaces
    card: '#FEFBF5',
    cardForeground: '#0F1F3D',

    // Primary action color (gold / amber — buttons, headers, active states)
    primary: '#EFB323',
    primaryForeground: '#0F1F3D',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#F1E9D6',
    secondaryForeground: '#1B2B4A',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#F3ECDA',
    mutedForeground: '#726A5B',

    // Accent highlights (warm cream — links, selected items, focus)
    accent: '#EDE2C9',
    accentForeground: '#182842',

    // Destructive actions (delete, error states)
    destructive: '#DC2626',
    destructiveForeground: '#FEFBF5',

    // Borders and input outlines
    border: '#E0D2AF',
    input: '#E0D2AF',
  },

  dark: {
    text: '#F4EEE0',
    tint: '#EFB323',

    background: '#0D1526',
    foreground: '#F4EEE0',

    card: '#111B30',
    cardForeground: '#F4EEE0',

    primary: '#EFB323',
    primaryForeground: '#0D1424',

    secondary: '#232B3B',
    secondaryForeground: '#F4EEE0',

    muted: '#232B3B',
    mutedForeground: '#A9A398',

    accent: '#2A3244',
    accentForeground: '#F4EEE0',

    destructive: '#B91C1C',
    destructiveForeground: '#F4EEE0',

    border: '#2A3244',
    input: '#2A3244',
  },

  // Matches the web portal's --radius: 0.5rem
  radius: 8,
};

export default colors;
