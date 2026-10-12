import { Check } from "lucide-react";
import { plans } from "./marketing-data";

export function Pricing() {
  return (
    <section className="mkt-section mkt-pricing-section" id="planos">
      <p className="mkt-eyebrow mkt-center">Planos</p>
      <h2 className="mkt-section-heading mkt-center">
        Escolha o plano ideal pro momento do seu negócio
      </h2>
      <p className="mkt-pricing-sub">
        O Pro é cobrado por usuário; a proposta sai na demonstração, conforme o tamanho do time.
      </p>

      <div className="mkt-pricing-grid">
        {plans.map((plan) => (
          <div
            className={"mkt-pricing-card" + (plan.highlighted ? " mkt-highlighted" : "")}
            key={plan.name}
          >
            {plan.highlighted && <span className="mkt-pricing-badge">Para o time todo</span>}
            <h3>{plan.name}</h3>
            <p className="mkt-pricing-tagline">{plan.tagline}</p>
            <p className="mkt-pricing-price">
              {plan.price}
              <span>{plan.period}</span>
            </p>
            <ul className="mkt-pricing-features">
              {plan.features.map((f) => (
                <li key={f}>
                  <Check size={14} strokeWidth={2.5} />
                  {f}
                </li>
              ))}
            </ul>
            <a
              className={"mkt-btn " + (plan.highlighted ? "mkt-btn-solid" : "mkt-btn-outline")}
              href="#demo"
            >
              Agende uma demonstração
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
