import Link from "next/link";

// Vídeo de fundo herdado do site do Gravity CRM (crm.ia). Externo por enquanto;
// hospedar junto do site quando houver o arquivo final.
const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4";

function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <g transform="rotate(-35 14 14)">
        <rect x="3" y="9" width="22" height="7" rx="3.5" fill="currentColor" />
        <rect x="3" y="18" width="15" height="7" rx="3.5" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Hero() {
  return (
    <div className="mkt-hero">
      <nav className="mkt-navbar mkt-entra" aria-label="Gravity CRM">
        <div className="mkt-nav-left">
          <Link className="mkt-brand" href="/">
            <LogoMark />
            <span className="mkt-brand-text">Gravity CRM</span>
          </Link>
          <div className="mkt-nav-tags">
            <span>Vendas · CS · Suporte</span>
            <span>WhatsApp com IA</span>
          </div>
        </div>
        <div className="mkt-nav-right">
          <Link className="mkt-login-link" href="/login">
            Entrar
          </Link>
        </div>
      </nav>

      <div className="mkt-video-bg mkt-entra-lento">
        <div className="mkt-video-wrap">
          <video src={VIDEO_URL} autoPlay muted playsInline loop />
        </div>
      </div>

      <div className="mkt-footer mkt-entra" style={{ animationDelay: "0.4s" }}>
        <div className="mkt-footer-left">
          <p className="mkt-subtitle">
            <span className="mkt-dot" aria-hidden="true" />
            CRM com IA para quem vende e atende pelo WhatsApp
          </p>
          <h1 className="mkt-heading">
            Vendas, Customer Success
            <br />
            e Suporte num CRM só.
          </h1>
          <div className="mkt-cta-row">
            <a className="mkt-btn mkt-btn-solid" href="#demo">
              Agende uma demonstração
            </a>
            <a className="mkt-btn mkt-btn-outline" href="#como-funciona">
              Ver como funciona
            </a>
          </div>
        </div>
        <div className="mkt-footer-right">
          <span className="mkt-tag-pill">Assinaturas</span>
          <span className="mkt-tag-pill">Clínicas</span>
          <span className="mkt-tag-pill">Serviços</span>
        </div>
      </div>
    </div>
  );
}
