// Admin-Seite "Gruppen & Rechte": Gruppen anlegen, Mitglieder anhaken,
// und je Sammlung festlegen, welche Gruppen lesen und wer schreibt.
// Alles direkt ueber die Datenbank - die Zugriffsregeln lassen nur den Admin.
import { $, db, element, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=10";

let personen = [];

export function gruppenEinrichten(zurueck) {
  $("#gruppen-zurueck").addEventListener("click", zurueck);
  $("#gruppe-anlegen").addEventListener("submit", (e) => { e.preventDefault(); gruppeAnlegen(); });
}

export async function zeigeGruppen() {
  zeige("gruppen");
  await laden();
}

async function laden() {
  meldung("#gruppen-meldung", "");
  const [p, g, m, s, l, w] = await Promise.all([
    db.from("profile").select("id, name, aktiv").order("name"),
    db.from("unterhaltungen").select("id, art, name, fuer_alle, archiviert").neq("art", "einzel").order("name"),
    db.from("mitglieder").select("unterhaltung_id, nutzer_id"),
    db.from("sammlungen").select("id, name").eq("archiviert", false).order("name"),
    db.from("sammlung_lesen").select("sammlung_id, unterhaltung_id"),
    db.from("sammlung_schreiben").select("sammlung_id, nutzer_id"),
  ]);
  const fehler = [p, g, m, s, l, w].find((x) => x.error);
  if (fehler) return meldung("#gruppen-meldung", "Konnte nicht laden: " + fehler.error.message);
  personen = p.data.filter((x) => x.aktiv);

  const gruppen = g.data.filter((x) => !x.archiviert);
  $("#gruppen-liste").replaceChildren(...(gruppen.length ? gruppen.map((gr) => gruppeKarte(gr, m.data)) :
    [element("p", { klasse: "leise", text: "Noch keine Gruppe angelegt." })]));
  $("#rechte-liste").replaceChildren(...s.data.map((sa) => rechteKarte(sa, gruppen, l.data, w.data)));
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

function rechteKarte(sa, gruppen, lesen, schreiben) {
  const leseGruppen = new Set(lesen.filter((x) => x.sammlung_id === sa.id).map((x) => x.unterhaltung_id));
  const schreiber = new Set(schreiben.filter((x) => x.sammlung_id === sa.id).map((x) => x.nutzer_id));
  return element("article", { klasse: "person" },
    element("div", { klasse: "person-kopf" }, element("strong", { text: `📖 ${sa.name}` })),
    element("p", { klasse: "klein", text: "Lesen dürfen diese Gruppen:" }),
    element("div", { klasse: "haken-liste" }, ...(gruppen.length ? gruppen.map((gr) => haken(
      gr.name, leseGruppen.has(gr.id),
      (an) => an
        ? db.from("sammlung_lesen").insert({ sammlung_id: sa.id, unterhaltung_id: gr.id })
        : db.from("sammlung_lesen").delete().eq("sammlung_id", sa.id).eq("unterhaltung_id", gr.id),
    )) : [element("span", { klasse: "leise", text: "Erst oben eine Gruppe anlegen." })])),
    element("p", { klasse: "klein", text: "Eintragen und ändern dürfen (Redakteure):" }),
    element("div", { klasse: "haken-liste" }, ...personen.map((pe) => haken(
      pe.name, schreiber.has(pe.id),
      (an) => an
        ? db.from("sammlung_schreiben").insert({ sammlung_id: sa.id, nutzer_id: pe.id })
        : db.from("sammlung_schreiben").delete().eq("sammlung_id", sa.id).eq("nutzer_id", pe.id),
    ))),
  );
}

// Ein Haken, der sofort speichert. Im change-Handler steht "checked" schon
// auf dem neuen Wert; geht das Speichern schief, wird er zurueckgesetzt.
function haken(text, an, speichern) {
  const box = element("input", { type: "checkbox" });
  box.checked = an;
  box.addEventListener("change", async () => {
    const neu = box.checked;
    box.disabled = true;
    const { error } = await speichern(neu);
    box.disabled = false;
    if (error) {
      box.checked = !neu;
      meldung("#gruppen-meldung", "Speichern ging nicht: " + error.message);
      return;
    }
    laden(); // Zahlen wie "3 Mitglieder" stimmen sonst nicht mehr
  });
  return element("label", { klasse: "haken" }, box, element("span", { text }));
}

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
