// Start der App: entscheidet, welcher Bildschirm kommt.
//   Adresse mit #einladung=… -> Einladung
//   gueltige Sitzung          -> Start
//   Geraet eingerichtet       -> PIN
//   sonst                     -> Einladung
import { $, db, farbenLaden, geraetLesen, zeige } from "./gemeinsam.js?v=32";
import { UMGEBUNG } from "./konfig.js?v=32";
import { anmeldungEinrichten, codeAus, zeigeEinladung, zeigePin } from "./anmelden.js?v=32";
import { adminEinrichten, zeigeAdmin } from "./admin.js?v=32";
import { eintragOeffnen, nachschlagenEinrichten, zeigeNachschlagen } from "./nachschlagen.js?v=32";
import { neuigkeiten, pushAusschalten, pushEinschalten, pushStatus, swRegistrieren } from "./hinweise.js?v=32";
import { gruppenEinrichten, zeigeGruppen } from "./gruppen.js?v=32";
import { planerEinrichten, zeigePlaner } from "./planer.js?v=32";
import { notizenEinrichten, zeigeNotizen } from "./notizen.js?v=32";
import { chatOeffnen, chatsEinrichten, chatsUngelesen, zeigeChats } from "./chats.js?v=32";
import { begruessung, heuteZeigen } from "./heute.js?v=32";

let ich = null;
let offenerLink = null; // { art, id } aus einer Push-Nachricht, wird nach der Anmeldung geoeffnet

// "#eintrag=<id>" oder "#chat=<id>" aus der Adresse nehmen (kommt aus einer Push-Nachricht).
function linkAusAdresse(url) {
  const m = /[#&](eintrag|chat)=([0-9a-f-]{36})/i.exec(url);
  return m ? { art: m[1], id: m[2] } : null;
}

function linkOeffnen(link) {
  return link.art === "chat" ? chatOeffnen(ich, link.id) : eintragOeffnen(ich, link.id);
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
  const g = begruessung(ich.name);
  $("#start-hallo").textContent = g.titel;
  $("#start-datum").textContent = g.datum;
  $("#start-umgebung").textContent = UMGEBUNG === "test" ? "· Testumgebung" : "";
  $("#admin-knoepfe").hidden = ich.rolle !== "admin";
  zeige("start");
  if (offenerLink) {
    const link = offenerLink;
    offenerLink = null;
    return linkOeffnen(link);
  }
  hinweiseZeigen();
  heuteZeigen(ich, {
    chat: (id) => chatOeffnen(ich, id),
    chats: () => zeigeChats(ich),
    eintrag: (id) => eintragOeffnen(ich, id),
    nachschlagen: () => zeigeNachschlagen(ich),
    planer: (reiter) => zeigePlaner(ich, reiter),
  });
}

async function hinweiseZeigen() {
  const [neu, ungelesen] = await Promise.all([neuigkeiten(), chatsUngelesen()]);
  $("#wiki-neu-zahl").textContent = String(neu.length);
  $("#wiki-neu-zahl").hidden = !neu.length;
  $("#chats-zahl").textContent = String(ungelesen);
  $("#chats-zahl").hidden = !ungelesen;
  pushAnzeigen();
}

const PUSH_TEXT = {
  an: "🔔 Push-Nachrichten sind auf diesem Gerät an.",
  aus: "🔕 Push-Nachrichten (Chats, Neues im Wiki) sind auf diesem Gerät aus.",
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
  notizenEinrichten(zeigeStart);
  chatsEinrichten(zeigeStart);

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
  $("#zu-notizen").addEventListener("click", () => zeigeNotizen());
  $("#zu-heute").addEventListener("click", () => zeigeStart());
  $("#zu-chats").addEventListener("click", () => zeigeChats(ich));
  $("#push-knopf").addEventListener("click", pushUmschalten);

  swRegistrieren();
  // Push-Nachricht angetippt, waehrend die App schon offen ist.
  navigator.serviceWorker?.addEventListener("message", (e) => {
    const link = e.data?.art === "oeffnen" ? linkAusAdresse(e.data.url) : null;
    if (!link) return;
    if (ich) linkOeffnen(link);
    else offenerLink = link;
  });
  offenerLink = linkAusAdresse(location.hash);
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
