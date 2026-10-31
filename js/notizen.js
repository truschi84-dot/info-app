// Notizen: nur fuer mich (die Datenbank laesst niemand anderen heran, auch
// den Admin nicht). Gespeichert wird von selbst, kurz nachdem man aufhoert zu
// tippen, und beim Verlassen. Am PC Liste links, Notiz rechts.
// Was noch nicht beim Server ist, liegt als Entwurf je Notiz bereit (auch im
// Geraet gespeichert) - ohne Netz geht nichts verloren, und eine spaete
// Server-Antwort kann nie eine andere Notiz ueberschreiben.
import { $, datumZeit, db, element, meldung, zeige, zeigeZwei } from "./gemeinsam.js?v=38";

const SPEICHER_PAUSE_MS = 800;
const breit = window.matchMedia("(min-width: 1024px)");

let notizen = [];
let offen = null;        // die gerade offene Notiz
let speicherUhr = null;
const ENTWURF_SCHLUESSEL = "info-app-notiz-entwuerfe";
const entwuerfe = new Map(); // Notiz-ID -> { titel, text, angeheftet }, noch nicht gespeichert
try {
  for (const [id, w] of Object.entries(JSON.parse(localStorage.getItem(ENTWURF_SCHLUESSEL) || "{}"))) entwuerfe.set(id, w);
} catch { /* kein Speicher im Geraet - dann nur im Arbeitsspeicher */ }

function entwuerfeSichern() {
  try { localStorage.setItem(ENTWURF_SCHLUESSEL, JSON.stringify(Object.fromEntries(entwuerfe))); } catch { /* egal */ }
}

export function notizenEinrichten(zurueck) {
  $("#notizen-zurueck").addEventListener("click", async () => { await jetztSpeichern(); zurueck(); });
  $("#notiz-neu").addEventListener("click", neueNotiz);
  $("#notizen-suche").addEventListener("input", listeZeichnen);
  $("#notiz-zurueck").addEventListener("click", async () => { await jetztSpeichern(); zeigeNotizen(); });
  for (const id of ["#notiz-titel", "#notiz-text"]) $(id).addEventListener("input", geaendert);
  $("#notiz-anheften").addEventListener("change", geaendert);
  $("#notiz-loeschen").addEventListener("click", loeschen);
  // Fenster zu oder App in den Hintergrund: nichts verlieren.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") jetztSpeichern(); });
}

export async function zeigeNotizen() {
  zeige("notizen");
  meldung("#notizen-meldung", "");
  await jetztSpeichern(); // liegengebliebene Entwuerfe zuerst
  const { data, error } = await db.from("notizen").select("*").order("geaendert_am", { ascending: false });
  if (error) return meldung("#notizen-meldung", "Konnte nicht laden: " + error.message);
  notizen = data;
  if (entwuerfe.size) meldung("#notizen-meldung", `${entwuerfe.size} Notiz${entwuerfe.size === 1 ? " ist" : "en sind"} noch nicht gespeichert (kein Netz?) – wird erneut versucht.`, "hinweis");
  listeZeichnen();
  if (breit.matches && offen) notizZeigen(notizen.find((n) => n.id === offen.id) || null);
}

function listeZeichnen() {
  const suche = $("#notizen-suche").value.trim().toLowerCase();
  const passend = notizen
    .filter((n) => !suche || (n.titel + " " + n.text).toLowerCase().includes(suche))
    .sort((a, b) => (b.angeheftet - a.angeheftet) || b.geaendert_am.localeCompare(a.geaendert_am));
  $("#notizen-zahl").textContent = suche ? `${passend.length} von ${notizen.length}` : `${notizen.length} Notiz${notizen.length === 1 ? "" : "en"}`;
  $("#notizen-liste").replaceChildren(...(passend.length ? passend.map((n) => element("li", { "data-id": n.id, klasse: offen?.id === n.id ? "offen" : "" },
    // Erst die offene Notiz sichern - sonst landet ihr Text in der neu gewaehlten.
    element("button", { klasse: "eintrag-knopf", onclick: async () => { await jetztSpeichern(); notizZeigen(notizen.find((x) => x.id === n.id)); } },
      element("strong", { text: (n.angeheftet ? "📌 " : "") + (n.titel || erstzeile(n.text) || "Ohne Titel") }),
      element("span", { klasse: "leise", text: `${datumZeit(n.geaendert_am)} · ${vorschau(n)}` }))))
    : [element("li", { klasse: "leise", text: suche ? "Nichts gefunden." : "Noch keine Notizen. Mit „＋ Neue Notiz“ anfangen." })]));
}

const erstzeile = (t) => (t || "").split("\n").find((z) => z.trim())?.trim().slice(0, 60) || "";
const vorschau = (n) => (n.titel ? erstzeile(n.text) : (n.text || "").split("\n").filter((z) => z.trim())[1] || "").slice(0, 80);

function notizZeigen(n) {
  offen = n;
  if (!n) return zeigeNotizen();
  const w = entwuerfe.get(n.id) || n; // Ungespeichertes hat Vorrang vor dem Stand vom Server
  $("#notiz-titel").value = w.titel;
  $("#notiz-text").value = w.text;
  $("#notiz-anheften").checked = w.angeheftet;
  status(entwuerfe.has(n.id) ? "⚠ Noch nicht gespeichert" : `Gespeichert ${datumZeit(n.geaendert_am)}`);
  if (breit.matches) zeigeZwei("notizen", "notiz");
  else zeige("notiz");
  for (const li of document.querySelectorAll("#notizen-liste li")) li.classList.toggle("offen", li.dataset.id === n.id);
}

async function neueNotiz() {
  await jetztSpeichern();
  const { data, error } = await db.from("notizen").insert({ titel: "", text: "" }).select().single();
  if (error) return meldung("#notizen-meldung", "Neue Notiz ging nicht: " + error.message);
  notizen.unshift(data);
  listeZeichnen();
  notizZeigen(data);
  $("#notiz-titel").focus();
}

function geaendert() {
  if (!offen) return;
  entwuerfe.set(offen.id, { titel: $("#notiz-titel").value.slice(0, 120), text: $("#notiz-text").value, angeheftet: $("#notiz-anheften").checked });
  entwuerfeSichern();
  status("…");
  clearTimeout(speicherUhr);
  speicherUhr = setTimeout(jetztSpeichern, SPEICHER_PAUSE_MS);
}

// Speichert alle Entwuerfe. Jeder bleibt liegen, bis der Server ihn bestaetigt
// hat - und wird nur geloescht, wenn inzwischen nicht weitergetippt wurde.
async function jetztSpeichern() {
  clearTimeout(speicherUhr);
  for (const [id, werte] of [...entwuerfe]) {
    const { data, error } = await db.from("notizen").update(werte).eq("id", id).select().single();
    if (error?.code === "PGRST116") { // Notiz gibt es nicht mehr (z. B. am anderen Geraet geloescht)
      entwuerfe.delete(id);
      entwuerfeSichern();
      continue;
    }
    if (error) {
      if (offen?.id === id) status("⚠ Nicht gespeichert: " + error.message);
      continue;
    }
    if (entwuerfe.get(id) === werte) entwuerfe.delete(id);
    entwuerfeSichern();
    notizen = notizen.map((n) => (n.id === id ? data : n));
    if (offen?.id === id) {
      offen = data;
      if (!entwuerfe.has(id)) status(`Gespeichert ${datumZeit(data.geaendert_am)}`);
    }
  }
  listeZeichnen();
}

async function loeschen() {
  if (!offen || !confirm("Diese Notiz löschen? Das lässt sich nicht rückgängig machen.")) return;
  clearTimeout(speicherUhr);
  const { error } = await db.from("notizen").delete().eq("id", offen.id);
  if (error) return status("⚠ Löschen ging nicht: " + error.message);
  entwuerfe.delete(offen.id);
  entwuerfeSichern();
  offen = null;
  zeigeNotizen();
}

function status(text) {
  $("#notiz-status").textContent = text;
}
