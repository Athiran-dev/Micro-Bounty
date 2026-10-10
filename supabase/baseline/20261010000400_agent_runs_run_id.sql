-- TinyFish run id, saved when the run starts so a run that outlives one
-- Edge Function connection can be picked up again (qa-agent resume).
ALTER TABLE "public"."agent_runs" ADD COLUMN IF NOT EXISTS "run_id" "text";
