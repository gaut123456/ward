// Génère site/index.html : la page vitrine embarque le vrai widget (renderer/)
// branché sur un faux client League, pour une démo jouable dans le navigateur.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const between = (text, start, end, file) => {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`${file} : repère introuvable (${start} … ${end})`);
  return text.slice(from + start.length, to);
};
const swap = (text, before, after, file) => {
  if (!text.includes(before)) throw new Error(`${file} a changé : « ${before} » introuvable, mets à jour build-site.cjs`);
  return text.split(before).join(after);
};
// Sérialise une valeur en littéral JS sûr à placer dans une balise <script>.
const literal = value => JSON.stringify(value).replace(/<\//g, '<\\/');

const icons = {};
for (const name of ['top', 'jungle', 'middle', 'bottom', 'utility', 'fill', 'unselected']) {
  icons[name] = `data:image/png;base64,${fs.readFileSync(path.join(root, 'renderer/assets/roles', `${name}.png`)).toString('base64')}`;
}

let widgetHtml = between(read('renderer/index.html'), '<body class="widget-body">', '<script src="app.js">', 'renderer/index.html');
widgetHtml = widgetHtml.split('src="assets/roles/unselected.png"').join(`src="${icons.unselected}"`);
const readyHtml = between(read('renderer/ready.html'), '<body class="ready-body">', '<script src="ready.js">', 'renderer/ready.html');

let css = read('renderer/styles.css');
css = swap(css, ':root {', ':host {', 'renderer/styles.css');
css = css.split('100vh').join('100%');

let app = read('renderer/app.js');
app = swap(app, 'const $ = id => document.getElementById(id);', 'const $ = id => ROOT.getElementById(id);', 'renderer/app.js');
app = swap(app, "document.querySelector('.widget')", "ROOT.querySelector('.widget')", 'renderer/app.js');
app = app.replace(/`assets\/roles\/\$\{(.+?)\}\.png`/g, 'ROLE_ICON($1)');
if (app.includes('assets/roles')) throw new Error('renderer/app.js : chemin d\'icône non converti');
app = swap(app, 'window.league', 'LEAGUE', 'renderer/app.js');

let ready = read('renderer/ready.js');
ready = swap(ready, 'document.querySelector(', 'ROOT.querySelector(', 'renderer/ready.js');
ready = swap(ready, 'window.league', 'LEAGUE', 'renderer/ready.js');
if (/\bdocument\.(getElementById|querySelector)/.test(app + ready)) throw new Error('Accès au document global restant dans le code du widget');

let page = read('site/landing.template.html');
const slots = {
  '/*{{ICONS}}*/': literal(icons),
  '/*{{WIDGET_HTML}}*/': literal(widgetHtml),
  '/*{{READY_HTML}}*/': literal(readyHtml),
  '/*{{WIDGET_CSS}}*/': literal(css),
  '/*{{APP_JS}}*/': app.replace(/<\//g, '<\\/'),
  '/*{{READY_JS}}*/': ready.replace(/<\//g, '<\\/')
};
for (const [slot, value] of Object.entries(slots)) page = swap(page, slot, value, 'site/landing.template.html');
for (const [name, uri] of Object.entries(icons)) page = page.split(`{{${name}}}`).join(uri);
if (/\{\{\w+\}\}/.test(page)) throw new Error('Emplacement non rempli dans site/landing.template.html');

fs.writeFileSync(path.join(root, 'site/index.html'), page);
console.log(`site/index.html généré (${Math.round(page.length / 1024)} Ko)`);
