import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
export default defineConfig({
  root,
  // Não carrega .env nem setup do banco. Testa a proposta sem editar runtime.
  envDir: false,
  resolve: { alias: [
    { find: "@/components/inbox/composer/EmojiButton", replacement: path.join(here, "EmojiButton.tsx") },
    { find: "@/components/inbox/composer/EmojiPicker", replacement: path.join(here, process.env.EMOJI_REVIEW_ORIGINAL === "1" ? "EmojiPicker.before.tsx" : "EmojiPicker.tsx") },
    { find: "@", replacement: root },
  ] },
  test: { environment: "jsdom", include: ["docs/audits/runtime-2026-09-24/readiness/emoji/composer-emoji.test.tsx"], testTimeout: 15000 },
});
