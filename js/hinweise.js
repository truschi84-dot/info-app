// Hinweise auf Neues im Wiki: Zahl/Liste in der App (wiki_neu) und Push aufs
// Handy (Service Worker sw.js + Cloud-Funktion wiki-push).
// Am iPhone geht Push nur, wenn die App vom Home-Bildschirm geoeffnet wurde -
// im normalen Safari fehlt PushManager ganz.
import { db, funktion, geraetLesen } from "./gemeinsam.js?v=29";

export async function neuigkeiten() {
  const { data, error } = await db.rpc("wiki_neu");
  return error ? [] : data;
}

// Zeit vom Server (eintrag_gesehen_merken) - nicht von der Uhr des Geraets.
export const eintragGesehen = (eintragId) => db.rpc("eintrag_gesehen_merken", { eintrag: eintragId });

export const allesGesehen = () => db.rpc("wiki_alles_gesehen");

// ── Push ────────────────────────────────────────────────────────────────
const IPHONE = /iPhone|iPad/i.test(navigator.userAgent);
const VOM_HOMEBILDSCHIRM = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export function swRegistrieren() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => null);
}

// "an" | "aus" | "gesperrt" (im Browser verboten) | "homebildschirm" (iPhone, erst hinzufuegen) | "geht_nicht"
export async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return IPHONE && !VOM_HOMEBILDSCHIRM ? "homebildschirm" : "geht_nicht";
  }
  if (Notification.permission === "denied") return "gesperrt";
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = await reg?.pushManager.getSubscription();
  if (!abo) return "aus";
  // Abo im Browser da, aber nicht (mehr) in der Datenbank - z. B. nach Geraet sperren.
  const { data } = await db.from("push_abos").select("id").eq("endpoint", abo.endpoint).maybeSingle();
  return data ? "an" : "aus";
}

function schluesselBytes(b64) {
  const roh = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(roh, (z) => z.charCodeAt(0));
}

// Muss direkt aus einem Klick kommen (iPhone fragt sonst nicht nach).
export async function pushEinschalten() {
  const erlaubt = await Notification.requestPermission();
  if (erlaubt !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await swRegistrieren());
  if (!reg) throw new Error("Push geht in diesem Browser nicht.");
  await navigator.serviceWorker.ready;
  const s = await funktion("wiki-push", { aktion: "schluessel" });
  if (s.status !== 200) throw new Error(s.daten.fehler || "Schlüssel fehlt.");
  let abo = await reg.pushManager.getSubscription();
  if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(s.daten.schluessel) });
  const j = abo.toJSON();
  const geraet = geraetLesen()?.geraet_id;
  if (!geraet) throw new Error("Dieses Gerät ist nicht eingerichtet.");
  // Ein Abo je Endpunkt: altes Abo dieses Endpunkts erst entfernen.
  await db.from("push_abos").delete().eq("endpoint", j.endpoint);
  const { error } = await db.from("push_abos").insert({ geraet_id: geraet, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw new Error("Speichern ging nicht: " + error.message);
}

export async function pushAusschalten() {
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = await reg?.pushManager.getSubscription();
  if (!abo) return;
  await db.from("push_abos").delete().eq("endpoint", abo.endpoint);
  await abo.unsubscribe();
}

export const wikiMelden = (eintragId) => funktion("wiki-push", { aktion: "melden", eintrag_id: eintragId });
export const chatMelden = (nachrichtId) => funktion("wiki-push", { aktion: "chat", nachricht_id: nachrichtId });
