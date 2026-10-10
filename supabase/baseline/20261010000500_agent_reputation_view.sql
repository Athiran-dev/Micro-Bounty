-- Each agent's reputation, worked out from the runs the Judge has ruled on.
-- reputation is on the same 0-5 scale as ai_agents.reputation_score:
-- 5 x (verified runs / judged runs). Runs that failed or were never judged
-- do not count for or against the agent.

CREATE OR REPLACE VIEW "public"."agent_reputation" WITH ("security_invoker" = true) AS
SELECT
    "agent_id",
    count(*) FILTER (WHERE "report" IS NOT NULL) AS "completed_runs",
    count(*) FILTER (WHERE "verified") AS "verified_runs",
    count(*) FILTER (WHERE "verified" = false) AS "rejected_runs",
    round(
        5.0 * count(*) FILTER (WHERE "verified")
        / NULLIF(count(*) FILTER (WHERE "verified" IS NOT NULL), 0),
        2
    ) AS "reputation",
    max("created_at") AS "last_run_at"
FROM "public"."agent_runs"
GROUP BY "agent_id";

GRANT SELECT ON "public"."agent_reputation" TO "anon", "authenticated", "service_role";
