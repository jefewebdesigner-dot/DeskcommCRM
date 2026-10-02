-- 0012: fn_emit_message_event para de passar pela RPC pública emit_event()
--
-- Bug real medido em produção (PeríciaIA, org 9563e071), universal — não
-- específico desta org: TODO inbound de WhatsApp que vira linha em `messages`
-- falha a emitir `message.received`, com o INSERT inteiro abortando por
-- RAISE EXCEPTION dentro do AFTER INSERT trigger. Efeito observado antes
-- desta migration: o webhook WAHA respondia 200 accepted:true, contato e
-- conversa eram resolvidos corretamente, e a mensagem NUNCA virava linha —
-- porque o INSERT inteiro era abortado pela trigger, sem nenhum rastro (até
-- a migration 0011-adjacente corrigir os catches silenciosos nas rotas de
-- webhook, esse erro não aparecia em lugar nenhum).
--
-- Causa raiz: `fn_emit_message_event` (trigger AFTER INSERT em `messages`)
-- chama `public.fn_log_event(...)`, que delega para `public.emit_event(...)`
-- — a RPC PÚBLICA. `emit_event` tem uma guarda deliberada:
--
--   if auth.uid() is not null and p_event_type in ('message.received', ...)
--   then raise exception 'reserved_message_received' using errcode='42501';
--
-- com o comentário "message.received nasce somente do INSERT inbound
-- interno. Um chamador público não pode reapresentar uma mensagem existente
-- como evento novo." A intenção é correta — mas a implementação assume que
-- uma emissão "interna" (vinda do trigger) roda com auth.uid() NULO, e isso
-- é falso nesta arquitetura Neon: a trigger roda na MESMA sessão/transação
-- do INSERT que a disparou, herdando o MESMO auth.uid() do inserter. Como
-- toda escrita de produção passa por `createAdminClient()` (identidade de
-- serviço, auth.uid() = identidade técnica, NUNCA nulo) ou por um usuário
-- real logado, não existe conexão de produção com auth.uid() nulo — a
-- guarda bloqueia o único caminho que deveria emitir este evento, sempre.
--
-- Fix: a trigger (já SECURITY DEFINER) insere DIRETO em event_log, com a
-- mesma forma de linha que `emit_event()` produziria, sem passar pela RPC
-- pública — que é exatamente o "chamador interno" que a guarda de
-- `emit_event` pretendia deixar passar, mas não deixava. A guarda em
-- `emit_event()` continua intacta e protegendo a RPC pública contra
-- chamador externo forjando o evento; só a trigger deixa de bater nela.

create or replace function public.fn_emit_message_event()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event text;
begin
  if coalesce(new.metadata->>'history_import','false') = 'true' then
    return new;
  end if;

  if new.direction='inbound' then
    v_event := 'message.received';
  else
    v_event := case new.status
      when 'sending' then 'message.sending'
      when 'sent' then 'message.sent'
      when 'failed' then 'message.failed'
      else 'message.outbound'
    end;
  end if;

  -- Insert direto em event_log — NÃO via emit_event()/fn_log_event(): este
  -- trigger É o emissor interno legítimo que a guarda de emit_event() quer
  -- deixar passar (ver cabeçalho da migration 0012); indo pela RPC pública,
  -- herdava o auth.uid() da sessão do INSERT e caía na própria guarda.
  insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload, metadata)
  values (
    new.organization_id,
    v_event,
    'message',
    new.id,
    jsonb_build_object(
      'message_id',new.id,
      'conversation_id',new.conversation_id,
      'contact_id',new.contact_id,
      'direction',new.direction,
      'type',new.type,
      'status',new.status,
      'external_id',new.external_id,
      'channel_session_id',new.channel_session_id,
      'body_preview',left(new.body,280)
    ),
    jsonb_build_object('emitted_at', extract(epoch from now()))
  );
  return new;
end;
$function$;
