// Nachschlagen: Sammlungen (Wiki/Tabelle) durchsuchen, Eintrag ansehen,
// fuer Redakteure anlegen, aendern, archivieren. Welche Felder es gibt,
// steht in sammlung_felder - nichts davon ist hier fest eingebaut.
import { $, datumZeit, db, element, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=12";

const SUCH_PAUSE_MS = 250;

let ich = null;
let sammlungen = [];
let aktuell = null;          // gewaehlte Sammlung
let felder = [];             // Felder der gewaehlten Sammlung
let darfSchreiben = new Set(); // Sammlungs-IDs, in denen ich Redakteur bin
let namen = new Map();       // Profil-ID -> Name (fuer "geaendert von")
let offenerEintrag = null;
let suchUhr = null;
let suchNr = 0;

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
}

export async function zeigeNachschlagen(angemeldet) {
  ich = angemeldet;
  zeige("nachschlagen");
  meldung("#nachschlagen-meldung", "");
  const [s, w, p] = await Promise.all([
    db.from("sammlungen").select("id, name, art, beschreibung").eq("archiviert", false).order("name"),
    db.from("sammlung_schreiben").select("sammlung_id").eq("nutzer_id", ich.id),
    db.from("profile").select("id, name"),
  ]);
  if (s.error) return meldung("#nachschlagen-meldung", "Konnte nicht laden: " + s.error.message);
  sammlungen = s.data;
  darfSchreiben = new Set((w.data || []).map((x) => x.sammlung_id));
  namen = new Map((p.data || []).map((x) => [x.id, x.name]));

  if (!sammlungen.length) {
    $("#sammlung-wahl").replaceChildren();
    $("#ergebnisse").replaceChildren();
    $("#eintrag-neu").hidden = true;
    return meldung("#nachschlagen-meldung", "Für dich ist noch nichts zum Nachschlagen freigegeben.", "hinweis");
  }
  await sammlungWaehlen(sammlungen.find((x) => x.id === aktuell?.id) || sammlungen[0]);
}

async function sammlungWaehlen(sammlung) {
  aktuell = sammlung;
  $("#sammlung-wahl").replaceChildren(...(sammlungen.length > 1 ? sammlungen.map((x) =>
    element("button", { klasse: "chip" + (x.id === sammlung.id ? " an" : ""), text: x.name, onclick: () => sammlungWaehlen(x) })) : []));
  $("#sammlung-titel").textContent = sammlung.name;
  $("#sammlung-beschreibung").textContent = sammlung.beschreibung || "";
  $("#eintrag-neu").hidden = !darfSchreiben.has(sammlung.id);
  const { data } = await db.from("sammlung_felder").select("*").eq("sammlung_id", sammlung.id).order("reihenfolge");
  felder = data || [];
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
    : await db.from("eintraege").select("id, titel, werte, stichwoerter, archiviert").eq("sammlung_id", aktuell.id).order("titel");
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
  const zusatz = listenFelder.map((f) => feldText(f, e.werte?.[f.schluessel])).filter(Boolean).join(" · ");
  const punkte = felder.filter((f) => f.typ === "stichpunkte")
    .reduce((n, f) => n + [].concat(e.werte?.[f.schluessel] || []).length, 0);
  return element("li", {},
    element("button", { klasse: "eintrag-knopf", onclick: () => eintragZeigen(e.id) },
      element("strong", { text: e.titel }),
      zusatz ? element("span", { klasse: "leise", text: zusatz }) : null,
      e.archiviert ? element("span", { klasse: "marke", text: "archiviert" }) : null,
      punkte ? element("span", { klasse: "zahl", text: `${punkte} Punkt${punkte === 1 ? "" : "e"}` }) : null,
    ));
}

function tabelle(eintraege, listenFelder) {
  const spalten = listenFelder.length ? listenFelder : felder;
  return element("div", { klasse: "tabelle-rahmen" },
    element("table", { klasse: "tabelle" },
      element("thead", {}, element("tr", {}, element("th", { text: "Titel" }), ...spalten.map((f) => element("th", { text: f.bezeichnung })))),
      element("tbody", {}, ...eintraege.map((e) => element("tr", { onclick: () => eintragZeigen(e.id) },
        element("td", { text: e.titel }), ...spalten.map((f) => element("td", { text: feldText(f, e.werte?.[f.schluessel]) }))))),
    ));
}

// ── Ein Eintrag ─────────────────────────────────────────────────────────
async function eintragZeigen(id) {
  const [e, v] = await Promise.all([
    db.from("eintraege").select("*").eq("id", id).maybeSingle(),
    db.from("eintraege_verlauf").select("fassung_nr, titel, werte, geaendert_von, geaendert_am").eq("eintrag_id", id).order("fassung_nr", { ascending: false }),
  ]);
  if (!e.data) return meldung("#nachschlagen-meldung", "Eintrag nicht gefunden.");
  offenerEintrag = e.data;
  const redakteur = darfSchreiben.has(e.data.sammlung_id);

  $("#eintrag-sammlung").textContent = aktuell?.name || "";
  $("#eintrag-titel").textContent = e.data.titel;
  $("#eintrag-inhalt").replaceChildren(...felder.map((f) => feldAnzeige(f, e.data.werte?.[f.schluessel])).filter(Boolean));
  $("#eintrag-stichwoerter").replaceChildren(...(e.data.stichwoerter || []).map((s) => element("span", { klasse: "chip klein", text: s })));
  $("#eintrag-meta").textContent = `Zuletzt geändert ${datumZeit(e.data.geaendert_am)}`
    + (namen.get(e.data.geaendert_von) ? ` von ${namen.get(e.data.geaendert_von)}` : "")
    + (e.data.archiviert ? " · archiviert" : "");

  const knoepfe = $("#eintrag-knoepfe");
  knoepfe.replaceChildren();
  if (redakteur) {
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
    element("span", { klasse: "leise", text: `Fassung ${f.fassung_nr} · ${datumZeit(f.geaendert_am)}${namen.get(f.geaendert_von) ? " · " + namen.get(f.geaendert_von) : ""}` }),
    element("strong", { text: f.titel }),
    ...felder.map((feld) => feldAnzeige(feld, f.werte?.[feld.schluessel])).filter(Boolean),
  )));
  meldung("#eintrag-meldung", "");
  zeige("eintrag");
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
  eintragZeigen(eintrag.id);
}

// ── Formular: Felder kommen aus sammlung_felder ─────────────────────────
function formularZeigen(eintrag) {
  offenerEintrag = eintrag;
  $("#formular-ueberschrift").textContent = eintrag ? "Eintrag bearbeiten" : `Neuer Eintrag in „${aktuell.name}"`;
  $("#f-titel").value = eintrag?.titel || "";
  $("#f-stichwoerter").value = (eintrag?.stichwoerter || []).join(", ");
  $("#formular-felder").replaceChildren(...felder.map((f) => formularFeld(f, eintrag?.werte?.[f.schluessel])));
  meldung("#formular-meldung", "");
  zeige("eintrag-formular");
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
    eingabe = element("textarea", { id, rows: "5" });
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
  for (const f of felder) {
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

  const knopf = $("#formular-speichern");
  knopfBeschaeftigt(knopf, true);
  const r = offenerEintrag
    ? await db.from("eintraege").update({ titel, werte, stichwoerter }).eq("id", offenerEintrag.id).select("id").single()
    : await db.from("eintraege").insert({ sammlung_id: aktuell.id, titel, werte, stichwoerter }).select("id").single();
  knopfBeschaeftigt(knopf, false);
  if (r.error) return meldung("#formular-meldung", "Speichern ging nicht: " + r.error.message);
  eintragZeigen(r.data.id);
}
