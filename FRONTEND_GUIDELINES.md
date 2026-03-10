# FRONTEND_GUIDELINES.md — Binance Buddy Design System

## Aesthetic Direction
Crypto-native dark theme with Binance-inspired gold accents. Clean, modern, NOT generic. The buddy creature adds warmth and personality to what would otherwise be a standard trading interface. Think: premium crypto app meets Tamagotchi nostalgia.

## Color Palette

### Primary Colors
- `--gold`: #F0B90B (Binance yellow — primary accent, CTAs, buddy glow)
- `--gold-light`: #FFD54F (hover states, highlights)
- `--gold-dark`: #C99700 (pressed states)

### Background Colors
- `--bg-primary`: #0B0E11 (main background — near black)
- `--bg-secondary`: #1E2329 (cards, panels, elevated surfaces)
- `--bg-tertiary`: #2B3139 (input fields, hover backgrounds)
- `--bg-chat`: #161A1E (chat message area)

### Text Colors
- `--text-primary`: #EAECEF (main text — off-white)
- `--text-secondary`: #848E9C (secondary text, labels, timestamps)
- `--text-tertiary`: #5E6673 (disabled, placeholder)

### Status Colors
- `--green`: #0ECB81 (profit, success, positive)
- `--red`: #F6465D (loss, error, negative, danger)
- `--blue`: #1890FF (links, info, research agent)
- `--orange`: #FF8C00 (warnings, trenches mode accent)
- `--purple`: #B659FF (XP, achievements, evolution)

## Typography

### Font Stack
- **Display/Headers**: "Space Grotesk", sans-serif (via Google Fonts)
- **Body/UI**: "IBM Plex Sans", sans-serif (via Google Fonts)
- **Mono/Code/Addresses**: "JetBrains Mono", monospace (via Google Fonts)

### Size Scale
- `--text-xs`: 11px (timestamps, micro labels)
- `--text-sm`: 13px (secondary text, captions)
- `--text-base`: 15px (body text, chat messages)
- `--text-lg`: 17px (section headers)
- `--text-xl`: 20px (card titles)
- `--text-2xl`: 24px (page titles)
- `--text-3xl`: 32px (hero numbers — portfolio value)

### Font Weights
- Regular: 400 (body text)
- Medium: 500 (labels, UI elements)
- Semibold: 600 (headers, emphasis)
- Bold: 700 (hero numbers, CTAs)

## Spacing Scale (multiples of 4px)
- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-6`: 24px
- `--space-8`: 32px
- `--space-12`: 48px
- `--space-16`: 64px

## Border Radius
- `--radius-sm`: 6px (buttons, inputs)
- `--radius-md`: 10px (cards, panels)
- `--radius-lg`: 16px (modals, large cards)
- `--radius-full`: 9999px (pills, avatars, badges)

## Shadows
- `--shadow-sm`: 0 1px 2px rgba(0, 0, 0, 0.3)
- `--shadow-md`: 0 4px 12px rgba(0, 0, 0, 0.4)
- `--shadow-lg`: 0 8px 24px rgba(0, 0, 0, 0.5)
- `--shadow-glow`: 0 0 20px rgba(240, 185, 11, 0.3) (gold glow for buddy/CTAs)

## Component Patterns

### Buttons
- **Primary**: bg-gold, text-bg-primary, rounded-sm, font-semibold, hover:bg-gold-light
- **Secondary**: bg-bg-tertiary, text-text-primary, border 1px bg-tertiary
- **Danger**: bg-red, text-white
- **Ghost**: transparent, text-text-secondary, hover:bg-bg-tertiary
- All buttons: height 40px, padding 0 16px, transition 150ms ease

### Cards
- bg-bg-secondary, rounded-md, padding 16px, border 1px rgba(255,255,255,0.06)
- Hover: border-color rgba(240,185,11,0.2), subtle gold tint

### Chat Messages
- **User messages**: bg-bg-tertiary, rounded-lg, align-right, max-width 80%
- **Buddy messages**: bg-bg-secondary, rounded-lg, align-left, max-width 85%, with buddy avatar
- **System messages**: text-text-secondary, centered, text-sm, no background
- **Trade confirmations**: special card with gold border, expanded layout

### Input Fields
- bg-bg-tertiary, border 1px transparent, rounded-sm, padding 10px 14px
- Focus: border-gold, shadow-glow
- Placeholder: text-text-tertiary

### Token Amount Display
- Large number in text-3xl bold
- Symbol in text-lg text-text-secondary
- USD value below in text-sm text-text-secondary
- Green/red color for positive/negative changes

## Buddy Avatar Area
- Square container, min 120px x 120px in popup, 200px x 200px in sidepanel
- Three.js canvas renders the voxel buddy
- Background: subtle radial gradient from bg-secondary center to bg-primary edges
- Gold particle effects during evolution
- Mood indicator: small emoji or colored dot near buddy

## Extension Dimensions
- **Popup**: 360px wide x 500px tall (Chrome extension popup standard)
- **Sidepanel**: 400px wide, full browser height (Chrome sidepanel API)

## Responsive Rules
- Extension popup and sidepanel are fixed-width — no responsive breakpoints needed
- Telegram responses: plain text with emoji, inline keyboards for actions
- If we build a web dashboard later: mobile-first, breakpoints at 640px, 1024px

## Animation & Micro-interactions
- Transitions: 150ms ease for UI elements, 300ms ease-out for modals
- Buddy idle animation: subtle floating/breathing loop (Three.js)
- Trade confirmation: slide up from bottom, 300ms
- XP gain: number flies up from buddy, fades out
- Evolution: 2-second glow + morph animation
- Profit notification: green pulse on portfolio value
- Loss: subtle red flash, buddy mood shifts

## Tailwind Config Extensions
```javascript
// tailwind.config.js extend
colors: {
  gold: { DEFAULT: '#F0B90B', light: '#FFD54F', dark: '#C99700' },
  bg: { primary: '#0B0E11', secondary: '#1E2329', tertiary: '#2B3139', chat: '#161A1E' },
  text: { primary: '#EAECEF', secondary: '#848E9C', tertiary: '#5E6673' },
  status: { green: '#0ECB81', red: '#F6465D', blue: '#1890FF', orange: '#FF8C00', purple: '#B659FF' },
}
```

## Iconography
- Use Lucide React icons throughout
- 20px default size, 16px for compact areas
- Color: text-text-secondary default, contextual colors for status

## Do NOT
- Use light/white backgrounds anywhere (this is a dark-mode-only app)
- Use rounded-full on cards or large elements (only pills/badges/avatars)
- Use more than 2 fonts on a single screen
- Add borders thicker than 1px
- Use animations longer than 500ms on UI elements
- Use any color not defined in this palette
