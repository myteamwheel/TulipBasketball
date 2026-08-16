-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('MAPPED', 'NEEDS_REVIEW', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "RosterSlot" AS ENUM ('STARTER', 'BENCH', 'TAXI', 'IR');

-- CreateEnum
CREATE TYPE "KtcSourceType" AS ENUM ('SEED_BASELINE', 'MANUAL_CSV', 'MANUAL_JSON');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RefreshStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('SELL_HIGH', 'HOLD', 'BUY_LOW', 'CUT_BAIT', 'WATCH');

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "sleeperId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "settings" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manager" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "sleeperUserId" TEXT NOT NULL,
    "sleeperRosterId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "teamName" TEXT,
    "isPrimaryTeam" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "sleeperId" TEXT NOT NULL,
    "ktcId" TEXT,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "nflTeam" TEXT,
    "status" TEXT,
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "mappingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipInterval" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "sourceTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnershipInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterSnapshot" (
    "id" TEXT NOT NULL,
    "refreshRunId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" "RosterSlot" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KtcObservation" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'SF-0.5PPR-noTEP',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceType" "KtcSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "importBatchId" TEXT,
    "refreshRunId" TEXT,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'VALID',
    "validationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KtcObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "sleeperTransactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sleeperCreatedAt" TIMESTAMP(3) NOT NULL,
    "rosterIdsInvolved" TEXT NOT NULL,
    "adds" TEXT,
    "drops" TEXT,
    "draftPicks" TEXT,
    "waiverBudget" TEXT,
    "rawPayload" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshRun" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RefreshStatus" NOT NULL DEFAULT 'RUNNING',
    "requestedSources" TEXT NOT NULL,
    "sleeperSyncOk" BOOLEAN,
    "ktcSyncOk" BOOLEAN,
    "rosterChangesCount" INTEGER NOT NULL DEFAULT 0,
    "playersRefreshed" INTEGER NOT NULL DEFAULT 0,
    "mappingWarnings" TEXT,
    "errors" TEXT,
    "summary" TEXT,

    CONSTRAINT "RefreshRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "refreshRunId" TEXT NOT NULL,
    "signal" "SignalType" NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "reasonCodes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNote" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "League_sleeperId_key" ON "League"("sleeperId");

-- CreateIndex
CREATE INDEX "Manager_leagueId_sleeperUserId_idx" ON "Manager"("leagueId", "sleeperUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Manager_leagueId_sleeperRosterId_key" ON "Manager"("leagueId", "sleeperRosterId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_sleeperId_key" ON "Player"("sleeperId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_ktcId_key" ON "Player"("ktcId");

-- CreateIndex
CREATE INDEX "Player_normalizedName_idx" ON "Player"("normalizedName");

-- CreateIndex
CREATE INDEX "Player_position_idx" ON "Player"("position");

-- CreateIndex
CREATE INDEX "OwnershipInterval_playerId_validFrom_idx" ON "OwnershipInterval"("playerId", "validFrom");

-- CreateIndex
CREATE INDEX "OwnershipInterval_managerId_validFrom_idx" ON "OwnershipInterval"("managerId", "validFrom");

-- CreateIndex
CREATE INDEX "RosterSnapshot_refreshRunId_managerId_idx" ON "RosterSnapshot"("refreshRunId", "managerId");

-- CreateIndex
CREATE INDEX "RosterSnapshot_playerId_observedAt_idx" ON "RosterSnapshot"("playerId", "observedAt");

-- CreateIndex
CREATE INDEX "KtcObservation_playerId_observedAt_idx" ON "KtcObservation"("playerId", "observedAt");

-- CreateIndex
CREATE INDEX "KtcObservation_importBatchId_idx" ON "KtcObservation"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sleeperTransactionId_key" ON "Transaction"("sleeperTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_leagueId_sleeperCreatedAt_idx" ON "Transaction"("leagueId", "sleeperCreatedAt");

-- CreateIndex
CREATE INDEX "RefreshRun_leagueId_startedAt_idx" ON "RefreshRun"("leagueId", "startedAt");

-- CreateIndex
CREATE INDEX "Signal_playerId_createdAt_idx" ON "Signal"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "Signal_refreshRunId_idx" ON "Signal"("refreshRunId");

-- CreateIndex
CREATE INDEX "UserNote_playerId_idx" ON "UserNote"("playerId");

-- AddForeignKey
ALTER TABLE "Manager" ADD CONSTRAINT "Manager_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipInterval" ADD CONSTRAINT "OwnershipInterval_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipInterval" ADD CONSTRAINT "OwnershipInterval_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_refreshRunId_fkey" FOREIGN KEY ("refreshRunId") REFERENCES "RefreshRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KtcObservation" ADD CONSTRAINT "KtcObservation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshRun" ADD CONSTRAINT "RefreshRun_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNote" ADD CONSTRAINT "UserNote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
