-- Slugs that do not name the town.
--
-- The repository is public. A region slug and a dozen store slugs
-- carrying a city name put that city in every migration, script and test
-- in the project, which says more about whoever built this than the app
-- needs to say.
--
-- The city itself stays in regions.city, because that is what a CEP is
-- matched against — ViaCEP answers with a city name and the lookup
-- compares the two. It lives in the database, which is not published.
--
-- Worth being straight about the limit: the chains collected in a region
-- still narrow it down. Hiding the slug is not anonymity, it is just not
-- announcing it.

update regions set slug = 'sp-2' where slug = 'sp-2';

update stores
   set slug = replace(slug, '-sp2', '-sp2')
 where slug like '%-sp2';
