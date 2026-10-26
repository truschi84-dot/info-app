// Planer: Monatskalender mit Terminen (je Gruppe) und Abwesenheiten,
// eigener Urlaub (Antrag), Uebersicht je Abteilung (Leiter: ihre, Freigeber
// und Admin: alle) mit Hoechstzahl gleichzeitig Abwesender, offene Antraege.
// Geschrieben wird ueber die Datenbank-Funktionen abwesenheit_* und direkt
// in "termine" - die Zugriffsregeln entscheiden, wer was darf.
import {
  $, abteilungsChip, db, eingefaerbt, element, farbenLaden, hoechstzahl, knopfBeschaeftigt, meldung, zeige,
} from "./gemeinsam.js?v=33";

const ARTEN = { urlaub: "Urlaub", schule: "Schule / Fortbildung", sonstiges: "Sonstiges", krank: "Krank" };
// Zeichen je Abwesenheit. "Krank" sehen nur Leitung, Freigeber und Admin (Datenbank-Regel).
const zeichen = (a) => (a.art === "krank" ? "🤒" : a.status === "beantragt" ? "⏳" : a.art === "schule" ? "📚" : "🌴");
const STATUS = { beantragt: "beantragt", genehmigt: "genehmigt", abgelehnt: "abgelehnt", zurueckgezogen: "zurückgezogen" };
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

let ich = null;
let ansicht = "kalender";
let monat = ersterImMonat(new Date());
let gewaehlterTag = isoTag(new Date());
let namen = new Map();
let abtVon = new Map();   // profil_id -> Abteilung
let leute = [];           // aktive Personen
let geleitet = new Set(); // Abteilungen, die ich leite
let gruppen = [];          // Gruppen, die ich sehe: { id, name, art, schreiben }
let termine = [];
let abwesenheiten = [];   // im angezeigten Monat
let genehmigte = [];      // ab heute, fuer die Antraege-Ansicht
let team = [];            // fuer wen ich eintragen darf
let istLeiter = false;
let offenerTermin = null;

// ── Datum ohne Zeitzonen-Fallen: Tage als "JJJJ-MM-TT" in Ortszeit ─────────
function isoTag(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ersterImMonat(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function tagLesbar(iso) {
  const [j, m, t] = iso.split("-").map(Number);
  return new Date(j, m - 1, t).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}
function zeitraum(a) {
  const halb = a.halbtags ? ` (${a.halbtags})` : "";
  return a.von === a.bis ? tagLesbar(a.von) + halb : `${tagLesbar(a.von)} – ${tagLesbar(a.bis)}`;
}
function uhrzeit(iso) { return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }
function tageZwischen(von, bis) {
  const tage = [];
  const [j, m, t] = von.split("-").map(Number);
  for (let d = new Date(j, m - 1, t); isoTag(d) <= bis && tage.length < 366; d.setDate(d.getDate() + 1)) tage.push(isoTag(d));
  return tage;
}
const tagKurz = (iso) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

export function planerEinrichten(zurueck) {
  $("#planer-zurueck").addEventListener("click", zurueck);
  $("#monat-zurueck").addEventListener("click", () => { monat = new Date(monat.getFullYear(), monat.getMonth() - 1, 1); kalenderLaden(); });
  $("#monat-vor").addEventListener("click", () => { monat = new Date(monat.getFullYear(), monat.getMonth() + 1, 1); kalenderLaden(); });
  $("#monat-heute").addEventListener("click", () => { monat = ersterImMonat(new Date()); gewaehlterTag = isoTag(new Date()); kalenderLaden(); });
  $("#ueb-zurueck").addEventListener("click", () => { monat = new Date(monat.getFullYear(), monat.getMonth() - 1, 1); abteilungLaden(); });
  $("#ueb-vor").addEventListener("click", () => { monat = new Date(monat.getFullYear(), monat.getMonth() + 1, 1); abteilungLaden(); });
  $("#ueb-heute").addEventListener("click", () => { monat = ersterImMonat(new Date()); abteilungLaden(); });
  $("#termin-neu").addEventListener("click", () => terminFormular(null));
  $("#termin-form").addEventListener("submit", (e) => { e.preventDefault(); terminSpeichern(); });
  $("#termin-abbrechen").addEventListener("click", () => { $("#termin-bereich").hidden = true; });
  $("#t-ganztags").addEventListener("change", () => { $("#t-zeiten").hidden = $("#t-ganztags").checked; });
  $("#urlaub-form").addEventListener("submit", (e) => { e.preventDefault(); urlaubBeantragen(); });
  for (const id of ["#u-von", "#u-bis"]) $(id).addEventListener("change", halbtagsPruefen);
}

// reiter (frei): "kalender" | "urlaub" | "abteilung" | "antraege" - z. B. von der Heute-Seite.
export async function zeigePlaner(angemeldet, reiter) {
  ich = angemeldet;
  if (reiter) ansicht = reiter;
  zeige("planer");
  const [p, g, m, l] = await Promise.all([
    db.from("profile").select("id, name, abteilung, aktiv").order("name"),
    db.from("unterhaltungen").select("id, name, art, archiviert").neq("art", "einzel").order("name"),
    db.from("mitglieder").select("unterhaltung_id, darf_schreiben").eq("nutzer_id", ich.id),
    db.from("abteilungsleiter").select("abteilung").eq("profil_id", ich.id),
    farbenLaden(),
  ]);
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  abtVon = new Map((p.data || []).map((x) => [x.id, x.abteilung]));
  leute = (p.data || []).filter((x) => x.aktiv);
  const meine = new Map((m.data || []).map((x) => [x.unterhaltung_id, x.darf_schreiben]));
  gruppen = (g.data || []).filter((x) => !x.archiviert).map((x) => ({
    ...x, schreiben: ich.rolle === "admin" || x.art === "offen" || meine.get(x.id) === true,
  }));

  // Fuer wen darf ich eintragen? Admin und Freigeber: alle; Leiter: ihre Abteilungen.
  geleitet = new Set((l.data || []).map((x) => x.abteilung));
  const alle = alleAbteilungen();
  team = (p.data || []).filter((x) => x.aktiv && x.id !== ich.id && (alle || geleitet.has(x.abteilung)));
  istLeiter = geleitet.size > 0;
  $("#u-fuer").replaceChildren(element("option", { value: "", text: "mich" }),
    ...team.map((x) => element("option", { value: x.id, text: x.name + (x.abteilung ? ` (${x.abteilung})` : "") })));
  $("#u-fuer-feld").hidden = !team.length;
  // Krank eintragen nur, wer fuer andere eintragen darf (Leitung, Freigeber, Admin).
  const krankWahl = $("#u-art option[value=krank]");
  if (team.length && !krankWahl) $("#u-art").append(element("option", { value: "krank", text: "🤒 Krank (nur für andere)" }));
  if (!team.length && krankWahl) krankWahl.remove();
  $("#u-fuer-hinweis").textContent = freigeber() ? "Für (du bist Freigeber – dann gleich genehmigt)" : "Für (wartet dann auf die Freigabe)";
  ansichtWaehlen(ansicht);
}

function ansichtWaehlen(name) {
  const reiter = [["kalender", "📅 Kalender"], ["urlaub", "🌴 Mein Urlaub"]];
  if (istLeiter || alleAbteilungen()) reiter.push(["abteilung", "👥 Übersicht"]);
  if (freigeber()) reiter.push(["antraege", "✅ Anträge"]);
  if (!reiter.some(([k]) => k === name)) name = "kalender";
  ansicht = name;
  $("#planer-reiter").replaceChildren(...reiter.map(([k, t]) =>
    element("button", { klasse: "chip" + (k === name ? " an" : ""), text: t, onclick: () => ansichtWaehlen(k) })));
  $("#planer-kalender").hidden = name !== "kalender";
  $("#planer-urlaub").hidden = name !== "urlaub";
  $("#planer-abteilung").hidden = name !== "abteilung";
  $("#planer-antraege").hidden = name !== "antraege";
  meldung("#planer-meldung", "");
  if (name === "kalender") kalenderLaden();
  if (name === "urlaub") urlaubLaden();
  if (name === "abteilung") abteilungLaden();
  if (name === "antraege") antraegeLaden();
}

// ── Kalender ────────────────────────────────────────────────────────────
async function kalenderLaden() {
  const start = isoTag(monat);
  const ende = isoTag(new Date(monat.getFullYear(), monat.getMonth() + 1, 0));
  $("#monat-name").textContent = `${MONATE[monat.getMonth()]} ${monat.getFullYear()}`;
  $("#termin-neu").hidden = !gruppen.some((g) => g.schreiben);
  const [t, a] = await Promise.all([
    db.from("termine").select("*").gte("beginn", new Date(monat.getFullYear(), monat.getMonth(), 1).toISOString())
      .lt("beginn", new Date(monat.getFullYear(), monat.getMonth() + 1, 1).toISOString()).order("beginn"),
    db.from("abwesenheiten").select("id, profil_id, art, von, bis, halbtags, status")
      .lte("von", ende).gte("bis", start).in("status", ["genehmigt", "beantragt"]),
  ]);
  if (t.error || a.error) return meldung("#planer-meldung", "Kalender konnte nicht laden: " + (t.error || a.error).message);
  termine = t.data;
  abwesenheiten = a.data;
  monatZeichnen();
  tagZeigen(gewaehlterTag.startsWith(start.slice(0, 7)) ? gewaehlterTag : start);
}

function amTag(iso) {
  return {
    termine: termine.filter((t) => isoTag(new Date(t.beginn)) === iso),
    weg: abwesenheiten.filter((a) => a.von <= iso && a.bis >= iso),
  };
}

function monatZeichnen() {
  const heute = isoTag(new Date());
  const versatz = (monat.getDay() + 6) % 7; // Montag zuerst
  const tage = new Date(monat.getFullYear(), monat.getMonth() + 1, 0).getDate();
  const zellen = WOCHENTAGE.map((w) => element("div", { klasse: "kal-kopf", text: w }));
  for (let i = 0; i < versatz; i++) zellen.push(element("div", { klasse: "kal-leer" }));
  for (let tag = 1; tag <= tage; tag++) {
    const iso = isoTag(new Date(monat.getFullYear(), monat.getMonth(), tag));
    const { termine: tt, weg } = amTag(iso);
    const krank = weg.filter((a) => a.art === "krank").length;
    const genehmigt = weg.filter((a) => a.status === "genehmigt").length - krank;
    const offen = weg.length - genehmigt - krank;
    const wochenende = [5, 6].includes((versatz + tag - 1) % 7);
    zellen.push(element("button", {
      klasse: "kal-tag" + (iso === heute ? " heute" : "") + (iso === gewaehlterTag ? " gewaehlt" : "") + (wochenende ? " we" : ""),
      "aria-label": tagLesbar(iso), onclick: () => tagZeigen(iso),
    },
    element("span", { klasse: "kal-zahl", text: String(tag) }),
    element("span", { klasse: "kal-marken" },
      tt.length ? element("span", { klasse: "marke-termin", text: `${tt.length}` }) : null,
      genehmigt ? element("span", { klasse: "marke-weg", text: `🌴${genehmigt}` }) : null,
      offen ? element("span", { klasse: "marke-weg", title: "beantragt", text: `⏳${offen}` }) : null,
      krank ? element("span", { klasse: "marke-weg", title: "krank", text: `🤒${krank}` }) : null),
    kalTexte(tt, weg)));
  }
  $("#kalender").replaceChildren(...zellen);
}

// Am PC (CSS) statt Zahlen: Termine und Namen direkt im Tag, hoechstens 4 Zeilen.
const KAL_ZEILEN = 4;
function kalTexte(tt, weg) {
  const zeilen = [
    ...tt.filter((t) => !t.abgesagt_am).map((t) => ({ k: "t", text: (t.ganztags ? "" : uhrzeit(t.beginn) + " ") + t.titel })),
    ...weg.map((a) => ({ k: "w", text: `${zeichen(a)} ${namen.get(a.profil_id) || "?"}`, abt: abtVon.get(a.profil_id) })),
  ];
  const sichtbar = zeilen.slice(0, zeilen.length > KAL_ZEILEN ? KAL_ZEILEN - 1 : KAL_ZEILEN);
  const rest = zeilen.length - sichtbar.length;
  return element("span", { klasse: "kal-texte" },
    ...sichtbar.map((z) => eingefaerbt(element("span", { klasse: z.k, text: z.text }), z.abt)),
    rest ? element("span", { klasse: "mehr", text: `+${rest} mehr` }) : null);
}

function tagZeigen(iso) {
  gewaehlterTag = iso;
  for (const b of document.querySelectorAll(".kal-tag")) b.classList.toggle("gewaehlt", b.getAttribute("aria-label") === tagLesbar(iso));
  const { termine: tt, weg } = amTag(iso);
  const gruppeName = (id) => gruppen.find((g) => g.id === id)?.name || "";
  const liste = [
    ...tt.map((t) => element("li", { klasse: "tag-eintrag" + (t.abgesagt_am ? " abgesagt" : "") },
      element("button", { klasse: "eintrag-knopf", onclick: () => terminFormular(t) },
        element("strong", { text: (t.ganztags ? "ganztags" : uhrzeit(t.beginn) + (t.ende ? "–" + uhrzeit(t.ende) : "")) + "  " + t.titel }),
        element("span", { klasse: "leise", text: [gruppeName(t.unterhaltung_id), t.ort, t.abgesagt_am ? "abgesagt" : null].filter(Boolean).join(" · ") }),
      ))),
    ...weg.map((a) => element("li", { klasse: "tag-eintrag" },
      element("div", { klasse: "eintrag-knopf ruhig" },
        element("strong", { text: `${zeichen(a)} ${namen.get(a.profil_id) || "?"}` }),
        element("span", {}, abtVon.get(a.profil_id) ? abteilungsChip(abtVon.get(a.profil_id)) : null,
          element("span", { klasse: "leise", text: ` ${ARTEN[a.art]}${a.halbtags ? " · " + a.halbtags : ""}${a.status === "beantragt" ? " · beantragt" : ""}` })),
      ))),
  ];
  $("#tag-titel").textContent = tagLesbar(iso);
  $("#tag-liste").replaceChildren(...(liste.length ? liste : [element("li", { klasse: "leise", text: "Nichts eingetragen." })]));
}

// ── Termin anlegen / aendern / absagen ──────────────────────────────────
function terminFormular(t) {
  const schreibbar = gruppen.filter((g) => g.schreiben);
  if (t && !schreibbar.some((g) => g.id === t.unterhaltung_id)) return; // nur ansehen
  offenerTermin = t;
  $("#termin-ueberschrift").textContent = t ? "Termin ändern" : "Neuer Termin";
  $("#t-gruppe").replaceChildren(...schreibbar.map((g) => element("option", { value: g.id, text: g.name })));
  $("#t-gruppe").disabled = !!t;
  if (t) $("#t-gruppe").value = t.unterhaltung_id;
  $("#t-titel").value = t?.titel || "";
  $("#t-datum").value = t ? isoTag(new Date(t.beginn)) : gewaehlterTag;
  $("#t-ganztags").checked = !!t?.ganztags;
  $("#t-zeiten").hidden = !!t?.ganztags;
  $("#t-von").value = t && !t.ganztags ? uhrzeit(t.beginn) : "08:00";
  $("#t-bis").value = t?.ende && !t.ganztags ? uhrzeit(t.ende) : "";
  $("#t-ort").value = t?.ort || "";
  $("#t-beschreibung").value = t?.beschreibung || "";
  const absagen = $("#termin-absagen");
  absagen.hidden = !t || !!t.abgesagt_am;
  absagen.onclick = () => terminAbsagen(t, absagen);
  meldung("#termin-meldung", "");
  $("#termin-bereich").hidden = false;
  $("#termin-bereich").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function terminSpeichern() {
  const titel = $("#t-titel").value.trim();
  const datum = $("#t-datum").value;
  if (!titel || !datum) return meldung("#termin-meldung", "Titel und Datum fehlen.");
  const ganztags = $("#t-ganztags").checked;
  const [j, m, t] = datum.split("-").map(Number);
  const zeit = (hhmm) => { const [h, mi] = hhmm.split(":").map(Number); return new Date(j, m - 1, t, h, mi); };
  const beginn = ganztags ? new Date(j, m - 1, t, 0, 0) : zeit($("#t-von").value || "08:00");
  const ende = !ganztags && $("#t-bis").value ? zeit($("#t-bis").value) : null;
  if (ende && ende < beginn) return meldung("#termin-meldung", "Das Ende liegt vor dem Anfang.");
  const daten = {
    titel, ganztags, beginn: beginn.toISOString(), ende: ende ? ende.toISOString() : null,
    ort: $("#t-ort").value.trim() || null, beschreibung: $("#t-beschreibung").value.trim() || null,
  };
  const knopf = $("#termin-speichern");
  knopfBeschaeftigt(knopf, true);
  const { error } = offenerTermin
    ? await db.from("termine").update(daten).eq("id", offenerTermin.id)
    : await db.from("termine").insert({ ...daten, unterhaltung_id: $("#t-gruppe").value });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#termin-meldung", "Speichern ging nicht: " + error.message);
  $("#termin-bereich").hidden = true;
  gewaehlterTag = datum;
  monat = new Date(j, m - 1, 1);
  kalenderLaden();
}

async function terminAbsagen(t, knopf) {
  if (!confirm(`„${t.titel}" absagen?`)) return;
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.from("termine").update({ abgesagt_am: new Date().toISOString() }).eq("id", t.id);
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#termin-meldung", "Absagen ging nicht: " + error.message);
  $("#termin-bereich").hidden = true;
  kalenderLaden();
}

// ── Mein Urlaub ─────────────────────────────────────────────────────────
function halbtagsPruefen() {
  const einTag = $("#u-von").value && $("#u-von").value === $("#u-bis").value;
  $("#u-halbtags-feld").hidden = !einTag;
  if (!einTag) $("#u-halbtags").value = "";
}

async function urlaubLaden() {
  const heute = isoTag(new Date());
  if (!$("#u-von").value) { $("#u-von").value = heute; $("#u-bis").value = heute; halbtagsPruefen(); }
  const [a, n] = await Promise.all([
    db.from("abwesenheiten").select("*").eq("profil_id", ich.id).order("von", { ascending: false }),
    db.from("abwesenheit_notizen").select("*"),
  ]);
  if (a.error) return meldung("#planer-meldung", "Konnte nicht laden: " + a.error.message);
  const notiz = new Map((n.data || []).map((x) => [x.abwesenheit_id, x]));
  $("#urlaub-liste").replaceChildren(...(a.data.length ? a.data.map((x) => {
    const nz = notiz.get(x.id);
    const zurueck = ["beantragt", "genehmigt"].includes(x.status) && x.bis >= heute;
    return element("li", { klasse: "antrag" },
      element("div", { klasse: "antrag-kopf" },
        element("strong", { text: `${ARTEN[x.art]} · ${zeitraum(x)}` }),
        element("span", { klasse: `status status-${x.status}`, text: STATUS[x.status] })),
      nz?.bemerkung ? element("p", { klasse: "klein", text: `Deine Bemerkung: ${nz.bemerkung}` }) : null,
      nz?.antwort ? element("p", { klasse: "klein", text: `Antwort: ${nz.antwort}` }) : null,
      zurueck ? element("button", { klasse: "neben klein-knopf", text: "Zurückziehen", onclick: (e) => zurueckziehen(x, e.currentTarget) }) : null);
  }) : [element("li", { klasse: "leise", text: "Noch nichts beantragt." })]));
}

async function urlaubBeantragen() {
  const von = $("#u-von").value;
  const bis = $("#u-bis").value;
  if (!von || !bis) return meldung("#urlaub-meldung", "Bitte Anfang und Ende wählen.");
  const krank = $("#u-art").value === "krank";
  if (krank && !$("#u-fuer").value) return meldung("#urlaub-meldung", "Krank trägst du für jemand anderen ein – bitte bei „Für“ die Person wählen.");
  const fuer = $("#u-fuer").value || ich.id;
  const { data: dazu } = await db.from("abwesenheiten").select("profil_id, von, bis")
    .eq("status", "genehmigt").lte("von", bis).gte("bis", von);
  const warnung = engpass({ profil_id: fuer, von, bis }, dazu || []);
  if (warnung && !confirm(warnung + "\n\nTrotzdem eintragen?")) return;
  const knopf = $("#urlaub-los");
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.rpc("abwesenheit_beantragen", {
    art: $("#u-art").value, von, bis, halbtags: $("#u-halbtags").value || null,
    bemerkung: $("#u-bemerkung").value.trim() || null, fuer: $("#u-fuer").value || null,
  });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#urlaub-meldung", error.message);
  const fuerJemand = $("#u-fuer").value;
  meldung("#urlaub-meldung",
    krank ? "Krankmeldung eingetragen. Sehen können sie nur Leitung und Chefs."
      : !fuerJemand ? "Beantragt. Du siehst hier, sobald entschieden ist."
      : freigeber() ? "Eingetragen und genehmigt."
      : "Eingetragen. Es wartet jetzt auf die Freigabe.", "hinweis");
  $("#u-bemerkung").value = "";
  urlaubLaden();
}

async function zurueckziehen(x, knopf, danach = urlaubLaden) {
  if (!confirm(`${ARTEN[x.art]} ${zeitraum(x)} zurückziehen?`)) return;
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.rpc("abwesenheit_zurueckziehen", { abwesenheit: x.id });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#planer-meldung", error.message);
  danach();
}

// ── Hoechstzahl: an welchen Tagen waeren zu viele aus einer Abteilung weg? ─
// x = { profil_id, von, bis }, genehmigt = andere genehmigte Abwesenheiten.
function engpass(x, genehmigt) {
  const abt = abtVon.get(x.profil_id);
  const max = hoechstzahl(abt);
  if (!max) return "";
  const kollegen = genehmigt.filter((a) => a.profil_id !== x.profil_id && abtVon.get(a.profil_id) === abt);
  const zuViel = tageZwischen(x.von, x.bis).filter((tag) => {
    const weg = new Set(kollegen.filter((a) => a.von <= tag && a.bis >= tag).map((a) => a.profil_id));
    return weg.size + 1 > max;
  });
  if (!zuViel.length) return "";
  const tage = zuViel.length > 6 ? `${zuViel.slice(0, 5).map(tagKurz).join(", ")} und ${zuViel.length - 5} weitere Tage` : zuViel.map(tagKurz).join(", ");
  return `⚠ ${abt}: erlaubt sind höchstens ${max} gleichzeitig – am ${tage} wären es mehr.`;
}

// Admin ist immer auch Freigeber (wie in intern.ist_freigeber).
const freigeber = () => ich.rolle === "admin" || ich.darf_freigeben;
const alleAbteilungen = freigeber;

// ── Uebersicht: wer ist wann weg, je Abteilung, ein Monat ───────────────
async function belegungZeichnen() {
  const start = isoTag(monat);
  const ende = isoTag(new Date(monat.getFullYear(), monat.getMonth() + 1, 0));
  $("#ueb-monat").textContent = `${MONATE[monat.getMonth()]} ${monat.getFullYear()}`;
  const { data, error } = await db.from("abwesenheiten").select("profil_id, art, von, bis, halbtags, status")
    .lte("von", ende).gte("bis", start).in("status", ["genehmigt", "beantragt"]);
  if (error) return meldung("#planer-meldung", "Übersicht konnte nicht laden: " + error.message);

  const abteilungen = [...new Set(leute.map((x) => x.abteilung).filter(Boolean))].sort()
    .filter((a) => alleAbteilungen() || geleitet.has(a));
  const ohne = alleAbteilungen() && leute.some((x) => !x.abteilung);
  $("#uebersicht-hinweis").textContent = alleAbteilungen()
    ? "Alle Abteilungen. Die Höchstzahl stellst du rechts neben der Abteilung ein."
    : `Deine Abteilung${abteilungen.length === 1 ? "" : "en"}: ${abteilungen.join(", ") || "–"}`;
  await farbenLaden();

  heuteWegZeigen(abteilungen);
  const tage = tageZwischen(start, ende);
  const heute = isoTag(new Date());
  const wochenende = (iso) => { const [j, m, t] = iso.split("-").map(Number); return [0, 6].includes(new Date(j, m - 1, t).getDay()); };
  const tagKlasse = (iso) => (wochenende(iso) ? " we" : "") + (iso === heute ? " heute" : "");
  const kopf = element("tr", {}, element("th", { klasse: "name", text: "" }),
    ...tage.map((t) => element("th", { klasse: "tag" + tagKlasse(t), text: String(Number(t.slice(8))) })));

  const zeilen = [];
  for (const abt of [...abteilungen, ...(ohne ? [null] : [])]) {
    const leuteHier = leute.filter((x) => x.abteilung === abt);
    const max = abt ? hoechstzahl(abt) : null;
    const abwHier = data.filter((a) => leuteHier.some((x) => x.id === a.profil_id));
    const kopfZelle = element("th", { klasse: "name" }, abt ? abteilungsChip(abt) : element("span", { klasse: "leise", text: "ohne Abteilung" }),
      abt && alleAbteilungen() ? hoechstzahlWahl(abt, max) : max ? element("span", { klasse: "klein", text: ` max. ${max}` }) : null);
    zeilen.push(eingefaerbt(element("tr", { klasse: "abt-zeile" }, kopfZelle, ...tage.map((t) => {
      const weg = new Set(abwHier.filter((a) => a.status === "genehmigt" && a.von <= t && a.bis >= t).map((a) => a.profil_id)).size;
      const offen = abwHier.some((a) => a.status === "beantragt" && a.von <= t && a.bis >= t);
      const stufe = max && weg > max ? " drueber" : max && weg === max ? " voll" : "";
      return element("td", { klasse: "zahl-zelle" + tagKlasse(t) + stufe, title: `${tagKurz(t)}: ${weg} weg${max ? `, höchstens ${max}` : ""}${offen ? ", dazu offene Anträge" : ""}`,
        text: weg ? String(weg) + (offen ? "⏳" : "") : offen ? "⏳" : "" });
    })), abt));
    for (const p of leuteHier) {
      const eigene = abwHier.filter((a) => a.profil_id === p.id);
      zeilen.push(element("tr", {}, element("th", { klasse: "name person-name", text: p.name }), ...tage.map((t) => {
        const a = eigene.find((x) => x.von <= t && x.bis >= t);
        if (!a) return element("td", { klasse: tagKlasse(t).trim() });
        const krank = a.art === "krank";
        return eingefaerbt(element("td", { klasse: "weg" + (a.status === "beantragt" ? " offen" : "") + (krank ? " krank" : "") + tagKlasse(t),
          title: `${p.name}: ${krank ? "krank" : a.status === "beantragt" ? "beantragt" : ARTEN[a.art]}${a.halbtags ? " (" + a.halbtags + ")" : ""}`,
          text: krank ? "K" : a.halbtags ? "½" : "" }), abt);
      })));
    }
  }
  $("#belegung").replaceChildren(zeilen.length
    ? element("table", { klasse: "belegung" }, element("thead", {}, kopf), element("tbody", {}, ...zeilen))
    : element("p", { klasse: "leise", text: "Noch keine Personen mit Abteilung." }));
  // Heute in den sichtbaren Bereich schieben (am Handy ist die Tabelle breiter als der Bildschirm).
  const rahmen = $("#belegung");
  const heuteSpalte = $("th.heute", rahmen);
  const namensSpalte = $("th.name", rahmen);
  rahmen.scrollLeft = 0; // anderer Monat: wieder vorn anfangen
  if (heuteSpalte && namensSpalte) {
    rahmen.scrollLeft += heuteSpalte.getBoundingClientRect().left - rahmen.getBoundingClientRect().left
      - namensSpalte.getBoundingClientRect().width - 2 * heuteSpalte.getBoundingClientRect().width;
  }
}

// Kopfzeile "Heute weg": krank (sieht nur, wer es sehen darf - die Datenbank
// liefert es sonst gar nicht) und Urlaub/Schule, je mit Namen.
async function heuteWegZeigen(abteilungen) {
  const heute = isoTag(new Date());
  const { data } = await db.from("abwesenheiten").select("profil_id, art").eq("status", "genehmigt").lte("von", heute).gte("bis", heute);
  const leuteHier = new Set(leute.filter((x) => abteilungen.includes(x.abteilung)).map((x) => x.id));
  const weg = (data || []).filter((a) => leuteHier.has(a.profil_id));
  const gruppe = (titel, liste) => (liste.length ? element("span", {}, element("strong", { text: titel }),
    document.createTextNode(liste.map((a) => namen.get(a.profil_id)).sort().join(", "))) : null);
  const krank = weg.filter((a) => a.art === "krank");
  const sonst = weg.filter((a) => a.art !== "krank");
  $("#ueb-weg").replaceChildren(...(weg.length
    ? [element("span", { klasse: "klein", text: "Heute weg:" }),
      gruppe(`🤒 ${krank.length} krank:`, krank), gruppe(`🌴 ${sonst.length} Urlaub/Schule:`, sonst)].filter(Boolean)
    : []));
}

function hoechstzahlWahl(abt, max) {
  const wahl = element("select", { klasse: "hoechst", "aria-label": `Höchstzahl gleichzeitig weg in ${abt}` },
    element("option", { value: "", text: "max. –" }),
    ...Array.from({ length: 10 }, (_, i) => element("option", { value: String(i + 1), text: `max. ${i + 1}` })));
  wahl.value = max ? String(max) : "";
  wahl.addEventListener("change", async () => {
    wahl.disabled = true;
    const { error } = await db.rpc("abteilung_hoechstzahl_setzen", { abteilung: abt, zahl: wahl.value ? Number(wahl.value) : null });
    wahl.disabled = false;
    if (error) return meldung("#planer-meldung", "Höchstzahl ging nicht: " + error.message);
    belegungZeichnen();
  });
  return wahl;
}

// ── Abteilung (Leiter, Freigeber): Uebersicht + Abwesenheiten ab heute ──
async function abteilungLaden() {
  belegungZeichnen();
  const heute = isoTag(new Date());
  const ids = team.map((x) => x.id);
  const { data, error } = ids.length
    ? await db.from("abwesenheiten").select("*").in("profil_id", ids).gte("bis", heute)
      .in("status", ["beantragt", "genehmigt", "abgelehnt"]).order("von")
    : { data: [], error: null };
  if (error) return meldung("#planer-meldung", "Konnte nicht laden: " + error.message);
  $("#abteilung-hinweis").textContent = team.length
    ? `Du trägst für ${team.length} Person${team.length === 1 ? "" : "en"} ein – unter „Mein Urlaub" bei „Für".`
    : "Dir ist noch keine Abteilung zugeordnet.";
  $("#abteilung-liste").replaceChildren(...(data.length ? data.map((x) => element("li", { klasse: "antrag" },
    element("div", { klasse: "antrag-kopf" },
      element("strong", { text: `${namen.get(x.profil_id) || "?"} · ${ARTEN[x.art]} · ${zeitraum(x)}` }),
      element("span", { klasse: `status status-${x.status}`, text: STATUS[x.status] })),
    ["beantragt", "genehmigt"].includes(x.status)
      ? element("button", { klasse: "neben klein-knopf", text: "Zurückziehen", onclick: (e) => zurueckziehen(x, e.currentTarget, abteilungLaden) })
      : null,
  )) : [element("li", { klasse: "leise", text: "Nichts geplant." })]));
}

// ── Antraege (Freigeber) ────────────────────────────────────────────────
async function antraegeLaden() {
  const [a, n, g] = await Promise.all([
    db.from("abwesenheiten").select("*").eq("status", "beantragt").order("von"),
    db.from("abwesenheit_notizen").select("*"),
    db.from("abwesenheiten").select("id, profil_id, von, bis").eq("status", "genehmigt").gte("bis", isoTag(new Date())),
  ]);
  if (a.error) return meldung("#planer-meldung", "Konnte nicht laden: " + a.error.message);
  const notiz = new Map((n.data || []).map((x) => [x.abwesenheit_id, x]));
  genehmigte = g.data || [];
  $("#antraege-liste").replaceChildren(...(a.data.length ? a.data.map((x) => {
    const antwort = element("input", { placeholder: "Antwort (freiwillig)", maxlength: "500" });
    const ueberschneidung = abwesenheitenAndere(x);
    const zuViele = engpass(x, genehmigte);
    return element("li", { klasse: "antrag" },
      element("div", { klasse: "antrag-kopf" },
        element("strong", { text: `${namen.get(x.profil_id) || "?"} · ${ARTEN[x.art]}`
          + (x.eingetragen_von && x.eingetragen_von !== x.profil_id ? ` (eingetragen von ${namen.get(x.eingetragen_von) || "?"})` : "") }),
        element("span", { klasse: "leise", text: zeitraum(x) })),
      notiz.get(x.id)?.bemerkung ? element("p", { klasse: "klein", text: `Bemerkung: ${notiz.get(x.id).bemerkung}` }) : null,
      ueberschneidung ? element("p", { klasse: "klein warnung", text: ueberschneidung }) : null,
      zuViele ? element("p", { klasse: "klein warnung stark", text: zuViele }) : null,
      element("label", { klasse: "feld" }, element("span", { text: "Antwort" }), antwort),
      element("div", { klasse: "knoepfe klein" },
        element("button", { klasse: "haupt", text: "Genehmigen", onclick: (e) => {
          if (zuViele && !confirm(zuViele + "\n\nTrotzdem genehmigen?")) return;
          entscheiden(x, true, antwort.value, e.currentTarget);
        } }),
        element("button", { klasse: "gefahr", text: "Ablehnen", onclick: (e) => entscheiden(x, false, antwort.value, e.currentTarget) })));
  }) : [element("li", { klasse: "leise", text: "Keine offenen Anträge." })]));
}

// Wer ist im selben Zeitraum schon weg? Hilft beim Entscheiden.
function abwesenheitenAndere(x) {
  const andere = genehmigte.filter((a) => a.profil_id !== x.profil_id && a.von <= x.bis && a.bis >= x.von);
  if (!andere.length) return "";
  return "Gleichzeitig weg: " + [...new Set(andere.map((a) => namen.get(a.profil_id)))].join(", ");
}

async function entscheiden(x, genehmigt, antwort, knopf) {
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.rpc("abwesenheit_entscheiden", { abwesenheit: x.id, genehmigt, antwort: antwort.trim() || null });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#planer-meldung", error.message);
  antraegeLaden();
}
