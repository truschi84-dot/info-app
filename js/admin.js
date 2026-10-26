// Admin-Seite "Personen": anlegen, einladen (QR + Druck), Geraete sperren,
// PIN-Sperre aufheben, deaktivieren / aktivieren, Personen ohne App eintragen,
// Abteilungsfarben waehlen. Lesen geht direkt ueber die
// Datenbank (Zugriffsregeln), Aendern ueber die Cloud-Funktion admin-personen.
import {
  $, FARBEN, abteilungsChip, abteilungsFarbe, datumZeit, db, element, farbenLaden, funktion, geraetLesen, haken,
  knopfBeschaeftigt, meldung, zeige,
} from "./gemeinsam.js?v=28";

const PIN_SPERRE_AB = 5;
let ich = null;
let abteilungen = [];   // alle vorkommenden Abteilungen (aus den Personen)
let leitung = [];       // { profil_id, abteilung }
let personen = [];      // fuer die Doppelt-Pruefung beim Anlegen
const FUNKTIONEN = ["Chef", "Betriebsleitung (Stellvertretung)", "Abteilungsleitung", "Büro"];

export function adminEinrichten(zurueck) {
  $("#admin-zurueck").addEventListener("click", zurueck);
  $("#anlegen").addEventListener("submit", (e) => { e.preventDefault(); personAnlegen(); });
  $("#anzeige-drucken").addEventListener("click", () => window.print());
  $("#anzeige-schliessen").addEventListener("click", () => { $("#einladung-anzeige").hidden = true; });
  $("#anlegen-app").addEventListener("change", (e) => {
    $("#anlegen-los").textContent = e.currentTarget.checked ? "Anlegen und einladen" : "Eintragen";
  });
  $("#sammel-los").addEventListener("click", sammelEintragen);
}

export async function zeigeAdmin(angemeldet) {
  ich = angemeldet;
  zeige("admin");
  await personenLaden();
}

async function personenLaden() {
  const liste = $("#personen");
  meldung("#admin-meldung", "");
  const [p, g, l, e] = await Promise.all([
    db.from("profile").select("id, name, abteilung, rolle, aktiv, darf_freigeben, funktion").order("name"),
    db.from("geraete").select("id, profil_id, bezeichnung, erstellt_am, gesperrt_am, fehlversuche").order("erstellt_am"),
    db.from("abteilungsleiter").select("profil_id, abteilung"),
    db.from("einladungen").select("profil_id, gueltig_bis").is("eingeloest_am", null).is("widerrufen_am", null)
      .gt("gueltig_bis", new Date().toISOString()),
    farbenLaden(),
  ]);
  if (p.error || g.error || l.error || e.error) {
    meldung("#admin-meldung", "Liste konnte nicht geladen werden: " + (p.error || g.error || l.error || e.error).message);
    return;
  }
  personen = p.data;
  leitung = l.data;
  abteilungen = [...new Set([...p.data.map((x) => x.abteilung), ...leitung.map((x) => x.abteilung)].filter(Boolean))].sort();
  $("#abteilungen-liste").replaceChildren(...abteilungen.map((a) => element("option", { value: a })));
  const funktionen = new Set([...FUNKTIONEN, ...p.data.map((x) => x.funktion).filter(Boolean)]);
  $("#funktionen-liste").replaceChildren(...[...funktionen].map((f) => element("option", { value: f })));
  farbenZeichnen();
  liste.replaceChildren(...p.data.map((person) => personKarte(person,
    g.data.filter((x) => x.profil_id === person.id), e.data.find((x) => x.profil_id === person.id))));
}

// ── Abteilungsfarben ────────────────────────────────────────────────────
function farbenZeichnen() {
  $("#farben").replaceChildren(...(abteilungen.length ? abteilungen.map((a) => {
    const anzahl = personen.filter((x) => x.abteilung === a && x.aktiv).length;
    return element("li", {},
      abteilungsChip(a),
      element("span", { klasse: "klein", text: `${anzahl} Person${anzahl === 1 ? "" : "en"}` }),
      element("div", { klasse: "farbfelder" }, ...FARBEN.map((f) => {
        const k = element("button", {
          type: "button", klasse: "farbfeld" + (f === abteilungsFarbe(a) ? " an" : ""), title: f, "aria-label": `Farbe ${f} für ${a}`,
          onclick: (ev) => farbeSetzen(a, f, ev.currentTarget),
        });
        k.style.setProperty("--abt", f);
        return k;
      })));
  }) : [element("li", { klasse: "leise", text: "Noch keine Abteilungen – sie entstehen, sobald eine Person eine Abteilung bekommt." })]));
}

async function farbeSetzen(abteilung, farbe, knopf) {
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.from("abteilungen").upsert({ name: abteilung, farbe });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#admin-meldung", "Farbe ging nicht: " + error.message);
  personenLaden();
}

function personKarte(person, geraete, offeneEinladung) {
  const selbst = person.id === ich.id;
  // Nie ein Gerät eingerichtet: die Person nutzt die App (noch) nicht.
  const ohneApp = !geraete.length;
  const knoepfe = element("div", { klasse: "knoepfe klein" });
  if (person.aktiv && ohneApp) {
    knoepfe.append(element("button", { klasse: "neben", text: offeneEinladung ? "📲 Neue Einladung" : "📲 Jetzt einladen",
      onclick: (e) => einladen(person, "erstes_geraet", e.currentTarget) }));
    if (!selbst) {
      knoepfe.append(element("button", { klasse: "gefahr", text: "Deaktivieren", onclick: (e) => deaktivieren(person, e.currentTarget) }));
    }
  } else if (person.aktiv) {
    knoepfe.append(
      element("button", { klasse: "neben", text: "➕ Weiteres Gerät", onclick: (e) => einladen(person, "weiteres_geraet", e.currentTarget) }),
      element("button", { klasse: "neben", text: "🔑 Neue PIN", onclick: (e) => einladen(person, "pin_neu", e.currentTarget) }),
    );
    if (!selbst) {
      knoepfe.append(element("button", { klasse: "gefahr", text: "Deaktivieren", onclick: (e) => deaktivieren(person, e.currentTarget) }));
    }
  } else {
    knoepfe.append(
      element("button", { klasse: "neben", text: "Wieder aktivieren", onclick: (e) => aktivieren(person, e.currentTarget) }),
      element("button", { klasse: "gefahr", text: "🗑️ Endgültig löschen", onclick: (e) => endgueltigLoeschen(person, e.currentTarget) }),
    );
  }

  // Gesperrte Geraete zusammengeklappt, sonst wird die Liste mit der Zeit lang.
  const aktiv = geraete.filter((g) => !g.gesperrt_am);
  const gesperrt = geraete.filter((g) => g.gesperrt_am);
  const geraeteListe = element("ul", { klasse: "geraete" });
  for (const g of aktiv) geraeteListe.append(geraetZeile(g));
  if (ohneApp) {
    geraeteListe.append(element("li", { klasse: "leise", text: offeneEinladung
      ? `Einladung offen bis ${datumZeit(offeneEinladung.gueltig_bis)} Uhr`
      : "Nutzt die App nicht – nur eingetragen" }));
  } else if (!aktiv.length) geraeteListe.append(element("li", { klasse: "leise", text: "Kein aktives Gerät" }));
  if (gesperrt.length) {
    geraeteListe.append(element("li", {}, element("details", { klasse: "gesperrte" },
      element("summary", { klasse: "leise", text: `${gesperrt.length} gesperrte${gesperrt.length === 1 ? "s" : ""} Gerät${gesperrt.length === 1 ? "" : "e"}` }),
      element("ul", { klasse: "geraete" }, ...gesperrt.map(geraetZeile)))));
  }

  const karte = element("article", { klasse: "person" + (person.aktiv ? "" : " aus") },
    element("div", { klasse: "person-kopf" },
      element("strong", { text: person.name + (selbst ? " (du)" : "") }),
      person.funktion ? element("span", { klasse: "funktion", text: person.funktion }) : null,
      person.abteilung ? abteilungsChip(person.abteilung) : null,
      ohneApp && person.aktiv ? element("span", { klasse: "ohne-app", text: "ohne App" }) : null,
      element("span", { klasse: "leise", text: [person.rolle === "admin" ? "Admin" : null, person.aktiv ? null : "deaktiviert"].filter(Boolean).join(" · ") }),
    ),
    geraeteListe,
    person.aktiv ? rechteBereich(person) : null,
    knoepfe,
  );
  if (person.abteilung) {
    karte.style.setProperty("--abt", abteilungsFarbe(person.abteilung));
    karte.classList.add("abt-strich");
  }
  return karte;
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
  const funktion = element("input", { value: person.funktion || "", list: "funktionen-liste", maxlength: "60", placeholder: "z. B. Chef" });
  funktion.addEventListener("change", async () => {
    const { error } = await db.from("profile").update({ funktion: funktion.value.trim() || null }).eq("id", person.id);
    if (error) return meldung("#admin-meldung", "Funktion ging nicht: " + error.message);
    personenLaden();
  });
  // Die eigene Rolle nicht aendern - sonst sperrt man sich selbst aus.
  const rolle = element("select", { "aria-label": `Rolle von ${person.name}` },
    element("option", { value: "mitarbeiter", text: "Mitarbeiter" }),
    element("option", { value: "admin", text: "Admin – darf alles" }));
  rolle.value = person.rolle;
  if (person.id === ich.id) rolle.disabled = true;
  rolle.addEventListener("change", async () => {
    if (!confirm(rolle.value === "admin"
      ? `${person.name} zum Admin machen? Admin darf alles: Personen verwalten, Urlaub genehmigen, jedes Wiki bearbeiten.`
      : `${person.name} ist dann kein Admin mehr.`)) { rolle.value = person.rolle; return; }
    const { error } = await db.from("profile").update({ rolle: rolle.value }).eq("id", person.id);
    if (error) { rolle.value = person.rolle; return meldung("#admin-meldung", "Rolle ging nicht: " + error.message); }
    personenLaden();
  });
  const leitet = new Set(leitung.filter((x) => x.profil_id === person.id).map((x) => x.abteilung));
  return element("div", { klasse: "rechte" },
    element("div", { klasse: "zeile" },
      element("label", { klasse: "feld klein-feld" }, element("span", { text: "Abteilung" }), abteilung),
      element("label", { klasse: "feld klein-feld" }, element("span", { text: "Funktion" }), funktion),
      element("label", { klasse: "feld klein-feld" }, element("span", { text: "Rolle" }), rolle)),
    person.rolle === "admin"
      ? element("p", { klasse: "klein", text: "✅ Genehmigt Urlaub und bearbeitet jedes Wiki (als Admin immer)" })
      : haken("Freigeber – genehmigt Urlaub", person.darf_freigeben,
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
  if (doppelt(name) && !confirm(`„${name}" gibt es schon. Trotzdem noch einmal anlegen?`)) return;
  const mitApp = $("#anlegen-app").checked;
  const d = await aktion($("#anlegen-los"), {
    aktion: "anlegen", name, abteilung: $("#anlegen-abteilung").value.trim(), funktion: $("#anlegen-funktion").value.trim(),
    rolle: $("#anlegen-rolle").value, ohne_app: !mitApp,
  }, "#anlegen-meldung");
  if (!d) return;
  $("#anlegen").reset();
  $("#anlegen-los").textContent = "Anlegen und einladen";
  if (mitApp) {
    meldung("#anlegen-meldung", "");
    einladungZeigen(name, "erstes_geraet", d);
  } else {
    meldung("#anlegen-meldung", `${name} ist eingetragen. Einladen geht später mit „Jetzt einladen".`, "hinweis");
  }
  personenLaden();
}

const doppelt = (name) => personen.some((p) => p.aktiv && p.name.toLowerCase() === name.toLowerCase());

// Eine Zeile je Person: "Name, Abteilung" - auch ; oder Tab (aus Excel kopiert).
function sammelZeilen(text) {
  return text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).map((z) => {
    const [name, ...rest] = z.split(/\t|;|,/);
    return { name: name.trim(), abteilung: rest.join(" ").trim() };
  });
}

async function sammelEintragen() {
  const zeilen = sammelZeilen($("#sammel-text").value);
  if (!zeilen.length) return meldung("#sammel-meldung", "Bitte mindestens eine Zeile eingeben.");
  const falsch = zeilen.findIndex((z) => !z.name || z.name.length > 80 || z.abteilung.length > 60);
  if (falsch >= 0) return meldung("#sammel-meldung", `Zeile ${falsch + 1}: Name fehlt oder ist zu lang.`);
  const schonDa = zeilen.filter((z) => doppelt(z.name)).map((z) => z.name);
  const neu = zeilen.filter((z) => !doppelt(z.name));
  if (!neu.length) return meldung("#sammel-meldung", "Alle gibt es schon – nichts eingetragen.", "hinweis");
  const frage = `${neu.length} Person${neu.length === 1 ? "" : "en"} ohne App eintragen?`
    + (schonDa.length ? `\n\nSchon vorhanden, wird übersprungen: ${schonDa.join(", ")}` : "");
  if (!confirm(frage)) return;
  const d = await aktion($("#sammel-los"), { aktion: "sammel_anlegen", personen: neu }, "#sammel-meldung");
  if (!d) return;
  $("#sammel-text").value = "";
  meldung("#sammel-meldung", `${d.angelegt} eingetragen.`, "hinweis");
  personenLaden();
}

async function einladen(person, zweck, knopf) {
  const d = await aktion(knopf, { aktion: "einladen", profil_id: person.id, zweck });
  if (!d) return;
  einladungZeigen(person.name, zweck, d);
  personenLaden(); // "Einladung offen bis ..." an der Person zeigen
}

async function deaktivieren(person, knopf) {
  if (!confirm(`${person.name} deaktivieren? Alle Geräte werden sofort abgemeldet und gesperrt.`)) return;
  if (await aktion(knopf, { aktion: "deaktivieren", profil_id: person.id })) personenLaden();
}

// Nach dem Ausscheiden: alles zur Person weg. Was sie fuer die Firma geschrieben
// hat (Wiki, Termine), bleibt ohne ihren Namen. Die Datenbank prueft dasselbe
// noch einmal (person_loeschen): nur Admin, nur deaktiviert, Name muss passen.
async function endgueltigLoeschen(person, knopf) {
  const eingabe = prompt(`${person.name} endgültig löschen?\n\n`
    + "Weg sind dann: Konto, Geräte, PIN, Urlaub, Gruppen, Chats und alle Protokolleinträge zu dieser Person.\n"
    + "Wiki-Einträge und Termine, die sie geschrieben hat, bleiben – ohne ihren Namen.\n"
    + "Das lässt sich NICHT rückgängig machen.\n\n"
    + "Zum Bestätigen den Namen genau so eintippen:");
  if (eingabe === null) return;
  if (eingabe.trim() !== person.name) return meldung("#admin-meldung", "Der Name passt nicht – nichts gelöscht.");
  knopfBeschaeftigt(knopf, true);
  const { data, error } = await db.rpc("person_loeschen", { person: person.id, name_bestaetigt: eingabe.trim() });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#admin-meldung", "Löschen ging nicht: " + error.message);
  await personenLaden(); // leert #admin-meldung - darum die Meldung erst danach
  meldung("#admin-meldung", `${person.name} ist gelöscht (${data.abwesenheiten} ${data.abwesenheiten === 1 ? "Abwesenheit" : "Abwesenheiten"} mit entfernt).`, "hinweis");
}

async function aktivieren(person, knopf) {
  if (!(await aktion(knopf, { aktion: "aktivieren", profil_id: person.id }))) return;
  await personenLaden();
  meldung("#admin-meldung", `${person.name} ist wieder aktiv und braucht eine neue Einladung („Weiteres Gerät" oder „Neue PIN").`, "hinweis");
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
