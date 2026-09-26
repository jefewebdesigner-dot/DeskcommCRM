---
impacto: capacidade_nova
secao: corrigido
titulo: Abrir o CRM após entrar com Neon Auth
---
A renderização das páginas autenticadas passa a usar as URLs públicas do Neon configuradas em runtime também no servidor. Isso evita a tela de erro após o login quando as variáveis públicas não foram preenchidas durante o build.
