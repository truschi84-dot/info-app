// Start der App: entscheidet, welcher Bildschirm kommt.
//   Adresse mit #einladung=… -> Einladung
//   gueltige Sitzung          -> Start
//   Geraet eingerichtet       -> PIN
//   sonst                     -> Einladung
import { $, db, farbenLaden, geraetLesen, zeige } from "./gemeinsam.js?v=17";
import { UMGEBUNG } from "./konfig.js?v=17";
import { anmeldungEinrichten, codeAus, zeigeEinladung, zeigePin } from "./anmelden.js?v=17";
import { adminEinrichten, zeigeAdmin } from "./admin.js?v=17";
import { nachschlagenEinrichten, zeigeNachschlagen } from "./nachschlagen.js?v=17";
import { gruppenEinrichten, zeigeGruppen } from "./gruppen.js?v=17";
import { planerEinrichten, zeigePlaner } from "./planer.js?v=17";

let ich = null;

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
