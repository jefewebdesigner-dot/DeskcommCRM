import "server-only";

import { Pool } from "pg";

import { env } from "@/lib/env";

export interface PerfilResponsavelDaTarefa {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  linked_user_id: string | null;
  is_active: boolean;
}

let pool: Pool | null = null;

function banco(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
    });
    pool.on("error", () => undefined);
  }
  return pool;
}

export async function listarResponsaveisDaTarefa(
  organizationId: string,
): Promise<PerfilResponsavelDaTarefa[]> {
  const result = await banco().query<PerfilResponsavelDaTarefa>(
    "select * from public.fn_task_responsibles_for_org($1::uuid)",
    [organizationId],
  );
  return result.rows;
}

export async function responsavelDaTarefaExiste(
  organizationId: string,
  responsibleProfileId: string,
): Promise<boolean> {
  const result = await banco().query<{ existe: boolean }>(
    "select public.fn_task_responsible_exists($1::uuid,$2::uuid) as existe",
    [organizationId, responsibleProfileId],
  );
  return result.rows[0]?.existe === true;
}
