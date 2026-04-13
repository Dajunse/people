-- CreateTable
CREATE TABLE "RewardSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "starsPerWeekTarget" INTEGER NOT NULL DEFAULT 5,
    "weeksRequiredPerRank" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "minRank" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Reward_isActive_minRank_idx" ON "Reward"("isActive", "minRank");
