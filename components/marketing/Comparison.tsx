import { Check, X } from "lucide-react";
import { comparisonRows } from "./marketing-data";

export function Comparison() {
  return (
    <section className="mkt-section mkt-comparison-section">
      <p className="mkt-eyebrow mkt-center">Comparativo direto</p>
      <h2 className="mkt-section-heading mkt-center">
        Por que o Gravity CRM é diferente do que você já testou
      </h2>

      <div className="mkt-comparison-table">
        <div className="mkt-comparison-row mkt-comparison-head">
          <span>Critério</span>
          <span>Maioria do mercado</span>
          <span>Gravity CRM</span>
        </div>
        {comparisonRows.map((row) => (
          <div className="mkt-comparison-row" key={row.criterio}>
            <span className="mkt-criterio">{row.criterio}</span>
            <span className="mkt-mercado">
              <X size={14} strokeWidth={2.5} />
              {row.mercado}
            </span>
            <span className="mkt-gravit">
              <Check size={14} strokeWidth={2.5} />
              {row.gravit}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
