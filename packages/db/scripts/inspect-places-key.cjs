const fs = require('fs');
const path = require('path');

function inspect(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.log(full + ': missing');
    return;
  }
  console.log('--- ' + full);
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    if (!/GOOGLE|PLACES|MAPS/i.test(k)) continue;
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    console.log(
      k +
        ' present=' +
        String(v.length > 0) +
        ' len=' +
        v.length +
        ' has_space=' +
        String(/\s/.test(v)) +
        ' quoted_empty=' +
        String(v === '""' || v === "''"),
    );
  }
}

inspect(path.join(__dirname, '../../../.env'));
inspect(path.join(__dirname, '../../../.env.local'));
inspect(path.join(__dirname, '../../../apps/console/.env'));
inspect(path.join(__dirname, '../../../apps/console/.env.local'));
inspect(path.join(__dirname, '../.env'));
