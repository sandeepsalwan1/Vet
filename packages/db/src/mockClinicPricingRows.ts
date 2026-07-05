type MockService = {
  id: string;
  serviceName: string;
  category: string;
  currentPriceCents: number;
  notes: string | null;
};

type PricingObservation = {
  id: string;
  source: string;
  competitorName: string;
  serviceName: string;
  observedPriceCents: number | null;
  observedText: string | null;
  url: string | null;
  raw: Record<string, unknown>;
  createdAt: string;
};

export type ServiceRow = {
  id: string;
  service_name: string;
  category: string;
  current_price_cents: number;
  notes: string | null;
};

export type PricingObservationRow = {
  id: string;
  source: string;
  competitor_name: string;
  service_name: string;
  observed_price_cents: number | null;
  observed_text: string | null;
  url: string | null;
  raw: Record<string, unknown>;
  created_at: string;
};

export function normalizeService(row: ServiceRow): MockService {
  return {
    id: row.id,
    serviceName: row.service_name,
    category: row.category,
    currentPriceCents: row.current_price_cents,
    notes: row.notes
  };
}

export function normalizePricingObservation(row: PricingObservationRow): PricingObservation {
  return {
    id: row.id,
    source: row.source,
    competitorName: row.competitor_name,
    serviceName: row.service_name,
    observedPriceCents: row.observed_price_cents,
    observedText: row.observed_text,
    url: row.url,
    raw: row.raw ?? {},
    createdAt: row.created_at
  };
}
