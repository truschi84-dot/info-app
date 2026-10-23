// Anmeldung: Einladung (Code oder QR), PIN waehlen, PIN eingeben.
// Ablauf siehe Plan Fassung 2, Abschnitt 2.
import {
  $, funktion, geraeteName, geraetLesen, geraetMerken, geraetVergessen, knopfBeschaeftigt,
  meldung, neuerGeraeteschluessel, sitzungUebernehmen, zeige,
} from "./gemeinsam.js?v=14";

let offeneEinladung = null; // { code, name, zweck, pin_noetig }
let nachAnmeldung = () => {};
let scanner = null;

export function anmeldungEinrichten(weiter) {
  nachAnmeldung = weiter;

  $("#einladung-weiter").addEventListener("click", () => einladungPruefen($("#einladung-code").value));
  $("#einladung-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#einladung-weiter").click(); });
  $("#einladung-scannen").addEventListener("click", scannerStarten);
  $("#scanner-aus").addEventListener("click", scannerStoppen);

  $("#pin-waehlen-los").addEventListener("click", einladungEinloesen);
  $("#pin-neu2").addEventListener("keydown", (e) => { if (e.key === "Enter") einladungEinloesen(); });
  $("#pin-waehlen-zurueck").addEventListener("click", () => zeigeEinladung());

  $("#pin-los").addEventListener("click", pinAnmelden);
  $("#pin-eingabe").addEventListener("keydown", (e) => { if (e.key === "Enter") pinAnmelden(); });
}

export function zeigeEinladung(code = "", text = "") {
  offeneEinladung = null;
  $("#einladung-code").value = code;
  meldung("#einladung-meldung", text, "hinweis");
  zeige("einladung");
  if (code) einladungPruefen(code);
}

export function zeigePin() {
  const g = geraetLesen();
  $("#pin-hallo").textContent = g?.name ? `Hallo ${g.name}` : "Hallo";
  $("#pin-eingabe").value = "";
  meldung("#pin-meldung", "");
  zeige("pin");
  $("#pin-eingabe").focus();
}

// Code aus einem QR-Inhalt holen: entweder die Adresse mit #einladung=… oder der Code selbst.
export function codeAus(text) {
  const t = String(text || "").trim();
  const treffer = t.match(/[#&]einladung=([0-9A-Za-z-]+)/);
  return (treffer ? treffer[1] : t).toUpperCase();
}

async function einladungPruefen(roh) {
  const code = codeAus(roh);
  if (code.replace(/[^0-9A-Z]/g, "").length !== 10) {
    meldung("#einladung-meldung", "Der Code hat 10 Zeichen, zum Beispiel K7P2X-9QMRT.");
    return;
  }
  const knopf = $("#einladung-weiter");
  knopfBeschaeftigt(knopf, true);
  const r = await funktion("anmelden", { aktion: "einladung_pruefen", code });
  knopfBeschaeftigt(knopf, false);
  if (r.status !== 200) {
    meldung("#einladung-meldung", r.daten.fehler || "Das hat nicht geklappt.");
    return;
  }
  offeneEinladung = { code, ...r.daten };
  zeigePinWaehlen();
}

function zeigePinWaehlen() {
  const e = offeneEinladung;
  $("#pin-waehlen-hallo").textContent = `Hallo ${e.name}`;
  $("#pin-waehlen-text").textContent = e.pin_noetig
    ? (e.zweck === "pin_neu"
      ? "Wähle eine neue 6-stellige PIN für dieses Gerät."
      : "Wähle eine 6-stellige PIN. Du brauchst sie nur, wenn du dich auf diesem Gerät neu anmelden musst.")
    : "Dieses Gerät wird zu deinem Zugang hinzugefügt. Deine PIN bleibt gleich.";
  $("#pin-waehlen-feld1").hidden = !e.pin_noetig;
  $("#pin-waehlen-feld2").hidden = !e.pin_noetig;
  $("#pin-neu").value = "";
  $("#pin-neu2").value = "";
  meldung("#pin-waehlen-meldung", "");
  zeige("pin-waehlen");
  if (e.pin_noetig) $("#pin-neu").focus();
}

async function einladungEinloesen() {
  const e = offeneEinladung;
  if (!e) return zeigeEinladung();
  const pin = $("#pin-neu").value;
  if (e.pin_noetig) {
    if (!/^\d{6}$/.test(pin)) return meldung("#pin-waehlen-meldung", "Die PIN muss aus 6 Ziffern bestehen.");
    if (pin !== $("#pin-neu2").value) return meldung("#pin-waehlen-meldung", "Die beiden PINs sind nicht gleich.");
  }

  const schluessel = neuerGeraeteschluessel();
  const bezeichnung = geraeteName();
  const knopf = $("#pin-waehlen-los");
  knopfBeschaeftigt(knopf, true);
  const r = await funktion("anmelden", {
    aktion: "einladung_einloesen", code: e.code, geraet_schluessel: schluessel, bezeichnung,
    ...(e.pin_noetig ? { pin } : {}),
  });
  if (r.status !== 200) {
    knopfBeschaeftigt(knopf, false);
    return meldung("#pin-waehlen-meldung", r.daten.fehler || "Das hat nicht geklappt.");
  }
  try {
    geraetMerken({ geraet_id: r.daten.geraet_id, schluessel, name: r.daten.name });
    await sitzungUebernehmen(r.daten);
  } catch (err) {
    knopfBeschaeftigt(knopf, false);
    return meldung("#pin-waehlen-meldung", err.message);
  }
  knopfBeschaeftigt(knopf, false);
  offeneEinladung = null;
  nachAnmeldung();
}

async function pinAnmelden() {
  const g = geraetLesen();
  if (!g) return zeigeEinladung();
  const pin = $("#pin-eingabe").value;
  if (!/^\d{6}$/.test(pin)) return meldung("#pin-meldung", "Die PIN hat 6 Ziffern.");

  const knopf = $("#pin-los");
  knopfBeschaeftigt(knopf, true);
  const r = await funktion("anmelden", { aktion: "pin", geraet_id: g.geraet_id, geraet_schluessel: g.schluessel, pin });
  knopfBeschaeftigt(knopf, false);

  if (r.status === 200) {
    try {
      await sitzungUebernehmen(r.daten);
    } catch (err) {
      return meldung("#pin-meldung", err.message);
    }
    return nachAnmeldung();
  }
  $("#pin-eingabe").value = "";
  if (r.status === 403) {
    geraetVergessen();
    return zeigeEinladung("", r.daten.fehler);
  }
  const rest = r.daten.versuche_uebrig;
  meldung("#pin-meldung", rest ? `${r.daten.fehler} Noch ${rest} Versuch${rest === 1 ? "" : "e"}.` : r.daten.fehler);
}

// ── QR-Code scannen (Bibliothek wird erst bei Bedarf geladen) ─────────────
function bibliothekLaden() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, fehl) => {
    const s = document.createElement("script");
    s.src = "lib/html5-qrcode.min.js?v=1";
    s.onload = ok;
    s.onerror = () => fehl(new Error("Scanner konnte nicht geladen werden."));
    document.head.append(s);
  });
}

async function scannerStarten() {
  meldung("#einladung-meldung", "");
  try {
    await bibliothekLaden();
    $("#scanner").hidden = false;
    $("#scanner-aus").hidden = false;
    $("#einladung-scannen").hidden = true;
    scanner = new window.Html5Qrcode("scanner");
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 220 },
      async (text) => {
        await scannerStoppen();
        const code = codeAus(text);
        $("#einladung-code").value = code;
        einladungPruefen(code);
      },
      () => {},
    );
  } catch (err) {
    await scannerStoppen();
    meldung("#einladung-meldung", `Kamera geht nicht (${err?.message || err}). Bitte den Code abtippen.`);
  }
}

async function scannerStoppen() {
  if (scanner) {
    try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch { /* schon aus */ }
    scanner = null;
  }
  $("#scanner").hidden = true;
  $("#scanner-aus").hidden = true;
  $("#einladung-scannen").hidden = false;
}
