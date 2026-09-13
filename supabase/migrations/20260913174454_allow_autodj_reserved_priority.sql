-- AutoDJ uses -100 to sort behind every guest request.
-- Previously PostgreSQL rejected all these inserts; SQLite did not.
SET lock_timeout = '5s';
ALTER TABLE jukebox_private.queue DROP CONSTRAINT queue_priority_check;
ALTER TABLE jukebox_private.queue ADD CONSTRAINT queue_priority_check
  CHECK (priority >= 0 OR (requester_id = 'autodj' AND priority = -100));
