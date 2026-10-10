-- One row per paid agent run. The qa-agent Edge Function inserts the row when it
-- accepts a payment (task_id is the on-chain lock_ai_payment task, usable once)
-- and fills in score and report when the run finishes.

CREATE TABLE IF NOT EXISTS "public"."agent_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" bigint NOT NULL,
    "task_id" bigint NOT NULL,
    "user_wallet" "text" NOT NULL,
    "url" "text" NOT NULL,
    "score" integer,
    "verified" boolean,
    "report" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_runs_task_id_key" UNIQUE ("task_id"),
    CONSTRAINT "agent_runs_score_check" CHECK (("score" >= 0) AND ("score" <= 100))
);

CREATE INDEX IF NOT EXISTS "agent_runs_agent_id_idx" ON "public"."agent_runs" ("agent_id");

ALTER TABLE "public"."agent_runs" ENABLE ROW LEVEL SECURITY;

-- Public read. No write policies: only the service role, which bypasses RLS, can write.
CREATE POLICY "agent_runs_select_public" ON "public"."agent_runs" FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."agent_runs" FROM "anon", "authenticated";
GRANT SELECT ON "public"."agent_runs" TO "anon", "authenticated";
GRANT ALL ON "public"."agent_runs" TO "service_role";
