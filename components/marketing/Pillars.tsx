"use client";

import { pillars } from "./marketing-data";

export function Pillars() {
  return (
    <section className="mkt-section mkt-pillars-section">
      <p className="mkt-eyebrow mkt-center">Os pilares</p>
      <h2 className="mkt-section-heading mkt-center">
        A empresa inteira num só lugar
      </h2>
      <div className="mkt-pillars-grid">
        {pillars.map((p, i) => (
          <div
            className="mkt-pillar-card"
            key={p.title}
          >
            <span className="mkt-pillar-index">{String(i + 1).padStart(2, "0")}</span>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
