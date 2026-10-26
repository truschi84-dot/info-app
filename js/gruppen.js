// Admin-Seite "Gruppen & Wikis": Gruppen anlegen und Mitglieder anhaken;
// Wikis/Tabellen anlegen, ihre Felder festlegen und bestimmen, wer liest
// (Gruppen, Abteilungen) und wer schreibt (Redakteure, Abteilungsleiter).
// Alles direkt ueber die Datenbank - die Zugriffsregeln lassen nur den Admin.
import { $, db, element, haken as sofortHaken, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=28";

const FELDTYPEN = {
  text: "Text (eine Zeile)", langtext: "Text (mehrere Zeilen)", stichpunkte: "Stichpunkte",
  zahl: "Zahl", datum: "Datum", link: "Link", auswahl: "Auswahl",
};

let personen = [];
let abteilungen = [];

export function gruppenEinrichten(zurueck) {
  $("#gruppen-zurueck").addEventListener("click", zurueck);
  $("#gruppe-anlegen").addEventListener("submit", (e) => { e.preventDefault(); gruppeAnlegen(); });
  $("#sammlung-anlegen").addEventListener("submit", (e) => { e.preventDefault(); sammlungAnlegen(); });
}

export async function zeigeGruppen() {
  zeige("gruppen");
  await laden();
}

async function laden() {
  meldung("#gruppen-meldung", "");
  const [p, g, m, s, l, w, a, f, ag] = await Promise.all([
    db.from("profile").select("id, name, abteilung, aktiv").order("name"),
    db.from("unterhaltungen").select("id, art, name, fuer_alle, archiviert").neq("art", "einzel").order("name"),
    db.from("mitglieder").select("unterhaltung_id, nutzer_id"),
    db.from("sammlungen").select("id, name, art, leiter_schreiben").eq("archiviert", false).order("name"),
    db.from("sammlung_lesen").select("sammlung_id, unterhaltung_id"),
    db.from("sammlung_schreiben").select("sammlung_id, nutzer_id"),
    db.from("sammlung_abteilung_lesen").select("sammlung_id, abteilung"),
    db.from("sammlung_felder").select("*").order("reihenfolge"),
    db.from("sammlung_abteilung_geschuetzt").select("sammlung_id, abteilung"),
  ]);
  const fehler = [p, g, m, s, l, w, a, f, ag].find((x) => x.error);
  if (fehler) return meldung("#gruppen-meldung", "Konnte nicht laden: " + fehler.error.message);
  personen = p.data.filter((x) => x.aktiv);
  abteilungen = [...new Set([...p.data.map((x) => x.abteilung), ...a.data.map((x) => x.abteilung), ...ag.data.map((x) => x.abteilung)]
    .filter(Boolean))].sort();

  const gruppen = g.data.filter((x) => !x.archiviert);
  $("#gruppen-liste").replaceChildren(...(gruppen.length ? gruppen.map((gr) => gruppeKarte(gr, m.data)) :
    [element("p", { klasse: "leise", text: "Noch keine Gruppe angelegt." })]));
  $("#rechte-liste").replaceChildren(...s.data.map((sa) => sammlungKarte(sa, gruppen, l.data, w.data, a.data, f.data, ag.data)));
}

function gruppeKarte(gr, mitglieder) {
  const drin = new Set(mitglieder.filter((x) => x.unterhaltung_id === gr.id).map((x) => x.nutzer_id));
  const art = gr.art === "ankuendigung" ? "Ankündigung" : "offene Gruppe";
  return element("article", { klasse: "person" },
    element("div", { klasse: "person-kopf" },
      element("strong", { text: gr.name }),
      element("span", { klasse: "leise", text: gr.fuer_alle ? `${art} · alle sind automatisch drin` : `${art} · ${drin.size} Mitglied${drin.size === 1 ? "" : "er"}` }),
    ),
    gr.fuer_alle ? null : element("div", { klasse: "haken-liste" }, ...personen.map((pe) => haken(
      pe.name, drin.has(pe.id),
      (an) => an
        ? db.from("mitglieder").insert({ unterhaltung_id: gr.id, nutzer_id: pe.id })
        : db.from("mitglieder").delete().eq("unterhaltung_id", gr.id).eq("nutzer_id", pe.id),
    ))),
  );
}

function sammlungKarte(sa, gruppen, lesen, schreiben, abtLesen, alleFelder, abtGeschuetzt) {
  const schutzAbt = new Set(abtGeschuetzt.filter((x) => x.sammlung_id === sa.id).map((x) => x.abteilung));
  const leseGruppen = new Set(lesen.filter((x) => x.sammlung_id === sa.id).map((x) => x.unterhaltung_id));
  const leseAbt = new Set(abtLesen.filter((x) => x.sammlung_id === sa.id).map((x) => x.abteilung));
  const schreiber = new Set(schreiben.filter((x) => x.sammlung_id === sa.id).map((x) => x.nutzer_id));
  const felder = alleFelder.filter((x) => x.sammlung_id === sa.id);
  return element("article", { klasse: "person" },
    element("div", { klasse: "person-kopf" },
      element("strong", { text: `${sa.art === "tabelle" ? "📊" : "📖"} ${sa.name}` }),
      element("span", { klasse: "leise", text: sa.art === "tabelle" ? "Tabelle" : "Wiki" })),

    element("p", { klasse: "klein", text: "Lesen dürfen diese Abteilungen:" }),
    element("div", { klasse: "haken-liste" }, ...(abteilungen.length ? abteilungen.map((ab) => haken(
      ab, leseAbt.has(ab),
      (an) => an
        ? db.from("sammlung_abteilung_lesen").insert({ sammlung_id: sa.id, abteilung: ab })
        : db.from("sammlung_abteilung_lesen").delete().eq("sammlung_id", sa.id).eq("abteilung", ab),
    )) : [element("span", { klasse: "leise", text: "Erst bei „Personen“ Abteilungen eintragen." })])),

    element("p", { klasse: "klein", text: "… und diese Gruppen:" }),
    element("div", { klasse: "haken-liste" }, ...(gruppen.length ? gruppen.map((gr) => haken(
      gr.name, leseGruppen.has(gr.id),
      (an) => an
        ? db.from("sammlung_lesen").insert({ sammlung_id: sa.id, unterhaltung_id: gr.id })
        : db.from("sammlung_lesen").delete().eq("sammlung_id", sa.id).eq("unterhaltung_id", gr.id),
    )) : [element("span", { klasse: "leise", text: "Keine Gruppe angelegt." })])),

    element("p", { klasse: "klein", text: "Eintragen und ändern dürfen (Redakteure, z. B. das Büro) – überall:" }),
    element("div", { klasse: "haken-liste" }, ...personen.map((pe) => haken(
      pe.name, schreiber.has(pe.id),
      (an) => an
        ? db.from("sammlung_schreiben").insert({ sammlung_id: sa.id, nutzer_id: pe.id })
        : db.from("sammlung_schreiben").delete().eq("sammlung_id", sa.id).eq("nutzer_id", pe.id),
    ))),
    haken("Abteilungsleiter dürfen Einträge für ihre Abteilung schreiben", sa.leiter_schreiben,
      (an) => db.from("sammlungen").update({ leiter_schreiben: an }).eq("id", sa.id)),

    element("p", { klasse: "klein", text: "Felder:" }),
    element("ul", { klasse: "felder-liste" }, ...felder.map((f) => element("li", {},
      element("span", { text: `${f.bezeichnung} · ${FELDTYPEN[f.typ] || f.typ}` }),
      haken("in der Liste zeigen", f.in_liste, (an) => db.from("sammlung_felder").update({ in_liste: an }).eq("id", f.id)),
      haken("🔒 geschützt", f.geschuetzt, (an) => db.rpc("feld_schutz_setzen", { feld: f.id, an }))))),
    felder.some((f) => f.geschuetzt) ? element("p", { klasse: "klein", text: "Geschützte Felder sehen diese Abteilungen (dazu Redakteure und Admin):" }) : null,
    felder.some((f) => f.geschuetzt) ? element("div", { klasse: "haken-liste" }, ...abteilungen.map((ab) => haken(
      ab, schutzAbt.has(ab),
      (an) => an
        ? db.from("sammlung_abteilung_geschuetzt").insert({ sammlung_id: sa.id, abteilung: ab })
        : db.from("sammlung_abteilung_geschuetzt").delete().eq("sammlung_id", sa.id).eq("abteilung", ab),
    ))) : null,
    feldFormular(sa, felder),
  );
}

function feldFormular(sa, felder) {
  const name = element("input", { maxlength: "60", placeholder: "Neues Feld, z. B. Ansprechpartner" });
  const typ = element("select", {}, ...Object.entries(FELDTYPEN).map(([k, t]) => element("option", { value: k, text: t })));
  const auswahl = element("input", { maxlength: "300", placeholder: "Auswahlwerte mit Komma, z. B. Ja, Nein" });
  auswahl.hidden = true;
  typ.addEventListener("change", () => { auswahl.hidden = typ.value !== "auswahl"; });
  const knopf = element("button", { klasse: "neben klein-knopf", type: "button", text: "＋ Feld" });
  knopf.addEventListener("click", async () => {
    const bezeichnung = name.value.trim();
    if (!bezeichnung) return meldung("#gruppen-meldung", "Bitte einen Feldnamen eingeben.");
    knopfBeschaeftigt(knopf, true);
    const { error } = await db.from("sammlung_felder").insert({
      sammlung_id: sa.id, bezeichnung, typ: typ.value, schluessel: schluesselAus(bezeichnung, felder),
      reihenfolge: felder.length + 1,
      auswahlwerte: typ.value === "auswahl" ? auswahl.value.split(",").map((x) => x.trim()).filter(Boolean) : null,
    });
    knopfBeschaeftigt(knopf, false);
    if (error) return meldung("#gruppen-meldung", "Feld ging nicht: " + error.message);
    laden();
  });
  return element("div", { klasse: "feld-neu" }, name, typ, auswahl, knopf);
}

// Interner Feldname aus der Bezeichnung: klein, ohne Umlaute, eindeutig.
function schluesselAus(bezeichnung, felder) {
  let s = bezeichnung.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "feld";
  if (!/^[a-z]/.test(s)) s = "f_" + s;
  const belegt = new Set(felder.map((f) => f.schluessel));
  let neu = s;
  for (let i = 2; belegt.has(neu); i++) neu = `${s}_${i}`;
  return neu;
}

// Nach jedem Haken neu laden - Zahlen wie "3 Mitglieder" stimmen sonst nicht mehr.
const haken = (text, an, speichern) => sofortHaken(text, an, speichern, "#gruppen-meldung", laden);

async function gruppeAnlegen() {
  const name = $("#gruppe-name").value.trim();
  if (!name) return meldung("#gruppe-anlegen-meldung", "Bitte einen Namen eingeben.");
  const knopf = $("#gruppe-anlegen-los");
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.from("unterhaltungen").insert({
    art: $("#gruppe-art").value, name, fuer_alle: $("#gruppe-alle").checked,
  });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#gruppe-anlegen-meldung", "Ging nicht: " + error.message);
  meldung("#gruppe-anlegen-meldung", "");
  $("#gruppe-anlegen").reset();
  laden();
}

// Neues Wiki bekommt gleich ein Textfeld, eine Tabelle startet ohne Felder.
async function sammlungAnlegen() {
  const name = $("#sammlung-name").value.trim();
  if (!name) return meldung("#sammlung-anlegen-meldung", "Bitte einen Namen eingeben.");
  const art = $("#sammlung-art").value;
  const knopf = $("#sammlung-anlegen-los");
  knopfBeschaeftigt(knopf, true);
  const { data, error } = await db.from("sammlungen")
    .insert({ name, art, beschreibung: $("#sammlung-beschreibung-neu").value.trim() || null })
    .select("id").single();
  if (!error && art === "wiki") {
    await db.from("sammlung_felder").insert({ sammlung_id: data.id, schluessel: "text", bezeichnung: "Text", typ: "langtext", reihenfolge: 1 });
  }
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#sammlung-anlegen-meldung", "Ging nicht: " + error.message);
  meldung("#sammlung-anlegen-meldung", "Angelegt. Jetzt unten festlegen, wer liest und schreibt.", "hinweis");
  $("#sammlung-anlegen").reset();
  laden();
}
