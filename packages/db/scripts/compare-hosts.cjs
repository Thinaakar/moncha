const fs = require('fs');

function host(file, key) {
  const t = fs.readFileSync(file, 'utf8');
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    if (s.slice(0, i).trim() !== key) continue;
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    try {
      return new URL(v.replace(/^postgresql:/i, 'http:')).hostname;
    } catch {
      return '(bad)';
    }
  }
  return '(missing)';
}

console.log('db/.env DATABASE_URL', host('.env', 'DATABASE_URL'));
console.log('root DATABASE_URL', host('../../.env', 'DATABASE_URL'));
console.log('root DIRECT_URL', host('../../.env', 'DIRECT_URL'));
