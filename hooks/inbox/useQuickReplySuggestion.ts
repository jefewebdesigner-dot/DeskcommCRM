"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { SugestaoRespostaRapida } from "@/lib/inbox/sugestao-resposta-rapida";

export function useQuickReplySuggestion(contactId?: string | null) {
  return useQuery({
    enabled: Boolean(contactId),
    queryKey: ["quick-reply-suggestion", contactId],
    queryFn: async () =>
      apiClient.get<{ data: { suggestion: SugestaoRespostaRapida | null } }>(
        `/api/v1/contacts/${contactId}/quick-reply-suggestion`,
      ),
    select: (res) => res.data.suggestion,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
