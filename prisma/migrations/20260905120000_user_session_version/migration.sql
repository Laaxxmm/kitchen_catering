-- Web sessions are JWTs; deactivating a user or changing their role used to
-- leave every existing token valid until it expired (30 days). The token now
-- carries this version and every guarded call compares it to the row.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
