-- AlterTable
ALTER TABLE "Robot" ADD COLUMN     "lastEntryPrice" DOUBLE PRECISION,
ADD COLUMN     "lastPositionQty" DOUBLE PRECISION,
ADD COLUMN     "lastSnapshotAt" TIMESTAMP(3),
ADD COLUMN     "lastUnrealizedPnl" DOUBLE PRECISION,
ADD COLUMN     "stopStage" TEXT,
ADD COLUMN     "stopWarning" TEXT;
