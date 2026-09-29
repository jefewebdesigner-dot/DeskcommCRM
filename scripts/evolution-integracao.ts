/**
 * Prova de integração da Evolution REAL (sem número): cria uma instância descartável,
 * confere QR, webhook e estado, e remove. Nunca toca instância que não criou.
 *
 *   EVOLUTION_API_BASE_URL=https://evo.<dominio> EVOLUTION_API_KEY=... \
 *     tsx scripts/evolution-integracao.ts
 *
 * Não imprime chave. Sai com código 1 se qualquer passo falhar.
 */
import { randomBytes } from "node:crypto";

import { EvolutionClient, EvolutionError } from "@/lib/channels/evolution/client";
import { statusInternoDaInstancia } from "@/lib/channels/adapters/evolution";

const base = process.env.EVOLUTION_API_BASE_URL ?? "";
const chave = process.env.EVOLUTION_API_KEY ?? "";
if (!base || !chave) {
  console.error("faltam EVOLUTION_API_BASE_URL/EVOLUTION_API_KEY");
  process.exit(1);
}

const client = new EvolutionClient(base, chave);
const nome = `evo_teste_${randomBytes(6).toString("hex")}`;
const segredo = randomBytes(24).toString("hex");
let falhas = 0;
const passo = (ok: boolean, msg: string) => {
  console.log(`${ok ? "OK  " : "FALHA"} ${msg}`);
  if (!ok) falhas++;
};

async function main() {
  const criada = await client.createInstance({
    instanceName: nome,
    webhookUrl: "https://example.invalid/api/v1/webhooks/channel/teste-descartavel",
    webhookHeaders: { "x-gravity-webhook-secret": segredo },
  });
  passo(criada.instanceName === nome, "createInstance devolve o mesmo nome");
  passo(criada.qr.png !== null || criada.qr.pairingCode !== null, "createInstance já traz QR");

  const info = await client.instanceInfo(nome);
  passo(info.state === "connecting" && info.ownerJid === null, `instanceInfo: connecting sem dono (state=${info.state})`);
  passo(statusInternoDaInstancia({ state: info.state, ownerJid: info.ownerJid }) === "SCAN_QR_CODE", "saúde interna = SCAN_QR_CODE");

  const estado = await client.connectionState(nome);
  passo(estado === "connecting" || estado === "close", `connectionState=${estado}`);

  const qr = await client.connect(nome);
  const png = qr.png;
  passo(!!png && png.length > 100 && png[0] === 0x89 && png[1] === 0x50, "connect devolve PNG válido");

  await client.setWebhook(nome, { url: "https://example.invalid/api/v1/webhooks/channel/teste-descartavel-2", headers: { "x-gravity-webhook-secret": segredo } });
  passo(true, "setWebhook reaplica sem erro");

  const semNumero = await client.whatsappNumber(nome, "5511999999999").catch((e) => e);
  passo(semNumero instanceof EvolutionError, "consulta de número com instância desconectada falha de forma controlada");

  const inexistente = await client.instanceInfo("evo_nao_existe_" + nome).catch((e) => e);
  passo(inexistente instanceof EvolutionError && inexistente.instanceMissing, "instância inexistente → instanceMissing");
}

main()
  .catch((e) => {
    console.log("FALHA erro inesperado:", e instanceof Error ? e.message : String(e));
    falhas++;
  })
  .finally(async () => {
    // O delete da Evolution é assíncrono e pode recusar logo após outra operação: repete até sumir.
    for (let i = 0; i < 15; i++) {
      await client.deleteInstance(nome).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2000));
      const ainda = await client.instanceInfo(nome).then(() => true, () => false);
      if (!ainda) break;
    }
    const restou = await client.instanceInfo(nome).then(() => true, () => false);
    passo(!restou, "instância descartável removida");
    console.log(falhas === 0 ? "INTEGRACAO OK" : `INTEGRACAO COM ${falhas} FALHA(S)`);
    process.exit(falhas === 0 ? 0 : 1);
  });
