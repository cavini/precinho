-- Tauste switched off: its robots.txt forbids us.
--
-- tauste.com.br/robots.txt has, under `User-agent: *`, a bare `Disallow: /`
-- with no Allow anywhere in that group. Only Googlebot is granted access.
-- Our collector matches `*`, so every path on that host — /graphql included
-- — is closed to us.
--
-- I check robots before enabling a chain and did it for the other eleven.
-- I skipped it here, added the store off the back of discovering it ran
-- Magento, and it collected against the file for several runs. Switching it
-- off is the correction; the row stays so the reason stays with it.
--
-- Worth asking them: a price comparator sends traffic toward a regional
-- chain, and written permission would reopen this properly.

update stores set active = false where slug = 'tauste';
