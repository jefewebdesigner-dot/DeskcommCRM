"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { faqs } from "./marketing-data";

export function FAQ() {
  const [open, setOpen] = useState(0);

  return (
    <section className="mkt-section mkt-faq-section" id="perguntas">
      <p className="mkt-eyebrow mkt-center">Perguntas frequentes</p>
      <h2 className="mkt-section-heading mkt-center">
        Tudo que você precisa saber antes de começar
      </h2>

      <div className="mkt-faq-list">
        {faqs.map((item, i) => {
          const isOpen = open === i;
          return (
            <div className="mkt-faq-item" key={item.q}>
              <button
                type="button"
                className="mkt-faq-question"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
              >
                <span>{item.q}</span>
                <ChevronDown
                  size={16}
                  className={"mkt-faq-chevron" + (isOpen ? " mkt-rotated" : "")}
                />
              </button>
              {isOpen && <p className="mkt-faq-answer">{item.a}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
