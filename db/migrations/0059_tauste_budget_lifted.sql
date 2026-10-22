-- Tauste lifted the cap, in writing, on 2026-10-21.
--
-- The cap was what truncated their sweep: 200 spent to the unit every
-- night, five categories unread, 3,557 products missing. 0020 fixed half of
-- that by not buying an empty page per slice; this is the other half.
--
-- Pacing stays at 2,000 ms, and the sweep is still bounded by their own
-- taxonomy — 113 slices, 112 pages of 200 plus one for the tree. The column
-- and store_request_log stay for the next chain that does set a number.

update stores
   set daily_request_budget = null
 where slug like 'tauste%';
