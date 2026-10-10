-- Storage bucket used by ImageUpload.tsx for agent images.
-- Same configuration and policies as the previous MicroBounty project:
-- public bucket, no size or MIME limits, anyone may read, upload and update.

INSERT INTO "storage"."buckets" ("id", "name", "public")
VALUES ('agent-assets', 'agent-assets', true)
ON CONFLICT ("id") DO NOTHING;

CREATE POLICY "Public Access" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'agent-assets'::"text"));

CREATE POLICY "Allow Wallet Upload" ON "storage"."objects" FOR INSERT WITH CHECK (("bucket_id" = 'agent-assets'::"text"));

CREATE POLICY "Allow Wallet Update" ON "storage"."objects" FOR UPDATE USING (("bucket_id" = 'agent-assets'::"text"));
