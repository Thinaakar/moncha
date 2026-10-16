-- Worker-wide drain pause: in-flight pipeline work finishes; new bots/copies/publishes wait.
-- Discovery schedules are unaffected.
CREATE TABLE IF NOT EXISTS "WorkerSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "queuePaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "pausedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkerSettings" ("id", "queuePaused", "updatedAt")
VALUES ('default', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
