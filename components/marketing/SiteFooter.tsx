import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mkt-site-footer">
      <div className="mkt-site-footer-top">
        <div className="mkt-site-footer-brand">
          <p className="mkt-site-footer-name">Gravity CRM</p>
          <p className="mkt-site-footer-desc">
            CRM brasileiro organizado por setor, com atendimento no WhatsApp por agentes de IA.
          </p>
        </div>
        <div className="mkt-site-footer-col">
          <p className="mkt-site-footer-title">Produto</p>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#perguntas">Perguntas frequentes</a>
        </div>
        <div className="mkt-site-footer-col">
          <p className="mkt-site-footer-title">Fale com a gente</p>
          <a href="#demo">Agendar demonstração</a>
          <Link href="/login">Entrar</Link>
        </div>
      </div>
      <div className="mkt-site-footer-bottom">
        <span>© {new Date().getFullYear()} Gravity CRM. Todos os direitos reservados.</span>
        <span className="mkt-site-footer-links">
          <Link href="/legal/terms">Termos de uso</Link>
          <Link href="/legal/privacy">Privacidade</Link>
        </span>
      </div>
    </footer>
  );
}
