-- Pages and images found on the submitted URL before the agent runs, with the
-- HTTP status of each (qa-agent page discovery). Saved as soon as it is known
-- so a resumed run does not have to repeat it.
ALTER TABLE "public"."agent_runs" ADD COLUMN IF NOT EXISTS "discovery" "jsonb";
