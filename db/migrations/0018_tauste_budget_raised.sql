-- Tauste lifted the hard limit; the budget stays anyway.
--
-- Their legal department came back: the technical coordinator is content
-- with a price-comparison POC, the twenty-a-day cap having been aimed at
-- people abusing their crawler policy. The new instruction is "com
-- parcimonia" — with moderation.
--
-- That is a judgement, not a number, and a constraint with no number is one
-- nobody actually keeps. So the budget mechanism stays and the number
-- becomes mine to defend: 150 requests a day, paced at two seconds.
--
-- Why those: 150 covers a full catalogue sweep daily with room to spare,
-- and at two seconds apart it is five minutes of activity — half a request
-- per second. The twelve other chains take between 400 and 1,250 requests
-- per run. This stays the gentlest collector of the lot, which is what
-- being trusted with a judgement call ought to look like.

update stores
   set daily_request_budget = 150,
       min_interval_ms = 2000
 where slug = 'tauste';
