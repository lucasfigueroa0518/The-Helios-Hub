BEGIN;

ALTER TABLE outreach.campaigns DROP CONSTRAINT IF EXISTS campaigns_expansion_step_check;
ALTER TABLE outreach.campaigns
  ADD CONSTRAINT campaigns_expansion_step_check
  CHECK (expansion_step >= 0 AND expansion_step <= 1024) NOT VALID;

COMMIT;
