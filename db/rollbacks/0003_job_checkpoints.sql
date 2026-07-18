-- Roll back durable LINE delivery checkpoints. Stop incoming webhook traffic first so
-- no processing job loses its saved result while these columns are removed.

begin;

alter table jobs drop column if exists delivered_at;
alter table jobs drop column if exists result;

commit;
