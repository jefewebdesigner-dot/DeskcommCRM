-- 0015: grants de authenticated ausentes nas funções do Google Calendar
--
-- Bug real medido em produção (PeríciaIA): "Atualizar lista e sincronização"
-- em Configurações > Agenda falhava sempre com 409 genérico. Causa real
-- (só visível depois do fix do catch mudo em
-- app/api/v1/agenda/google/calendarios/atualizar/route.ts, commit 2331d3d):
-- "permission denied for function fn_google_catalog".
--
-- Mesma classe de bug já corrigida várias vezes nesta sessão (0011, 0014):
-- função SECURITY DEFINER nova em `public` sem GRANT EXECUTE para
-- `authenticated`. Aqui o alcance é maior — TODA a integração de Google
-- Calendar depende destas 6 funções (sync de catálogo, claim/fence de
-- calendário, criar/mover/cancelar compromisso, redact de LGPD), e nenhuma
-- delas tinha o grant. Outras 4 `fn_google_*` já tinham (fn_google_selection,
-- fn_google_resolve, fn_google_coverage, fn_google_counts_for_conflicts) —
-- por isso só parte do módulo parecia funcionar (a tela abria, listava a
-- conta conectada) e a outra parte (sync, criar evento) falhava sempre.

grant execute on function public.fn_google_catalog(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.fn_google_calendar_fence(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.fn_google_calendar(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.fn_google_appointment(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.fn_google_projection_stamp() to authenticated;
grant execute on function public.fn_google_redact_contact() to authenticated;
