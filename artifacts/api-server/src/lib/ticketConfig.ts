import {
  db,
  slaConfigTable,
  ticketCategoriesTable,
  ticketEnvironmentsTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export interface TicketConfigDto {
  categories: Array<{ key: string; label: string }>;
  environments: Array<{ key: string; label: string }>;
  severities: Array<{
    key: string;
    label: string;
    rank: number;
    isUrgent: boolean;
    resolutionOptional: boolean;
    firstResponseMinutes: number;
    resolutionMinutes: number | null;
    use24x7: boolean;
  }>;
}

/** Active taxonomy for populating new-ticket forms and filters. */
export async function loadTicketConfig(): Promise<TicketConfigDto> {
  const [categories, environments, severities] = await Promise.all([
    db
      .select()
      .from(ticketCategoriesTable)
      .where(eq(ticketCategoriesTable.active, true))
      .orderBy(asc(ticketCategoriesTable.sortOrder), asc(ticketCategoriesTable.label)),
    db
      .select()
      .from(ticketEnvironmentsTable)
      .where(eq(ticketEnvironmentsTable.active, true))
      .orderBy(asc(ticketEnvironmentsTable.sortOrder), asc(ticketEnvironmentsTable.label)),
    db
      .select()
      .from(slaConfigTable)
      .where(eq(slaConfigTable.active, true))
      .orderBy(asc(slaConfigTable.rank)),
  ]);

  return {
    categories: categories.map((c) => ({ key: c.key, label: c.label })),
    environments: environments.map((e) => ({ key: e.key, label: e.label })),
    severities: severities.map((s) => ({
      key: s.severity,
      label: s.label,
      rank: s.rank,
      isUrgent: s.isUrgent,
      resolutionOptional: s.resolutionOptional,
      firstResponseMinutes: s.firstResponseMinutes,
      resolutionMinutes: s.resolutionMinutes,
      use24x7: s.use24x7,
    })),
  };
}

/**
 * Validate that a ticket's taxonomy keys are all active config options.
 * Returns a user-facing error message, or null if everything is valid.
 */
export async function validateTicketTaxonomy(input: {
  severity: string;
  category: string;
  environment: string;
}): Promise<string | null> {
  const config = await loadTicketConfig();
  if (!config.severities.some((s) => s.key === input.severity)) {
    return "That severity is not available. Pick one from the list.";
  }
  if (!config.categories.some((c) => c.key === input.category)) {
    return "That category is not available. Pick one from the list.";
  }
  if (!config.environments.some((e) => e.key === input.environment)) {
    return "That environment is not available. Pick one from the list.";
  }
  return null;
}
