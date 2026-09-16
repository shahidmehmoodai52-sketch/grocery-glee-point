/**
 * Static, offline-first help knowledge base for Tillix.
 *
 * Everything here is plain data — no network, no AI API, no database. This
 * keeps the Help assistant fully usable in offline mode.
 *
 * Every `route` below is an existing app route (see src/routes/_authenticated
 * and src/components/app-sidebar.tsx). Do not invent routes or features here.
 */

export type HelpTopic = {
  id: string;
  /** Section name shown in the UI. */
  title: string;
  /** Real app route this topic belongs to (used for "You are here" + Open). */
  route: string;
  /** One-line description of what the section is for. */
  summary: string;
  /** Short, ordered how-to steps. */
  steps: string[];
  /** English + Roman Urdu keywords/synonyms used for matching. */
  keywords: string[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    route: "/dashboard",
    summary: "Aaj ke sales, profit, credit aur top summary numbers ek jagah.",
    steps: [
      "Top pe date range choose karein (today, week, month or custom).",
      "Summary cards sales, cash sales, credit sales aur expenses dikhate hain.",
      "Kisi card par click karke us ki detail list open karein.",
    ],
    keywords: [
      "dashboard", "home", "summary", "overview", "aaj", "today", "khulasa",
      "total sale", "profit", "munafa", "kitni sale hui", "main screen",
    ],
  },
  {
    id: "pos",
    title: "POS / Billing",
    route: "/pos",
    summary: "Counter par bill banane ki screen — barcode scan, cart, payment aur print.",
    steps: [
      "Search box mein barcode scan karein ya item ka naam type karein.",
      "Arrow keys se item select karke Enter dabayein — item cart mein aa jayega.",
      "Quantity aur discount cart line par edit karein; Delete key se line hataayein.",
      "Payment method choose karein (cash, credit, ya doosra account) aur checkout karein.",
      "Print confirm karne par receipt nikal jaye gi.",
    ],
    keywords: [
      "pos", "billing", "bill", "bill kaise banaye", "counter", "invoice banao",
      "barcode", "scan", "cart", "checkout", "receipt", "print", "sale karni hai",
      "cash", "udhar", "credit sale", "quick add", "naya item bill mein",
    ],
  },
  {
    id: "sales",
    title: "Sales",
    route: "/sales",
    summary: "Saari purani sale invoices, search, detail aur reprint.",
    steps: [
      "Date range aur search se invoice dhoondein (invoice number ya customer se).",
      "Invoice row par click karke items aur payment detail dekhein.",
      "Wahan se invoice dobara print ya share kar sakte hain.",
    ],
    keywords: [
      "sales", "sale list", "invoices", "purani sale", "invoice dhoondna",
      "bill history", "reprint", "sale detail", "kitne bill bane",
    ],
  },
  {
    id: "sale-returns",
    title: "Sale Returns",
    route: "/sale-returns",
    summary: "Customer se wapas aaya maal record karna aur refund/adjust karna.",
    steps: [
      "Original invoice search karein.",
      "Jo items wapas aaye hain unki quantity select karein.",
      "Return save karein — stock wapas add ho ga aur customer balance adjust ho ga.",
    ],
    keywords: [
      "sale return", "return", "wapsi", "wapas", "customer return", "refund",
      "maal wapas aaya", "bill return", "cancel item",
    ],
  },
  {
    id: "purchases",
    title: "Purchases",
    route: "/purchases",
    summary: "Supplier se kharida hua maal enter karna aur stock barhana.",
    steps: [
      "New purchase par click karein aur supplier select karein.",
      "Items add karein — quantity, purchase rate aur sale rate likhein.",
      "Invoice number aur date daalein.",
      "Payment: kitna cash diya aur kitna udhar (supplier balance) rakha.",
      "Save karein — stock automatically update ho jaye ga.",
    ],
    keywords: [
      "purchase", "purchase kaise banani hai", "kharidari", "khareed",
      "supplier bill", "stock add", "maal aaya", "naya stock",
      "purchase entry", "bill scan", "draft purchase",
    ],
  },
  {
    id: "purchase-returns",
    title: "Purchase Returns",
    route: "/purchase-returns",
    summary: "Supplier ko maal wapas bhejna aur supplier balance adjust karna.",
    steps: [
      "Supplier ya purchase invoice select karein.",
      "Return honay wali items aur quantity choose karein.",
      "Save karein — stock kam ho ga aur supplier ledger adjust ho ga.",
    ],
    keywords: [
      "purchase return", "supplier return", "maal supplier ko wapas",
      "kharidari wapas", "return to supplier", "damaged stock wapas",
    ],
  },
  {
    id: "products",
    title: "Products",
    route: "/products",
    summary: "Item catalog — naam, rate, barcode, stock aur category.",
    steps: [
      "Search se item dhoondein (naam, SKU ya barcode).",
      "Add product se naya item banayein; rate aur barcode set karein.",
      "Item par click karke uski detail, stock aur movement history dekhein.",
    ],
    keywords: [
      "products", "product", "items", "item", "medicine", "catalog", "rate change",
      "naya item", "item add", "barcode lagana", "price update", "stock kaise check karun",
      "stock check", "quantity", "maujooda stock", "item ki qeemat",
    ],
  },
  {
    id: "stock-count",
    title: "Stock Count",
    route: "/stock-count",
    summary: "Physical stock ginti karke system stock se milaana (audit).",
    steps: [
      "Naya stock count start karein.",
      "Items scan/enter karke actual counted quantity likhein.",
      "Count finalize karein — difference ka adjustment record ho jaye ga.",
    ],
    keywords: [
      "stock count", "ginti", "physical stock", "audit", "stock milana",
      "inventory count", "stock check karna", "difference",
    ],
  },
  {
    id: "expiry",
    title: "Expiry & Waste",
    route: "/expiry",
    summary: "Expiry ke qareeb items, waste/damage aur short & excess tracking.",
    steps: [
      "Expiring items ki list dekhein aur supplier ko wapas ya waste mark karein.",
      "Short & Excess tab counter shortage/extra record karne ke liye hai.",
    ],
    keywords: [
      "expiry", "expire", "waste", "damage", "kharab maal", "short excess",
      "kami beshi", "shortage", "expiry date",
    ],
  },
  {
    id: "customers",
    title: "Customers",
    route: "/customers",
    summary: "Customer list, udhar (credit) balance aur ledger.",
    steps: [
      "Customer search karein aur uske naam par click karein.",
      "Ledger mein saari sales, returns aur payments date wise nazar aayengi.",
      "Payment received record karne se balance kam ho jaye ga.",
    ],
    keywords: [
      "customer", "customers", "customer balance kahan hai", "balance",
      "udhar", "udhaar", "credit", "ledger", "khata", "payment received",
      "recovery", "kisne paise dene hain", "customer ka hisab",
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    route: "/suppliers",
    summary: "Supplier list, unka balance aur purchase ledger.",
    steps: [
      "Supplier par click karke ledger open karein.",
      "Purchases, returns aur payments ek hi ledger mein dikhengi.",
      "Payment paid record karne se supplier balance kam ho ga.",
    ],
    keywords: [
      "supplier", "suppliers", "supplier balance", "party", "wholesaler",
      "supplier ledger", "supplier ko payment", "hisab supplier",
    ],
  },
  {
    id: "expenses",
    title: "Expenses",
    route: "/expenses",
    summary: "Dukan ke kharche (rent, bijli, salary waghera) record karna.",
    steps: [
      "Add expense par click karein.",
      "Category, amount, date aur note likhein.",
      "Save karein — expense cash flow aur reports mein aa jaye ga.",
    ],
    keywords: [
      "expense", "expenses", "kharcha", "kharch", "bill bijli", "rent",
      "salary", "expense add", "kharcha kahan likhein",
    ],
  },
  {
    id: "cash-flow",
    title: "Cash Flow",
    route: "/cash-flow",
    summary: "Cash aur bank accounts mein paise ki aamad-o-raft aur balance.",
    steps: [
      "Date range choose karein ya 'All' se poori history dekhein.",
      "Account card par click karke us account ki poori history dekhein.",
      "Cash in / cash out entry se manual movement record karein.",
    ],
    keywords: [
      "cash flow", "cashflow", "cash", "bank", "account balance",
      "cash in", "cash out", "paise kahan gaye", "rozana cash", "easypaisa",
      "jazzcash", "nakdi",
    ],
  },
  {
    id: "shifts",
    title: "Shifts",
    route: "/shifts",
    summary: "Cashier shift open/close aur cash counting.",
    steps: [
      "Shift start karte waqt opening cash daalein.",
      "Shift close par counted cash likhein — system difference dikhaye ga.",
    ],
    keywords: [
      "shift", "shifts", "cashier", "opening cash", "closing cash",
      "shift close", "duty", "counter close",
    ],
  },
  {
    id: "operations",
    title: "Operations",
    route: "/operations",
    summary: "Rozana operational tasks aur checks ek jagah.",
    steps: [
      "Tabs se relevant operational task choose karein.",
      "Jo action chahiye us row par click karein.",
    ],
    keywords: [
      "operations", "operation", "daily task", "checklist", "rozana kaam",
    ],
  },
  {
    id: "reports",
    title: "Reports",
    route: "/reports",
    summary: "Sale, profit, credit, expense aur P&L reports date range ke sath.",
    steps: [
      "Date range select karein (Pakistan time ke hisaab se).",
      "Sale, profit, credit outstanding aur expenses ke summary cards dekhein.",
      "Credit sale ya kisi card par click karke detail invoices list open karein.",
    ],
    keywords: [
      "report", "reports", "profit", "munafa", "p&l", "profit and loss",
      "credit outstanding", "monthly report", "sale report", "analysis",
      "hisab kitab", "date range",
    ],
  },
  {
    id: "intelligence",
    title: "Intelligence",
    route: "/intelligence",
    summary: "Slow/fast moving items aur business insights.",
    steps: [
      "Filters se items ki category ya movement choose karein.",
      "Insight list se decide karein kya order karna hai aur kya nahi.",
    ],
    keywords: [
      "intelligence", "insights", "slow moving", "fast moving", "best selling",
      "kaunsa item chalta hai", "dead stock",
    ],
  },
  {
    id: "import",
    title: "Bulk Import",
    route: "/import",
    summary: "Excel/CSV se products ya data ek sath import karna.",
    steps: [
      "Sample file download karke usi format mein data bharein.",
      "File upload karein aur preview check karein.",
      "Import confirm karein.",
    ],
    keywords: [
      "import", "bulk import", "excel", "csv", "upload data", "data import",
      "products upload",
    ],
  },
  {
    id: "library",
    title: "Global Library",
    route: "/library",
    summary: "Ready-made product library se items apne catalog mein laana.",
    steps: [
      "Library mein item search karein.",
      "Item select karke apne products mein add karein, phir rate set karein.",
    ],
    keywords: [
      "library", "global library", "ready items", "product library",
      "banaye hue items",
    ],
  },
  {
    id: "assets",
    title: "Assets",
    route: "/assets",
    summary: "Dukan ke assets (freezer, rack, gaari waghera) ka record.",
    steps: [
      "Add asset se naya asset likhein — naam, value aur date.",
      "List se asset detail update karein.",
    ],
    keywords: [
      "asset", "assets", "freezer", "furniture", "machinery", "dukan ka samaan",
    ],
  },
  {
    id: "barcode-generator",
    title: "Barcode Generator",
    route: "/barcode-generator",
    summary: "Items ke barcode labels design aur print karna.",
    steps: [
      "Items select karein aur kitne labels chahiye set karein.",
      "Label size choose karke print karein.",
    ],
    keywords: [
      "barcode", "barcode generator", "label print", "sticker", "barcode banana",
      "price tag",
    ],
  },
  {
    id: "backup",
    title: "Auto Backup",
    route: "/backup",
    summary: "Data ka backup schedule aur manual backup download.",
    steps: [
      "Backup schedule on karein aur time set karein.",
      "Download backup se abhi ka backup file le lein.",
    ],
    keywords: [
      "backup", "auto backup", "data safe", "download backup", "restore",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    route: "/settings",
    summary: "Shop name, currency, printer, receipt aur general preferences.",
    steps: [
      "Store info (naam, address, phone) update karein.",
      "Currency aur receipt/printer settings adjust karein.",
      "Save karein — changes poori app par apply ho jayenge.",
    ],
    keywords: [
      "settings", "setting", "shop name", "currency", "printer", "receipt",
      "language", "zuban", "tarteeb", "configuration", "logo",
    ],
  },
  {
    id: "shop-admin",
    title: "Shop Admin",
    route: "/shop-admin",
    summary: "Staff users, permissions aur shop-level admin controls.",
    steps: [
      "User add karein aur uska role/permissions choose karein.",
      "Kisi user ko disable karna ho to uska access hata dein.",
    ],
    keywords: [
      "shop admin", "admin", "users", "staff", "permission", "role",
      "user add", "access", "mulazim",
    ],
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Roman-Urdu / English spelling variants folded to one form before matching. */
const SYNONYMS: Record<string, string> = {
  udhaar: "udhar", udhari: "udhar", credit: "udhar",
  kharidari: "purchase", khareed: "purchase", kharid: "purchase",
  kharch: "kharcha", kharche: "kharcha", expenses: "expense",
  bik: "sale", sales: "sale", becha: "sale", bill: "sale",
  grahak: "customer", customers: "customer",
  maal: "stock", inventory: "stock", quantity: "stock",
  hisaab: "hisab", khata: "ledger",
  raqam: "amount", paisa: "cash", paise: "cash", nakdi: "cash",
  reports: "report", rapot: "report",
  items: "item", products: "product", medicines: "product", medicine: "product",
  suppliers: "supplier", party: "supplier",
  banani: "banana", banaye: "banana", banane: "banana", banao: "banana",
  kaise: "kaise", kese: "kaise", kesay: "kaise", kaisay: "kaise",
  kahan: "kahan", kaha: "kahan", kidhar: "kahan",
  setting: "settings",
};

const fold = (tokens: string[]) => tokens.map((t) => SYNONYMS[t] ?? t);

export function findTopicByRoute(pathname: string): HelpTopic | undefined {
  // Longest matching route wins so /customers/123 resolves to /customers.
  return [...HELP_TOPICS]
    .sort((a, b) => b.route.length - a.route.length)
    .find((t) => pathname === t.route || pathname.startsWith(t.route + "/"));
}

export type HelpMatch = { topic: HelpTopic; score: number };

/**
 * Keyword/synonym scoring over the static knowledge base. Deliberately simple
 * and local so it works offline and never invents an answer.
 */
export function searchTopics(query: string, limit = 5): HelpMatch[] {
  const q = norm(query);
  if (!q) return [];
  const tokens = fold(q.split(" ").filter((t) => t.length > 1));
  if (tokens.length === 0) return [];

  const scored = HELP_TOPICS.map((topic) => {
    const haystackKeywords = topic.keywords.map((k) => norm(k));
    const haystackText = fold(
      norm(`${topic.title} ${topic.summary} ${topic.steps.join(" ")}`).split(" "),
    ).join(" ");

    let score = 0;
    // Whole-phrase keyword hit is the strongest signal.
    for (const k of haystackKeywords) {
      if (k.includes(q) || q.includes(k)) score += k.split(" ").length > 1 ? 8 : 5;
    }
    for (const token of tokens) {
      if (haystackKeywords.some((k) => fold(k.split(" ")).includes(token))) score += 3;
      else if (haystackText.includes(token)) score += 1;
      if (norm(topic.title).includes(token)) score += 2;
    }
    return { topic, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
