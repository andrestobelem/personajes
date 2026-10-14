import type { WorldClock } from "../domain/world-schema.ts";
/** Format the fictional clock using its recorded convention, never the machine timezone. */
export function formatFictionalClock(clock: WorldClock) {
  if (clock.convention.kind === "fixedOffset") {
    const shifted = new Date(
      clock.instant + clock.convention.offsetMinutes * 60_000,
    );
    return `${shifted.toISOString().slice(0, 19).replace("T", " ")} · ${clock.convention.label}`;
  }
  return `${new Intl.DateTimeFormat("es", { timeZone: clock.convention.zone, dateStyle: "medium", timeStyle: "medium" }).format(clock.instant)} · ${clock.convention.zone}`;
}
export function fictionalDateKey(clock: WorldClock) {
  if (clock.convention.kind === "fixedOffset")
    return new Date(clock.instant + clock.convention.offsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: clock.convention.zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock.instant);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
