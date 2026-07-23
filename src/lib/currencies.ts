// Global currencies (ISO 4217). `rate` is approx units per 1 USD, used by
// the landing page for local-price display. Symbols are display-friendly.
export type WorldCurrency = {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  decimals?: number;
};

export const WORLD_CURRENCIES: WorldCurrency[] = [
  { code: "USD", name: "US Dollar", symbol: "$", rate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", rate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", rate: 0.79 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", rate: 155, decimals: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", rate: 7.2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", rate: 7.8 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", rate: 1.35 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", rate: 1.52 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", rate: 1.65 },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", rate: 1.36 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", rate: 0.89 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", rate: 10.5, decimals: 0 },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", rate: 10.8, decimals: 0 },
  { code: "DKK", name: "Danish Krone", symbol: "kr", rate: 6.9, decimals: 0 },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", rate: 4.0 },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč", rate: 23, decimals: 0 },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft", rate: 360, decimals: 0 },
  { code: "RON", name: "Romanian Leu", symbol: "lei", rate: 4.6 },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", rate: 34, decimals: 0 },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", rate: 92, decimals: 0 },
  { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", rate: 41, decimals: 0 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", rate: 3.67, decimals: 0 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", rate: 3.75, decimals: 0 },
  { code: "QAR", name: "Qatari Riyal", symbol: "﷼", rate: 3.64, decimals: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", rate: 0.31 },
  { code: "OMR", name: "Omani Rial", symbol: "﷼", rate: 0.38 },
  { code: "BHD", name: "Bahraini Dinar", symbol: ".د.ب", rate: 0.38 },
  { code: "JOD", name: "Jordanian Dinar", symbol: "د.ا", rate: 0.71 },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪", rate: 3.7 },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", rate: 48, decimals: 0 },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م.", rate: 10 },
  { code: "ZAR", name: "South African Rand", symbol: "R", rate: 18, decimals: 0 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", rate: 1550, decimals: 0 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", rate: 129, decimals: 0 },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", rate: 15 },
  { code: "PKR", name: "Pakistani Rupee", symbol: "₨", rate: 278, decimals: 0 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", rate: 83, decimals: 0 },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", rate: 118, decimals: 0 },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", rate: 305, decimals: 0 },
  { code: "NPR", name: "Nepalese Rupee", symbol: "₨", rate: 133, decimals: 0 },
  { code: "AFN", name: "Afghan Afghani", symbol: "؋", rate: 70, decimals: 0 },
  { code: "IRR", name: "Iranian Rial", symbol: "﷼", rate: 42000, decimals: 0 },
  { code: "IQD", name: "Iraqi Dinar", symbol: "ع.د", rate: 1310, decimals: 0 },
  { code: "THB", name: "Thai Baht", symbol: "฿", rate: 36 },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", rate: 25000, decimals: 0 },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", rate: 16000, decimals: 0 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", rate: 4.7 },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", rate: 58 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", rate: 1380, decimals: 0 },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$", rate: 32, decimals: 0 },
  { code: "MXN", name: "Mexican Peso", symbol: "$", rate: 18 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", rate: 5.5 },
  { code: "ARS", name: "Argentine Peso", symbol: "$", rate: 990, decimals: 0 },
  { code: "CLP", name: "Chilean Peso", symbol: "$", rate: 950, decimals: 0 },
  { code: "COP", name: "Colombian Peso", symbol: "$", rate: 4000, decimals: 0 },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/", rate: 3.8 },
  { code: "UYU", name: "Uruguayan Peso", symbol: "$U", rate: 40, decimals: 0 },
];

export const WORLD_CURRENCIES_MAP: Record<string, WorldCurrency> = Object.fromEntries(
  WORLD_CURRENCIES.map((c) => [c.code, c]),
);
