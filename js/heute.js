// Startseite "Heute": was jetzt wichtig ist, auf einen Blick - ungelesene Chats,
// wichtige Ankuendigungen, Termine heute/morgen, wer heute fehlt, offene
// Antraege (Freigeber), Neues im Wiki. Jede Zeile fuehrt direkt dorthin.
// Gelesen wird nur, was die Datenbank-Regeln erlauben (z. B. "krank" nur fuer
// Leitung und Chefs) - hier wird nichts zusaetzlich gefiltert, nur eingegrenzt.
import { $, abteilungsChip, db, element } from "./gemeinsam.js?v=32";
import { neuigkeiten } from "./hinweise.js?v=32";

const TAG = 86400e3;

// ziele: { chat(id), chats(), eintrag(id), nachschlagen(), planer(reiter) }
export async function heuteZeigen(ich, ziele) {
  const jetzt = new Date();
  const heute = isoTag(jetzt);
  const tagStart = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const freigeber = ich.rolle === "admin" || ich.darf_freigeben;
  const [c, w, t, a, l, p, n, offen] = await Promise.all([
    db.rpc("meine_chats"),
    db.from("nachrichten").select("id, unterhaltung_id, autor_id, text, erstellt_am").eq("wichtig", true).is("geloescht_am", null)
      .gte("erstellt_am", new Date(Date.now() - 7 * TAG).toISOString()).order("erstellt_am", { ascending: false }).limit(3),
    db.from("termine").select("id, titel, beginn, ende, ganztags, ort, unterhaltung_id").is("abgesagt_am", null)
      .gte("beginn", tagStart.toISOString()).lt("beginn", new Date(tagStart.getTime() + 2 * TAG).toISOString()).order("beginn"),
    db.from("abwesenheiten").select("profil_id, art").eq("status", "genehmigt").lte("von", heute).gte("bis", heute),
    db.from("abteilungsleiter").select("abteilung").eq("profil_id", ich.id),
    db.from("profile").select("id, name, abteilung").eq("aktiv", true),
    neuigkeiten(),
    freigeber ? db.from("abwesenheiten").select("id", { count: "exact", head: true }).eq("status", "beantragt") : Promise.resolve({ count: 0 }),
  ]);
  const chats = c.data || [];
  const namen = new Map((p.data || []).map((x) => [x.id, x.name]));
  const abtVon = new Map((p.data || []).map((x) => [x.id, x.abteilung]));
  const chatName = (id) => chats.find((x) => x.id === id)?.name || "";

  // Wer fehlt heute - Freigeber/Admin: alle; Leitung: ihre Abteilungen; sonst die eigene.
  const meineAbt = abtVon.get(ich.id);
  const blick = new Set([meineAbt, ...(l.data || []).map((x) => x.abteilung)].filter(Boolean));
  const weg = (a.data || []).filter((x) => x.profil_id !== ich.id && (freigeber || blick.has(abtVon.get(x.profil_id))));

  const karten = [
    karte("💬 Ungelesen", ungelesenListe(chats, ziele), "Alles gelesen ✓", ["Chats öffnen", ziele.chats]),
    (w.data || []).length ? karte("❗ Wichtig", (w.data || []).map((m) => zeile(
      () => ziele.chat(m.unterhaltung_id), m.text, `${namen.get(m.autor_id) || "?"} · ${chatName(m.unterhaltung_id)} · ${wann(m.erstellt_am)}`, "wichtig"))) : null,
    karte("📅 Termine heute und morgen", (t.data || []).map((x) => zeile(() => ziele.planer("kalender"), x.titel,
      [tagText(x.beginn), x.ganztags ? "ganztags" : uhrzeit(x.beginn), x.ort, chatName(x.unterhaltung_id)].filter(Boolean).join(" · "))),
      "Heute und morgen keine Termine", ["Zum Kalender", () => ziele.planer("kalender")]),
    karte(freigeber ? "👥 Heute weg" : "👥 Heute weg in deiner Abteilung", wegListe(weg, namen, abtVon, ziele),
      "Heute sind alle da 👍", blick.size || freigeber ? ["Zur Übersicht", () => ziele.planer("abteilung")] : null),
    offen.count ? karte("✅ Offene Anträge", [zeile(() => ziele.planer("antraege"),
      offen.count === 1 ? "1 Antrag wartet auf dich" : `${offen.count} Anträge warten auf dich`, "Urlaub genehmigen oder ablehnen", "hervor")]) : null,
    n.length ? karte(`📖 Neu im Wiki (${n.length})`, n.slice(0, 3).map((x) => zeile(() => ziele.eintrag(x.id), x.titel,
      `${x.ganz_neu ? "neu" : "geändert"} · ${wann(x.zeit)}`)), "", n.length > 3 ? ["Alle ansehen", ziele.nachschlagen] : null) : null,
  ].filter(Boolean);
  $("#heute").replaceChildren(...karten);
}

function ungelesenListe(chats, ziele) {
  return chats.filter((x) => x.ungelesen).slice(0, 4).map((x) => zeile(() => ziele.chat(x.id), x.name || "?",
    (x.art !== "einzel" && x.letzte_autor ? x.letzte_autor + ": " : "") + (x.letzte_text || ""), null, x.ungelesen));
}

function wegListe(weg, namen, abtVon, ziele) {
  const krank = weg.filter((x) => x.art === "krank");
  const sonst = weg.filter((x) => x.art !== "krank");
  const reihe = (zeichen, titel, liste) => (liste.length ? zeile(() => ziele.planer("abteilung"), `${zeichen} ${liste.length} ${titel}`,
    liste.map((x) => namen.get(x.profil_id)).sort().join(", "), null, null, [...new Set(liste.map((x) => abtVon.get(x.profil_id)).filter(Boolean))]) : null);
  return [reihe("🤒", "krank", krank), reihe("🌴", "Urlaub / Schule", sonst)].filter(Boolean);
}

function karte(titel, zeilen, leer, knopf) {
  return element("section", { klasse: "heute-karte" },
    element("h2", { text: titel }),
    zeilen.length ? element("ul", { klasse: "heute-liste" }, ...zeilen) : element("p", { klasse: "leise", text: leer }),
    knopf ? element("button", { klasse: "neben klein-knopf", text: knopf[0], onclick: knopf[1] }) : null);
}

function zeile(los, titel, unter, art = null, zahl = null, abteilungen = []) {
  return element("li", { klasse: art ? `heute-${art}` : "" },
    element("button", { klasse: "eintrag-knopf heute-zeile", onclick: los },
      element("span", { klasse: "heute-text" },
        element("strong", { text: titel }),
        unter ? element("span", { klasse: "leise", text: unter }) : null,
        abteilungen.length ? element("span", { klasse: "heute-chips" }, ...abteilungen.map((x) => abteilungsChip(x))) : null),
      zahl ? element("span", { klasse: "neu-zahl", text: String(zahl) }) : null));
}

function isoTag(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const uhrzeit = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const tagText = (iso) => (isoTag(new Date(iso)) === isoTag(new Date()) ? "heute" : "morgen");
function wann(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `vor ${Math.max(min, 1)} Min.`;
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// Begruessung nach Tageszeit, Datum ausgeschrieben.
export function begruessung(name) {
  const h = new Date().getHours();
  const gruss = h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend";
  return { titel: `${gruss}, ${name}`, datum: new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) };
}
