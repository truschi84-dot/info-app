// Chats: Liste (meine_chats, neueste oben, Zahl ungelesen) und ein Chat.
// Neue Nachrichten kommen live (Supabase Realtime, die Datenbank prueft dabei
// die Regeln); faellt das aus, wird alle 20 Sekunden nachgesehen.
// Texte immer per textContent - nie als HTML (Plan, Falle 8).
// Gelesen: im Einzelchat Haken, in Gruppen eine Zahl erst ab 3 Empfaengern
// (chat_lesestand liefert sonst nichts).
import { $, abteilungsChip, db, element, knopfBeschaeftigt, meldung, zeige, zeigeZwei } from "./gemeinsam.js?v=25";
import { chatMelden } from "./hinweise.js?v=25";

const NACHSEHEN_MS = 20000;
const SEITE = 100;
// Nur die freigegebenen Spalten - "*" schliesst gemeldet_am ein, und dann lehnt die Datenbank die ganze Abfrage ab.
const SPALTEN = "id, unterhaltung_id, autor_id, text, wichtig, ablauf_am, erstellt_am, bearbeitet_am, geloescht_am";
const breit = window.matchMedia("(min-width: 1024px)");

let ich = null;
let chats = [];
let offen = null;          // Zeile aus meine_chats
let nachrichten = [];
let namen = new Map();
let abteilungVon = new Map();
let lesestand = null;      // { empfaenger, gelesen_bis[] }
let kanal = null;
let listenKanal = null;
let uhr = null;
let alleGeladen = false;

export function chatsEinrichten(zurueck) {
  $("#chats-zurueck").addEventListener("click", () => { schliessen(); zurueck(); });
  $("#chat-zurueck").addEventListener("click", () => { kanalZu(); offen = null; zeigeChats(ich); });
  $("#chat-neu").addEventListener("click", () => { $("#chat-personen").hidden = !$("#chat-personen").hidden; personenZeichnen(); });
  $("#chat-personen-suche").addEventListener("input", personenZeichnen);
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); senden(); });
  // Enter schickt ab (am PC), Umschalt+Enter macht eine neue Zeile.
  $("#chat-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && breit.matches) { e.preventDefault(); senden(); }
  });
  $("#chat-aeltere").addEventListener("click", aeltereLaden);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && offen && !$("[data-bildschirm=chat]").hidden) nachrichtenLaden();
  });
}

// Fuer die Kachel auf der Startseite.
export async function chatsUngelesen() {
  const { data } = await db.rpc("meine_chats");
  return (data || []).reduce((n, c) => n + c.ungelesen, 0);
}

export async function zeigeChats(angemeldet) {
  ich = angemeldet;
  if (!(breit.matches && offen)) zeige("chats");
  meldung("#chats-meldung", "");
  const [c, p] = await Promise.all([
    db.rpc("meine_chats"),
    db.from("profile").select("id, name, abteilung, aktiv").eq("aktiv", true).order("name"),
  ]);
  if (c.error) return meldung("#chats-meldung", "Konnte nicht laden: " + c.error.message);
  chats = c.data;
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  abteilungVon = new Map((p.data || []).map((x) => [x.id, x.abteilung]));
  listeZeichnen();
  personenZeichnen();
  listeLive();
}

// Chat direkt oeffnen (aus einer Push-Nachricht).
export async function chatOeffnen(angemeldet, id) {
  await zeigeChats(angemeldet);
  const c = chats.find((x) => x.id === id);
  if (!c) return meldung("#chats-meldung", "Diesen Chat gibt es nicht mehr oder du bist nicht (mehr) dabei.");
  chatZeigen(c);
}

const ART_TEXT = { einzel: "", offen: "Gruppe", ankuendigung: "📢 Ankündigung" };

function listeZeichnen() {
  $("#chats-liste").replaceChildren(...(chats.length ? chats.map((c) => element("li", { "data-id": c.id, klasse: offen?.id === c.id ? "offen" : "" },
    element("button", { klasse: "eintrag-knopf chat-zeile", onclick: () => chatZeigen(c) },
      element("span", { klasse: "chat-bild", text: c.art === "einzel" ? anfang(c.name) : c.art === "ankuendigung" ? "📢" : "👥" }),
      element("span", { klasse: "chat-mitte" },
        element("strong", { text: c.name || "?" }),
        element("span", { klasse: "leise", text: c.letzte_text ? (c.art !== "einzel" && c.letzte_autor ? c.letzte_autor + ": " : "") + c.letzte_text : ART_TEXT[c.art] || "Noch keine Nachrichten" })),
      element("span", { klasse: "chat-rechts" },
        element("span", { klasse: "klein", text: zeitKurz(c.zeit) }),
        c.ungelesen ? element("span", { klasse: "neu-zahl", text: String(c.ungelesen) }) : null))))
    : [element("li", { klasse: "leise", text: "Noch keine Chats. Mit „＋ Neuer Chat“ jemandem schreiben." })]));
}

function personenZeichnen() {
  const suche = $("#chat-personen-suche").value.trim().toLowerCase();
  const leute = [...namen.entries()].filter(([id, n]) => id !== ich?.id && (!suche || n.toLowerCase().includes(suche)));
  $("#chat-personen-liste").replaceChildren(...leute.map(([id, n]) => element("li", {},
    element("button", { klasse: "eintrag-knopf", onclick: (e) => einzelchat(id, e.currentTarget) },
      element("strong", { text: n }),
      abteilungVon.get(id) ? abteilungsChip(abteilungVon.get(id)) : null))));
}

async function einzelchat(person, knopf) {
  knopfBeschaeftigt(knopf, true);
  const { data, error } = await db.rpc("einzelchat_oeffnen", { person });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#chats-meldung", "Chat ging nicht: " + error.message);
  $("#chat-personen").hidden = true;
  $("#chat-personen-suche").value = "";
  await chatOeffnen(ich, data);
}

// ── Ein Chat ────────────────────────────────────────────────────────────
async function chatZeigen(c) {
  kanalZu();
  offen = c;
  alleGeladen = false;
  nachrichten = [];
  $("#chat-titel").textContent = c.name || "?";
  $("#chat-unter").textContent = c.art === "einzel" ? "" : (c.beschreibung || ART_TEXT[c.art]);
  $("#chat-verlauf").replaceChildren();
  const schreiben = c.darf_schreiben;
  $("#chat-form").hidden = !schreiben;
  $("#chat-nur-lesen").hidden = schreiben;
  $("#chat-extras").hidden = c.art !== "ankuendigung";
  $("#chat-haltbarkeit").value = "";
  $("#chat-wichtig").checked = false;
  meldung("#chat-meldung", "");
  if (breit.matches) zeigeZwei("chats", "chat");
  else zeige("chat");
  for (const li of document.querySelectorAll("#chats-liste li")) li.classList.toggle("offen", li.dataset.id === c.id);
  await nachrichtenLaden();
  live();
}

async function nachrichtenLaden() {
  if (!offen) return;
  const id = offen.id;
  const [n, l] = await Promise.all([
    db.from("nachrichten").select(SPALTEN).eq("unterhaltung_id", id).order("erstellt_am", { ascending: false }).limit(Math.max(SEITE, nachrichten.length)),
    db.rpc("chat_lesestand", { chat: id }),
  ]);
  if (offen?.id !== id) return;
  if (n.error) return meldung("#chat-meldung", "Konnte nicht laden: " + n.error.message);
  alleGeladen = alleGeladen || n.data.length < Math.max(SEITE, nachrichten.length);
  nachrichten = n.data.reverse();
  lesestand = l.data?.[0] || null;
  verlaufZeichnen();
  if (document.visibilityState === "visible") gelesen();
}

async function aeltereLaden() {
  if (!offen || !nachrichten.length) return;
  const { data, error } = await db.from("nachrichten").select(SPALTEN).eq("unterhaltung_id", offen.id)
    .lt("erstellt_am", nachrichten[0].erstellt_am).order("erstellt_am", { ascending: false }).limit(SEITE);
  if (error) return meldung("#chat-meldung", error.message);
  alleGeladen = data.length < SEITE;
  nachrichten = [...data.reverse(), ...nachrichten];
  verlaufZeichnen(false);
}

async function gelesen() {
  if (!offen || !nachrichten.some((n) => n.autor_id !== ich.id)) return;
  await db.rpc("chat_gelesen", { chat: offen.id });
  const c = chats.find((x) => x.id === offen.id);
  if (c && c.ungelesen) { c.ungelesen = 0; listeZeichnen(); }
}

function verlaufZeichnen(nachUnten = true) {
  const kasten = $("#chat-verlauf");
  const warUnten = kasten.scrollHeight - kasten.scrollTop - kasten.clientHeight < 80;
  const teile = [];
  let tag = "";
  for (const n of nachrichten) {
    const t = new Date(n.erstellt_am).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
    if (t !== tag) { tag = t; teile.push(element("div", { klasse: "chat-tag", text: t })); }
    teile.push(blase(n));
  }
  if (!nachrichten.length) teile.push(element("p", { klasse: "leise chat-leer", text: "Noch keine Nachrichten." }));
  kasten.replaceChildren(...teile);
  $("#chat-aeltere").hidden = alleGeladen;
  if (nachUnten || warUnten) kasten.scrollTop = kasten.scrollHeight;
}

function blase(n) {
  const meine = n.autor_id === ich.id;
  const geloescht = !!n.geloescht_am;
  const meta = [uhrzeit(n.erstellt_am), n.bearbeitet_am ? "bearbeitet" : null,
    n.ablauf_am ? `gilt bis ${new Date(n.ablauf_am).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}` : null,
    meine && !geloescht ? gelesenText(n) : null].filter(Boolean).join(" · ");
  const b = element("div", { klasse: "blase" + (meine ? " meine" : "") + (n.wichtig ? " wichtig" : "") + (geloescht ? " geloescht" : "") },
    !meine && offen.art !== "einzel" ? element("span", { klasse: "blase-autor", text: namen.get(n.autor_id) || "Ehemalig" }) : null,
    n.wichtig && !geloescht ? element("span", { klasse: "blase-wichtig", text: "❗ Wichtig" }) : null,
    element("p", { klasse: "blase-text", text: geloescht ? "🚫 Nachricht gelöscht" : n.text }),
    element("span", { klasse: "blase-meta", text: meta }));
  if (meine && !geloescht) {
    b.title = "Antippen zum Löschen";
    b.addEventListener("click", () => loeschen(n));
  }
  return b;
}

// Einzelchat: ✓ gesendet, ✓✓ gelesen. Gruppe: "gelesen n" (nur ab 3 Empfaengern).
function gelesenText(n) {
  if (!lesestand) return "";
  // Als Zeitpunkte vergleichen, nicht als Text (Nachkommastellen sind nicht immer gleich lang).
  const gesendet = Date.parse(n.erstellt_am);
  const gelesenVon = (lesestand.gelesen_bis || []).filter((t) => Date.parse(t) >= gesendet).length;
  if (offen.art === "einzel") return gelesenVon ? "✓✓" : "✓";
  if (lesestand.gelesen_bis === null) return "";
  return `gelesen ${gelesenVon}/${lesestand.empfaenger}`;
}

async function senden() {
  const text = $("#chat-text").value.trim();
  if (!text || !offen) return;
  const knopf = $("#chat-senden");
  knopfBeschaeftigt(knopf, true);
  const tage = $("#chat-haltbarkeit").value;
  const zeile = { unterhaltung_id: offen.id, text };
  if (offen.art === "ankuendigung") {
    zeile.wichtig = $("#chat-wichtig").checked;
    if (tage) zeile.ablauf_am = new Date(Date.now() + Number(tage) * 86400e3).toISOString();
  }
  const { data, error } = await db.from("nachrichten").insert(zeile).select(SPALTEN).single();
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#chat-meldung", "Senden ging nicht: " + error.message);
  meldung("#chat-meldung", "");
  $("#chat-text").value = "";
  $("#chat-wichtig").checked = false;
  if (!nachrichten.some((x) => x.id === data.id)) nachrichten.push(data);
  verlaufZeichnen();
  chatMelden(data.id); // Push an die anderen - im Hintergrund, Fehler stoeren das Senden nicht
}

async function loeschen(n) {
  if (!confirm("Diese Nachricht für alle löschen?")) return;
  const { error } = await db.from("nachrichten").update({ geloescht_am: new Date().toISOString() }).eq("id", n.id);
  if (error) return meldung("#chat-meldung", "Löschen ging nicht: " + error.message);
  nachrichtenLaden();
}

// ── Live ────────────────────────────────────────────────────────────────
function live() {
  if (!offen) return;
  const id = offen.id;
  kanal = db.channel(`chat-${id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "nachrichten", filter: `unterhaltung_id=eq.${id}` }, () => nachrichtenLaden())
    .subscribe();
  // Rueckfall und "gelesen" der anderen: regelmaessig nachsehen, solange sichtbar.
  uhr = setInterval(() => { if (document.visibilityState === "visible") nachrichtenLaden(); }, NACHSEHEN_MS);
}

function listeLive() {
  if (listenKanal) return;
  listenKanal = db.channel("chatliste")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "nachrichten" }, async () => {
      const { data } = await db.rpc("meine_chats");
      if (!data) return;
      chats = data;
      if (offen) { const c = chats.find((x) => x.id === offen.id); if (c) c.ungelesen = 0; }
      listeZeichnen();
    })
    .subscribe();
}

function kanalZu() {
  clearInterval(uhr);
  if (kanal) db.removeChannel(kanal);
  kanal = null;
}

function schliessen() {
  kanalZu();
  if (listenKanal) db.removeChannel(listenKanal);
  listenKanal = null;
  offen = null;
}

// ── Kleinkram ───────────────────────────────────────────────────────────
const anfang = (name) => (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const uhrzeit = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
function zeitKurz(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const heute = new Date();
  if (d.toDateString() === heute.toDateString()) return uhrzeit(iso);
  const gestern = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() - 1);
  if (d.toDateString() === gestern.toDateString()) return "gestern";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
