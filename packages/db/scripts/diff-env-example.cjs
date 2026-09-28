const fs = require('fs');
const path = require('path');

function keysOf(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return { full, keys: new Set() };
  const keys = new Set();
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    keys.add(s.slice(0, i).trim());
  }
  return { full, keys };
}

const root = keysOf('../../.env');
const example = keysOf('../../.env.example');
console.log('root keys:', [...root.keys].sort().join(', '));
console.log('example keys:', [...example.keys].sort().join(', '));
console.log(
  'in example missing from root:',
  [...example.keys].filter((k) => !root.keys.has(k)).sort().join(', ') || '(none)',
);
console.log(
  'in root missing from example:',
  [...root.keys].filter((k) => !example.keys.has(k)).sort().join(', ') || '(none)',
);
