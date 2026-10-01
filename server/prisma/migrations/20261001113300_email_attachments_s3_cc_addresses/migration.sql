/*
  Warnings:

  - You are about to drop the column `content_type` on the `email_attachments` table. All the data in the column will be lost.
  - You are about to drop the column `data` on the `email_attachments` table. All the data in the column will be lost.
  - Added the required column `declared_content_type` to the `email_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `s3_key` to the `email_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size_bytes` to the `email_attachments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "email_attachments" DROP COLUMN "content_type",
DROP COLUMN "data",
ADD COLUMN     "declared_content_type" TEXT NOT NULL,
ADD COLUMN     "detected_content_type" TEXT,
ADD COLUMN     "s3_key" TEXT NOT NULL,
ADD COLUMN     "size_bytes" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "cc_addresses" TEXT[];
