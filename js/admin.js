// Admin-Seite "Personen": anlegen, einladen (QR + Druck), Geraete sperren,
// PIN-Sperre aufheben, deaktivieren / aktivieren. Lesen geht direkt ueber die
// Datenbank (Zugriffsregeln), Aendern ueber die Cloud-Funktion admin-personen.
import { $, datumZeit, db, element, funktion, geraetLesen, haken, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=12";

const PIN_SPERRE_AB = 5;
let ich = null;
let abteilungen = [];   // alle vorkommenden Abteilungen (aus den Personen)
let leitung = [];       // { profil_id, abteilung }

export function adminEinrichten(zurueck) {
  $("#admin-zurueck").addEventListener("click", zurueck);
  $("#anlegen").addEventListener("submit", (e) => { e.preventDefault(); personAnlegen(); });
  $("#anzeige-drucken").addEventListener("click", () => window.print());
  $("#anzeige-schliessen").addEventListener("click", () => { $("#einladung-anzeige").hidden = true; });
}

export async function zeigeAdmin(angemeldet) {
  ich = angemeldet;
  zeige("admin");
  await personenLaden();
}

async function personenLaden() {
  const liste = $("#personen");
  meldung("#admin-meldung", "");
  const [p, g, l] = await Promise.all([
    db.from("profile").select("id, name, abteilung, rolle, aktiv, darf_freigeben").order("name"),
    db.from("geraete").select("id, profil_id, bezeichnung, erstellt_am, gesperrt_am, fehlversuche").order("erstellt_am"),
    db.from("abteilungsleiter").select("profil_id, abteilung"),
  ]);
  if (p.error || g.error || l.error) {
    meldung("#admin-meldung", "Liste konnte nicht geladen werden: " + (p.error || g.error || l.error).message);
    return;
  }
  leitung = l.data;
  abteilungen = [...new Set([...p.data.map((x) => x.abteilung), ...leitung.map((x) => x.abteilung)].filter(Boolean))].sort();
  $("#abteilungen-liste").replaceChildren(...abteilungen.map((a) => element("option", { value: a })));
  liste.replaceChildren(...p.data.map((person) => personKarte(person, g.data.filter((x) => x.profil_id === person.id))));
}

function personKarte(person, geraete) {
  const selbst = person.id === ich.id;
  const knoepfe = element("div", { klasse: "knoepfe klein" });
  if (person.aktiv) {
    knoepfe.append(
      element("button", { klasse: "neben", text: "➕ Weiteres Gerät", onclick: (e) => einladen(person, "weiteres_geraet", e.currentTarget) }),
      element("button", { klasse: "neben", text: "🔑 Neue PIN", onclick: (e) => einladen(person, "pin_neu", e.currentTarget) }),
    );
    if (!selbst) {
      knoepfe.append(element("button", { klasse: "gefahr", text: "Deaktivieren", onclick: (e) => deaktivieren(person, e.currentTarget) }));
    }
  } else {
    knoepfe.append(element("button", { klasse: "neben", text: "Wieder aktivieren", onclick: (e) => aktivieren(person, e.currentTarget) }));
  }

  // Gesperrte Geraete zusammengeklappt, sonst wird die Liste mit der Zeit lang.
  const aktiv = geraete.filter((g) => !g.gesperrt_am);
  const gesperrt = geraete.filter((g) => g.gesperrt_am);
  const geraeteListe = element("ul", { klasse: "geraete" });
  for (const g of aktiv) geraeteListe.append(geraetZeile(g));
  if (!aktiv.length) geraeteListe.append(element("li", { klasse: "leise", text: "Kein aktives Gerät" }));
  if (gesperrt.length) {
    geraeteListe.append(element("li", {}, element("details", { klasse: "gesperrte" },
      element("summary", { klasse: "leise", text: `${gesperrt.length} gesperrte${gesperrt.length === 1 ? "s" : ""} Gerät${gesperrt.length === 1 ? "" : "e"}` }),
      element("ul", { klasse: "geraete" }, ...gesperrt.map(geraetZeile)))));
  }

  return element("article", { klasse: "person" + (person.aktiv ? "" : " aus") },
    element("div", { klasse: "person-kopf" },
      element("strong", { text: person.name + (selbst ? " (du)" : "") }),
      element("span", { klasse: "leise", text: [person.abteilung, person.rolle === "admin" ? "Admin" : null, person.aktiv ? null : "deaktiviert"].filter(Boolean).join(" · ") }),
    ),
    geraeteListe,
    person.aktiv ? rechteBereich(person) : null,
    knoepfe,
  );
}

// Abteilung, Freigeber (genehmigt Urlaub), welche Abteilungen jemand leitet.
function rechteBereich(person) {
  const abteilung = element("input", { value: person.abteilung || "", list: "abteilungen-liste", maxlength: "60", placeholder: "z. B. Versand" });
  abteilung.addEventListener("change", async () => {
    const neu = abteilung.value.trim() || null;
    const { error } = await db.from("profile").update({ abteilung: neu }).eq("id", person.id);
    if (error) return meldung("#admin-meldung", "Abteilung ging nicht: " + error.message);
    personenLaden();
  });
  const leitet = new Set(leitung.filter((x) => x.profil_id === person.id).map((x) => x.abteilung));
  return element("div", { klasse: "rechte" },
    element("label", { klasse: "feld klein-feld" }, element("span", { text: "Abteilung" }), abteilung),
    haken("Freigeber – genehmigt Urlaub", person.darf_freigeben,
      (an) => db.from("profile").update({ darf_freigeben: an }).eq("id", person.id), "#admin-meldung"),
    abteilungen.length ? element("div", { klasse: "haken-liste" },
      element("span", { klasse: "klein", text: "Leitet:" }),
      ...abteilungen.map((a) => haken(a, leitet.has(a),
        (an) => an
          ? db.from("abteilungsleiter").insert({ profil_id: person.id, abteilung: a })
          : db.from("abteilungsleiter").delete().eq("profil_id", person.id).eq("abteilung", a),
        "#admin-meldung"))) : null,
  );
}

function geraetZeile(g) {
  const status = g.gesperrt_am ? `gesperrt ${datumZeit(g.gesperrt_am)}`
    : g.fehlversuche >= PIN_SPERRE_AB ? "PIN-Sperre (zu viele falsche PINs)"
    : "aktiv";
  const diesesGeraet = g.id === geraetLesen()?.geraet_id;
  const zeile = element("li", { klasse: g.gesperrt_am ? "leise" : "" },
    element("span", { text: `${g.bezeichnung || "Gerät"}${diesesGeraet ? " (dieses Gerät)" : ""} · seit ${datumZeit(g.erstellt_am)} · ${status}` }));
  if (!g.gesperrt_am) {
    if (g.fehlversuche >= PIN_SPERRE_AB) {
      zeile.append(element("button", { klasse: "neben klein-knopf", text: "Freigeben", onclick: (e) => pinSperreAufheben(g, e.currentTarget) }));
    }
    zeile.append(element("button", { klasse: "gefahr klein-knopf", text: "Sperren", onclick: (e) => geraetSperren(g, e.currentTarget) }));
  }
  return zeile;
}

async function aktion(knopf, body, ziel = "#admin-meldung") {
  knopfBeschaeftigt(knopf, true);
  const r = await funktion("admin-personen", body);
  knopfBeschaeftigt(knopf, false);
  if (r.status !== 200) {
    meldung(ziel, r.daten.fehler || "Das hat nicht geklappt.");
    return null;
  }
  return r.daten;
}

async function personAnlegen() {
  const name = $("#anlegen-name").value.trim();
  if (!name) return meldung("#anlegen-meldung", "Bitte einen Namen eingeben.");
  const d = await aktion($("#anlegen-los"), {
    aktion: "anlegen", name, abteilung: $("#anlegen-abteilung").value.trim(), rolle: $("#anlegen-rolle").value,
  }, "#anlegen-meldung");
  if (!d) return;
  meldung("#anlegen-meldung", "");
  $("#anlegen").reset();
  einladungZeigen(name, "erstes_geraet", d);
  personenLaden();
}

async function einladen(person, zweck, knopf) {
  const d = await aktion(knopf, { aktion: "einladen", profil_id: person.id, zweck });
  if (d) einladungZeigen(person.name, zweck, d);
}

async function deaktivieren(person, knopf) {
  if (!confirm(`${person.name} deaktivieren? Alle Geräte werden sofort abgemeldet und gesperrt.`)) return;
  if (await aktion(knopf, { aktion: "deaktivieren", profil_id: person.id })) personenLaden();
}

async function aktivieren(person, knopf) {
  if (!(await aktion(knopf, { aktion: "aktivieren", profil_id: person.id }))) return;
  meldung("#admin-meldung", `${person.name} ist wieder aktiv und braucht eine neue Einladung („Weiteres Gerät" oder „Neue PIN").`, "hinweis");
  personenLaden();
}

async function pinSperreAufheben(g, knopf) {
  if (await aktion(knopf, { aktion: "pin_sperre_aufheben", geraet_id: g.id })) personenLaden();
}

async function geraetSperren(g, knopf) {
  const diesesGeraet = g.id === geraetLesen()?.geraet_id;
  const frage = diesesGeraet
    ? "Das ist das Gerät, an dem du gerade sitzt. Wirklich sperren? Du wirst sofort abgemeldet und brauchst eine neue Einladung."
    : `Gerät „${g.bezeichnung || "Gerät"}" sperren? Es wird sofort abgemeldet und kann nicht wieder entsperrt werden.`;
  if (!confirm(frage)) return;
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.rpc("geraet_sperren", { geraet: g.id });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#admin-meldung", "Sperren hat nicht geklappt: " + error.message);
  if (diesesGeraet) return location.reload();
  personenLaden();
}

// ── Einladung anzeigen: QR-Code, Code zum Abtippen, Drucken ─────────────
const ZWECK_TEXT = {
  erstes_geraet: "Erstes Gerät einrichten",
  weiteres_geraet: "Weiteres Gerät hinzufügen (PIN bleibt gleich)",
  pin_neu: "Neue PIN festlegen",
};

function einladungZeigen(name, zweck, daten) {
  const adresse = location.origin + location.pathname;
  const qr = window.qrcode(0, "M");
  qr.addData(`${adresse}#einladung=${daten.code}`);
  qr.make();

  $("#anzeige-name").textContent = name;
  $("#anzeige-zweck").textContent = ZWECK_TEXT[zweck] || "";
  $("#anzeige-qr").replaceChildren(element("img", { src: qr.createDataURL(6, 2), alt: "QR-Code der Einladung" }));
  $("#anzeige-code").textContent = daten.code;
  $("#anzeige-gueltig").textContent = `Gilt einmal, bis ${datumZeit(daten.gueltig_bis)} Uhr.`;
  $("#anzeige-adresse").textContent = adresse.replace(/^https?:\/\//, "");
  $("#einladung-anzeige").hidden = false;
}
