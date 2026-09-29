// Preload do agent-worker (`tsx --require ./workers/agent-worker/server-only-shim.cjs ...`).
//
// `lib/supabase/admin.ts` (e outros módulos do app) declaram `import "server-only"`: no Next,
// o bundler resolve o pacote e ele só protege contra import em componente de cliente. Fora do
// Next — este worker roda como processo Node puro, o mesmo código do handler de envio — o
// pacote não existe em node_modules e o boot morre com `Cannot find module 'server-only'`.
//
// O worker É servidor, então o guard não tem o que proteger aqui: o módulo vira um vazio. Sem
// dependência nova e sem mexer nos módulos do app (que precisam manter o guard para o Next).
const Module = require("node:module");

const resolveOriginal = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./empty-module.cjs");
  return resolveOriginal.call(this, request, ...rest);
};
