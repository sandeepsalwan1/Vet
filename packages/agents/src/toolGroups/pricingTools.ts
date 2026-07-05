import { z } from "zod";
import type { MockClinicData, MockService, PricingObservation } from "../contracts";
import { DEFAULT_SEARCH_ACTOR, apifyConfigured, runApifyActor } from "../apifyClient";
import {
  addEffect,
  defineTool,
  looseMatch,
  makeReport,
  recordEvent
} from "../toolCore";

function comparePrices(services: MockService[], observations: PricingObservation[]) {
  return observations.map((observation) => {
    const service = services.find((candidate) =>
      looseMatch(candidate.serviceName, observation.serviceName) ||
      looseMatch(observation.serviceName, candidate.serviceName)
    );
    const deltaCents =
      service && typeof observation.observedPriceCents === "number"
        ? observation.observedPriceCents - service.currentPriceCents
        : null;
    const recommendation =
      deltaCents === null
        ? "Review manually; competitor price was not normalized."
        : deltaCents > 1000
          ? "Clinic appears under local market; review whether the price is sustainable."
          : deltaCents < -1000
            ? "Clinic appears above local market; review client sensitivity and positioning."
            : "Close to observed market; no immediate change recommended.";
    return {
      observation,
      service,
      deltaCents,
      recommendation,
      flagged: deltaCents === null || Math.abs(deltaCents) > 1000
    };
  });
}

function samplePricing(data: MockClinicData) {
  return data.pricingObservations.filter((item) => item.source === "sample");
}

const PRICE_PATTERN = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/;

function hostnameLabel(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractPriceCents(text: string): { cents: number | null; matched: string | null } {
  const match = text.match(PRICE_PATTERN);
  if (!match) return { cents: null, matched: null };
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return { cents: null, matched: match[0] };
  return { cents: Math.round(value * 100), matched: match[0] };
}

async function fetchApifyPricing(services: MockService[]): Promise<PricingObservation[] | null> {
  if (!apifyConfigured()) return null;
  const actorId = process.env.APIFY_PRICING_ACTOR_ID || DEFAULT_SEARCH_ACTOR;
  const targeted = services.slice(0, 4);
  if (!targeted.length) return null;
  const rows = await runApifyActor<Record<string, unknown>>(
    actorId,
    {
      // google-search-scraper expects newline-separated `queries`; generic scrapers use `query`.
      queries: targeted.map((service) => `veterinary ${service.serviceName} price cost`).join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: 5,
      countryCode: "us",
      query: targeted.map((service) => service.serviceName).join(", "),
      maxResults: 8
    },
    { timeoutMs: 45_000, limit: 12 }
  );
  if (!rows?.length) return null;

  const observations: PricingObservation[] = [];
  rows.forEach((record, rowIndex) => {
    const row = record && typeof record === "object" ? record : {};
    const rawQuery = (row as Record<string, unknown>).searchQuery;
    const queryTerm = typeof rawQuery === "string"
      ? rawQuery
      : rawQuery && typeof rawQuery === "object"
        ? String((rawQuery as Record<string, unknown>).term ?? "")
        : "";
    const matchedService = targeted.find((service) => looseMatch(queryTerm, service.serviceName))
      ?? targeted[Math.min(rowIndex, targeted.length - 1)];
    const organicResults = (row as Record<string, unknown>).organicResults;
    const results = Array.isArray(organicResults) ? organicResults : [row];
    results.slice(0, 4).forEach((result, resultIndex) => {
      const item = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
      const url = typeof item.url === "string" ? item.url
        : typeof (row as Record<string, unknown>).url === "string" ? (row as Record<string, unknown>).url as string
          : undefined;
      const title = String(item.title ?? (row as Record<string, unknown>).title ?? "");
      const snippet = String(item.description ?? item.snippet ?? item.text ?? (row as Record<string, unknown>).text ?? "");
      const { cents, matched } = extractPriceCents(`${snippet} ${title}`);
      observations.push({
        id: `apify-${rowIndex}-${resultIndex}`,
        source: "apify",
        competitorName: hostnameLabel(url) ?? (title.slice(0, 60) || "Web result"),
        serviceName: matchedService?.serviceName ?? (queryTerm || "Unknown service"),
        observedPriceCents: cents,
        observedText: matched ?? (snippet ? snippet.slice(0, 140) : undefined),
        url
      });
    });
  });

  if (!observations.length) return null;
  observations.sort((a, b) => Number(b.observedPriceCents !== null) - Number(a.observedPriceCents !== null));
  return observations.slice(0, 12);
}

export const pricingTools = {
  list_service_catalog: defineTool({
    description: "List service catalog prices for pricing review.",
    parameters: z.object({}),
    execute: async (_args, runtime) => ({ services: await runtime.adapters.pricing.listServices() })
  }),
  run_competitor_scan: defineTool({
    description: "Read sample or Apify-normalized competitor pricing observations.",
    parameters: z.object({
      source: z.enum(["sample", "apify"]).optional()
    }),
    execute: async (args, runtime) => {
      if (args.source === "apify") {
        const services = await runtime.adapters.pricing.listServices();
        const live = await fetchApifyPricing(services);
        if (live?.length) {
          await runtime.adapters.pricing.replaceObservations(live);
          recordEvent(runtime, {
            eventType: "apify_scan",
            title: "Apify pricing scan completed",
            detail: `${live.length} live observation(s) normalized.`,
            metadata: { provider: "apify", count: live.length }
          });
          return { mode: "apify", observations: live };
        }
        const fallback = samplePricing(runtime.data);
        await runtime.adapters.pricing.replaceObservations(fallback);
        recordEvent(runtime, {
          eventType: "apify_fallback",
          title: "Apify pricing fallback used",
          detail: "Apify token missing or live scan returned no usable results; using sample pricing.",
          metadata: { provider: "mock", actor: process.env.APIFY_PRICING_ACTOR_ID || DEFAULT_SEARCH_ACTOR, apifyConfigured: apifyConfigured() }
        });
        return { mode: "mock", observations: fallback };
      }
      const observations = await runtime.adapters.pricing.listObservations({ source: args.source });
      const selected = observations.length ? observations : samplePricing(runtime.data);
      await runtime.adapters.pricing.replaceObservations(selected);
      return { mode: "mock", observations: selected };
    }
  }),
  compare_service_prices: defineTool({
    description: "Compare service catalog to competitor pricing observations.",
    parameters: z.object({}),
    execute: async (_args, runtime) => {
      const [services, observations] = await Promise.all([
        runtime.adapters.pricing.listServices(),
        runtime.adapters.pricing.listObservations()
      ]);
      return { comparisons: comparePrices(services, observations) };
    }
  }),
  create_price_review_report: defineTool({
    description: "Create a pricing report without changing prices or creating a review task.",
    parameters: z.object({
      summary: z.string(),
      flaggedCount: z.number(),
      comparisons: z.array(z.unknown()),
      recommendations: z.array(z.unknown()).optional()
    }),
    execute: async (args, runtime) => {
      const report = addEffect(runtime, makeReport({
        reportType: "pricing",
        title: "Competitor pricing review",
        summary: args.summary,
        taskId: null,
        data: {
          comparisons: args.comparisons,
          recommendations: args.recommendations ?? [],
          changedPrices: false
        }
      }));
      recordEvent(runtime, {
        eventType: "pricing_report_created",
        title: "Pricing report created",
        detail: "No service prices were changed.",
        metadata: { reportId: report.id, flaggedCount: args.flaggedCount, changedPrices: false }
      });
      return { report };
    }
  })
};
