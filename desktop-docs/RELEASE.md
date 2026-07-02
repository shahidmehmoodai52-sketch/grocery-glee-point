# Release & Auto-Update Guide (Grocery POS Desktop)

Ye guide bataata hai kaise Windows `.exe` build karke GitHub Releases pe publish karna hai. Ek baar users install kar len, phir har naya release **automatically download + install** ho jayega jab app restart hogi.

---

## One-time setup

### 1. GitHub repo for releases
Ek repo banao (public ya private) sirf releases host karne ke liye — code alag rah sakta hai. Example: `mart/grocery-pos-releases`.

### 2. Update `electron-builder.yml`
`publish.owner` aur `publish.repo` me apne GitHub owner + repo daalo:

```yaml
publish:
  - provider: github
    owner: your-github-username
    repo: grocery-pos-releases
```

### 3. GitHub personal access token
- GitHub → Settings → Developer settings → **Personal access tokens (classic)**
- Scope: `repo` (private) ya `public_repo` (public)
- Token save karo — sirf ek baar dikhega

### 4. Build machine par set karo
Windows PC pe (jahan `.exe` banega):

```powershell
setx GH_TOKEN "ghp_xxxxxxxxxxxx"
```

New terminal open karo taake env variable load ho.

---

## Har release ka flow

1. `package.json` me `version` bump karo (`0.1.0` → `0.1.1`)
2. Terminal me chalao:
   ```powershell
   bun install
   bun run electron:release
   ```
3. electron-builder ye karega:
   - Vite + Nitro build (node-server preset)
   - `.exe` installer banaega `electron-release/` me
   - GitHub pe **draft release** create karega, `.exe` + `latest.yml` upload karega
4. GitHub pe jaa ke draft release ko **Publish** kar do.
5. Installed users ki app agli baar khulne pe update dhoondh legi (auto-check on boot + har 4 ghante). Update dialog dikhega, download background me hoga, "Restart to install" click pe naya version chalu.

---

## Local test build (without publishing)

```powershell
bun run electron:pack
```

Sirf `.exe` banega `electron-release/` me, GitHub pe kuch nahi jayega. USB / WhatsApp se share kar sakte ho.

---

## Development

```powershell
bun run dev             # terminal 1: Vite dev server on :8080
bun run electron:dev    # terminal 2: Electron window pointing to dev server
```

`POS_DEV=1` set hone se auto-updater band rehta hai aur DevTools khulta hai.

---

## Troubleshooting

**"Update failed - HttpError: 404"**
- Repo owner/name galat hai, ya release draft me hai (publish nahi hui).
- Private repo hai lekin `GH_TOKEN` embed nahi hua — build ke waqt token env me hona chahiye.

**Users ko update nahi mila**
- Purani version me auto-updater code nahi tha (v1). Un users ko naya `.exe` manually dena padega, uske baad auto-update chalega.

**App boot nahi ho rahi (server did not start)**
- `.output/server/index.mjs` missing hai. `bun run electron:build` phir chalao.
- Antivirus block kar raha ho sakta hai — installer whitelist karo.

---

## Code signing (recommended for production)

Bina signed .exe ke Windows SmartScreen warning dikhaega. EV certificate (~$300/year) recommended. `electron-builder.yml` me `win.certificateFile` add karke enable karo — details: https://www.electron.build/code-signing
