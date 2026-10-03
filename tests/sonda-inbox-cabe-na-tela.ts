/**
 * O INBOX PRIORIZA A CONVERSA — regressão de layout medida em browser real.
 *
 * O CRM é contexto sob demanda: por padrão ficam apenas lista compacta + fio.
 * Abrir "Contexto" usa uma gaveta sobreposta, sem encolher a conversa. O modo
 * foco é a segunda porta: esconde a lista e entrega toda a largura útil ao chat.
 *
 * Uso: npx tsx tests/sonda-inbox-cabe-na-tela.ts
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.E2E_PORT
  ? `http://127.0.0.1:${process.env.E2E_PORT}`
  : "http://127.0.0.1:3100";
const CONVERSA = "8b9fcd5f-252d-4f6b-9538-f7c2c538807f";
const c = JSON.parse(readFileSync("/Users/rafaelmelgaco/DeskcommCRM/.e2e-creds.json", "utf8"));

const LARGURAS = [1280, 1366, 1440, 1536, 1920];
const THREAD_MIN = 520;

async function main(): Promise<void> {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const erros: string[] = [];
  p.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });

  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.getByLabel(/e-?mail/i).fill(c.users.manager.email);
  await p.getByLabel(/senha/i).fill(c.password);
  await p.getByRole("button", { name: /entrar/i }).click();
  await p.waitForURL(/\/app/);
  await p.goto(`${BASE}/app/inbox?id=${CONVERSA}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);

  const linhas: Array<Record<string, unknown>> = [];
  for (const w of LARGURAS) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(250);
    linhas.push(
      await p.evaluate(() => {
        const grid = document.querySelector<HTMLElement>("[data-realtime-status]");
        if (!grid) return { viewport: window.innerWidth, sem_grid: true };
        const lista = grid.children[0] as HTMLElement;
        const meio = grid.children[1] as HTMLElement;
        const header = meio.children[0] as HTMLElement;
        const main = grid.closest("main");
        const acoes = Array.from(header.querySelectorAll<HTMLElement>("button, a"));
        const contexto = header.querySelector<HTMLElement>('button[aria-label="Contexto"]');
        const cr = contexto?.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          list_w: Math.round(lista.getBoundingClientRect().width),
          thread_w: Math.round(meio.getBoundingClientRect().width),
          header_h: Math.round(header.getBoundingClientRect().height),
          botoes: acoes.length,
          botoes_perdidos: acoes.filter((x) => {
            const r = x.getBoundingClientRect();
            return r.width < 1 || r.right > header.getBoundingClientRect().right + 1;
          }).length,
          contexto_visivel: Boolean(cr && cr.width > 0 && cr.right <= window.innerWidth + 1),
          crm_aberto_por_padrao: Boolean(document.querySelector('[data-testid="inbox-demandas"]')),
          main_rola_de_lado: main ? main.scrollWidth > main.clientWidth : null,
          doc_rola_de_lado:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      }),
    );
  }

  // A gaveta não pode alterar a largura do fio: ela é overlay, não terceira coluna.
  await p.setViewportSize({ width: 1280, height: 900 });
  const antes = await p
    .locator("[data-realtime-status]")
    .evaluate((grid) =>
      Math.round((grid.children[1] as HTMLElement).getBoundingClientRect().width),
    );
  await p.getByRole("button", { name: "Contexto", exact: true }).click();
  await p.getByTestId("inbox-demandas").waitFor({ state: "visible" });
  const contexto = await p.getByTestId("inbox-demandas").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });
  const depois = await p
    .locator("[data-realtime-status]")
    .evaluate((grid) =>
      Math.round((grid.children[1] as HTMLElement).getBoundingClientRect().width),
    );

  await p.screenshot({ path: "evidence/inbox-contexto-overlay-1280.png" });
  await b.close();

  const casos: Array<[string, boolean]> = [
    ["mediu todas as larguras", linhas.length === LARGURAS.length],
    ["a lista fica compacta (até 260px)", linhas.every((r) => Number(r.list_w) <= 260)],
    [
      `a conversa nunca fica abaixo de ${THREAD_MIN}px`,
      linhas.every((r) => Number(r.thread_w) >= THREAD_MIN),
    ],
    ["nenhuma ação do cabeçalho se perde", linhas.every((r) => r.botoes_perdidos === 0)],
    [
      "Contexto está alcançável em toda largura desktop",
      linhas.every((r) => r.contexto_visivel === true),
    ],
    ["CRM não rouba coluna por padrão", linhas.every((r) => r.crm_aberto_por_padrao === false)],
    [
      "Inbox não rola de lado",
      linhas.every((r) => r.main_rola_de_lado === false && r.doc_rola_de_lado === false),
    ],
    [
      "gaveta de contexto cabe na viewport",
      contexto.left >= 0 && contexto.right <= 1280 && contexto.width > 250,
    ],
    ["abrir contexto não encolhe a conversa", Math.abs(antes - depois) <= 2],
    ["sem erro de console", erros.length === 0],
  ];

  let falhas = 0;
  for (const [nome, ok] of casos) {
    console.info(`${ok ? "  ok  " : "FALHA "} ${nome}`);
    if (!ok) falhas += 1;
  }
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
