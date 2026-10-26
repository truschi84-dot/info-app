// Chats: Liste (meine_chats, neueste oben, Zahl ungelesen) und ein Chat.
// Neue Nachrichten kommen live (Supabase Realtime, die Datenbank prueft dabei
// die Regeln); faellt das aus, wird alle 20 Sekunden nachgesehen.
// Texte immer per textContent - nie als HTML (Plan, Falle 8).
// Gelesen: im Einzelchat Haken, in Gruppen eine Zahl erst ab 3 Empfaengern
// (chat_gelesen_zahlen liefert nur Zahlen je eigener Nachricht, sonst nichts).
// Als gelesen gilt nur, was wirklich auf dem Bildschirm steht.
import { $, abteilungsChip, db, element, knopfBeschaeftigt, meldung, zeige, zeigeZwei } from "./gemeinsam.js?v=30";
import { chatMelden } from "./hinweise.js?v=30";

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
let gelesenZahlen = new Map(); // eigene Nachricht -> { gelesen, empfaenger }
let lauf = 0;             // zaehlt Chat-Wechsel: alte Antworten/Kanaele erkennen
let sendetGerade = false;
const entwuerfe = new Map(); // Chat -> angefangener Text (bleibt beim Wechseln im richtigen Chat)
let kanal = null;
let listenKanal = null;
let uhr = null;
let alleGeladen = false;
let mitApp = new Set();      // anschreiben kann man nur, wer die App benutzt

export function chatsEinrichten(zurueck) {
  $("#chats-zurueck").addEventListener("click", () => { entwurfMerken(); schliessen(); zurueck(); });
  $("#chat-zurueck").addEventListener("click", () => { entwurfMerken(); kanalZu(); offen = null; zeigeChats(ich); });
  $("#chat-neu").addEventListener("click", () => { $("#chat-personen").hidden = !$("#chat-personen").hidden; personenZeichnen(); });
  $("#chat-personen-suche").addEventListener("input", personenZeichnen);
  $("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); senden(); });
  // Enter schickt ab (am PC), Umschalt+Enter macht eine neue Zeile.
  $("#chat-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && breit.matches) { e.preventDefault(); senden(); }
  });
  $("#chat-aeltere").addEventListener("click", aeltereLaden);
  document.addEventListener("visibilitychange", () => { if (chatSichtbar()) nachrichtenLaden(); });
}

// Nur wenn der Chat wirklich zu sehen ist, wird geladen und als gelesen markiert.
const chatSichtbar = () => !!offen && document.visibilityState === "visible" && !$("[data-bildschirm=chat]").hidden;

function entwurfMerken() {
  if (offen) entwuerfe.set(offen.id, $("#chat-text").value);
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
  const [c, p, a] = await Promise.all([
    db.rpc("meine_chats"),
    db.from("profile").select("id, name, abteilung, aktiv").eq("aktiv", true).order("name"),
    db.rpc("personen_mit_app"),
  ]);
  if (c.error) return meldung("#chats-meldung", "Konnte nicht laden: " + c.error.message);
  chats = c.data;
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  abteilungVon = new Map((p.data || []).map((x) => [x.id, x.abteilung]));
  mitApp = new Set(a.data || []);
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
  const leute = [...namen.entries()].filter(([id, n]) => id !== ich?.id && mitApp.has(id) && (!suche || n.toLowerCase().includes(suche)));
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
  entwurfMerken();
  kanalZu();
  const meinLauf = ++lauf;
  offen = c;
  gelesenZahlen = new Map();
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
  $("#chat-text").value = entwuerfe.get(c.id) || ""; // angefangener Text bleibt in seinem Chat
  meldung("#chat-meldung", "");
  if (breit.matches) zeigeZwei("chats", "chat");
  else zeige("chat");
  for (const li of document.querySelectorAll("#chats-liste li")) li.classList.toggle("offen", li.dataset.id === c.id);
  await nachrichtenLaden();
  if (meinLauf === lauf) live(c.id); // inzwischen anderen Chat gewaehlt: keinen Kanal fuer den alten
}

async function nachrichtenLaden() {
  if (!offen) return;
  const id = offen.id;
  const [n, l] = await Promise.all([
    db.from("nachrichten").select(SPALTEN).eq("unterhaltung_id", id).order("erstellt_am", { ascending: false }).limit(Math.max(SEITE, nachrichten.length)),
    db.rpc("chat_gelesen_zahlen", { chat: id }),
  ]);
  if (offen?.id !== id) return;
  if (n.error) return meldung("#chat-meldung", "Konnte nicht laden: " + n.error.message);
  alleGeladen = alleGeladen || n.data.length < Math.max(SEITE, nachrichten.length);
  nachrichten = n.data.reverse();
  gelesenZahlen = new Map((l.data || []).map((x) => [x.nachricht_id, x]));
  verlaufZeichnen();
  if (chatSichtbar()) gelesen();
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
  if (!chatSichtbar() || !nachrichten.some((n) => n.autor_id !== ich.id)) return;
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

// Einzelchat: ✓ gesendet, ✓✓ gelesen. Gruppe: "gelesen n/m" (die Datenbank
// liefert in Gruppen unter 3 Empfaengern nichts - dann steht hier nichts).
function gelesenText(n) {
  const z = gelesenZahlen.get(n.id);
  if (offen.art === "einzel") return z?.gelesen ? "✓✓" : "✓";
  return z ? `gelesen ${z.gelesen}/${z.empfaenger}` : "";
}

async function senden() {
  const feld = $("#chat-text");
  const text = feld.value.trim();
  // sendetGerade: zweimal schnell Enter darf nicht zwei Nachrichten ergeben.
  if (!text || !offen || sendetGerade) return;
  sendetGerade = true;
  const chat = offen.id;
  feld.value = ""; // sofort leeren - was jetzt getippt wird, gehoert zur naechsten Nachricht
  entwuerfe.delete(chat);
  const knopf = $("#chat-senden");
  knopfBeschaeftigt(knopf, true);
  const tage = $("#chat-haltbarkeit").value;
  const zeile = { unterhaltung_id: chat, text };
  if (offen.art === "ankuendigung") {
    zeile.wichtig = $("#chat-wichtig").checked;
    if (tage) zeile.ablauf_am = new Date(Date.now() + Number(tage) * 86400e3).toISOString();
  }
  const { data, error } = await db.from("nachrichten").insert(zeile).select(SPALTEN).single();
  knopfBeschaeftigt(knopf, false);
  sendetGerade = false;
  if (error) {
    // Text zurueck ins Feld (vor das inzwischen Getippte), damit nichts verloren geht.
    if (offen?.id === chat) feld.value = text + (feld.value ? "\n" + feld.value : "");
    else entwuerfe.set(chat, text);
    return meldung("#chat-meldung", "Senden ging nicht: " + error.message);
  }
  meldung("#chat-meldung", "");
  $("#chat-wichtig").checked = false;
  if (offen?.id === chat && !nachrichten.some((x) => x.id === data.id)) nachrichten.push(data);
  if (offen?.id === chat) verlaufZeichnen();
  chatMelden(data.id); // Push an die anderen - im Hintergrund, Fehler stoeren das Senden nicht
}

async function loeschen(n) {
  if (!confirm("Diese Nachricht für alle löschen?")) return;
  const { error } = await db.from("nachrichten").update({ geloescht_am: new Date().toISOString() }).eq("id", n.id);
  if (error) return meldung("#chat-meldung", "Löschen ging nicht: " + error.message);
  nachrichtenLaden();
}

// ── Live ────────────────────────────────────────────────────────────────
// Nur Neu und Geaendert: Loesch-Ereignisse prueft Supabase gegen keine Regel und
// keinen Filter - die kaemen von allen Chats und loesten unnoetiges Nachladen aus.
function live(id) {
  kanalZu();
  kanal = db.channel(`chat-${id}-${lauf}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "nachrichten", filter: `unterhaltung_id=eq.${id}` }, () => nachrichtenLaden())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "nachrichten", filter: `unterhaltung_id=eq.${id}` }, () => nachrichtenLaden())
    .subscribe();
  // Rueckfall und "gelesen" der anderen: regelmaessig nachsehen, solange der Chat zu sehen ist.
  uhr = setInterval(() => { if (chatSichtbar()) nachrichtenLaden(); }, NACHSEHEN_MS);
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
