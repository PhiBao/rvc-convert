/*
  Warnings:

  - You are about to drop the column `model` on the `VideoConvert` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "VideoConvert" DROP COLUMN "model",
ADD COLUMN     "output" TEXT;
