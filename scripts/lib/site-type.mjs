/** Shared Roadside / Background grouping for BL SiteClassification and LAQN site_type. */

const ROADSIDE = /\b(kerbside|roadside|urban traffic)\b/i;
const BACKGROUND = /\b(urban background|suburban background|suburban|background)\b/i;
const DROP = /\b(industrial|rural|indoor)\b/i;

export function groupSiteType(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (DROP.test(t)) return null;
  if (ROADSIDE.test(t)) return "Roadside";
  if (BACKGROUND.test(t)) return "Background";
  return null;
}
