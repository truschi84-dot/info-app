// Einstellungen: Feierabend-Ruhe (eigene), Loeschfrist Krankmeldungen (nur Admin)
// und die Datenschutz-Seite. Die Ruhezeit beachtet die Push-Funktion (wiki-push);
// gespeichert wird nur ueber ruhe_setzen() bzw. krank_frist_setzen().
import { $, db, knopfBeschaeftigt, meldung, zeige } from "./gemeinsam.js?v=38";

let ich = null;
let zurueckZu = null; // wohin "Zurueck" auf der Datenschutz-Seite fuehrt

export function einstellungenEinrichten(zurueck) {
  $("#einstellungen-zurueck").addEventListener("click", zurueck);
  $("#ruhe-an").addEventListener("change", ruheFelder);
  $("#ruhe-form").addEventListener("submit", (e) => { e.preventDefault(); ruheSpeichern(); });
  $("#frist-form").addEventListener("submit", (e) => { e.preventDefault(); fristSpeichern(); });
  $("#zum-datenschutz").addEventListener("click", () => zeigeDatenschutz(() => zeigeEinstellungen(ich)));
  for (const k of document.querySelectorAll(".datenschutz-link")) {
    const bildschirm = k.closest("[data-bildschirm]").dataset.bildschirm;
    k.addEventListener("click", () => zeigeDatenschutz(() => zeige(bildschirm)));
  }
  $("#datenschutz-zurueck").addEventListener("click", () => zurueckZu?.());
}

export async function zeigeEinstellungen(angemeldet) {
  ich = angemeldet;
  zeige("einstellungen");
  meldung("#ruhe-meldung", "");
  meldung("#frist-meldung", "");
  $("#frist-form").hidden = ich.rolle !== "admin";
  const [r, f] = await Promise.all([db.rpc("meine_ruhe"), ich.rolle === "admin" ? db.rpc("krank_frist") : { data: null }]);
  if (r.error) return meldung("#ruhe-meldung", "Konnte nicht laden: " + r.error.message);
  const ruhe = r.data || {};
  $("#ruhe-an").checked = !!ruhe.von;
  $("#ruhe-von").value = ruhe.von || "20:00";
  $("#ruhe-bis").value = ruhe.bis || "06:00";
  $("#ruhe-wochenende").checked = ruhe.wochenende !== false;
  ruheFelder();
  if (f.data) $("#frist-monate").value = f.data;
}

function ruheFelder() {
  for (const f of document.querySelectorAll("#ruhe-zeiten input")) f.disabled = !$("#ruhe-an").checked;
}

async function ruheSpeichern() {
  const an = $("#ruhe-an").checked;
  const von = $("#ruhe-von").value;
  const bis = $("#ruhe-bis").value;
  if (an && (!von || !bis)) return meldung("#ruhe-meldung", "Bitte Anfang und Ende eintragen.");
  if (an && von === bis) return meldung("#ruhe-meldung", "Anfang und Ende sind gleich – das wäre keine Ruhezeit.");
  const knopf = $("#ruhe-speichern");
  knopfBeschaeftigt(knopf, true);
  const { error } = await db.rpc("ruhe_setzen", { von: an ? von : null, bis: an ? bis : null, wochenende: $("#ruhe-wochenende").checked });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#ruhe-meldung", "Ging nicht: " + error.message);
  meldung("#ruhe-meldung", "✓ Gespeichert. " + ruheText({ von: an ? von : null, bis: an ? bis : null, wochenende: $("#ruhe-wochenende").checked }), "hinweis");
}

async function fristSpeichern() {
  const monate = Number($("#frist-monate").value);
  if (!Number.isInteger(monate) || monate < 1 || monate > 24) return meldung("#frist-meldung", "Bitte eine ganze Zahl von 1 bis 24.");
  const knopf = $("#frist-speichern");
  knopfBeschaeftigt(knopf, true);
  const { data, error } = await db.rpc("krank_frist_setzen", { monate });
  knopfBeschaeftigt(knopf, false);
  if (error) return meldung("#frist-meldung", "Ging nicht: " + error.message);
  meldung("#frist-meldung", `✓ Gespeichert: ${monate} Monate.${data ? ` ${data} ältere Krankmeldung${data === 1 ? "" : "en"} gerade gelöscht.` : ""}`, "hinweis");
}

// "🌙 Ruhe 20:00–06:00 und am Wochenende" - fuer Einstellungen und Startseite.
export function ruheText(r) {
  const teile = [r.von ? `${r.von}–${r.bis} Uhr` : null, r.wochenende ? "am Wochenende" : null].filter(Boolean);
  return teile.length ? `🌙 Feierabend-Ruhe: ${teile.join(" und ")}.` : "🌙 Keine Feierabend-Ruhe – Push kommt rund um die Uhr.";
}

export async function ruheKurz() {
  const { data } = await db.rpc("meine_ruhe");
  return data ? ruheText(data) + (data.jetzt ? " Gerade ist Ruhe." : "") : null;
}

export async function zeigeDatenschutz(zurueck) {
  zurueckZu = zurueck;
  zeige("datenschutz");
  const { data } = await db.rpc("krank_frist");
  $("#ds-frist").textContent = data ? `${data} Monat${data === 1 ? "" : "e"}` : "nach der eingestellten Frist";
}
