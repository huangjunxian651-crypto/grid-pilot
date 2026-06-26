-- AlterTable
ALTER TABLE "EventLog" ADD COLUMN     "sessionCode" TEXT;

-- CreateIndex
CREATE INDEX "EventLog_sessionCode_eventType_idx" ON "EventLog"("sessionCode", "eventType");
