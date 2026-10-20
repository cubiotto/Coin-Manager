# Set up your own Google login (Drive sync)

Google is only used for **☁️ Đồng bộ Google Drive**. The app needs one OAuth client ID that you own, saved in [config/google.js](../config/google.js).


## 1. Create the Google Cloud project

1. Open <https://console.cloud.google.com/> → project picker → **New project** (e.g. `coin-manager`).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.

## 2. Consent screen (Google Auth Platform)

1. **APIs & Services → OAuth consent screen** (opens *Google Auth Platform*) → **Get started**.
2. App name `Sổ Chi Tiêu`, support email = your Gmail. Audience **External**. Contact email = your Gmail. Create.
3. **Data Access → Add or remove scopes** → tick `.../auth/drive.appdata` → Update → Save.
   (Non-sensitive scope: no Google verification needed.)
4. **Audience → Test users → Add users** → add every Gmail that will sync (yourself, family…). Leave the app in **Testing**.

## 3. Create the OAuth client

**Clients → Create client** → type **Web application**, name `Coin Manager web`.

| Field | Values |
|---|---|
| Authorized JavaScript origins | `http://localhost:8765` · `https://cubiotto.github.io` |
| Authorized redirect URIs | `http://localhost:8765/oauth.html` · `https://cubiotto.github.io/Coin-Manager/oauth.html` |

Origins have **no path and no trailing slash**. Create → copy the **Client ID** (`…apps.googleusercontent.com`). You don't need the client secret — the app never uses it.

## 4. Put the client ID in the app

Edit [config/google.js](../config/google.js):

```js
export const GOOGLE_CLIENT_ID = '1234567890-abc….apps.googleusercontent.com';
```

## 5. Run it

**Localhost:** `powershell -ExecutionPolicy Bypass -File scripts/serve.ps1` → <http://localhost:8765/> → Cài đặt → ☁️ Đồng bộ Google Drive → Đồng bộ ngay.

**GitHub Pages:** push to `main` of your repo `cubiotto/Coin-Manager` → GitHub repo **Settings → Pages → Deploy from a branch → `main` / `(root)`** → wait ~1 min → open `https://cubiotto.github.io/Coin-Manager/`.

## Notes

- Your data on localhost and on GitHub Pages are **separate** (different origins = different browser storage). Use Drive sync with the same password to keep them together.
- Settings changes in Google Cloud can take a few minutes to apply.
- Errors: `redirect_uri_mismatch` → redirect URI in step 3 doesn't match exactly · `access_denied` / "app not verified" blocks you → that Gmail isn't in Test users · `403` from Drive → Drive API not enabled (step 1.2).
