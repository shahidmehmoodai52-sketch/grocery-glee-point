## Problem (file inspect ke baad confirm)

Aap ki file `final_merged_correct_barcodes.xlsx` ke headers **jhoot bol rahe hen** — har column ka label uske andar ke data se match nahi karta. Actual mapping:

| Header (galat naam) | Andar asli data |
|---|---|
| `code` | khali |
| `itemname` | **item code** (2, 3, 4…) |
| `category` | **item name** (MS Foods Masala 20…) |
| `barcode` | barcode ✓ |
| `rackdetails` | **unit** (Pck, Grm, Pcs) |
| `mrprate` | **purchase rate** |
| `salesrate` | hamesha 0 |
| `negativestock` | **sale rate** |
| `currentstock` | hamesha 0 |
| `dealercode` | **stock** (negative bhi) |
| `tax` | item name (duplicate) |

Import tool ka `autoMap` sirf header naam pe bharosa karta hy, is liye:
- `name` ← `itemname` (asli me code aa raha tha)
- `sku` ← `code` (khali)
- `cost_price` ← `purchaserate` (khali → 0)
- `sell_price` ← `salesrate` (0)
- `stock` ← `currentstock` (0)

Isi wajah se saab kuch mixup ho gaya.

Aur "Single merged file" tab me **manual mapping dropdowns hain hi nahin** — user auto-map override nahi kar sakta tha.

## Kya fix karunga

### 1) Content-based smart auto-mapping (`src/routes/_authenticated/import.tsx`)
Naya function `smartAutoMap(headers, rows)` jo pehle header naam try karega, phir **pehli 50-100 rows ka content dekh kar** score karega:

- **barcode** = column jis me 80%+ values 8–14 digit ke pure numbers hon
- **sku / item code** = column jis me chhote integers (1–999999) ya alphanumeric codes hon aur unique-count kam ho (grouping karta ho)
- **name** = column jis me letters wale strings hon (numbers nahi), 80%+ non-empty
- **unit** = column jis me chhote 2–4 letter tokens hon (Pck, Grm, Pcs, Kg, Nos, Dzn)
- **cost_price / sell_price** = decimal numbers (`.` wale), non-zero
- **stock** = integer numbers (negative allowed), header hint check
- Khali columns aur `date`-shaped columns ignore

Header name hint + content score dono milake best column choose hoga.

### 2) Manual column mapping UI in "Single merged file" tab
Har target field (Item Name, Item Code, Barcode, Category, Unit, Purchase Rate, Sale Rate, Stock, Tax) ke saath dropdown add karunga jis me file ke saare headers list honge — aap khud koi bhi override kar saken. `— skip —` option bhi.

Auto-detect ke saath, har badge ke neeche ek chhoti "sample" line dikhaunga (`e.g. "MS Foods Masala 20"`) taake foran pata chale mapping sahi hy ya galat.

### 3) Live preview table (pehle 20 rows) grouped state ke naal
Import se pehle table dikhega: SKU · Name · Barcode(s) · Unit · Cost · Sale · Stock — aap dekh ke confirm karen ge phir "Import" dabana ho ga. Auto-save checkbox default **off** kar dun ga taake accident dobara na ho.

### 4) "Wipe imported stock" button
Ek chhota destructive button (confirm dialog ke saath) jo `product_barcodes` aur `products` empty kar dega. Sales/purchases history untouched rahegi (unke items name+price snapshot rakhte hen). Aap ne pehle jawab diya tha "sirf mapping fix karen" — is liye button optional rahega, aap khud dabaen ge jab chahen.

### 5) Aap ki file ke liye expected result
Naye smart-map se aap ki file me automatically ye pick hoga:
- name ← `category` column
- sku ← `itemname` column
- barcode ← `barcode` column
- unit ← `rackdetails` column
- cost_price ← `mrprate` column
- sell_price ← `negativestock` column
- stock ← `dealercode` column

Preview me confirm ho ga → import → **~400 unique products, ~5500 barcodes properly linked**, aur POS me name/code/barcode search sahi chalega.

## Technical notes

- Sirf `src/routes/_authenticated/import.tsx` change hoga.
- `smartAutoMap` pure client-side, koi DB migration nahi.
- Wipe button `supabase.from("product_barcodes").delete()` + `supabase.from("products").delete()` — RLS `authenticated` users allow karta hy.
- Existing "Products" / "Customers" / "Suppliers" tabs pe koi asar nahi.
