/**
 * Semantic design tokens synced from the Ekai Support Portal web app
 * (artifacts/support-portal/src/index.css).
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#020817',
    tint: '#2563EB',

    // Core surfaces
    background: '#FFFFFF',
    foreground: '#020817',

    // Cards / elevated surfaces
    card: '#F8FAFC',
    cardForeground: '#020817',

    // Primary action color (navy — buttons, headers, active states)
    primary: '#0F1F3D',
    primaryForeground: '#F8FAFC',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#F1F5F9',
    secondaryForeground: '#0F172A',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#F1F5F9',
    mutedForeground: '#64748B',

    // Accent highlights (electric blue — links, selected items, focus)
    accent: '#2563EB',
    accentForeground: '#FFFFFF',

    // Destructive actions (delete, error states)
    destructive: '#EF4444',
    destructiveForeground: '#F8FAFC',

    // Borders and input outlines
    border: '#E2E8F0',
    input: '#E2E8F0',
  },

  dark: {
    text: '#F8FAFC',
    tint: '#2563EB',

    background: '#020817',
    foreground: '#F8FAFC',

    card: '#0B1426',
    cardForeground: '#F8FAFC',

    primary: '#F8FAFC',
    primaryForeground: '#0F172A',

    secondary: '#1E293B',
    secondaryForeground: '#F8FAFC',

    muted: '#1E293B',
    mutedForeground: '#94A3B8',

    accent: '#2563EB',
    accentForeground: '#FFFFFF',

    destructive: '#7F1D1D',
    destructiveForeground: '#F8FAFC',

    border: '#1E293B',
    input: '#1E293B',
  },

  // Matches the web portal's --radius: 0.5rem
  radius: 8,
};

export default colors;
