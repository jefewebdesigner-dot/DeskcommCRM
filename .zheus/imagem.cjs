#!/usr/bin/env node
// Gera uma imagem e grava dentro do projeto. Arquivo escrito pelo Zheus.
//   node .zheus/imagem.cjs "descricao" assets/hero.png [800x600]
const http = require('http');
const [descricao, destino, tamanho] = process.argv.slice(2);
if (!descricao || !destino) {
  console.error("uso: imagem.cjs <descricao> <destino> [tamanho]");
  process.exit(1);
}
// JSON.stringify no lugar do printf do shell: o printf antigo não
// escapava nada, e uma descrição com aspas montava um corpo inválido.
const corpo = Buffer.from(JSON.stringify({
  prompt: descricao, destino: destino, tamanho: tamanho || "1024x1024",
}));
const req = http.request("http://127.0.0.1:3333/api/projects/3f24cdc5-7711-4a1d-ba4a-d4d7ab138f61/imagem", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": corpo.length,
    "X-Zheus-Imagem": "e362712100e9f4021c2e349508a76cf50139bf5d756e7479",
  },
}, (res) => {
  let dados = "";
  res.setEncoding("utf8");
  res.on("data", (p) => { dados += p; });
  res.on("end", () => {
    process.stdout.write(dados);
    // O `curl -s` saía com 0 até em erro HTTP: o agente lia "deu certo",
    // seguia escrevendo <img src> e o site ficava com imagem quebrada.
    // Falha de imagem custa dinheiro — tem que aparecer como falha.
    // `exitCode` e não `exit()`: em POSIX a escrita no stdout de um PIPE
    // é assíncrona, e `exit()` logo depois pode cortar o motivo do erro
    // no meio — justamente o texto que o agente precisa ler.
    if (!(res.statusCode >= 200 && res.statusCode < 300)) process.exitCode = 1;
  });
});
req.on("error", (e) => { console.error("falhou: " + e.message); process.exit(1); });
// Sem timeout de propósito: gerar imagem leva dezenas de segundos e o
// curl também esperava o quanto fosse preciso.
req.end(corpo);
