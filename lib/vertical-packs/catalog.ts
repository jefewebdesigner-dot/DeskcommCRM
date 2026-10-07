export const GRAVITY_CRM_CORE_CAPABILITIES = [
  "contacts_accounts",
  "commercial_pipelines",
  "inbox_whatsapp",
  "tasks",
  "agenda",
  "billing_contracts",
  "revenue_os",
  "customer_360",
  "customer_health",
  "action_center",
  "retention_intelligence",
  "ai_automations",
  "analytics",
] as const;

export type GravityCrmCoreCapability=(typeof GRAVITY_CRM_CORE_CAPABILITIES)[number];

export const VERTICAL_PACKS={
  periciaia:{
    id:"periciaia",
    label:"PeríciaIA",
    fusion:"in_place",
    existingOrganizationId:"9563e071-406b-4db2-aaa4-d08846d3267b",
    coreOwned:[
      "contacts_accounts",
      "commercial_pipelines",
      "inbox_whatsapp",
      "tasks",
      "agenda",
      "billing_contracts",
      "revenue_os",
      "customer_360",
      "customer_health",
      "action_center",
      "retention_intelligence",
      "ai_automations",
      "analytics",
    ] satisfies GravityCrmCoreCapability[],
    verticalOwned:[
      "pje_global_token",
      "pje_legacy_bridge",
      "periciaia_billing_adapter",
      "periciaia_product_catalog",
      "periciaia_commercial_fields",
      "legacy_migration_trace",
    ] as const,
    temporaryBridges:[
      "periciaia-legacy-crm-import",
      "pje_legacy_bridge",
      "legacy_backend_sync",
    ] as const,
    invariants:[
      "do_not_create_second_periciaia_tenant",
      "preserve_existing_organization_id",
      "preserve_contact_ids",
      "preserve_crm_history",
      "preserve_conversations_and_channels",
      "preserve_user_memberships",
      "do_not_move_judicial_process_domain_into_crm_core",
    ] as const,
  },
} as const;

export type VerticalPackId=keyof typeof VERTICAL_PACKS;

export function verticalPack(id:string){
  return VERTICAL_PACKS[id as VerticalPackId]??null;
}
