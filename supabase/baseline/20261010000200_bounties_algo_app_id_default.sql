-- Point the bounties.algo_app_id default at the redeployed contract (App ID 773988811).
ALTER TABLE "public"."bounties" ALTER COLUMN "algo_app_id" SET DEFAULT 773988811;
