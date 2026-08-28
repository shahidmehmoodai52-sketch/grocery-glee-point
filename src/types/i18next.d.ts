import 'i18next';

// Narrow i18next's t() return type to plain strings.
// Without this, t() is typed as `string | $SpecialObject | TFunctionDetailedResult`,
// which React refuses to render as a child (TS2322).
declare module 'i18next' {
  interface CustomTypeOptions {
    returnNull: false;
    returnObjects: false;
    returnDetails: false;
  }
}
