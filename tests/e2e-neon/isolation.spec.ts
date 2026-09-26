import { test, expect, type Browser, type BrowserContext } from "@playwright/test";

import { lerFixturesABC } from "./ler-fixtures";

type Ator = ReturnType<typeof lerFixturesABC>["A"];

const BASE = `http://localhost:${process.env.E2E_NEON_PORT ?? "3591"}`;

// O Next dev compila rotas sob demanda nesta VPS de 1 vCPU; a primeira chamada
// de uma rota pode ultrapassar os 15s globais sem indicar falha do produto.
test.use({ actionTimeout: 45_000 });

async function entrar(browser: Browser, ator: Ator): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto("/login?next=/app/contacts", {
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.getByLabel("Email").fill(ator.email);
  await page.getByLabel("Senha").fill(ator.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  let autenticado = false;
  for (let i = 0; i < 90; i += 1) {
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name.includes("session_token"))) {
      autenticado = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(autenticado, `sessão não criada para ator ${ator.label}`).toBe(true);
  await page.close();
  return context;
}

function contatoId(body: unknown): string {
  const id = (body as { data?: { contact?: { id?: unknown } } })?.data?.contact?.id;
  if (typeof id !== "string") throw new Error("Resposta de contato sem id");
  return id;
}

test("isolamento A/B/C pela API real do aplicativo", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = lerFixturesABC();
  // A e B entram já no início (o teste intercala os dois o tempo todo). C só
  // entra perto de onde é usado — VPS de 4GB medida sem aguentar 3 contextos
  // de browser abertos ao mesmo tempo durante o login sequencial (o login de
  // B/C dava timeout de 45s com A já logado e outro contexto ocioso na
  // memória). Menos contextos simultâneos, mesma cobertura.
  const ctxA = await entrar(browser, f.A);
  const ctxB = await entrar(browser, f.B);
  let ctxC: Awaited<ReturnType<typeof entrar>> | null = null;

  try {
    const stamp = Date.now();
    const criaA = await ctxA.request.post("/api/v1/contacts", {
      data: { name: `Contato A ${stamp}`, email: `a-${stamp}@example.test`, source: "manual" },
    });
    expect(criaA.status()).toBe(201);
    const idA = contatoId(await criaA.json());

    const criaB = await ctxB.request.post("/api/v1/contacts", {
      data: { name: `Contato B ${stamp}`, email: `b-${stamp}@example.test`, source: "manual" },
    });
    expect(criaB.status()).toBe(201);
    const idB = contatoId(await criaB.json());

    const ownA = await ctxA.request.get(`/api/v1/contacts/${idA}`);
    const ownB = await ctxB.request.get(`/api/v1/contacts/${idB}`);
    expect(ownA.status()).toBe(200);
    expect(ownB.status()).toBe(200);

    expect((await ctxA.request.get(`/api/v1/contacts/${idB}`)).status()).toBe(404);
    expect((await ctxB.request.get(`/api/v1/contacts/${idA}`)).status()).toBe(404);
    const patchAB = await ctxA.request.patch(`/api/v1/contacts/${idB}`, {
      data: { name: "A nao pode editar B" },
    });
    const patchBA = await ctxB.request.patch(`/api/v1/contacts/${idA}`, {
      data: { name: "B nao pode editar A" },
    });
    expect(patchAB.status()).toBe(404);
    expect(patchBA.status()).toBe(404);

    expect((await ctxA.request.delete(`/api/v1/contacts/${idB}`)).status()).toBe(404);
    expect((await ctxB.request.delete(`/api/v1/contacts/${idA}`)).status()).toBe(404);

    expect((await ctxA.request.get(`/api/v1/contacts/${idA}`)).status()).toBe(200);
    expect((await ctxB.request.get(`/api/v1/contacts/${idB}`)).status()).toBe(200);

    ctxC = await entrar(browser, f.C);
    const cLista = await ctxC.request.get("/api/v1/contacts");
    expect(cLista.status()).toBe(403);
    const cCria = await ctxC.request.post("/api/v1/contacts", {
      data: { name: "C nao pode criar", source: "manual" },
    });
    expect(cCria.status()).toBe(403);

    const listaA = await ctxA.request.get("/api/v1/contacts?limit=50");
    const listaB = await ctxB.request.get("/api/v1/contacts?limit=50");
    expect(listaA.status()).toBe(200);
    expect(listaB.status()).toBe(200);
    const dadosA = (await listaA.json()) as { data?: Array<{ id?: string; organization_id?: string }> };
    const dadosB = (await listaB.json()) as { data?: Array<{ id?: string; organization_id?: string }> };
    expect(dadosA.data?.some((x) => x.id === idA)).toBe(true);
    expect(dadosA.data?.some((x) => x.id === idB)).toBe(false);
    expect(dadosB.data?.some((x) => x.id === idB)).toBe(true);
    expect(dadosB.data?.some((x) => x.id === idA)).toBe(false);

    const alteraA = await ctxA.request.patch(`/api/v1/contacts/${idA}`, {
      data: { name: `Contato A alterado ${stamp}` },
    });
    const alteraB = await ctxB.request.patch(`/api/v1/contacts/${idB}`, {
      data: { name: `Contato B alterado ${stamp}` },
    });
    expect(alteraA.status()).toBe(200);
    expect(alteraB.status()).toBe(200);

    const spoof = await ctxA.request.post("/api/v1/contacts", {
      data: {
        name: `Contato A spoof ${stamp}`,
        source: "manual",
        organization_id: f.B.orgId,
      },
    });
    expect(spoof.status()).toBe(201);
    const spoofBody = (await spoof.json()) as { data?: { contact?: { id?: string; organization_id?: string } } };
    const idSpoof = spoofBody.data?.contact?.id;
    expect(spoofBody.data?.contact?.organization_id).toBe(f.A.orgId);
    expect(typeof idSpoof).toBe("string");
    if (idSpoof) {
      expect((await ctxB.request.get(`/api/v1/contacts/${idSpoof}`)).status()).toBe(404);
      expect((await ctxA.request.delete(`/api/v1/contacts/${idSpoof}`)).status()).toBe(204);
    }

    expect((await ctxA.request.delete(`/api/v1/contacts/${idA}`)).status()).toBe(204);
    expect((await ctxB.request.delete(`/api/v1/contacts/${idB}`)).status()).toBe(204);
    expect((await ctxA.request.get(`/api/v1/contacts/${idA}`)).status()).toBe(404);
    expect((await ctxB.request.get(`/api/v1/contacts/${idB}`)).status()).toBe(404);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await ctxC?.close();
  }
});
