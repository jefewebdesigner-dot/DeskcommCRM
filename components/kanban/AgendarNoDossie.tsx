"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { useMarcarAgendamento } from "@/hooks/agenda/useMarcarAgendamento";
import type { Lead } from "@/lib/types/leads";

interface TipoDeAgenda {
  id: string;
  name: string;
  duration_minutes: number;
  location_kind: string;
  location_details: string | null;
  is_active: boolean;
}

function dataLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function janelaDoDia(dia: string): { de: string; ate: string } {
  const de = new Date(`${dia}T00:00:00`);
  const ate = new Date(`${dia}T23:59:59.999`);
  return { de: de.toISOString(), ate: ate.toISOString() };
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function unwrap<T>(json: unknown): T {
  return (json as { data: T }).data;
}

export function AgendarNoDossie({ lead, pipelineId }: { lead: Lead; pipelineId: string }) {
  const amanha = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dataLocal(d);
  }, []);
  const [aberto, setAberto] = useState(false);
  const [dia, setDia] = useState(amanha);
  const [tipoId, setTipoId] = useState<string>("");
  const marcar = useMarcarAgendamento();

  const tipos = useQuery({
    queryKey: ["agenda", "tipos", "lead-dossier"],
    enabled: aberto,
    queryFn: async () => {
      const res = await fetch("/api/v1/agenda/tipos");
      const json = await res.json();
      if (!res.ok) throw new Error("Não foi possível carregar os tipos de reunião.");
      return unwrap<TipoDeAgenda[]>(json).filter((t) => t.is_active);
    },
    staleTime: 60_000,
  });

  const tipoSelecionado = tipos.data?.find((tipo) => tipo.id === tipoId) ?? tipos.data?.[0] ?? null;
  const janela = dia ? janelaDoDia(dia) : null;
  const horarios = useHorariosLivres(
    aberto && tipoSelecionado && janela
      ? {
          event_type_id: tipoSelecionado.id,
          de: janela.de,
          ate: janela.ate,
        }
      : null,
  );

  async function confirmar(inicio: string) {
    if (!tipoSelecionado || !lead.contact_id) return;
    const nome = lead.contact?.display_name ?? lead.contact?.name ?? lead.title;
    await marcar.mutateAsync({
      event_type_id: tipoSelecionado.id,
      starts_at: inicio,
      contact_id: lead.contact_id,
      conversation_id: lead.conversa?.id ?? undefined,
      title: `${tipoSelecionado.name} · ${nome}`,
      description: "Agendado pelo Funil do CRM.",
      location_details: tipoSelecionado.location_details ?? undefined,
    });
    setAberto(false);
    void fetch(`/api/v1/pipelines/${pipelineId}/board`, { cache: "no-store" }).catch(
      () => undefined,
    );
  }

  if (!lead.contact_id) {
    return (
      <div className="space-y-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title="Associe um contato ao negócio para poder agendar uma reunião."
        >
          <CalendarPlus className="mr-1.5 h-4 w-4" />
          Agendar reunião
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Associe um contato ao negócio para liberar o agendamento.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <CalendarPlus className="h-4 w-4 text-primary" />
          Agendar reunião
        </span>
        <span className="text-xs text-text-muted">{aberto ? "Fechar" : "Abrir"}</span>
      </button>

      {aberto ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {tipos.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando agenda…
            </div>
          ) : tipos.data?.length ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={tipoSelecionado?.id ?? ""} onValueChange={setTipoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo de reunião" />
                  </SelectTrigger>
                  <SelectContent>
                    {tipos.data.map((tipo) => (
                      <SelectItem key={tipo.id} value={tipo.id}>
                        {tipo.name} · {tipo.duration_minutes} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="date"
                  value={dia}
                  min={dataLocal(new Date())}
                  onChange={(e) => setDia(e.target.value)}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>

              {tipoSelecionado?.location_kind === "google_meet" ? (
                <p className="flex items-start gap-1.5 rounded-md bg-primary/5 px-2.5 py-2 text-xs text-text-muted">
                  <Video className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />O Google Meet será
                  criado na Agenda. Se este lead tiver conversa ativa, o CRM entrega o link
                  automaticamente pelo WhatsApp quando o Google liberar a sala.
                </p>
              ) : null}

              {horarios.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Buscando horários livres…
                </div>
              ) : horarios.data?.slots?.length ? (
                <div>
                  <p className="mb-2 text-xs font-medium text-text-muted">Horários livres</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {horarios.data.slots.slice(0, 12).map((slot) => (
                      <Button
                        key={slot.inicio}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={marcar.isPending}
                        onClick={() => void confirmar(slot.inicio)}
                      >
                        {hora(slot.inicio)}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-muted">Nenhum horário livre neste dia.</p>
              )}

              <Button asChild type="button" variant="ghost" size="sm" className="w-full">
                <Link
                  href={`/app/agenda?contato=${lead.contact_id}&conversa=${lead.conversa?.id ?? ""}`}
                >
                  Abrir Agenda completa
                </Link>
              </Button>
            </>
          ) : (
            <p className="text-xs text-text-muted">
              Nenhum tipo de atendimento ativo foi configurado na Agenda.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
