# FinTrack

A privacy-first personal finance tracker. Track transactions, budgets, savings goals, and recurring expenses with multi-device sync via Firebase.

Built with vanilla JavaScript, Vite, and Firebase (Auth + Firestore). No backend server to run — Firebase handles auth, persistence, and per-user isolation.

## Features

- **Transactions** — income, expense, and transfer entries with categories and accounts
- **Budgets** — monthly category limits with progress bars
- **Goals** — savings targets with contribution tracking
- **Recurring entries** — repeating bills/incomes with manual "Add now" posting
- **Charts** — spend-by-category and trend visualisations (Chart.js)
- **Multi-account support** — cash, bank, wallet, etc. with per-account balances
- **Import / Export** — JSON and CSV
- **Multi-user** — sign up + login, each user's data fully isolated
- **Cross-device sync** — Firestore source of truth, instant local cache for first paint
- **Offline support** — Firestore IndexedDB persistent cache; works offline, syncs on reconnect
- **Light / Dark theme**

## Tech Stack

| Layer | Tool |
|------|------|
| Build | Vite 5 |
| Language | Vanilla JS (ES Modules) |
| Auth | Firebase Authentication (Email / Password) |
| Database | Cloud Firestore |
| Charts | Chart.js 4 |
| Styling | Hand-written CSS, no framework |

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url> fintrack
cd fintrack
npm install
```

### 2. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. **Build → Authentication → Get started → Sign-in method** → enable **Email/Password**.
3. **Build → Firestore Database → Create database** → start in **production mode** in the region closest to you.
4. **Project Settings (gear icon) → Your apps → Web (`</>`)** → register an app and copy the config values.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your Firebase web-app config:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef

VITE_ADMIN_NAME=Admin
VITE_ADMIN_EMAIL=admin@yourdomain.com
VITE_ADMIN_PASSWORD=ChangeThisToSomethingStrong!
```

> The admin user is created automatically the first time the app boots. **Change `VITE_ADMIN_PASSWORD` before deploying.**

### 4. Publish Firestore security rules

In **Firestore → Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**. This guarantees every user can only read/write their own document.

### 5. Run

```bash
npm run dev
```

Open http://localhost:5173. Sign up to create your first account.

## Available Scripts

| Command | What it does |
|--------|--------------|
| `npm run dev` | Start Vite dev server on port 5173 with HMR |
| `npm run build` | Produce a static production build in `dist/` |
| `npm run preview` | Serve the built `dist/` locally to verify the build |

## Project Structure

```
fintrack/
├── index.html              # Vite entry point
├── vite.config.js
├── package.json
├── .env                    # local secrets (gitignored)
├── .env.example            # template
├── src/
│   ├── main.js             # tiny boot file: imports app.js
│   ├── app.js              # main UI, state, render loop, all features
│   ├── auth.js             # Firebase Auth wrapper (register / login / logout / profile)
│   ├── firebase.js         # Firebase app + Auth + Firestore singletons
│   ├── storage.js          # localStorage + Firestore persistence (per-user)
│   └── styles.css
├── README.md
└── workflow.md             # architecture and data-flow documentation
```

## Deploying

Any static-file host works because the build output is plain HTML/JS/CSS.

### Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public dir: dist, single-page: yes
npm run build
firebase deploy
```

### Vercel / Netlify

- Build command: `npm run build`
- Output directory: `dist`
- Add the same `VITE_FIREBASE_*` and `VITE_ADMIN_*` variables in the host's environment-variables UI.

## Security Notes

This is a client-only app, so a few things must be true for it to be safe:

1. **`.env` is gitignored** — never commit your real Firebase keys or admin password.
2. **Firestore security rules are mandatory.** The rules above ensure server-side per-user isolation; without them anyone could read all users' data.
3. **The Firebase web API key is not a secret.** It only identifies the project. Lock it down in **Google Cloud Console → APIs & Services → Credentials → API restrictions** by limiting referrers to your deployed domains.
4. **Admin password.** The bootstrap admin (`VITE_ADMIN_PASSWORD`) is created on first run. Set a strong value before deploying. After first run you can remove it from env vars; the user already exists in Firebase.
5. **No password reset** is wired up in the UI — users currently cannot self-service. If you need that, call Firebase's `sendPasswordResetEmail` from `auth.js`.
6. **Email enumeration.** Firebase's auth errors distinguish "user not found" from "wrong password". To prevent enumeration, map both to a generic "invalid credentials" message in the catch handler in `auth.js` if needed.
7. **All HTML rendered from user data is escaped** via `escapeHtml(...)`. If you add new render code, follow the same pattern — never interpolate raw user fields into `innerHTML`.

## Audit Summary (this version)

Findings from the project review:

| Severity | Area | Finding | Status |
|---|---|---|---|
| Low | Data integrity | `importJson` and `importCsv` did not validate transaction shape; corrupt rows could enter state | **Fixed** — both now run rows through `normalizeTransaction` |
| Info | XSS surface | All user-content interpolation goes through `escapeHtml`; `toast` uses `textContent`; `openModal` title uses `textContent` | OK |
| Info | XSS latent | `emptyState(title, body)` interpolates raw — currently only called with hardcoded literals; if you add a dynamic caller, escape both args | Watch |
| Info | Inline handler | One `onclick="event.stopPropagation()"` in a template; harmless but blocks strict CSP | Acceptable |
| Info | Secrets | Admin password stored in `.env` (and exposed to the bundle via `VITE_*`). By design, but rotate after first run | Document |
| Info | Auth | Email-enumeration possible via Firebase error codes | Optional hardening |
| UX | Recurring | Recurring transactions don't auto-post; user must press "Add now" | Known |

## License

MIT — do whatever you like.
