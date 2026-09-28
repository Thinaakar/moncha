const fs = require('fs');

function host(url) {
  try {
    return new URL(url.replace(/^postgresql:/i, 'http:')).hostname;
  } catch {
    return '(bad)';
  }
}

function parse(file) {
  const t = fs.readFileSync(file, 'utf8');
  const lines = t.split(/\r?\n/);
  const keys = [];
  const hosts = {};
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    keys.push(k);
    if (k === 'DATABASE_URL' || k === 'DIRECT_URL') hosts[k] = host(v);
  }
  return { lines: lines.length, keys, hosts };
}

const root = parse('../../.env');
const db = parse('.env');
console.log('root .env: lines=' + root.lines + ' keys=' + root.keys.length);
console.log('  keys: ' + root.keys.join(', '));
console.log('  hosts:', JSON.stringify(root.hosts));
console.log('packages/db/.env: lines=' + db.lines + ' keys=' + db.keys.length);
console.log('  keys: ' + db.keys.join(', '));
console.log('  hosts:', JSON.stringify(db.hosts));
