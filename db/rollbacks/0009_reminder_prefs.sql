-- 回滾提醒暫停旗標。

begin;

alter table users drop column if exists reminders_paused;

commit;
