const fs = require('fs');
const path = require('path');

function hosts(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.log(full + ': MISSING');
    return;
  }
  console.log('--- ' + full);
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
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
    if (k.includes('URL')) {
      try {
        console.log(k, 'host=' + new URL(v.replace(/^postgresql:/i, 'http:')).hostname);
      } catch {
        console.log(k, 'host=(bad)');
      }
    } else if (/DB_|NEON|PROD|GOOGLE|SESSION|TENANT|OPENROUTER|WORKER|LLM|APP_URL/.test(k)) {
      console.log(k, 'set=' + String(v.length > 0), 'len=' + v.length);
    }
  }
}

hosts(path.join(__dirname, '../../../.env'));
hosts(path.join(__dirname, '../.env'));
