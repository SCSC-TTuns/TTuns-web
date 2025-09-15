// lib/utils/anonymousId.ts
export function getAnonymousId(): string | null {
  if (typeof window === "undefined") return null;

  let anonId = localStorage.getItem("anonymous_id");
  if (!anonId) {
    anonId = "anon_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("anonymous_id", anonId);
  }
  return anonId;
}
