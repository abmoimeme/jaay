# Jaay PAH: iPhone and Android app

The Jaay web app packaged with Capacitor 8 for Planet Auto Hub staff. Publisher: Nioro Resources LLC.
App id `com.niororesources.jaay.pah`. The store is fixed to `pah`; nobody can create a store from the app.

## Build
```
cd mobile
npm install
npm run sync        # builds www/ (all code and fonts inside the package) and copies it to ios/ and android/
python3 assets.py   # only after re-creating ios/ or android/: icon and launch screen
```
- Android: open `android/` in Android Studio → Build → Generate Signed App Bundle (.aab). Target API 36.
- iPhone: open `ios/App/App.xcodeproj` in Xcode 26 or later on a Mac → set the Nioro Resources team → Product → Archive.
- Raise `versionCode` / build number for every upload.

## What differs from the website
- Firebase, PDF, Excel, barcode code and fonts are inside the package (no code downloaded at run time).
- `config.js` gets `lockStore: 'pah'` and `app: true`.
- Files (PDF, CSV, backup) go to the share sheet instead of a browser download.
- The guide's Print button is hidden (use Share → Print on a PDF).

## Never commit
Signing keys (`*.jks`, `*.keystore`, `*.p8`, `*.p12`, provisioning profiles). They are in `.gitignore`.

## Email worker
Add `capacitor://localhost` and `https://localhost` to the worker's `ALLOWED_ORIGINS` so Campaigns works in the app.
