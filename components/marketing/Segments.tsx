"use client";

import { useState } from "react";
import { segments } from "./marketing-data";

export function Segments() {
  const [active, setActive] = useState(segments[0]!.id);
  const current = segments.find((s) => s.id === active) ?? segments[0]!;

  return (
    <section className="mkt-section mkt-segments-section">
      <p className="mkt-eyebrow mkt-center">Para o seu tipo de operação</p>
      <h2 className="mkt-section-heading mkt-center">
        O Gravity CRM se adapta ao seu tipo de operação
      </h2>

      <div className="mkt-segments-tabs">
        {segments.map((s) => (
          <button
            key={s.id}
            className={"mkt-segment-tab" + (s.id === active ? " mkt-active" : "")}
            onClick={() => setActive(s.id)}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>

      <>
        <div
          key={current.id}
          className="mkt-segment-panel"
        >
          <div className="mkt-segment-panel-text">
            <h3>{current.title}</h3>
            <p>{current.text}</p>
            <ul>
              {current.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <a className="mkt-btn mkt-btn-solid" href="#demo">
              Agende uma demo
            </a>
          </div>
          <div className="mkt-segment-panel-visual" aria-hidden="true" />
        </div>
      </>
    </section>
  );
}
