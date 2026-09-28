const fs = require('fs');
const path = require('path');

for (const f of ['.env', path.join('..', '..', '.env')]) {
  const full = path.resolve(f);
  if (!fs.existsSync(full)) {
    console.log(full + ': missing');
    continue;
  }
  const t = fs.readFileSync(full, 'utf8');
  console.log('--- ' + full);
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(
      /^(DATABASE_URL|DIRECT_URL|DATABASE_URL_UNPOOLED|DB_ENV|PROD_DB_HOST|NEON_BRANCH)=(.*)$/,
    );
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (m[1].includes('URL')) {
      try {
        const u = new URL(v.replace(/^postgresql:/i, 'http:'));
        console.log(m[1] + ' host=' + u.hostname);
      } catch {
        console.log(m[1] + ' host=(unparseable)');
      }
    } else {
      console.log(m[1] + '=' + v);
    }
  }
}
