-- 200 a day, now that the catalogue has been measured.
--
-- I picked 150 before knowing the shape of Tauste's catalogue, which was a
-- guess dressed as a decision. Measured: 18,791 products across 115 real
-- categories, and because a product sits in more than one category the
-- slices total 22,350 — 186 pages of 200, plus one request for the tree.
-- 187 against a budget of 150 would have left every run truncated.
--
-- So 200: a complete daily sweep with a little headroom. At two seconds
-- apart that is under seven minutes of activity, half a request per second,
-- against 400-1,250 requests for each of the other twelve chains. Still the
-- gentlest collector here, which is what "com parcimonia" should mean when
-- somebody trusts you to pick the number yourself.

update stores set daily_request_budget = 200 where slug = 'tauste';
