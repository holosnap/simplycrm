-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "imap_folder" TEXT,
ADD COLUMN     "imap_uid" BIGINT;

-- CreateTable
CREATE TABLE "imap_folder_state" (
    "id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uid_validity" BIGINT NOT NULL,
    "last_seen_uid" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imap_folder_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imap_folder_state_folder_key" ON "imap_folder_state"("folder");
