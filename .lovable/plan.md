# i18n Optimization and Professional Translation Plan

This plan involves optimizing the i18n implementation to prevent flickering during language switching and completing the professional translation for 4 languages (Arabic, Spanish, German, Norwegian) to match the completeness of the Urdu translation.

## User Review Required

> [!IMPORTANT]
> - I will remove the layout reflow hack in `i18n.ts` which causes flickering.
> - I will provide professional translations for the "landing" section in Arabic, Spanish, German, and Norwegian files.
> - No keys will be changed; only the values will be updated to ensure the application logic remains intact.

## Proposed Changes

### i18n Logic Optimization
#### [src/lib/i18n.ts](src/lib/i18n.ts)
- Set `debug: false` to reduce console noise.
- Remove the code that toggles `body.style.display` in `syncDir`. This "layout recalc" logic is the root cause of the screen flickering when changing languages.

### Professional Translations
I will update the following files to ensure the `landing` section is fully translated (industries, features, global, how, team, footer, testimonials, pricing features, hero cards, and "why" section metadata).

#### [public/locales/ar/translation.json](public/locales/ar/translation.json) (Arabic)
- Translate remaining English values to Arabic.

#### [public/locales/es/translation.json](public/locales/es/translation.json) (Spanish)
- Translate remaining English values to Spanish.

#### [public/locales/de/translation.json](public/locales/de/translation.json) (German)
- Translate remaining English values to German.

#### [public/locales/no/translation.json](public/locales/no/translation.json) (Norwegian)
- Translate remaining English values to Norwegian.

## Technical Details

- **Timezone**: All date/time displays follow Pakistan Time (Asia/Karachi).
- **Validation**:
  - JSON syntax check for all updated translation files.
  - Verification that only the requested 5 files are modified.
  - Ensuring `i18n.ts` retains its core functionality (direction and language setting).
