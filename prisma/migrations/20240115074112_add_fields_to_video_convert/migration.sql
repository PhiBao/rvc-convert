/*
  Warnings:

  - You are about to drop the column `output` on the `VideoConvert` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "VideoConvert" DROP COLUMN "output",
ADD COLUMN     "cancelUrl" TEXT,
ADD COLUMN     "status" TEXT;
