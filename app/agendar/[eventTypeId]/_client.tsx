"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Slot {
  inicio: string;
  fim: string;
}

interface SlotsResponse {
  data: {
    tipo: { nome: string; duracao_minutos: number };
    timezone: string;
    slots: Slot[];
  };
}

interface ErroResponse {
  error: { code: string; message: string };
}

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; mensagem: string }
  | { fase: "pronto"; tipoNome: string; timezone: string; slots: Slot[] }
  | { fase: "enviando"; tipoNome: string; timezone: string; slots: Slot[] }
  | { fase: "confirmado"; quando: string }
  | { fase: "falhou"; tipoNome: string; timezone: string; slots: Slot[]; mensagem: string };

/** Agrupa os slots por dia local, no fuso da regra — nunca no do navegador. */
function agruparPorDia(slots: Slot[], timezone: string): Map<string, Slot[]> {
  const grupos = new Map<string, Slot[]>();
  for (const slot of slots) {
    const chave = new Date(slot.inicio).toLocaleDateString("pt-BR", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const lista = grupos.get(chave) ?? [];
    lista.push(slot);
    grupos.set(chave, lista);
  }
  return grupos;
}

function tituloDoDia(chave: string, timezone: string): string {
  const [dia, mes, ano] = chave.split("/");
  const data = new Date(`${ano}-${mes}-${dia}T12:00:00`);
  return data.toLocaleDateString("pt-BR", { timeZone: timezone, weekday: "long", day: "2-digit", month: "long" });
}

export function AgendamentoPublico({ eventTypeId }: { eventTypeId: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [diaEscolhido, setDiaEscolhido] = useState<string | null>(null);
  const [slotEscolhido, setSlotEscolhido] = useState<Slot | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");

  useEffect(() => {
    let vivo = true;
    const de = new Date();
    const ate = new Date(de.getTime() + 14 * 86_400_000);
    fetch(
      `/api/v1/public/agenda/${eventTypeId}?de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
    )
      .then(async (resp) => {
        const body = (await resp.json()) as SlotsResponse | ErroResponse;
        if (!vivo) return;
        if (!resp.ok || "error" in body) {
          setEstado({
            fase: "erro",
            mensagem: "error" in body ? body.error.message : "Não foi possível carregar os horários.",
          });
          return;
        }
        setEstado({
          fase: "pronto",
          tipoNome: body.data.tipo.nome,
          timezone: body.data.timezone,
          slots: body.data.slots,
        });
      })
      .catch(() => {
        if (vivo) setEstado({ fase: "erro", mensagem: "Não foi possível carregar os horários agora." });
      });
    return () => {
      vivo = false;
    };
  }, [eventTypeId]);

  const grupos = useMemo(() => {
    if (estado.fase === "pronto" || estado.fase === "enviando" || estado.fase === "falhou") {
      return agruparPorDia(estado.slots, estado.timezone);
    }
    return new Map<string, Slot[]>();
  }, [estado]);

  const dias = useMemo(() => [...grupos.keys()], [grupos]);

  async function confirmar() {
    if (estado.fase !== "pronto" && estado.fase !== "falhou") return;
    if (!slotEscolhido || !nome.trim() || telefone.trim().length < 8) return;
    const { tipoNome, timezone, slots } = estado;
    setEstado({ fase: "enviando", tipoNome, timezone, slots });
    try {
      const resp = await fetch(`/api/v1/public/agenda/${eventTypeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), telefone: telefone.trim(), starts_at: slotEscolhido.inicio }),
      });
      const body = (await resp.json()) as { data?: { agendamento: { starts_at: string } } } | ErroResponse;
      if (!resp.ok || "error" in body) {
        setEstado({
          fase: "falhou",
          tipoNome,
          timezone,
          slots,
          mensagem: "error" in body ? body.error.message : "Não foi possível agendar. Tente de novo.",
        });
        return;
      }
      const quando = new Date(body.data!.agendamento.starts_at).toLocaleString("pt-BR", {
        timeZone: timezone,
        weekday: "long",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      setEstado({ fase: "confirmado", quando });
    } catch {
      setEstado({
        fase: "falhou",
        tipoNome,
        timezone,
        slots,
        mensagem: "Não foi possível agendar agora. Verifique sua conexão e tente de novo.",
      });
    }
  }

  if (estado.fase === "carregando") {
    return <TelaCentral><p className="text-sm text-muted-foreground">Carregando horários…</p></TelaCentral>;
  }
  if (estado.fase === "erro") {
    return (
      <TelaCentral>
        <p className="text-sm text-destructive">{estado.mensagem}</p>
      </TelaCentral>
    );
  }
  if (estado.fase === "confirmado") {
    return (
      <TelaCentral>
        <h1 className="text-xl font-semibold">Reunião confirmada!</h1>
        <p className="text-sm text-muted-foreground">
          Marcada para <strong>{estado.quando}</strong>. Você vai receber a confirmação pelo WhatsApp.
        </p>
      </TelaCentral>
    );
  }

  const diaAtivo = diaEscolhido ?? dias[0] ?? null;
  const slotsDoDia = diaAtivo ? (grupos.get(diaAtivo) ?? []) : [];
  const enviando = estado.fase === "enviando";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{estado.tipoNome}</h1>
        <p className="text-sm text-muted-foreground">Escolha um horário disponível.</p>
      </div>

      {estado.fase === "falhou" && <p className="text-sm text-destructive">{estado.mensagem}</p>}

      {dias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum horário disponível nos próximos dias.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {dias.map((dia) => (
              <button
                key={dia}
                type="button"
                onClick={() => {
                  setDiaEscolhido(dia);
                  setSlotEscolhido(null);
                }}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm capitalize",
                  dia === diaAtivo ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted",
                )}
              >
                {tituloDoDia(dia, estado.timezone)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {slotsDoDia.map((slot) => {
              const hora = new Date(slot.inicio).toLocaleTimeString("pt-BR", {
                timeZone: estado.timezone,
                hour: "2-digit",
                minute: "2-digit",
              });
              const ativo = slotEscolhido?.inicio === slot.inicio;
              return (
                <button
                  key={slot.inicio}
                  type="button"
                  onClick={() => setSlotEscolhido(slot)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm",
                    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  {hora}
                </button>
              );
            })}
          </div>

          {slotEscolhido && (
            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="space-y-1.5">
                <Label htmlFor="nome">Seu nome</Label>
                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telefone">WhatsApp</Label>
                <Input
                  id="telefone"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  placeholder="(11) 98888-7777"
                  maxLength={20}
                />
              </div>
              <Button
                type="button"
                onClick={confirmar}
                disabled={enviando || !nome.trim() || telefone.trim().length < 8}
              >
                {enviando ? "Confirmando…" : "Confirmar horário"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TelaCentral({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6 text-center">{children}</div>;
}
