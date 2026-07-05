import { ArrowDown, ArrowUp, Minus, TrendingUp } from "lucide-react";

interface PricingObservation {
  id?: string;
  serviceName: string;
  competitorName?: string;
  observedPriceCents?: number | null;
  observedText?: string | null;
  source?: string;
  url?: string | null;
}

interface ServiceCatalogItem {
  id?: string;
  serviceName: string;
  currentPriceCents: number;
}

export interface PricingComparison {
  observation: PricingObservation;
  service?: ServiceCatalogItem | null;
  deltaCents?: number | null;
  recommendation?: string;
}

export function PricingComparisonsList({
  comparisons,
}: {
  comparisons: PricingComparison[];
}) {
  if (!comparisons || comparisons.length === 0) {
    return (
      <p className="noDetailsNote">No pricing comparisons available.</p>
    );
  }

  return (
    <div className="pricingCompList">
      <div className="pricingCompHeader">
        <span className="pricingCompCol pricingCompCol--service">Service</span>
        <span className="pricingCompCol pricingCompCol--competitor">Competitor</span>
        <span className="pricingCompCol pricingCompCol--ourPrice">Our Price</span>
        <span className="pricingCompCol pricingCompCol--theirPrice">Their Price</span>
        <span className="pricingCompCol pricingCompCol--delta">Δ</span>
      </div>
      {comparisons.map((comp, idx) => {
        const delta = comp.deltaCents;
        const isNull = delta === null || delta === undefined;
        const isHigh = !isNull && delta > 1000;
        const isLow = !isNull && delta < -1000;
        const cls = isNull
          ? "pricingCompRow--neutral"
          : isHigh
          ? "pricingCompRow--under"
          : isLow
          ? "pricingCompRow--over"
          : "pricingCompRow--ok";

        const ourPrice = comp.service?.currentPriceCents;
        const theirPrice = comp.observation.observedPriceCents;

        return (
          <div key={idx} className={`pricingCompRow ${cls}`}>
            <span className="pricingCompCol pricingCompCol--service">
              <TrendingUp size={12} className="pricingCompIcon" />
              {comp.observation.serviceName}
            </span>
            <span className="pricingCompCol pricingCompCol--competitor">
              {comp.observation.competitorName ?? "Competitor"}
            </span>
            <span className="pricingCompCol pricingCompCol--ourPrice">
              {ourPrice != null ? `$${(ourPrice / 100).toFixed(2)}` : "n/a"}
            </span>
            <span className="pricingCompCol pricingCompCol--theirPrice">
              {theirPrice != null
                ? `$${(theirPrice / 100).toFixed(2)}`
                : comp.observation.observedText ?? "n/a"}
            </span>
            <span className="pricingCompCol pricingCompCol--delta">
              {isNull ? (
                <Minus size={12} className="pricingCompDeltaIcon pricingCompDeltaIcon--neutral" />
              ) : isHigh ? (
                <span className="pricingCompDeltaChip pricingCompDeltaChip--under">
                  <ArrowUp size={10} />
                  {`+$${Math.abs(delta! / 100).toFixed(0)}`}
                </span>
              ) : isLow ? (
                <span className="pricingCompDeltaChip pricingCompDeltaChip--over">
                  <ArrowDown size={10} />
                  {`-$${Math.abs(delta! / 100).toFixed(0)}`}
                </span>
              ) : (
                <span className="pricingCompDeltaChip pricingCompDeltaChip--ok">≈</span>
              )}
            </span>
            {comp.recommendation && (
              <span className="pricingCompRec">{comp.recommendation}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
