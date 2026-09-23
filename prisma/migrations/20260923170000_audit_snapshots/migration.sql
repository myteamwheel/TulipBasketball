CREATE TABLE IF NOT EXISTS "AuditSnapshot" (
  id text PRIMARY KEY,
  "snapshotDate" date NOT NULL,
  "refreshRunId" text,
  "generatedAt" timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'VALIDATED',
  data jsonb NOT NULL,
  "changeSummary" jsonb NOT NULL,
  "modelVersion" text NOT NULL DEFAULT 'orlando-audit-v1'
);

CREATE INDEX IF NOT EXISTS "AuditSnapshot_generatedAt_idx"
  ON "AuditSnapshot" ("generatedAt" DESC);

ALTER TABLE "AuditSnapshot" DROP CONSTRAINT IF EXISTS "AuditSnapshot_snapshotDate_key";
