// Notizen: nur fuer mich (die Datenbank laesst niemand anderen heran, auch
// den Admin nicht). Gespeichert wird von selbst, kurz nachdem man aufhoert zu
// tippen, und beim Verlassen. Am PC Liste links, Notiz rechts.
import { $, datumZeit, db, element, meldung, zeige, zeigeZwei } from "./gemeinsam.js?v=25";

const SPEICHER_PAUSE_MS = 800;
const breit = window.matchMedia("(min-width: 1024px)");

let notizen = [];
let offen = null;        // die gerade offene Notiz
let speicherUhr = null;
let ungespeichert = false;

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
  const { data, error } = await db.from("notizen").select("*").order("geaendert_am", { ascending: false });
  if (error) return meldung("#notizen-meldung", "Konnte nicht laden: " + error.message);
  notizen = data;
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
  $("#notiz-titel").value = n.titel;
  $("#notiz-text").value = n.text;
  $("#notiz-anheften").checked = n.angeheftet;
  status(`Gespeichert ${datumZeit(n.geaendert_am)}`);
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
  ungespeichert = true;
  status("…");
  clearTimeout(speicherUhr);
  speicherUhr = setTimeout(jetztSpeichern, SPEICHER_PAUSE_MS);
}

async function jetztSpeichern() {
  clearTimeout(speicherUhr);
  if (!offen || !ungespeichert) return;
  ungespeichert = false;
  const neu = { titel: $("#notiz-titel").value.slice(0, 120), text: $("#notiz-text").value, angeheftet: $("#notiz-anheften").checked };
  const { data, error } = await db.from("notizen").update(neu).eq("id", offen.id).select().single();
  if (error) {
    ungespeichert = true;
    return status("⚠ Nicht gespeichert: " + error.message);
  }
  offen = data;
  notizen = notizen.map((n) => (n.id === data.id ? data : n));
  status(`Gespeichert ${datumZeit(data.geaendert_am)}`);
  listeZeichnen();
}

async function loeschen() {
  if (!offen || !confirm("Diese Notiz löschen? Das lässt sich nicht rückgängig machen.")) return;
  clearTimeout(speicherUhr);
  ungespeichert = false;
  const { error } = await db.from("notizen").delete().eq("id", offen.id);
  if (error) return status("⚠ Löschen ging nicht: " + error.message);
  offen = null;
  zeigeNotizen();
}

function status(text) {
  $("#notiz-status").textContent = text;
}
