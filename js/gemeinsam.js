// Gemeinsame Hilfen der Oberflaeche: Datenbank, Cloud-Funktionen,
// Geräte-Speicher, Bildschirmwechsel. Texte immer per textContent setzen,
// nie als HTML (Plan Abschnitt 5, Falle 8).
// Alle eigenen Module tragen dieselbe ?v=-Nummer wie in index.html. Ein Modul
// muss ueberall mit derselben Adresse eingebunden werden, sonst laeuft es doppelt.
import { SUPABASE, UMGEBUNG } from "./konfig.js?v=30";

export const db = window.supabase.createClient(SUPABASE.url, SUPABASE.key, {
  auth: { storageKey: `info-app-sitzung-${UMGEBUNG}`, persistSession: true, autoRefreshToken: true },
});

export async function funktion(name, body) {
  const { data: { session } } = await db.auth.getSession();
  const kopf = { "Content-Type": "application/json", apikey: SUPABASE.key };
  if (session) kopf.Authorization = `Bearer ${session.access_token}`;
  let r;
  try {
    r = await fetch(`${SUPABASE.url}/functions/v1/${name}`, { method: "POST", headers: kopf, body: JSON.stringify(body) });
  } catch {
    return { status: 0, daten: { fehler: "Keine Verbindung. Bitte Internet prüfen." } };
  }
  return { status: r.status, daten: await r.json().catch(() => ({})) };
}

export async function sitzungUebernehmen(daten) {
  const { error } = await db.auth.setSession({ access_token: daten.access_token, refresh_token: daten.refresh_token });
  if (error) throw new Error("Sitzung konnte nicht gespeichert werden.");
}

// ── Gerät: ID, Schluessel und Name liegen nur auf diesem Gerät ─────────
const GERAET_SCHLUESSEL = `info-app-geraet-${UMGEBUNG}`;

export function geraetLesen() {
  try {
    const g = JSON.parse(localStorage.getItem(GERAET_SCHLUESSEL) || "null");
    return g && g.geraet_id && g.schluessel ? g : null;
  } catch {
    return null;
  }
}

export function geraetMerken(geraet) {
  localStorage.setItem(GERAET_SCHLUESSEL, JSON.stringify(geraet));
}

export function geraetVergessen() {
  localStorage.removeItem(GERAET_SCHLUESSEL);
}

export function neuerGeraeteschluessel() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function geraeteName() {
  return /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? "Handy" : "PC";
}

// ── Oberflaeche ─────────────────────────────────────────────────────────
export const $ = (sel, wurzel = document) => wurzel.querySelector(sel);

export function zeige(name) {
  document.body.classList.remove("zweispaltig");
  for (const b of document.querySelectorAll("[data-bildschirm]")) b.hidden = b.dataset.bildschirm !== name;
  window.scrollTo(0, 0);
}

// Am PC zwei Bildschirme nebeneinander (z. B. Liste links, Eintrag rechts).
export function zeigeZwei(links, rechts) {
  document.body.classList.add("zweispaltig");
  for (const b of document.querySelectorAll("[data-bildschirm]")) {
    b.hidden = b.dataset.bildschirm !== links && b.dataset.bildschirm !== rechts;
  }
}

export function meldung(ziel, text, art = "fehler") {
  const m = typeof ziel === "string" ? $(ziel) : ziel;
  m.textContent = text || "";
  m.dataset.art = art;
  m.hidden = !text;
}

export function knopfBeschaeftigt(knopf, an) {
  knopf.disabled = an;
  knopf.classList.toggle("laedt", an);
}

export function element(tag, eigenschaften = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (k === "text") e.textContent = v;
    else if (k === "klasse") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kinder) if (k) e.append(k);
  return e;
}

// Ein Haken, der sofort speichert. Im change-Handler steht "checked" schon
// auf dem neuen Wert; geht das Speichern schief, wird er zurueckgesetzt.
export function haken(text, an, speichern, meldeZiel, danach = () => {}) {
  const box = element("input", { type: "checkbox" });
  box.checked = an;
  box.addEventListener("change", async () => {
    const neu = box.checked;
    box.disabled = true;
    const { error } = await speichern(neu);
    box.disabled = false;
    if (error) {
      box.checked = !neu;
      meldung(meldeZiel, "Speichern ging nicht: " + error.message);
      return;
    }
    danach();
  });
  return element("label", { klasse: "haken" }, box, element("span", { text }));
}

export const datumZeit = (iso) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// ── Abteilungsfarben ────────────────────────────────────────────────────
// Der Admin waehlt je Abteilung eine Farbe aus dieser Palette (Tabelle
// "abteilungen"). Ohne Wahl ergibt der Name immer dieselbe Farbe der Palette.
// Alle Farben sind kraeftig genug fuer einen Punkt auf hellem und dunklem Grund.
export const FARBEN = ["#0f766e", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#15803d",
  "#a16207", "#db2777", "#0891b2", "#65a30d", "#4f46e5", "#78716c"];
// In derselben Tabelle steht die Hoechstzahl gleichzeitig Abwesender (max_weg).
let farbenGewaehlt = new Map();
let hoechstzahlen = new Map();

export async function farbenLaden() {
  const { data } = await db.from("abteilungen").select("name, farbe, max_weg");
  farbenGewaehlt = new Map((data || []).filter((x) => x.farbe).map((x) => [x.name, x.farbe]));
  hoechstzahlen = new Map((data || []).filter((x) => x.max_weg).map((x) => [x.name, x.max_weg]));
}

export const hoechstzahl = (abteilung) => hoechstzahlen.get(abteilung) || null;

export function abteilungsFarbe(name) {
  if (!name) return null;
  if (farbenGewaehlt.has(name)) return farbenGewaehlt.get(name);
  let h = 0;
  for (const z of name) h = (h * 31 + z.codePointAt(0)) >>> 0;
  return FARBEN[h % FARBEN.length];
}

// Farbe an ein Element haengen (CSS liest --abt). Per CSSOM, das erlaubt die CSP.
export function eingefaerbt(e, abteilung) {
  const farbe = abteilungsFarbe(abteilung);
  if (farbe) {
    e.style.setProperty("--abt", farbe);
    e.classList.add("abt");
  }
  return e;
}

export const abteilungsChip = (name) => eingefaerbt(element("span", { klasse: "chip klein", text: name }), name);
