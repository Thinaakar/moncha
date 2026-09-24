const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'prisma/migrations/20260924103000_phase2_audit_queue/migration.sql');

const result = spawnSync(
  'npx',
  ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  { cwd: root, encoding: 'utf8', shell: true },
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const extra = `
-- Partial unique: one open review task per lead
CREATE UNIQUE INDEX "review_task_one_open_per_lead"
ON "ReviewTask" ("tenantId", "leadId")
WHERE status = 'open';

CREATE OR REPLACE FUNCTION moncha_forbid_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WebsiteAudit is immutable: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER website_audit_immutable_update
BEFORE UPDATE ON "WebsiteAudit"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_audit_mutation();

CREATE TRIGGER website_audit_immutable_delete
BEFORE DELETE ON "WebsiteAudit"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_audit_mutation();

CREATE OR REPLACE FUNCTION moncha_forbid_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EvidenceItem is immutable: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_item_immutable_update
BEFORE UPDATE ON "EvidenceItem"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_evidence_mutation();

CREATE TRIGGER evidence_item_immutable_delete
BEFORE DELETE ON "EvidenceItem"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_evidence_mutation();
`;

fs.writeFileSync(out, `${result.stdout.trimEnd()}\n${extra}`, { encoding: 'utf8' });
const buf = fs.readFileSync(out);
console.log('wrote', out, 'bytes', buf.length, 'utf16?', buf[0] === 0xff, 'nulls', buf.includes(0));
