-- Carrefour answers without a sales channel and refuses with one.
--
-- Its account host returns 206 for a plain catalogue query and 401 the
-- moment sc=1 is attached — which is what made a whole 30-term sweep fail
-- while single manual requests kept working. Channel 1 is simply not a
-- public channel on that account, and seeding it was my guess rather than
-- something measured.
--
-- regionId still applies, so the prices stay São Paulo's rather than
-- defaulting to some other trading area.

update stores set sales_channel = null where slug = 'carrefour';
