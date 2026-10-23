// Nachschlagen: Sammlungen (Wiki/Tabelle) durchsuchen, Eintrag ansehen,
// anlegen, aendern, archivieren. Welche Felder es gibt, steht in
// sammlung_felder - nichts davon ist hier fest eingebaut.
// Schreiben duerfen Redakteure (ueberall) und - wenn im Wiki eingeschaltet -
// Abteilungsleiter fuer Eintraege, die nur ihren Abteilungen zugeordnet sind.
// Am PC stehen Liste und Eintrag nebeneinander. Oben steht, was seit dem
// letzten Oeffnen neu oder geaendert ist (wiki_neu).
import { $, abteilungsChip, datumZeit, db, element, knopfBeschaeftigt, meldung, zeige, zeigeZwei } from "./gemeinsam.js?v=22";
import { allesGesehen, eintragGesehen, neuigkeiten, wikiMelden } from "./hinweise.js?v=22";

const SUCH_PAUSE_MS = 250;
const breit = window.matchMedia("(min-width: 1024px)");

let ich = null;
let sammlungen = [];
let aktuell = null;            // gewaehlte Sammlung
let felder = [];               // Felder der gewaehlten Sammlung
let redakteurIn = new Set();   // Sammlungs-IDs, in denen ich Redakteur bin
let leitung = [];              // Abteilungen, die ich leite
let alleAbteilungen = [];
let namen = new Map();         // Profil-ID -> Name (fuer "geaendert von")
let meineAbteilung = null;
let geschuetzt = new Map();    // Eintrag-ID -> geschuetzte Werte (nur was ich sehen darf)
let geschuetztFuer = [];       // Abteilungen, die geschuetzte Felder dieser Sammlung sehen
let offenerEintrag = null;
let suchUhr = null;
let suchNr = 0;
let neu = new Map();           // Eintrag-ID -> { sammlung_id, titel, zeit, ganz_neu } (fuer mich neu/geaendert)

// Fenster breiter/schmaler gezogen: offenen Eintrag in der passenden Ansicht zeigen.
breit.addEventListener("change", () => {
  const offen = ["eintrag", "eintrag-formular"].find((n) => !document.querySelector(`[data-bildschirm="${n}"]`).hidden);
  if (offen) rechtsZeigen(offen);
});

export function nachschlagenEinrichten(zurueck) {
  $("#nachschlagen-zurueck").addEventListener("click", zurueck);
  $("#suche").addEventListener("input", () => {
    clearTimeout(suchUhr);
    suchUhr = setTimeout(listeLaden, SUCH_PAUSE_MS);
  });
  $("#eintrag-neu").addEventListener("click", () => formularZeigen(null));
  $("#eintrag-zurueck").addEventListener("click", () => zeigeListe());
  $("#formular").addEventListener("submit", (e) => { e.preventDefault(); speichern(); });
  $("#formular-abbrechen").addEventListener("click", () => (offenerEintrag ? eintragZeigen(offenerEintrag.id) : zeigeListe()));
  $("#alles-gesehen").addEventListener("click", async (e) => {
    knopfBeschaeftigt(e.currentTarget, true);
    const { error } = await allesGesehen();
    knopfBeschaeftigt(e.currentTarget, false);
    if (error) return meldung("#nachschlagen-meldung", "Ging nicht: " + error.message);
    neu.clear();
    neuigkeitenZeichnen();
    listeLaden();
  });
}

// Aus einer Push-Nachricht: Wiki des Eintrags waehlen und ihn zeigen.
export async function eintragOeffnen(angemeldet, id) {
  await zeigeNachschlagen(angemeldet);
  const { data } = await db.from("eintraege").select("sammlung_id").eq("id", id).maybeSingle();
  const sammlung = sammlungen.find((x) => x.id === data?.sammlung_id);
  if (!sammlung) return meldung("#nachschlagen-meldung", "Diesen Eintrag gibt es nicht mehr oder du darfst ihn nicht sehen.");
  if (aktuell?.id !== sammlung.id) await sammlungWaehlen(sammlung);
  await eintragZeigen(id);
}

function neuigkeitenZeichnen() {
  const liste = [...neu.entries()].sort((a, b) => b[1].zeit.localeCompare(a[1].zeit));
  $("#neuigkeiten").hidden = !liste.length;
  $("#neuigkeiten-titel").textContent = `🔔 Neu für dich (${liste.length})`;
  const wikiName = (id) => sammlungen.find((x) => x.id === id)?.name || "";
  $("#neuigkeiten-liste").replaceChildren(...liste.map(([id, x]) => element("li", {},
    element("button", { klasse: "eintrag-knopf", onclick: async () => {
      const sammlung = sammlungen.find((z) => z.id === x.sammlung_id);
      if (sammlung && aktuell?.id !== sammlung.id) await sammlungWaehlen(sammlung);
      eintragZeigen(id);
    } },
    neuMarke(x),
    element("strong", { text: x.titel }),
    element("span", { klasse: "leise", text: `${wikiName(x.sammlung_id)} · ${datumZeit(x.zeit)}` })))));
}

const neuMarke = (x) => element("span", { klasse: x.ganz_neu ? "marke-neu" : "marke-geaendert", text: x.ganz_neu ? "neu" : "geändert" });

export async function zeigeNachschlagen(angemeldet) {
  ich = angemeldet;
  zeige("nachschlagen");
  meldung("#nachschlagen-meldung", "");
  const [s, w, p, l, n] = await Promise.all([
    db.from("sammlungen").select("id, name, art, beschreibung, leiter_schreiben").eq("archiviert", false).order("name"),
    db.from("sammlung_schreiben").select("sammlung_id").eq("nutzer_id", ich.id),
    db.from("profile").select("id, name, abteilung"),
    db.from("abteilungsleiter").select("abteilung").eq("profil_id", ich.id),
    neuigkeiten(),
  ]);
  if (s.error) return meldung("#nachschlagen-meldung", "Konnte nicht laden: " + s.error.message);
  sammlungen = s.data;
  neu = new Map(n.map((x) => [x.id, x]));
  neuigkeitenZeichnen();
  redakteurIn = new Set((w.data || []).map((x) => x.sammlung_id));
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  meineAbteilung = (p.data || []).find((x) => x.id === ich.id)?.abteilung || null;
  leitung = (l.data || []).map((x) => x.abteilung).sort();
  alleAbteilungen = [...new Set([...(p.data || []).map((x) => x.abteilung), ...leitung].filter(Boolean))].sort();

  if (!sammlungen.length) {
    $("#sammlung-wahl").replaceChildren();
    $("#ergebnisse").replaceChildren();
    $("#eintrag-neu").hidden = true;
    return meldung("#nachschlagen-meldung", "Für dich ist noch nichts zum Nachschlagen freigegeben.", "hinweis");
  }
  await sammlungWaehlen(sammlungen.find((x) => x.id === aktuell?.id) || sammlungen[0]);
}

// Darf ich in dieser Sammlung ueberhaupt etwas anlegen? Und diesen Eintrag aendern?
// Admin ist in jedem Wiki Redakteur (wie in intern.darf_schreiben_s).
const redakteur = (s) => ich.rolle === "admin" || redakteurIn.has(s.id);
const leiterDarfHier = (s) => s.leiter_schreiben && leitung.length > 0;
const darfAendern = (e) => redakteur(aktuell)
  || (leiterDarfHier(aktuell) && e.abteilungen?.length > 0 && e.abteilungen.every((a) => leitung.includes(a)));
// Geschuetzte Felder: dieselbe Regel wie intern.darf_geschuetzt_lesen in der Datenbank
// (die Datenbank entscheidet - hier geht es nur darum, was angezeigt wird).
const darfGeschuetzt = () => ich.rolle === "admin" || redakteur(aktuell)
  || geschuetztFuer.includes(meineAbteilung) || leitung.some((a) => geschuetztFuer.includes(a));
const alleWerte = (e) => ({ ...(e.werte || {}), ...(geschuetzt.get(e.id) || {}) });

async function sammlungWaehlen(sammlung) {
  aktuell = sammlung;
  $("#sammlung-wahl").replaceChildren(...(sammlungen.length > 1 ? sammlungen.map((x) =>
    element("button", { klasse: "chip" + (x.id === sammlung.id ? " an" : ""), text: x.name, onclick: () => sammlungWaehlen(x) })) : []));
  $("#sammlung-titel").textContent = sammlung.name;
  $("#sammlung-beschreibung").textContent = sammlung.beschreibung || "";
  $("#eintrag-neu").hidden = !(redakteur(sammlung) || leiterDarfHier(sammlung));
  const [f, g, a] = await Promise.all([
    db.from("sammlung_felder").select("*").eq("sammlung_id", sammlung.id).order("reihenfolge"),
    db.from("eintrag_geschuetzt").select("eintrag_id, werte, eintraege!inner(sammlung_id)").eq("eintraege.sammlung_id", sammlung.id),
    db.from("sammlung_abteilung_geschuetzt").select("abteilung").eq("sammlung_id", sammlung.id),
  ]);
  felder = f.data || [];
  geschuetzt = new Map((g.data || []).map((x) => [x.eintrag_id, x.werte]));
  geschuetztFuer = (a.data || []).map((x) => x.abteilung).sort();
  await listeLaden();
}

function zeigeListe() {
  zeige("nachschlagen");
  listeLaden();
}

// ── Liste / Suche ───────────────────────────────────────────────────────
async function listeLaden() {
  if (!aktuell) return;
  const nr = ++suchNr;
  const suche = $("#suche").value.trim();
  const r = suche
    ? await db.rpc("nachschlagen", { suche, sammlung: aktuell.id })
    : await db.from("eintraege").select("id, titel, werte, stichwoerter, abteilungen, archiviert").eq("sammlung_id", aktuell.id).order("titel");
  if (nr !== suchNr) return; // eine neuere Suche ist schon unterwegs
  if (r.error) return meldung("#nachschlagen-meldung", "Suche ging nicht: " + r.error.message);
  meldung("#nachschlagen-meldung", "");

  const eintraege = r.data;
  $("#treffer-zahl").textContent = suche
    ? `${eintraege.length} Treffer für „${suche}"`
    : `${eintraege.length} Einträge`;
  const listenFelder = felder.filter((f) => f.in_liste);
  $("#ergebnisse").replaceChildren(aktuell.art === "tabelle"
    ? tabelle(eintraege, listenFelder)
    : element("ul", { klasse: "eintragsliste" }, ...eintraege.map((e) => listenZeile(e, listenFelder))));
}

function feldText(feld, wert) {
  if (wert == null || wert === "") return "";
  if (Array.isArray(wert)) return wert.join(" · ");
  return String(wert);
}

function listenZeile(e, listenFelder) {
  const zusatz = listenFelder.map((f) => feldText(f, alleWerte(e)[f.schluessel])).filter(Boolean).join(" · ");
  const punkte = felder.filter((f) => f.typ === "stichpunkte")
    .reduce((n, f) => n + [].concat(alleWerte(e)[f.schluessel] || []).length, 0);
  return element("li", { "data-id": e.id, klasse: offenerEintrag?.id === e.id ? "offen" : "" },
    element("button", { klasse: "eintrag-knopf", onclick: () => eintragZeigen(e.id) },
      neu.has(e.id) ? neuMarke(neu.get(e.id)) : null,
      element("strong", { text: e.titel }),
      zusatz ? element("span", { klasse: "leise", text: zusatz }) : null,
      ...(e.abteilungen || []).map((a) => abteilungsChip(a)),
      e.archiviert ? element("span", { klasse: "marke", text: "archiviert" }) : null,
      punkte ? element("span", { klasse: "zahl", text: `${punkte} Punkt${punkte === 1 ? "" : "e"}` }) : null,
    ));
}

function tabelle(eintraege, listenFelder) {
  const spalten = listenFelder.length ? listenFelder : felder;
  const kopf = element("tr", {},
    element("th", { text: "Titel" }),
    ...spalten.map((f) => element("th", { text: f.bezeichnung })),
    element("th", { text: "Abteilung" }));
  const zeilen = eintraege.map((e) => element("tr", { onclick: () => eintragZeigen(e.id), "data-id": e.id },
    element("td", {}, neu.has(e.id) ? neuMarke(neu.get(e.id)) : null, document.createTextNode((neu.has(e.id) ? " " : "") + e.titel)),
    ...spalten.map((f) => element("td", { text: feldText(f, alleWerte(e)[f.schluessel]) })),
    element("td", { text: (e.abteilungen || []).join(", ") })));
  return element("div", { klasse: "tabelle-rahmen" },
    element("table", { klasse: "tabelle" }, element("thead", {}, kopf), element("tbody", {}, ...zeilen)));
}

// Am PC: Liste links, Eintrag/Formular rechts. Am Handy: nacheinander.
function rechtsZeigen(name) {
  if (breit.matches) zeigeZwei("nachschlagen", name);
  else zeige(name);
  for (const li of document.querySelectorAll(".eintragsliste li")) li.classList.toggle("offen", li.dataset.id === offenerEintrag?.id);
}

// ── Ein Eintrag ─────────────────────────────────────────────────────────
async function eintragZeigen(id) {
  const [e, v] = await Promise.all([
    db.from("eintraege").select("*").eq("id", id).maybeSingle(),
    db.from("eintraege_verlauf").select("fassung_nr, titel, werte, abteilungen, geaendert_von, geaendert_am").eq("eintrag_id", id).order("fassung_nr", { ascending: false }),
  ]);
  if (!e.data) return meldung("#nachschlagen-meldung", "Eintrag nicht gefunden.");
  offenerEintrag = e.data;
  if (neu.has(id)) {
    neu.delete(id);
    // Abwarten: sonst zeigt der Start beim schnellen Zurueck noch die alte Zahl.
    const { error } = await eintragGesehen(id);
    if (error) meldung("#nachschlagen-meldung", "„Gelesen“ ging nicht: " + error.message);
    neuigkeitenZeichnen();
    for (const m of document.querySelectorAll(`#ergebnisse [data-id="${id}"] .marke-neu, #ergebnisse [data-id="${id}"] .marke-geaendert`)) m.remove();
  }

  $("#eintrag-sammlung").textContent = aktuell?.name || "";
  $("#eintrag-titel").textContent = e.data.titel;
  $("#eintrag-inhalt").replaceChildren(
    ...(e.data.abteilungen?.length ? [element("p", { klasse: "gilt-fuer" }, element("span", { klasse: "klein", text: "Gilt für: " }),
      ...e.data.abteilungen.map((a) => abteilungsChip(a)))] : []),
    ...felder.map((f) => (f.geschuetzt && !darfGeschuetzt()
      ? schlossAnzeige(f)
      : feldAnzeige(f, alleWerte(e.data)[f.schluessel]))).filter(Boolean));
  $("#eintrag-stichwoerter").replaceChildren(...(e.data.stichwoerter || []).map((s) => element("span", { klasse: "chip klein", text: s })));
  $("#eintrag-meta").textContent = `Zuletzt geändert ${datumZeit(e.data.geaendert_am)}`
    + (namen.get(e.data.geaendert_von) ? ` von ${namen.get(e.data.geaendert_von)}` : "")
    + (e.data.archiviert ? " · archiviert" : "");

  const knoepfe = $("#eintrag-knoepfe");
  knoepfe.replaceChildren();
  if (darfAendern(e.data)) {
    knoepfe.append(
      element("button", { klasse: "haupt", text: "✏️ Bearbeiten", onclick: () => formularZeigen(e.data) }),
      element("button", { klasse: e.data.archiviert ? "neben" : "gefahr", text: e.data.archiviert ? "Wiederherstellen" : "Archivieren",
        onclick: (ev) => archivieren(e.data, ev.currentTarget) }),
    );
  }

  const fassungen = v.data || [];
  $("#eintrag-verlauf").hidden = !fassungen.length;
  $("#verlauf-zahl").textContent = `Ältere Fassungen (${fassungen.length})`;
  $("#verlauf-liste").replaceChildren(...fassungen.map((f) => element("li", {},
    element("span", { klasse: "leise", text: `Fassung ${f.fassung_nr} · ${datumZeit(f.geaendert_am)}${namen.get(f.geaendert_von) ? " · " + namen.get(f.geaendert_von) : ""}`
      + (f.abteilungen?.length ? ` · gilt für ${f.abteilungen.join(", ")}` : "") }),
    element("strong", { text: f.titel }),
    ...felder.map((feld) => feldAnzeige(feld, f.werte?.[feld.schluessel])).filter(Boolean),
  )));
  meldung("#eintrag-meldung", "");
  rechtsZeigen("eintrag");
}

function schlossAnzeige(feld) {
  return element("section", { klasse: "feld-anzeige geschlossen" },
    element("h3", { text: feld.bezeichnung }),
    element("p", { klasse: "leise", text: `🔒 Nur für ${geschuetztFuer.length ? geschuetztFuer.join(", ") : "Berechtigte"}` }));
}

function feldAnzeige(feld, wert) {
  if (wert == null || wert === "" || (Array.isArray(wert) && !wert.length)) return null;
  let inhalt;
  if (feld.typ === "stichpunkte") {
    inhalt = element("ul", { klasse: "stichpunkte" }, ...[].concat(wert).map((p) => element("li", { text: p })));
  } else if (feld.typ === "link" && /^https?:\/\//i.test(wert)) {
    inhalt = element("a", { href: wert, target: "_blank", rel: "noopener noreferrer", text: wert });
  } else {
    inhalt = element("p", { klasse: feld.typ === "langtext" ? "langtext" : "", text: feldText(feld, wert) });
  }
  return element("section", { klasse: "feld-anzeige" }, element("h3", { text: feld.bezeichnung }), inhalt);
}

async function archivieren(eintrag, knopf) {
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.from("eintraege").update({ archiviert: !eintrag.archiviert }).eq("id", eintrag.id);
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#eintrag-meldung", "Ging nicht: " + error.message);
  await eintragZeigen(eintrag.id);
  listeLaden();
}

// ── Formular: Felder kommen aus sammlung_felder ─────────────────────────
function formularZeigen(eintrag) {
  offenerEintrag = eintrag;
  $("#formular-ueberschrift").textContent = eintrag ? "Eintrag bearbeiten" : `Neuer Eintrag in „${aktuell.name}"`;
  $("#f-titel").value = eintrag?.titel || "";
  $("#f-stichwoerter").value = (eintrag?.stichwoerter || []).join(", ");
  // Neuer Eintrag: alle informieren vorbelegt. Aenderung: nur, wenn angehakt.
  $("#f-informieren").checked = !eintrag;
  $("#formular-felder").replaceChildren(...bearbeitbareFelder().map((f) => formularFeld(f, eintrag ? alleWerte(eintrag)[f.schluessel] : undefined)));

  // Zuordnung: Redakteure alle Abteilungen (leer = gilt fuer alle Leser),
  // Abteilungsleiter nur ihre eigenen und mindestens eine.
  const auswahl = redakteur(aktuell) ? alleAbteilungen : leitung;
  const gesetzt = new Set(eintrag?.abteilungen || (redakteur(aktuell) ? [] : leitung.slice(0, 1)));
  $("#f-abteilungen").replaceChildren(...auswahl.map((a) => {
    const box = element("input", { type: "checkbox", value: a });
    box.checked = gesetzt.has(a);
    return element("label", { klasse: "haken" }, box, abteilungsChip(a));
  }));
  $("#f-abteilungen-hinweis").textContent = redakteur(aktuell)
    ? "Gilt für (ohne Haken: für alle, die dieses Wiki lesen)"
    : "Gilt für (mindestens eine deiner Abteilungen)";
  $("#f-abteilungen-feld").hidden = !auswahl.length;

  meldung("#formular-meldung", "");
  rechtsZeigen("eintrag-formular");
  $("#f-titel").focus();
}

function formularFeld(f, wert) {
  const id = `f-feld-${f.schluessel}`;
  let eingabe;
  if (f.typ === "stichpunkte") {
    const punkte = [].concat(wert || []);
    eingabe = element("textarea", { id, rows: String(Math.min(20, Math.max(6, punkte.length + 2))), placeholder: "Ein Punkt pro Zeile" });
    eingabe.value = punkte.join("\n");
  } else if (f.typ === "langtext") {
    eingabe = element("textarea", { id, rows: "8" });
    eingabe.value = wert || "";
  } else if (f.typ === "auswahl") {
    eingabe = element("select", { id }, element("option", { value: "", text: "–" }),
      ...(f.auswahlwerte || []).map((a) => element("option", { value: a, text: a })));
    eingabe.value = wert || "";
  } else {
    const typ = { zahl: "number", datum: "date", link: "url" }[f.typ] || "text";
    eingabe = element("input", { id, type: typ });
    eingabe.value = wert ?? "";
  }
  return element("label", { klasse: "feld" },
    element("span", { text: f.bezeichnung + (f.pflicht ? " *" : "") + (f.typ === "stichpunkte" ? " (ein Punkt pro Zeile)" : "") }),
    eingabe);
}

async function speichern() {
  const titel = $("#f-titel").value.trim();
  if (!titel) return meldung("#formular-meldung", "Bitte einen Titel eingeben.");
  const werte = {};
  for (const f of bearbeitbareFelder()) {
    const roh = $(`#f-feld-${f.schluessel}`).value;
    let wert;
    if (f.typ === "stichpunkte") wert = roh.split("\n").map((z) => z.trim()).filter(Boolean);
    else if (f.typ === "zahl") wert = roh === "" ? null : Number(roh);
    else wert = roh.trim();
    if (f.pflicht && (wert == null || wert === "" || (Array.isArray(wert) && !wert.length))) {
      return meldung("#formular-meldung", `„${f.bezeichnung}" fehlt.`);
    }
    werte[f.schluessel] = wert;
  }
  const stichwoerter = $("#f-stichwoerter").value.split(",").map((s) => s.trim()).filter(Boolean);
  const abteilungen = [...document.querySelectorAll("#f-abteilungen input:checked")].map((b) => b.value);
  if (!redakteur(aktuell) && !abteilungen.length) return meldung("#formular-meldung", "Bitte mindestens eine Abteilung anhaken.");

  const knopf = $("#formular-speichern");
  knopfBeschaeftigt(knopf, true);
  // Offene Felder in "eintraege", geschuetzte in "eintrag_geschuetzt" (eigene Regeln).
  const offen = {};
  const zu = {};
  for (const f of felder) {
    if (!(f.schluessel in werte)) continue;
    (f.geschuetzt ? zu : offen)[f.schluessel] = werte[f.schluessel];
  }
  // Offene Felder, die ich nicht bearbeiten konnte, bleiben wie sie waren.
  const offenGesamt = { ...(offenerEintrag?.werte || {}), ...offen };

  const r = offenerEintrag
    ? await db.from("eintraege").update({ titel, werte: offenGesamt, stichwoerter, abteilungen }).eq("id", offenerEintrag.id).select("id").single()
    : await db.from("eintraege").insert({ sammlung_id: aktuell.id, titel, werte: offenGesamt, stichwoerter, abteilungen }).select("id").single();
  if (r.error) {
    knopfBeschaeftigt(knopf, false);
    return meldung("#formular-meldung", "Speichern ging nicht: " + r.error.message);
  }
  if (Object.keys(zu).length) {
    const alt = geschuetzt.get(r.data.id);
    const neu = { ...(alt || {}), ...zu };
    const g = alt
      ? await db.from("eintrag_geschuetzt").update({ werte: neu }).eq("eintrag_id", r.data.id).select("eintrag_id")
      : await db.from("eintrag_geschuetzt").insert({ eintrag_id: r.data.id, werte: neu }).select("eintrag_id");
    if (g.error || !g.data?.length) {
      knopfBeschaeftigt(knopf, false);
      return meldung("#formular-meldung", "Geschützte Felder gingen nicht: " + (g.error?.message || "keine Berechtigung"));
    }
    geschuetzt.set(r.data.id, neu);
  }
  knopfBeschaeftigt(knopf, false);
  const informieren = $("#f-informieren").checked;
  await eintragZeigen(r.data.id);
  listeLaden();
  if (!informieren) return;
  const m = await wikiMelden(r.data.id);
  meldung("#eintrag-meldung", m.status !== 200 ? "📣 Push ging nicht: " + (m.daten.fehler || "Fehler")
    : m.daten.hinweis ? "📣 " + m.daten.hinweis
    : `📣 Push an ${m.daten.gesendet} Gerät${m.daten.gesendet === 1 ? "" : "e"} gesendet.`, m.status === 200 ? "hinweis" : "fehler");
}

// Geschuetzte Felder nur, wenn ich sie sehen darf - sonst wuerde ich blind ueberschreiben.
const bearbeitbareFelder = () => felder.filter((f) => !f.geschuetzt || darfGeschuetzt());
