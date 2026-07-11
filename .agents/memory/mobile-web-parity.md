---
name: Mobile/web design parity
description: Keeping the Expo mobile app visually and functionally in sync with the Ekai Support Portal web app
---

# Mobile/web design parity

**Rule:** The mobile app's design tokens are hand-synced from the web portal's CSS variables (`artifacts/support-portal/src/index.css`) into `artifacts/mobile/constants/colors.ts` (HSL → hex). Badge tints for ticket severity/status mirror the portal's Tailwind badge classes. If the portal palette changes, re-sync both files.

**Why:** There is no shared token pipeline between the Tailwind web app and React Native; drift is silent.

**Gotchas learned while building the mobile app:**
- The generated react-query hooks (orval) require `queryKey` when you pass any `query` options (e.g. `enabled`); use the exported `get*QueryKey()` helpers.
- Clerk on Expo needs env forwarding in **two** places: the `dev` script in `artifacts/mobile/package.json` and the Metro env in `artifacts/mobile/scripts/build.js` (deployment) — `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_CLERK_PROXY_URL`.
- The portal is invite-only: `/auth/me` returns 403 for Clerk-authenticated but uninvited users; every client must handle that state explicitly (mobile shows a "No portal access" screen).
