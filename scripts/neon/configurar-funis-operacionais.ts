import pg from "pg";

import {
  FUNIS_OPERACIONAIS,
  type FunilOperacional,
  type TipoOperacionalDoFunil,
} from "@/lib/pipelines/funis-operacionais";

const { Client } = pg;

function argumento(nome: string): string | null {
  const prefixo = `--${nome}=`;
  const encontrado = process.argv.find((item) => item.startsWith(prefixo));
  return encontrado ? encontrado.slice(prefixo.length) : null;
}

function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function vocabulario(kind: TipoOperacionalDoFunil) {
  if (kind === "post_sales") {
    return {
      lead: "Cliente",
      lead_plural: "Clientes",
      deal: "Acompanhamento",
      deal_plural: "Acompanhamentos",
      won: "Concluído",
      lost: "Encerrado",
      stage: "Etapa",
      stage_plural: "Etapas",
    };
  }
  if (kind === "support") {
    return {
      lead: "Cliente",
      lead_plural: "Clientes",
      deal: "Chamado",
      deal_plural: "Chamados",
      won: "Resolvido",
      lost: "Encerrado",
      stage: "Etapa",
      stage_plural: "Etapas",
    };
  }
  if (kind === "retention") {
    return {
      lead: "Cliente",
      lead_plural: "Clientes",
      deal: "Caso",
      deal_plural: "Casos",
      won: "Regularizado",
      lost: "Cancelado",
      stage: "Etapa",
      stage_plural: "Etapas",
    };
  }
  return {
    lead: "Lead",
    lead_plural: "Leads",
    deal: "Negócio",
    deal_plural: "Negócios",
    won: "Ganho",
    lost: "Perdido",
    stage: "Etapa",
    stage_plural: "Etapas",
  };
}

function ajustes(kind: TipoOperacionalDoFunil, funil: FunilOperacional) {
  return {
    operational_kind: kind,
    operational_version: 1,
    lost_reasons: [...funil.motivosDePerda],
    ...(kind === "retention" ? { reactivation_ready: true } : {}),
  };
}

function chaveNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  const connectionString = process.env.MIGRATIONS_DATABASE_URL;
  if (!connectionString) throw new Error("MIGRATIONS_DATABASE_URL ausente");

  const orgSlug = argumento("org") ?? "periciaia";
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("begin");

    const org = await client.query<{ id: string; display_name: string }>(
      "select id, display_name from public.organizations where slug=$1 limit 1",
      [orgSlug],
    );
    const organization = org.rows[0];
    if (!organization) throw new Error(`Organização não encontrada: ${orgSlug}`);

    const existentes = await client.query<{
      id: string;
      name: string;
      slug: string;
      is_default: boolean;
      position: number;
      settings: Record<string, unknown>;
    }>(
      "select id,name,slug,is_default,position,settings from public.crm_pipelines where organization_id=$1 and is_archived=false order by position",
      [organization.id],
    );

    const idsPorTipo = new Map<TipoOperacionalDoFunil, string>();
    const slugs = new Set(existentes.rows.map((p) => p.slug));
    let proximaPosicao = Math.max(0, ...existentes.rows.map((p) => Number(p.position))) + 1000;

    for (const modelo of FUNIS_OPERACIONAIS) {
      let atual = existentes.rows.find(
        (p) => (p.settings?.operational_kind as string | undefined) === modelo.kind,
      );

      // O funil padrão antigo do PeríciaIA é preservado como Vendas para não
      // quebrar referências, webhooks ou cards existentes. Só sua semântica muda.
      if (!atual && modelo.kind === "sales") {
        atual = existentes.rows.find((p) => p.is_default) ?? existentes.rows[0];
      }

      if (!atual) {
        const base = slug(modelo.nome);
        let candidato = base;
        let n = 2;
        while (slugs.has(candidato)) candidato = `${base}_${n++}`;
        slugs.add(candidato);

        const inserido = await client.query<{ id: string }>(
          `insert into public.crm_pipelines
             (organization_id,name,slug,description,is_default,is_archived,position,vocabulary,settings)
           values ($1,$2,$3,$4,false,false,$5,$6::jsonb,$7::jsonb)
           returning id`,
          [
            organization.id,
            modelo.nome,
            candidato,
            modelo.descricao,
            proximaPosicao,
            JSON.stringify(vocabulario(modelo.kind)),
            JSON.stringify({
              fields: [],
              canonical_tags: [],
              identity_resolution: { fields_in_priority_order: ["cpf", "phone_e164", "email"] },
              ...ajustes(modelo.kind, modelo),
            }),
          ],
        );
        atual = {
          id: inserido.rows[0]!.id,
          name: modelo.nome,
          slug: candidato,
          is_default: false,
          position: proximaPosicao,
          settings: ajustes(modelo.kind, modelo),
        };
        proximaPosicao += 1000;
      } else {
        await client.query(
          `update public.crm_pipelines
             set name=$3,
                 description=$4,
                 vocabulary=$5::jsonb,
                 settings=coalesce(settings,'{}'::jsonb) || $6::jsonb,
                 updated_at=now()
           where organization_id=$1 and id=$2`,
          [
            organization.id,
            atual.id,
            modelo.nome,
            modelo.descricao,
            JSON.stringify(vocabulario(modelo.kind)),
            JSON.stringify(ajustes(modelo.kind, modelo)),
          ],
        );
      }

      idsPorTipo.set(modelo.kind, atual.id);

      const etapas = await client.query<{
        id: string;
        name: string;
        slug: string;
        is_archived: boolean;
      }>(
        "select id,name,slug,is_archived from public.crm_stages where organization_id=$1 and pipeline_id=$2 order by position",
        [organization.id, atual.id],
      );

      // Libera as marcações antes de redesenhar terminais; os índices de ganho e
      // perda são únicos por funil e imediatos.
      await client.query(
        "update public.crm_stages set is_won=false,is_lost=false,agent_stage_hint=null where organization_id=$1 and pipeline_id=$2",
        [organization.id, atual.id],
      );

      const porNome = new Map(etapas.rows.map((e) => [chaveNome(e.name), e]));
      const porSlug = new Map(etapas.rows.map((e) => [e.slug, e]));

      // Compatibilidade com o funil antigo do PeríciaIA: preserva ids mesmo que
      // o slug histórico tenha nome de e-commerce.
      const aliasesDeVendas: Record<string, string> = {
        "novo lead": "carrinho_abandonado",
        contatado: "aguardando_pagamento",
        "demonstracao agendada": "pago",
        "negociando plano": "em_separacao",
        "assinante ativo": "enviado",
        perdido: "cancelado",
      };

      for (const [indice, etapa] of modelo.etapas.entries()) {
        const chave = chaveNome(etapa.nome);
        const alias = modelo.kind === "sales" ? aliasesDeVendas[chave] : undefined;
        const existente = porNome.get(chave) ?? porSlug.get(etapa.slug) ?? (alias ? porSlug.get(alias) : undefined);
        const position = (indice + 1) * 1000;

        if (existente) {
          await client.query(
            `update public.crm_stages
               set name=$4, position=$5, is_archived=false, is_won=$6, is_lost=$7,
                   agent_stage_hint=$8, updated_at=now()
             where organization_id=$1 and pipeline_id=$2 and id=$3`,
            [
              organization.id,
              atual.id,
              existente.id,
              etapa.nome,
              position,
              etapa.won === true,
              etapa.lost === true,
              etapa.hint,
            ],
          );
        } else {
          await client.query(
            `insert into public.crm_stages
               (organization_id,pipeline_id,name,slug,position,is_won,is_lost,is_archived,agent_stage_hint)
             values ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
            [
              organization.id,
              atual.id,
              etapa.nome,
              etapa.slug,
              position,
              etapa.won === true,
              etapa.lost === true,
              etapa.hint,
            ],
          );
        }
      }
    }

    await client.query("commit");

    console.info(`Organização: ${organization.display_name}`);
    for (const modelo of FUNIS_OPERACIONAIS) {
      console.info(`${modelo.nome}: ${idsPorTipo.get(modelo.kind)}`);
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
