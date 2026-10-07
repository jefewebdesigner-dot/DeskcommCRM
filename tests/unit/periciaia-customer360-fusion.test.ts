import { describe, expect, it } from "vitest";

import {
  PERICIAIA_ORGANIZATION_ID,
  periciaiaIdentities,
} from "@/lib/vertical-packs/periciaia-customer360";

describe("PeríciaIA Customer 360 fusion", () => {
  it("preserva o tenant existente como destino da fusão", () => {
    expect(PERICIAIA_ORGANIZATION_ID).toBe(
      "9563e071-406b-4db2-aaa4-d08846d3267b",
    );
  });

  it("uma pessoa com duas assinaturas do mesmo customer não vira duas contas", () => {
    const identities = periciaiaIdentities({
      id: "contact-1",
      custom_fields: {
        financeiro: {
          assinaturas: [
            {
              provider: "stripe",
              subscriptionId: "sub_1",
              customerId: "cus_1",
            },
            {
              provider: "stripe",
              subscriptionId: "sub_2",
              customerId: "cus_1",
            },
          ],
        },
      },
    });

    expect(identities).toEqual([
      { source: "stripe", externalCustomerId: "cus_1" },
    ]);
  });

  it("liga identidades financeiras e identidade do produto na mesma conta", () => {
    const identities = periciaiaIdentities({
      id: "contact-2",
      custom_fields: {
        financeiro: {
          assinaturas: [
            {
              provider: "abacatepay",
              subscriptionId: "sub_a",
              customerId: "cus_a",
            },
          ],
        },
        legacy: {
          user_ids: ["firebase-user-2"],
        },
      },
    });

    expect(identities).toEqual(
      expect.arrayContaining([
        { source: "abacatepay", externalCustomerId: "cus_a" },
        { source: "periciaia", externalCustomerId: "firebase-user-2" },
      ]),
    );
  });
});
