/**
 * Logger estruturado MÍNIMO (F2-04): JSON por linha em stdout — ts, level, msg +
 * campos. PII nunca entra em `fields` (disciplina do call site — payload de job e
 * conteúdo de lead não são logáveis; o scanner de obs-metrics.test.ts vigia).
 */
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function createLogger(stream: NodeJS.WritableStream = process.stdout): Logger {
  const write = (level: 'info' | 'warn' | 'error', msg: string, fields?: LogFields): void => {
    stream.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

/**
 * Logger derivado com campos fixos de escopo (F2-16) — ex.: o contexto do RUN
 * (job_id = run id, tenant_id, lead_id) carimbado em toda linha do turno sem
 * repetir os campos em cada call site. `fields` do call site vence em colisão.
 */
export function withFields(log: Logger, bindings: LogFields): Logger {
  return {
    info: (msg, fields) => log.info(msg, { ...bindings, ...fields }),
    warn: (msg, fields) => log.warn(msg, { ...bindings, ...fields }),
    error: (msg, fields) => log.error(msg, { ...bindings, ...fields }),
  };
}

/**
 * Redação de dado sensível em TEXTO que vai para log ou para o painel de saúde: e-mail,
 * sequência longa de dígitos (telefone/documento), credencial com cara de token e conexão
 * com senha. A disciplina do call site continua sendo a primeira defesa (PII não entra em
 * `fields`); esta é a rede embaixo, para o erro cru de driver/HTTP que ninguém escreveu.
 */
export function sanitizarTexto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:postgres(?:ql)?|https?|redis):\/\/[^\s"']*@[^\s"']+/gi, '[url]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]')
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/g, '[token]')
    // UUID (id de job/tenant) é útil e não é segredo: só o resto longo vira [token].
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? m : '[token]',
    )
    // 10+ dígitos com separadores simples: telefone/documento. Data (8 dígitos) não casa.
    .replace(/\+?\d(?:[\s().-]{0,2}\d){9,}/g, '[numero]');
}

function sanitizarCampos(v: unknown, fundo = 0): unknown {
  if (typeof v === 'string') return sanitizarTexto(v);
  if (fundo > 3 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => sanitizarCampos(x, fundo + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, sanitizarCampos(x, fundo + 1)]));
}

/**
 * Logger que sanitiza mensagem e campos ANTES de escrever e guarda o último erro (já
 * sanitizado) para o heartbeat do worker. `aoErro` recebe só texto limpo.
 */
export function comSanitizacao(base: Logger, aoErro?: (msgLimpa: string) => void): Logger {
  const limpo = (fields?: LogFields) => (fields ? (sanitizarCampos(fields) as LogFields) : undefined);
  return {
    info: (msg, fields) => base.info(sanitizarTexto(msg), limpo(fields)),
    warn: (msg, fields) => base.warn(sanitizarTexto(msg), limpo(fields)),
    error: (msg, fields) => {
      const detalhe = typeof fields?.error === 'string' ? `: ${fields.error}` : '';
      aoErro?.(sanitizarTexto(`${msg}${detalhe}`).slice(0, 200));
      base.error(sanitizarTexto(msg), limpo(fields));
    },
  };
}
