// Builds mobile/www: the Jaay web app with every script and font inside the package (app stores do not
// accept apps that download their code), locked to one store. Run: npm run build
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'), out = path.resolve(import.meta.dirname, 'www');
const STORE = process.env.JAAY_STORE || 'pah';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out + '/vendor', { recursive: true });
for(const d of ['brand', 'logos', 'templates']) if(fs.existsSync(root + '/' + d)) fs.cpSync(root + '/' + d, out + '/' + d, { recursive: true });
fs.copyFileSync(root + '/manifest.webmanifest', out + '/manifest.webmanifest');

// Firebase comes from the npm package instead of gstatic.com.
const gstatic = { name: 'gstatic', setup(b){ b.onResolve({ filter: /^https:\/\/www\.gstatic\.com\/firebasejs\// }, a => {
  const m = /firebase-([a-z-]+)\.js$/.exec(a.path); return b.resolve('firebase/' + m[1], { resolveDir: import.meta.dirname, kind: 'import-statement' }); }); } };
await build({ entryPoints: [root + '/backend.js'], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: out + '/backend.js', plugins: [gstatic], logLevel: 'warning' });

const nm = p => path.resolve(import.meta.dirname, 'node_modules', p);
fs.copyFileSync(nm('jspdf/dist/jspdf.umd.min.js'), out + '/vendor/jspdf.umd.min.js');
fs.copyFileSync(nm('xlsx/dist/xlsx.full.min.js'), out + '/vendor/xlsx.full.min.js');
fs.copyFileSync(nm('jsbarcode/dist/JsBarcode.all.min.js'), out + '/vendor/JsBarcode.all.min.js');

fs.writeFileSync(out + '/fonts-entry.css', ['barlow/400', 'barlow/500', 'barlow/600', 'barlow/700', 'sora/700'].map(f => '@import "@fontsource/' + f + '.css";').join('\n'));
await build({ entryPoints: [out + '/fonts-entry.css'], bundle: true, minify: true, outfile: out + '/vendor/fonts.css', loader: { '.woff': 'file', '.woff2': 'file' }, assetNames: 'fonts/[name]', nodePaths: [nm('')], logLevel: 'warning' });
fs.rmSync(out + '/fonts-entry.css');

// config.js: same Firebase project, store fixed.
let cfg = fs.readFileSync(root + '/config.js', 'utf8');
if(!/defaultStore:/.test(cfg)) throw new Error('config.js: defaultStore not found');
cfg = cfg.replace(/defaultStore:\s*'[^']*',/, "defaultStore: '" + STORE + "',\n  lockStore: '" + STORE + "',\n  app: true,");
fs.writeFileSync(out + '/config.js', cfg);

let html = fs.readFileSync(root + '/index.html', 'utf8');
const swap = (re, to) => { if(!re.test(html)) throw new Error('index.html: expected ' + re); html = html.replace(re, to); };
swap(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n/, '');
swap(/<link href="https:\/\/fonts\.googleapis\.com[^"]*" rel="stylesheet">/, '<link href="vendor/fonts.css" rel="stylesheet">');
swap(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]*/, 'vendor/jspdf.umd.min.js');
swap(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/[^"]*/, 'vendor/xlsx.full.min.js');
swap(/https:\/\/cdn\.jsdelivr\.net\/npm\/jsbarcode[^"]*/, 'vendor/JsBarcode.all.min.js');
const left = html.match(/<(script|link)[^>]+(src|href)="https?:[^"]*"/g);
if(left) throw new Error('Still loaded from the internet: ' + left.join(' | '));
fs.writeFileSync(out + '/index.html', html);
console.log('Built', out, 'for store', STORE);
