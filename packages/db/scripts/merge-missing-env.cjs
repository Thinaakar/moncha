const fs = require('fs');
const path = require('path');

const rootPath = path.resolve(__dirname, '../../../.env');
const examplePath = path.resolve(__dirname, '../../../.env.example');

function parseKeys(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    map.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
  }
  return map;
}

const rootText = fs.readFileSync(rootPath, 'utf8');
const exampleText = fs.readFileSync(examplePath, 'utf8');
const root = parseKeys(rootText);
const example = parseKeys(exampleText);

const missing = [...example.keys()].filter((k) => !root.has(k));
if (!missing.length) {
  console.log('Root .env already has every .env.example key.');
  process.exit(0);
}

const block = [
  '',
  '# --- Added from .env.example (optional / not set yet) ---',
  ...missing.map((k) => `${k}=${example.get(k)}`),
  '',
].join('\n');

fs.writeFileSync(rootPath, rootText.replace(/\s*$/, '') + '\n' + block, 'utf8');
console.log('Appended to root .env:', missing.join(', '));
