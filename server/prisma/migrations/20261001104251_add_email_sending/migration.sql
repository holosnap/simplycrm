-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "signature_text" TEXT;

-- CreateTable
CREATE TABLE "email_threads" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT,
    "deal_id" TEXT,
    "subject" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "deal_id" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "author_id" TEXT,
    "ses_message_id" TEXT,
    "rfc822_message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "body_text" TEXT,
    "body_html" TEXT,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "email_message_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_threads_contact_id_idx" ON "email_threads"("contact_id");

-- CreateIndex
CREATE INDEX "email_threads_deal_id_idx" ON "email_threads"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_ses_message_id_key" ON "email_messages"("ses_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_rfc822_message_id_key" ON "email_messages"("rfc822_message_id");

-- CreateIndex
CREATE INDEX "email_messages_status_next_attempt_at_idx" ON "email_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
