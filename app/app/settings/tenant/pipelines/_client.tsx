"use client";

import { useT } from "@/hooks/i18n/useT";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";
import type { PipelineConfigPatch } from "@/lib/schemas/settings";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { customFieldSchema, type CustomFieldDef } from "@/lib/schemas/settings";
import { Plus, Trash } from "@/lib/ui/icons";
import { AgentMappingSection, ancoraDoMapeamento } from "./_mapping";
import { StagesSection, ancoraDasEtapas } from "./_stages";

export interface PipelineRow {
  id: string;
  name: string;
  slug: string;
  vocabulary: Record<string, string> | null;
  settings: Record<string, unknown> | null;
}

/**
 * Os tipos de campo que esta tela oferece — DERIVADOS do schema, nunca
 * reescritos à mão.
 *
 * Quando a lista era digitada aqui, ela encolheu sem ninguém ver: `multiselect`
 * existia em `customFieldSchema`, era gravado pela API e aparecia no dossiê
 * (`components/contacts/CustomFieldsEditor.tsx`), mas faltava nesta lista. O
 * efeito para quem abria a tela era um campo que parecia corrompido — o
 * `<Select>` recebia `value="multiselect"`, nenhum `SelectItem` casava, e o
 * seletor ficava EM BRANCO. Pior: as opções do campo só apareciam para
 * `select`, então um multiselect ficava sem como ser editado, e a saída óbvia
 * (escolher um tipo para "consertar" o branco) transformava a escolha múltipla
 * em escolha única.
 *
 * Derivar do schema faz a divergência deixar de ser possível: tipo novo lá
 * nasce oferecido aqui.
 */
export const TIPOS_DE_CAMPO = customFieldSchema.shape.type.options;

/** Tipos cujo valor sai de uma lista fechada — são os que mostram o campo de opções. */
export function tipoTemOpcoes(tipo: CustomFieldDef["type"]): boolean {
  return tipo === "select" || tipo === "multiselect";
}

function readLostReasons(settings: Record<string, unknown> | null): string[] {
  if (!settings) return [];
  const r = (settings as { lost_reasons?: unknown }).lost_reasons;
  return Array.isArray(r) ? (r as string[]) : [];
}

export function PipelinesClient({
  pipelines,
  podeEditarConfig,
}: {
  pipelines: PipelineRow[];
  /** Vocabulário/custom fields são admin (a server action recusa o resto). */
  podeEditarConfig: boolean;
}) {
  const t = useT();
  if (pipelines.length === 0) {
    // ⚠️ NÃO PROMETA UM CAMINHO QUE NÃO EXISTE. Criar funil não é feito por
    // nenhuma tela, rota ou action deste produto — só por script de instalação;
    // e como o instalador não provisiona funil, ESTE é o estado de toda
    // instalação nova. O texto anterior mandava "crie um no quadro", e o quadro
    // vazio manda "Ir para Configurações": pingue-pongue fechado, com o usuário
    // procurando um botão que não existe em lugar nenhum.
    return (
      <Card className="rounded-[24px] border-border/60 bg-muted/[0.06] p-6 text-sm leading-relaxed text-muted-foreground shadow-sm">
        {t(
          "Você ainda não tem nenhum funil. Enquanto for assim, o agente atende normalmente, mas não tem para onde levar o card de ninguém — não há etapas para onde mover. Criar o funil é feito por quem instalou o sistema, direto no banco; depois ele aparece aqui para você escolher a etapa de cada passo.",
        )}
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {pipelines.map((p) => (
        <Card
          key={p.id}
          className="overflow-hidden rounded-[24px] border-border/60 bg-card p-0 shadow-[0_10px_28px_rgba(0,0,0,0.04)]"
        >
          <header className="border-b border-border/60 bg-muted/[0.14] px-5 py-4 sm:px-6">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {t("Funil")}
            </p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.025em]">{p.name}</h2>
              <p className="rounded-lg border border-border/50 bg-background/65 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                /{p.slug}
              </p>
            </div>
          </header>
          <div className="space-y-6 p-5 sm:p-6">
            {/* As ETAPAS vêm primeiro, e a ordem é a do raciocínio de quem
              configura: primeiro o quadro existe do jeito da sua operação,
              depois se decide o que o assistente faz com ele. Invertido, a
              primeira coisa que o dono da clínica vê é um mapeamento sobre
              colunas de e-commerce que ele nem sabia que dava para trocar. */}
            <StagesSection pipelineId={p.id} ancoraMapeamento={ancoraDoMapeamento(p.id)} />
            <section className="rounded-2xl border border-border/60 bg-muted/[0.08] p-4 sm:p-5">
              <AgentMappingSection pipelineId={p.id} ancoraEtapas={ancoraDasEtapas(p.id)} />
            </section>
            {podeEditarConfig && <PipelineEditor pipeline={p} />}
          </div>
        </Card>
      ))}
    </div>
  );
}

function PipelineEditor({ pipeline }: { pipeline: PipelineRow }) {
  const t = useT();
  const v = pipeline.vocabulary ?? {};
  const [lead, setLead] = useState(v.lead ?? "Lead");
  const [deal, setDeal] = useState(v.deal ?? "Deal");
  const [won, setWon] = useState(v.won ?? "Ganho");
  const [lost, setLost] = useState(v.lost ?? "Perdido");
  const [reasonsText, setReasonsText] = useState(readLostReasons(pipeline.settings).join(", "));
  const [fields, setFields] = useState<CustomFieldDef[]>(camposDoFunil(pipeline.settings));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const ok: CustomFieldDef[] = [];
    for (const f of fields) {
      // O item vazio que a vírgula deixou no input segue vivo até aqui — é o
      // preço de NÃO descartá-lo durante a digitação (ver o `onChange` das
      // opções). Ele nunca foi uma opção: `customFieldSchema` exige
      // `label.min(1)`, então filtrá-lo ANTES de validar é o que separa "acabei
      // de digitar uma vírgula" de "quero gravar uma opção em branco". É aqui
      // também que o espaço do FIM de cada opção é aparado: o `onChange` só
      // apara o início, para não apagar o espaço que a pessoa está digitando.
      const limpo = tipoTemOpcoes(f.type)
        ? {
            ...f,
            options: (f.options ?? [])
              .map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
              .filter((o) => o.label !== ""),
          }
        : f;
      const parsed = customFieldSchema.safeParse(limpo);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? t("Campo inválido."));
        return;
      }
      ok.push(parsed.data);
    }
    const reasons = reasonsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const patch: PipelineConfigPatch = {
      vocabulary: { lead, deal, won, lost },
      fields: ok,
      lost_reasons: reasons,
    };
    startTransition(async () => {
      const r = await updatePipelineConfig(pipeline.id, patch);
      if (r.ok) toast.success(`${pipeline.name} ${t("atualizado.")}`);
      else toast.error(`${t("Erro:")} ${r.error}`);
    });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-muted/[0.08] p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{t("Vocabulário e campos")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(
            "Ajustes avançados do funil. Eles mudam como os dados aparecem no dossiê e nos encerramentos.",
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Lead</Label>
          <Input value={lead} onChange={(e) => setLead(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Deal</Label>
          <Input value={deal} onChange={(e) => setDeal(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Won</Label>
          <Input value={won} onChange={(e) => setWon(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lost</Label>
          <Input value={lost} onChange={(e) => setLost(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("Motivos de perda (separados por vírgula)")}</Label>
        <Input value={reasonsText} onChange={(e) => setReasonsText(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">{t("Campos do lead neste funil")}</Label>
        <p className="text-xs text-muted-foreground">
          {t(
            "Aparecem no dossiê do negócio. No follow-up, você escolhe em qual campo gravar a resposta.",
          )}
        </p>
        {fields.map((f, i) => (
          <div
            key={`${f.key}-${i}`}
            className="grid gap-2 rounded-xl border border-border/60 bg-background/70 p-2.5 md:grid-cols-[1fr_1fr_8rem_auto]"
          >
            <Input
              aria-label={`${t("Chave do campo")} ${i + 1}`}
              placeholder={t("chave (endereco)")}
              value={f.key}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, key: e.target.value };
                setFields(next);
              }}
            />
            <Input
              aria-label={`${t("Rótulo do campo")} ${i + 1}`}
              placeholder={t("Rótulo (Endereço)")}
              value={f.label}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, label: e.target.value };
                setFields(next);
              }}
            />
            <Select
              value={f.type}
              onValueChange={(type) => {
                const next = [...fields];
                next[i] = { ...f, type: type as CustomFieldDef["type"] };
                setFields(next);
              }}
            >
              <SelectTrigger aria-label={`${t("Tipo do campo")} ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_CAMPO.map((tipo) => (
                  <SelectItem key={tipo} value={tipo}>
                    {tipo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-lg"
              aria-label={`${t("Remover campo")} ${f.label || i + 1}`}
              onClick={() => setFields(fields.filter((_, j) => j !== i))}
            >
              <Trash size={14} aria-hidden />
            </Button>
            {tipoTemOpcoes(f.type) && (
              <Input
                className="md:col-span-3"
                aria-label={`${t("Opções do campo")} ${i + 1}`}
                placeholder={t("Opções, separadas por vírgula")}
                value={(f.options ?? []).map((o) => o.label).join(", ")}
                onChange={(e) => {
                  // SEM `.filter(Boolean)` aqui, de propósito. O item vazio do
                  // fim é o que a vírgula acabou de criar, e ele precisa
                  // sobreviver até a pessoa digitar a palavra seguinte.
                  // Descartá-lo no mesmo instante apaga o separador da tela —
                  // digitar "Dor," some com a vírgula — e a tecla seguinte cola
                  // na palavra anterior ("Dor" + "O" vira "DorO"). Com o item
                  // vazio preservado, o `join(", ")` reescreve "Dor, " e o
                  // cursor continua onde a pessoa parou. O vazio só é descartado
                  // no `handleSave`, quando deixa de ser útil. Pelo mesmo
                  // motivo só o INÍCIO é aparado (o espaço que o `join(", ")`
                  // põe): aparar o fim apagaria o espaço recém-digitado, e
                  // "Clareamento" + " " + "D" viraria "ClareamentoD".
                  const options = e.target.value
                    .split(",")
                    .map((s) => s.trimStart())
                    .map((label) => ({ value: label, label }));
                  const next = [...fields];
                  next[i] = { ...f, options };
                  setFields(next);
                }}
              />
            )}
          </div>
        ))}
        {fields.length < 50 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() =>
              setFields([
                ...fields,
                { key: `campo_${fields.length + 1}`, label: t("Novo campo"), type: "text" },
              ])
            }
          >
            <Plus size={14} aria-hidden className="mr-1" /> {t("Adicionar campo")}
          </Button>
        )}
      </div>

      <div className="flex sm:justify-end">
        <Button onClick={handleSave} disabled={isPending} className="w-full rounded-xl sm:w-auto">
          {isPending ? t("Salvando…") : t("Salvar vocabulário e campos")}
        </Button>
      </div>
    </section>
  );
}
