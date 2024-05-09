-- CreateTable
CREATE TABLE "VideoConvert" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "model" TEXT,
    "title" TEXT,
    "videoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoConvert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoConvert_deviceId_key" ON "VideoConvert"("deviceId");
