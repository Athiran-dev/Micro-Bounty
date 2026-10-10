-- Baseline schema for the new "Micro-Bounty" Supabase project.
-- Schema-only dump (tables, functions, triggers, RLS policies, realtime publication, grants)
-- of the previous MicroBounty project, taken 2026-10-10. Contains no data.
-- Supersedes supabase/migrations/001-008 for fresh projects.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assign_validators"("p_dispute_id" "uuid", "p_bounty_id" bigint, "p_required_skills" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_creator_wallet         text;
  v_disputed_hunter_wallet text;
  v_validator              record;
  v_weight                 numeric;
  v_count                  integer := 0;
BEGIN
  -- Get dispute parties to exclude them
  SELECT creator_wallet, disputed_hunter_wallet
    INTO v_creator_wallet, v_disputed_hunter_wallet
    FROM public.disputes
   WHERE id = p_dispute_id;

  -- Loop through top 5 eligible validators
  FOR v_validator IN
    SELECT v.wallet_address, v.reputation_score
      FROM public.validators v
     WHERE v.is_active = true
       AND v.wallet_address != v_creator_wallet
       AND v.wallet_address != v_disputed_hunter_wallet
       AND v.skills && p_required_skills   -- overlaps operator
     ORDER BY v.reputation_score DESC
     LIMIT 5
  LOOP
    -- Calculate vote weight based on reputation tier
    IF v_validator.reputation_score < 1.2 THEN
      v_weight := 1.0;
    ELSIF v_validator.reputation_score <= 2.0 THEN
      v_weight := 1.5;
    ELSE
      v_weight := 2.0;
    END IF;

    INSERT INTO public.validator_assignments
      (dispute_id, bounty_id, validator_wallet, reputation_score, vote_weight)
    VALUES
      (p_dispute_id, p_bounty_id, v_validator.wallet_address, v_validator.reputation_score, v_weight);

    v_count := v_count + 1;
  END LOOP;

  -- Move dispute to voting phase
  UPDATE public.disputes
     SET status = 'voting'
   WHERE id = p_dispute_id;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."assign_validators"("p_dispute_id" "uuid", "p_bounty_id" bigint, "p_required_skills" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_verdict"("p_dispute_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_innocent_weight   numeric := 0;
  v_fraud_weight      numeric := 0;
  v_hunter_wins       boolean;
  v_majority_vote     boolean;
  v_assignment        record;
  v_new_reputation    numeric;
BEGIN
  -- Tally weighted votes
  SELECT
    COALESCE(SUM(CASE WHEN vote = true  THEN vote_weight ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vote = false THEN vote_weight ELSE 0 END), 0)
  INTO v_innocent_weight, v_fraud_weight
  FROM public.validator_assignments
  WHERE dispute_id = p_dispute_id;

  -- Determine winner
  v_hunter_wins   := (v_innocent_weight > v_fraud_weight);
  v_majority_vote := v_hunter_wins;  -- true = innocent won, false = fraud won

  -- Resolve the dispute
  UPDATE public.disputes
     SET status      = CASE WHEN v_hunter_wins THEN 'resolved_hunter_wins' ELSE 'resolved_client_wins' END,
         resolved_at = now()
   WHERE id = p_dispute_id;

  -- Update each validator's reputation based on whether they voted with majority
  FOR v_assignment IN
    SELECT va.id, va.validator_wallet, va.vote
      FROM public.validator_assignments va
     WHERE va.dispute_id = p_dispute_id
  LOOP
    -- Always increment total_votes
    UPDATE public.validators
       SET total_votes    = total_votes + 1,
           last_voted_at  = now()
     WHERE wallet_address = v_assignment.validator_wallet;

    -- Reward correct votes, penalise incorrect
    IF v_assignment.vote = v_majority_vote THEN
      UPDATE public.validators
         SET correct_votes    = correct_votes + 1,
             reputation_score = reputation_score + 0.1
       WHERE wallet_address = v_assignment.validator_wallet;
    ELSE
      -- Clamp minimum to 0.5
      SELECT GREATEST(0.5, reputation_score - 0.05)
        INTO v_new_reputation
        FROM public.validators
       WHERE wallet_address = v_assignment.validator_wallet;

      UPDATE public.validators
         SET reputation_score = v_new_reputation
       WHERE wallet_address = v_assignment.validator_wallet;
    END IF;
  END LOOP;

  RETURN v_hunter_wins;
END;
$$;


ALTER FUNCTION "public"."calculate_verdict"("p_dispute_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_bounty_data"("p_bounty_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Messages cascade via bounty_rooms FK
  DELETE FROM public.bounty_rooms WHERE bounty_id = p_bounty_id;

  -- Delete applications
  DELETE FROM public.applications WHERE bounty_id = p_bounty_id;

  -- Delete submissions
  DELETE FROM public.submissions WHERE bounty_id = p_bounty_id;

  -- Delete scheduled deletion entry
  DELETE FROM public.scheduled_deletions WHERE bounty_id = p_bounty_id;

  -- Delete the bounty itself
  DELETE FROM public.bounties WHERE bounty_id = p_bounty_id;
END;
$$;


ALTER FUNCTION "public"."cleanup_bounty_data"("p_bounty_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_submissions_for_viewer"("p_bounty_id" bigint, "p_viewer_wallet" "text") RETURNS TABLE("id" "uuid", "bounty_id" bigint, "hunter_wallet" "text", "deploy_link" "text", "github_link" "text", "starter_files_url" "text", "work_description" "text", "submitted_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bounty_status text;
  v_is_creator boolean;
BEGIN
  -- Get bounty status
  SELECT b.status INTO v_bounty_status
  FROM public.bounties b
  WHERE b.bounty_id = p_bounty_id;

  -- Check if viewer is the creator
  SELECT EXISTS(
    SELECT 1 FROM public.bounties b
    WHERE b.bounty_id = p_bounty_id
    AND b.creator_wallet = p_viewer_wallet
  ) INTO v_is_creator;

  RETURN QUERY
  SELECT
    s.id,
    s.bounty_id,
    s.hunter_wallet,
    s.deploy_link,  -- ALWAYS visible
    -- github_link: hunter sees own, creator sees after paid
    CASE
      WHEN s.hunter_wallet = p_viewer_wallet THEN s.github_link
      WHEN v_is_creator AND v_bounty_status = 'paid' THEN s.github_link
      ELSE NULL
    END AS github_link,
    -- starter_files_url: same logic
    CASE
      WHEN s.hunter_wallet = p_viewer_wallet THEN s.starter_files_url
      WHEN v_is_creator AND v_bounty_status = 'paid' THEN s.starter_files_url
      ELSE NULL
    END AS starter_files_url,
    -- work_description: same logic
    CASE
      WHEN s.hunter_wallet = p_viewer_wallet THEN s.work_description
      WHEN v_is_creator AND v_bounty_status = 'paid' THEN s.work_description
      ELSE NULL
    END AS work_description,
    s.submitted_at
  FROM public.submissions s
  WHERE s.bounty_id = p_bounty_id
  AND (
    s.hunter_wallet = p_viewer_wallet
    OR v_is_creator
  )
  ORDER BY s.submitted_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_submissions_for_viewer"("p_bounty_id" bigint, "p_viewer_wallet" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_wallet"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (current_setting('request.headers', true)::json->>'x-wallet-address'),
    ''
  );
$$;


ALTER FUNCTION "public"."get_wallet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_bounty_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('paid', 'refunded')
     AND (OLD.status IS NULL OR OLD.status != NEW.status) THEN
    INSERT INTO public.scheduled_deletions (bounty_id, delete_after)
    VALUES (NEW.bounty_id, now() + interval '24 hours')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."on_bounty_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_scheduled_deletions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  deleted_count integer := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT sd.bounty_id
    FROM public.scheduled_deletions sd
    WHERE sd.delete_after <= now()
  LOOP
    PERFORM public.cleanup_bounty_data(rec.bounty_id);
    deleted_count := deleted_count + 1;
  END LOOP;

  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."process_scheduled_deletions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_winners_after_dispute"("p_bounty_id" bigint, "p_disputed_rank" smallint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_winner      record;
  v_max_rank    smallint;
  v_creator_wallet text;
BEGIN
  -- Mark the disputed winner as removed
  UPDATE public.winners
     SET status = 'removed'
   WHERE bounty_id = p_bounty_id
     AND rank = p_disputed_rank;

  -- Promote each winner with rank > disputed_rank
  FOR v_winner IN
    SELECT id, rank
      FROM public.winners
     WHERE bounty_id = p_bounty_id
       AND rank > p_disputed_rank
     ORDER BY rank ASC
  LOOP
    UPDATE public.winners
       SET status = 'promoted',
           rank   = v_winner.rank - 1
     WHERE id = v_winner.id;
  END LOOP;

  -- Find the now-empty last rank slot
  SELECT MAX(rank) INTO v_max_rank
    FROM public.winners
   WHERE bounty_id = p_bounty_id;

  -- Record empty slot as refunded-to-client placeholder
  SELECT creator_wallet INTO v_creator_wallet
    FROM public.bounties
   WHERE bounty_id = p_bounty_id;

  INSERT INTO public.winners (bounty_id, rank, hunter_wallet, payout_percent, status)
  VALUES (
    p_bounty_id,
    COALESCE(v_max_rank, p_disputed_rank) + 1,
    v_creator_wallet,
    0,
    'refunded_to_client'
  );
END;
$$;


ALTER FUNCTION "public"."promote_winners_after_dispute"("p_bounty_id" bigint, "p_disputed_rank" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_reasoning" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_agent_id bigint;
BEGIN
  -- Get agent_id before update
  SELECT agent_id INTO v_agent_id
    FROM public.ai_tasks
   WHERE task_id = p_task_id;

  -- Update the task record
  UPDATE public.ai_tasks
     SET output_data     = p_output_data,
         judge_verdict   = p_judge_verdict,
         judge_reasoning = p_judge_reasoning,
         status          = CASE WHEN p_judge_verdict THEN 'judge_passed' ELSE 'judge_failed' END,
         completed_at    = now()
   WHERE task_id = p_task_id;

  -- Increment agent total_tasks
  UPDATE public.ai_agents
     SET total_tasks = total_tasks + 1
   WHERE agent_id = v_agent_id;

  -- Increment successful_tasks if judge approved
  IF p_judge_verdict = true THEN
    UPDATE public.ai_agents
       SET successful_tasks = successful_tasks + 1
     WHERE agent_id = v_agent_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_reasoning" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_confidence" numeric, "p_judge_reasoning" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_agent_id bigint;
BEGIN
  -- Get agent_id before update
  SELECT agent_id INTO v_agent_id
    FROM public.ai_tasks
   WHERE task_id = p_task_id;

  -- Update the task record
  UPDATE public.ai_tasks
     SET output_data      = p_output_data,
         judge_verdict    = p_judge_verdict,
         judge_confidence = p_judge_confidence,
         judge_reasoning  = p_judge_reasoning,
         status           = CASE WHEN p_judge_verdict THEN 'judge_passed' ELSE 'judge_failed' END,
         completed_at     = now()
   WHERE task_id = p_task_id;

  -- Increment agent total_tasks
  UPDATE public.ai_agents
     SET total_tasks = total_tasks + 1
   WHERE agent_id = v_agent_id;

  -- Increment successful_tasks if judge approved
  IF p_judge_verdict = true THEN
    UPDATE public.ai_agents
       SET successful_tasks = successful_tasks + 1
     WHERE agent_id = v_agent_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_confidence" numeric, "p_judge_reasoning" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_client_satisfaction"("p_task_id" bigint, "p_is_satisfied" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_agent_id       bigint;
  v_new_reputation numeric;
BEGIN
  -- Get agent_id
  SELECT agent_id INTO v_agent_id
    FROM public.ai_tasks
   WHERE task_id = p_task_id;

  -- Record client satisfaction on task
  UPDATE public.ai_tasks
     SET client_satisfaction = p_is_satisfied
   WHERE task_id = p_task_id;

  IF p_is_satisfied = false THEN
    -- Clamp minimum to 0
    SELECT GREATEST(0, reputation_score - 0.2)
      INTO v_new_reputation
      FROM public.ai_agents
     WHERE agent_id = v_agent_id;

    UPDATE public.ai_agents
       SET unsatisfied_count  = unsatisfied_count + 1,
           reputation_score   = v_new_reputation
     WHERE agent_id = v_agent_id;

  ELSIF p_is_satisfied = true THEN
    -- Clamp maximum to 10
    SELECT LEAST(10, reputation_score + 0.1)
      INTO v_new_reputation
      FROM public.ai_agents
     WHERE agent_id = v_agent_id;

    UPDATE public.ai_agents
       SET reputation_score = v_new_reputation
     WHERE agent_id = v_agent_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."record_client_satisfaction"("p_task_id" bigint, "p_is_satisfied" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_bounty_status"("p_bounty_id" bigint, "p_new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_creator_wallet text;
BEGIN
  -- Fetch the creator for authorisation check
  SELECT creator_wallet INTO v_creator_wallet
    FROM public.bounties
   WHERE bounty_id = p_bounty_id;

  -- Only creator wallet is allowed to call this (service_role bypasses RLS automatically)
  IF public.get_wallet() != '' AND public.get_wallet() != v_creator_wallet THEN
    RAISE EXCEPTION 'Unauthorized: only the bounty creator can update status';
  END IF;

  -- Update status
  UPDATE public.bounties
     SET status = p_new_status
   WHERE bounty_id = p_bounty_id;

  -- Schedule deletion 24h after terminal states
  IF p_new_status IN ('paid', 'refunded') THEN
    INSERT INTO public.scheduled_deletions (bounty_id, delete_after)
    VALUES (p_bounty_id, now() + interval '24 hours')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;


ALTER FUNCTION "public"."update_bounty_status"("p_bounty_id" bigint, "p_new_status" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" bigint NOT NULL,
    "developer_wallet" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "endpoint_url" "text" NOT NULL,
    "tech_tags" "text"[] NOT NULL,
    "category" "text" NOT NULL,
    "sample_inputs" "jsonb",
    "sample_outputs" "jsonb",
    "price_per_task_algo" numeric NOT NULL,
    "stake_amount_algo" numeric NOT NULL,
    "reputation_score" numeric DEFAULT 5.0,
    "total_tasks" integer DEFAULT 0,
    "successful_tasks" integer DEFAULT 0,
    "unsatisfied_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "registered_at" timestamp with time zone DEFAULT "now"(),
    "algo_txn_id" "text",
    "avatar_url" "text",
    "preview_images" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."ai_agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" bigint NOT NULL,
    "agent_id" bigint NOT NULL,
    "client_wallet" "text" NOT NULL,
    "input_type" "text" NOT NULL,
    "input_data" "jsonb" NOT NULL,
    "output_data" "jsonb",
    "judge_verdict" boolean,
    "judge_reasoning" "text",
    "client_satisfaction" boolean,
    "payment_amount_algo" numeric NOT NULL,
    "net_to_agent_algo" numeric NOT NULL,
    "platform_cut_algo" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "lock_txn_id" "text",
    "release_txn_id" "text",
    "refund_txn_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "judge_confidence" numeric DEFAULT 0,
    CONSTRAINT "ai_tasks_input_type_check" CHECK (("input_type" = ANY (ARRAY['text'::"text", 'image'::"text", 'video'::"text", 'file'::"text", 'mixed'::"text"]))),
    CONSTRAINT "ai_tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'judge_passed'::"text", 'judge_failed'::"text", 'paid'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."ai_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "hunter_wallet" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bounties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "creator_wallet" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "reward_algo" numeric NOT NULL,
    "max_applicants" integer NOT NULL,
    "payout_split" integer[] NOT NULL,
    "deadline" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "winner_count" smallint,
    "split_1" smallint,
    "split_2" smallint DEFAULT 0,
    "split_3" smallint DEFAULT 0,
    "net_reward_algo" numeric,
    "platform_fee_algo" numeric,
    "algo_app_id" bigint DEFAULT 761815545,
    "disputed_rank" smallint,
    CONSTRAINT "bounties_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'active'::"text", 'submitted'::"text", 'paid'::"text", 'refunded'::"text", 'disputed'::"text"])))
);


ALTER TABLE "public"."bounties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bounty_rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "creator_wallet" "text" NOT NULL,
    "hunter_wallets" "text"[] DEFAULT '{}'::"text"[],
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "bounty_rooms_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."bounty_rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."disputes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "disputed_rank" smallint NOT NULL,
    "disputed_hunter_wallet" "text" NOT NULL,
    "creator_wallet" "text" NOT NULL,
    "client_argument" "text" NOT NULL,
    "hunter_defence" "text",
    "status" "text" DEFAULT 'awaiting_defence'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "algo_txn_id" "text",
    CONSTRAINT "disputes_status_check" CHECK (("status" = ANY (ARRAY['awaiting_defence'::"text", 'voting'::"text", 'resolved_hunter_wins'::"text", 'resolved_client_wins'::"text"])))
);


ALTER TABLE "public"."disputes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "room_id" "uuid" NOT NULL,
    "sender_wallet" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_deletions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "delete_after" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."scheduled_deletions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "hunter_wallet" "text" NOT NULL,
    "deploy_link" "text" NOT NULL,
    "github_link" "text" NOT NULL,
    "starter_files_url" "text",
    "work_description" "text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "commit_hash" "text",
    "deploy_link_hash" "text",
    "submitted_at_round" bigint
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."validator_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dispute_id" "uuid" NOT NULL,
    "bounty_id" bigint NOT NULL,
    "validator_wallet" "text" NOT NULL,
    "reputation_score" numeric DEFAULT 1.0,
    "vote" boolean,
    "vote_weight" numeric DEFAULT 1.0,
    "voted_at" timestamp with time zone,
    "algo_txn_id" "text",
    "assigned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."validator_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."validators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wallet_address" "text" NOT NULL,
    "skills" "text"[] NOT NULL,
    "reputation_score" numeric DEFAULT 1.0,
    "total_votes" integer DEFAULT 0,
    "correct_votes" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "last_voted_at" timestamp with time zone
);


ALTER TABLE "public"."validators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."winners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bounty_id" bigint NOT NULL,
    "rank" smallint NOT NULL,
    "hunter_wallet" "text" NOT NULL,
    "payout_percent" smallint NOT NULL,
    "status" "text" DEFAULT 'pending_approval'::"text" NOT NULL,
    "set_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "winners_status_check" CHECK (("status" = ANY (ARRAY['pending_approval'::"text", 'approved'::"text", 'disputed'::"text", 'promoted'::"text", 'removed'::"text", 'refunded_to_client'::"text"])))
);


ALTER TABLE "public"."winners" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_agents"
    ADD CONSTRAINT "ai_agents_agent_id_key" UNIQUE ("agent_id");



ALTER TABLE ONLY "public"."ai_agents"
    ADD CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_tasks"
    ADD CONSTRAINT "ai_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_tasks"
    ADD CONSTRAINT "ai_tasks_task_id_key" UNIQUE ("task_id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_bounty_id_hunter_wallet_key" UNIQUE ("bounty_id", "hunter_wallet");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bounties"
    ADD CONSTRAINT "bounties_bounty_id_key" UNIQUE ("bounty_id");



ALTER TABLE ONLY "public"."bounties"
    ADD CONSTRAINT "bounties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bounty_rooms"
    ADD CONSTRAINT "bounty_rooms_bounty_id_key" UNIQUE ("bounty_id");



ALTER TABLE ONLY "public"."bounty_rooms"
    ADD CONSTRAINT "bounty_rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_deletions"
    ADD CONSTRAINT "scheduled_deletions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_bounty_id_hunter_wallet_key" UNIQUE ("bounty_id", "hunter_wallet");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."validator_assignments"
    ADD CONSTRAINT "validator_assignments_dispute_id_validator_wallet_key" UNIQUE ("dispute_id", "validator_wallet");



ALTER TABLE ONLY "public"."validator_assignments"
    ADD CONSTRAINT "validator_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."validators"
    ADD CONSTRAINT "validators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."validators"
    ADD CONSTRAINT "validators_wallet_address_key" UNIQUE ("wallet_address");



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_bounty_id_rank_key" UNIQUE ("bounty_id", "rank");



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_ai_agents_active" ON "public"."ai_agents" USING "btree" ("is_active");



CREATE INDEX "idx_ai_agents_dev" ON "public"."ai_agents" USING "btree" ("developer_wallet");



CREATE INDEX "idx_ai_agents_tags" ON "public"."ai_agents" USING "gin" ("tech_tags");



CREATE INDEX "idx_ai_tasks_agent" ON "public"."ai_tasks" USING "btree" ("agent_id");



CREATE INDEX "idx_ai_tasks_client" ON "public"."ai_tasks" USING "btree" ("client_wallet");



CREATE INDEX "idx_ai_tasks_status" ON "public"."ai_tasks" USING "btree" ("status");



CREATE INDEX "idx_applications_bounty" ON "public"."applications" USING "btree" ("bounty_id");



CREATE INDEX "idx_applications_hunter" ON "public"."applications" USING "btree" ("hunter_wallet");



CREATE INDEX "idx_bounties_creator" ON "public"."bounties" USING "btree" ("creator_wallet");



CREATE INDEX "idx_bounties_deadline" ON "public"."bounties" USING "btree" ("deadline");



CREATE INDEX "idx_bounties_status" ON "public"."bounties" USING "btree" ("status");



CREATE INDEX "idx_bounty_rooms_bounty" ON "public"."bounty_rooms" USING "btree" ("bounty_id");



CREATE INDEX "idx_disputes_bounty" ON "public"."disputes" USING "btree" ("bounty_id");



CREATE INDEX "idx_disputes_hunter" ON "public"."disputes" USING "btree" ("disputed_hunter_wallet");



CREATE INDEX "idx_disputes_status" ON "public"."disputes" USING "btree" ("status");



CREATE INDEX "idx_messages_created" ON "public"."messages" USING "btree" ("created_at");



CREATE INDEX "idx_messages_room" ON "public"."messages" USING "btree" ("room_id");



CREATE INDEX "idx_scheduled_del_after" ON "public"."scheduled_deletions" USING "btree" ("delete_after");



CREATE INDEX "idx_submissions_bounty" ON "public"."submissions" USING "btree" ("bounty_id");



CREATE INDEX "idx_submissions_hunter" ON "public"."submissions" USING "btree" ("hunter_wallet");



CREATE INDEX "idx_val_assign_dispute" ON "public"."validator_assignments" USING "btree" ("dispute_id");



CREATE INDEX "idx_val_assign_wallet" ON "public"."validator_assignments" USING "btree" ("validator_wallet");



CREATE INDEX "idx_validators_active" ON "public"."validators" USING "btree" ("is_active");



CREATE INDEX "idx_validators_wallet" ON "public"."validators" USING "btree" ("wallet_address");



CREATE INDEX "idx_winners_bounty" ON "public"."winners" USING "btree" ("bounty_id");



CREATE OR REPLACE TRIGGER "trg_bounty_status_change" AFTER UPDATE OF "status" ON "public"."bounties" FOR EACH ROW EXECUTE FUNCTION "public"."on_bounty_status_change"();



ALTER TABLE ONLY "public"."ai_tasks"
    ADD CONSTRAINT "ai_tasks_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("agent_id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bounty_rooms"
    ADD CONSTRAINT "bounty_rooms_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."disputes"
    ADD CONSTRAINT "disputes_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."bounty_rooms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."validator_assignments"
    ADD CONSTRAINT "validator_assignments_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."validator_assignments"
    ADD CONSTRAINT "validator_assignments_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("bounty_id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_agents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_agents_insert_dev" ON "public"."ai_agents" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("developer_wallet" = "public"."get_wallet"())));



CREATE POLICY "ai_agents_select_active" ON "public"."ai_agents" FOR SELECT USING (("is_active" = true));



CREATE POLICY "ai_agents_select_own" ON "public"."ai_agents" FOR SELECT USING (("developer_wallet" = "public"."get_wallet"()));



CREATE POLICY "ai_agents_update_dev" ON "public"."ai_agents" FOR UPDATE USING (("developer_wallet" = "public"."get_wallet"())) WITH CHECK (("developer_wallet" = "public"."get_wallet"()));



ALTER TABLE "public"."ai_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_tasks_delete_client" ON "public"."ai_tasks" FOR DELETE USING (("client_wallet" = "public"."get_wallet"()));



CREATE POLICY "ai_tasks_insert_client" ON "public"."ai_tasks" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("client_wallet" = "public"."get_wallet"())));



CREATE POLICY "ai_tasks_select_client" ON "public"."ai_tasks" FOR SELECT USING (("client_wallet" = "public"."get_wallet"()));



CREATE POLICY "ai_tasks_select_dev" ON "public"."ai_tasks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."ai_agents" "a"
  WHERE (("a"."agent_id" = "ai_tasks"."agent_id") AND ("a"."developer_wallet" = "public"."get_wallet"())))));



ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "applications_insert_hunter" ON "public"."applications" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("hunter_wallet" = "public"."get_wallet"())));



CREATE POLICY "applications_select_public" ON "public"."applications" FOR SELECT USING (true);



ALTER TABLE "public"."bounties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bounties_insert_creator" ON "public"."bounties" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("creator_wallet" = "public"."get_wallet"())));



CREATE POLICY "bounties_select_public" ON "public"."bounties" FOR SELECT USING (true);



CREATE POLICY "bounties_update_creator" ON "public"."bounties" FOR UPDATE USING (("creator_wallet" = "public"."get_wallet"())) WITH CHECK (("creator_wallet" = "public"."get_wallet"()));



ALTER TABLE "public"."bounty_rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."disputes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "disputes_insert_creator" ON "public"."disputes" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("creator_wallet" = "public"."get_wallet"()) AND (EXISTS ( SELECT 1
   FROM "public"."bounties" "b"
  WHERE (("b"."bounty_id" = "disputes"."bounty_id") AND ("b"."creator_wallet" = "public"."get_wallet"()))))));



CREATE POLICY "disputes_select_public" ON "public"."disputes" FOR SELECT USING (true);



CREATE POLICY "disputes_update_hunter_defence" ON "public"."disputes" FOR UPDATE USING ((("disputed_hunter_wallet" = "public"."get_wallet"()) AND ("status" = 'awaiting_defence'::"text"))) WITH CHECK (("disputed_hunter_wallet" = "public"."get_wallet"()));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_insert_members" ON "public"."messages" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("sender_wallet" = "public"."get_wallet"()) AND (EXISTS ( SELECT 1
   FROM "public"."bounty_rooms" "r"
  WHERE (("r"."id" = "messages"."room_id") AND (("r"."creator_wallet" = "public"."get_wallet"()) OR ("public"."get_wallet"() = ANY ("r"."hunter_wallets"))))))));



CREATE POLICY "messages_select_members" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bounty_rooms" "r"
  WHERE (("r"."id" = "messages"."room_id") AND (("r"."creator_wallet" = "public"."get_wallet"()) OR ("public"."get_wallet"() = ANY ("r"."hunter_wallets")))))));



CREATE POLICY "rooms_insert_creator" ON "public"."bounty_rooms" FOR INSERT WITH CHECK (("creator_wallet" = "public"."get_wallet"()));



CREATE POLICY "rooms_select_members" ON "public"."bounty_rooms" FOR SELECT USING ((("creator_wallet" = "public"."get_wallet"()) OR ("public"."get_wallet"() = ANY ("hunter_wallets"))));



CREATE POLICY "rooms_update_creator" ON "public"."bounty_rooms" FOR UPDATE USING (("creator_wallet" = "public"."get_wallet"())) WITH CHECK (("creator_wallet" = "public"."get_wallet"()));



CREATE POLICY "scheduled_del_deny_all" ON "public"."scheduled_deletions" FOR SELECT USING (false);



ALTER TABLE "public"."scheduled_deletions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submissions_insert_hunter" ON "public"."submissions" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND ("hunter_wallet" = "public"."get_wallet"())));



CREATE POLICY "submissions_select_authorized" ON "public"."submissions" FOR SELECT USING ((("hunter_wallet" = "public"."get_wallet"()) OR (EXISTS ( SELECT 1
   FROM "public"."bounties" "b"
  WHERE (("b"."bounty_id" = "submissions"."bounty_id") AND ("b"."creator_wallet" = "public"."get_wallet"()))))));



CREATE POLICY "val_assign_select_own" ON "public"."validator_assignments" FOR SELECT USING ((("validator_wallet" = "public"."get_wallet"()) OR (EXISTS ( SELECT 1
   FROM "public"."disputes" "d"
  WHERE (("d"."id" = "validator_assignments"."dispute_id") AND ("d"."status" = ANY (ARRAY['resolved_hunter_wins'::"text", 'resolved_client_wins'::"text"])) AND (("d"."creator_wallet" = "public"."get_wallet"()) OR ("d"."disputed_hunter_wallet" = "public"."get_wallet"())))))));



CREATE POLICY "val_assign_update_vote" ON "public"."validator_assignments" FOR UPDATE USING ((("validator_wallet" = "public"."get_wallet"()) AND ("vote" IS NULL))) WITH CHECK (("validator_wallet" = "public"."get_wallet"()));



ALTER TABLE "public"."validator_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."validators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "validators_insert_own" ON "public"."validators" FOR INSERT WITH CHECK (("wallet_address" = "public"."get_wallet"()));



CREATE POLICY "validators_select_public" ON "public"."validators" FOR SELECT USING (true);



CREATE POLICY "validators_update_own" ON "public"."validators" FOR UPDATE USING (("wallet_address" = "public"."get_wallet"())) WITH CHECK (("wallet_address" = "public"."get_wallet"()));



ALTER TABLE "public"."winners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "winners_insert_creator" ON "public"."winners" FOR INSERT WITH CHECK ((("public"."get_wallet"() <> ''::"text") AND (EXISTS ( SELECT 1
   FROM "public"."bounties" "b"
  WHERE (("b"."bounty_id" = "winners"."bounty_id") AND ("b"."creator_wallet" = "public"."get_wallet"()))))));



CREATE POLICY "winners_select_public" ON "public"."winners" FOR SELECT USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ai_tasks";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bounty_rooms";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."disputes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."validator_assignments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."winners";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."assign_validators"("p_dispute_id" "uuid", "p_bounty_id" bigint, "p_required_skills" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."assign_validators"("p_dispute_id" "uuid", "p_bounty_id" bigint, "p_required_skills" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_validators"("p_dispute_id" "uuid", "p_bounty_id" bigint, "p_required_skills" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_verdict"("p_dispute_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_verdict"("p_dispute_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_verdict"("p_dispute_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_bounty_data"("p_bounty_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_bounty_data"("p_bounty_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_bounty_data"("p_bounty_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_submissions_for_viewer"("p_bounty_id" bigint, "p_viewer_wallet" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_submissions_for_viewer"("p_bounty_id" bigint, "p_viewer_wallet" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_submissions_for_viewer"("p_bounty_id" bigint, "p_viewer_wallet" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_wallet"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_wallet"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_wallet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_bounty_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_bounty_status_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_bounty_status_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_scheduled_deletions"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_scheduled_deletions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_scheduled_deletions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."promote_winners_after_dispute"("p_bounty_id" bigint, "p_disputed_rank" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."promote_winners_after_dispute"("p_bounty_id" bigint, "p_disputed_rank" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_winners_after_dispute"("p_bounty_id" bigint, "p_disputed_rank" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_reasoning" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_reasoning" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_reasoning" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_confidence" numeric, "p_judge_reasoning" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_confidence" numeric, "p_judge_reasoning" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_ai_task_result"("p_task_id" bigint, "p_output_data" "jsonb", "p_judge_verdict" boolean, "p_judge_confidence" numeric, "p_judge_reasoning" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_client_satisfaction"("p_task_id" bigint, "p_is_satisfied" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."record_client_satisfaction"("p_task_id" bigint, "p_is_satisfied" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_client_satisfaction"("p_task_id" bigint, "p_is_satisfied" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_bounty_status"("p_bounty_id" bigint, "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_bounty_status"("p_bounty_id" bigint, "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_bounty_status"("p_bounty_id" bigint, "p_new_status" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."ai_agents" TO "anon";
GRANT ALL ON TABLE "public"."ai_agents" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_agents" TO "service_role";



GRANT ALL ON TABLE "public"."ai_tasks" TO "anon";
GRANT ALL ON TABLE "public"."ai_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON TABLE "public"."bounties" TO "anon";
GRANT ALL ON TABLE "public"."bounties" TO "authenticated";
GRANT ALL ON TABLE "public"."bounties" TO "service_role";



GRANT ALL ON TABLE "public"."bounty_rooms" TO "anon";
GRANT ALL ON TABLE "public"."bounty_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."bounty_rooms" TO "service_role";



GRANT ALL ON TABLE "public"."disputes" TO "anon";
GRANT ALL ON TABLE "public"."disputes" TO "authenticated";
GRANT ALL ON TABLE "public"."disputes" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_deletions" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_deletions" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_deletions" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON TABLE "public"."validator_assignments" TO "anon";
GRANT ALL ON TABLE "public"."validator_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."validator_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."validators" TO "anon";
GRANT ALL ON TABLE "public"."validators" TO "authenticated";
GRANT ALL ON TABLE "public"."validators" TO "service_role";



GRANT ALL ON TABLE "public"."winners" TO "anon";
GRANT ALL ON TABLE "public"."winners" TO "authenticated";
GRANT ALL ON TABLE "public"."winners" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































