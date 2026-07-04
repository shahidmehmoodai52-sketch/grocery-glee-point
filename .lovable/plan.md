## Problem

POS search me jab user SKU (item code jaise `2448`) type karta hai, dropdown me sirf item ka naam nazar aata hai — code, barcode ya stock nazar nahi aata. Is wajah se confusion hoti hai ke match sahi hua ya nahi, aur SKU-based sales dhoond'na mushkil hai.

Confirm kiya:
- DB me products ke SKU (e.g. `2448`, `2449`) aur barcodes maujood hain.
- Search logic (`src/routes/_authenticated/pos.tsx`) already SKU, barcode aur name pe match karta hai — issue upload ya matching me nahi, sirf dropdown UI me detail missing hai.

## Fix

Sirf POS dropdown ka UI update — koi business logic ya DB change nahi.

**File:** `src/routes/_authenticated/pos.tsx` (dropdown rows around lines 447–476)

1. **Dropdown header** me "Code" column add karein (Item | Code | Rate | Qty | Dis | Amount).
2. **Har row** me:
   - Item name (bold, jaisa abhi hai)
   - Uske neeche chhoti muted line me: `SKU · Barcode · Category` (jo bhi maujood ho)
   - Naye Code column me SKU (ya fallback barcode) tabular text me
   - Stock badge (e.g. `12 pcs`) name ke sath inline — jaldi pata chale stock hai ya nahi
3. **Search matching** unchanged rahega, lekin query ko trim ke sath whitespace collapse (`\s+` → single space) karein taake copy‑paste SKUs bhi match karein.
4. **"No products match"** message me hint add karein: `"Try name, SKU, ya barcode"`.

## Out of scope

- Import flow, products table, ya database schema me koi change nahi.
- Barcode scan behavior same rahega.

Approve karain to build mode me apply kar dun.