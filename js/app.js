// Start der App: entscheidet, welcher Bildschirm kommt.
//   Adresse mit #einladung=… -> Einladung
//   gueltige Sitzung          -> Start
//   Geraet eingerichtet       -> PIN
//   sonst                     -> Einladung
import { $, db, farbenLaden, geraetLesen, zeige } from "./gemeinsam.js?v=22";
import { UMGEBUNG } from "./konfig.js?v=22";
import { anmeldungEinrichten, codeAus, zeigeEinladung, zeigePin } from "./anmelden.js?v=22";
import { adminEinrichten, zeigeAdmin } from "./admin.js?v=22";
import { eintragOeffnen, nachschlagenEinrichten, zeigeNachschlagen } from "./nachschlagen.js?v=22";
import { neuigkeiten, pushAusschalten, pushEinschalten, pushStatus, swRegistrieren } from "./hinweise.js?v=22";
import { gruppenEinrichten, zeigeGruppen } from "./gruppen.js?v=22";
import { planerEinrichten, zeigePlaner } from "./planer.js?v=22";

let ich = null;
let offenerLink = null; // Eintrag aus einer Push-Nachricht, der nach der Anmeldung geoeffnet wird

// "#eintrag=<id>" aus der Adresse nehmen (kommt aus einer Push-Nachricht).
function eintragAusAdresse(url) {
  const m = /[#&]eintrag=([0-9a-f-]{36})/i.exec(url);
  return m ? m[1] : null;
}

// Wer bin ich? Liefert nur etwas, wenn Person aktiv und dieses Geraet nicht
// gesperrt ist - sonst sieht die Sitzung wegen der Zugriffsregeln nichts.
async function ichSelbst() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data, error } = await db.from("profile").select("id, name, rolle, darf_freigeben").eq("id", session.user.id).maybeSingle();
  return error ? null : data;
}

async function zeigeStart() {
  ich = await ichSelbst();
  if (!ich) return ohneSitzung();
  farbenLaden();
  $("#start-hallo").textContent = `Hallo ${ich.name}`;
  $("#start-umgebung").textContent = UMGEBUNG === "test" ? "Testumgebung" : "";
  $("#admin-knoepfe").hidden = ich.rolle !== "admin";
  zeige("start");
  if (offenerLink) {
    const id = offenerLink;
    offenerLink = null;
    return eintragOeffnen(ich, id);
  }
  hinweiseZeigen();
}

async function hinweiseZeigen() {
  const neu = await neuigkeiten();
  $("#wiki-neu-zahl").textContent = `${neu.length} neu`;
  $("#wiki-neu-zahl").hidden = !neu.length;
  pushAnzeigen();
}

const PUSH_TEXT = {
  an: "🔔 Push-Nachrichten sind auf diesem Gerät an.",
  aus: "🔕 Push-Nachrichten bei Neuem im Wiki sind auf diesem Gerät aus.",
  gesperrt: "🔕 Benachrichtigungen sind im Browser verboten. Freigeben geht in den Einstellungen des Browsers bzw. am iPhone unter Einstellungen → Mitteilungen → Info-App.",
  homebildschirm: "🔕 Push geht am iPhone nur, wenn du die App über „Teilen → Zum Home-Bildschirm“ hinzufügst und von dort öffnest.",
  geht_nicht: "🔕 Dieser Browser kann keine Push-Nachrichten.",
};

async function pushAnzeigen() {
  const status = await pushStatus();
  $("#push-bereich").hidden = false;
  $("#push-text").textContent = PUSH_TEXT[status];
  const knopf = $("#push-knopf");
  knopf.hidden = !["an", "aus"].includes(status);
  knopf.textContent = status === "an" ? "Ausschalten" : "🔔 Einschalten";
  knopf.dataset.status = status;
}

async function pushUmschalten() {
  const knopf = $("#push-knopf");
  knopf.disabled = true;
  try {
    if (knopf.dataset.status === "an") await pushAusschalten();
    else await pushEinschalten();
  } catch (err) {
    $("#push-text").textContent = "⚠ " + err.message;
    knopf.disabled = false;
    return;
  }
  knopf.disabled = false;
  pushAnzeigen();
}

async function ohneSitzung(text = "") {
  await db.auth.signOut({ scope: "local" });
  if (geraetLesen()) zeigePin();
  else zeigeEinladung("", text);
}

async function start() {
  anmeldungEinrichten(zeigeStart);
  adminEinrichten(zeigeStart);
  nachschlagenEinrichten(zeigeStart);
  gruppenEinrichten(zeigeStart);
  planerEinrichten(zeigeStart);

  // Nur dieses Geraet abmelden ("local"). Ohne Angabe beendet Supabase alle
  // Sitzungen der Person - dann waere auch das Handy draussen, wenn man am PC
  // auf Abmelden drueckt (am 23.10.2026 so gemessen).
  $("#abmelden").addEventListener("click", async () => {
    await db.auth.signOut({ scope: "local" });
    zeigePin();
  });
  $("#zur-verwaltung").addEventListener("click", () => zeigeAdmin(ich));
  $("#zu-gruppen").addEventListener("click", () => zeigeGruppen());
  $("#zum-nachschlagen").addEventListener("click", () => zeigeNachschlagen(ich));
  $("#zum-planer").addEventListener("click", () => zeigePlaner(ich));
  $("#push-knopf").addEventListener("click", pushUmschalten);

  swRegistrieren();
  // Push-Nachricht angetippt, waehrend die App schon offen ist.
  navigator.serviceWorker?.addEventListener("message", (e) => {
    const id = e.data?.art === "oeffnen" ? eintragAusAdresse(e.data.url) : null;
    if (!id) return;
    if (ich) eintragOeffnen(ich, id);
    else offenerLink = id;
  });
  offenerLink = eintragAusAdresse(location.hash);
  if (offenerLink) history.replaceState(null, "", location.pathname + location.search);

  // Einladung aus dem QR-Code: Code aus der Adresse nehmen und dort loeschen.
  if (location.hash.includes("einladung=")) {
    const code = codeAus(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    return zeigeEinladung(code);
  }

  ich = await ichSelbst();
  if (ich) return zeigeStart();
  return ohneSitzung();
}

start();
