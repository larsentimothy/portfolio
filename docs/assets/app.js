// Lädt data/projects.json und baut daraus die Projekt-Kacheln (Startseite) bzw. die Projektseite.
// Neues Projekt = neuer Eintrag in projects.json – am HTML musst du nichts ändern.

async function ladeProjekte() {
  const antwort = await fetch("data/projects.json");
  if (!antwort.ok) throw new Error("data/projects.json wurde nicht gefunden");
  return antwort.json();
}

// Element mit Text erzeugen (textContent schützt vor kaputtem HTML)
function el(tag, text, klasse) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function liste(punkte) {
  const ul = el("ul");
  punkte.forEach((p) => ul.append(el("li", p)));
  return ul;
}

const istNegativ = (wert) => /^[-−]/.test(String(wert).trim());

// ---------- Startseite: Kacheln ----------
function zeigeKacheln(projekte, ziel, stand) {
  ziel.innerHTML = "";
  const fertige = projekte.filter((p) => p.status === "fertig").length;
  if (stand) stand.textContent = `${fertige} von ${projekte.length} veröffentlicht`;

  projekte.forEach((p) => {
    const fertig = p.status === "fertig";
    const kachel = el(fertig ? "a" : "div", null, "kachel" + (fertig ? "" : " in-arbeit"));
    if (fertig) kachel.href = `projekt.html?id=${encodeURIComponent(p.id)}`;

    const bildRahmen = el("div", null, "kachel-bild");
    const bild = el("img");
    bild.src = p.bild || "img/platzhalter.svg";
    bild.alt = "";
    bild.loading = "lazy";
    bildRahmen.append(bild);

    const text = el("div", null, "kachel-text");
    if (p.tags?.length) text.append(el("p", p.tags.join(", "), "kachel-fokus"));
    text.append(el("h3", p.titel), el("p", p.kurz, "kachel-kurz"));
    if (fertig && p.kennzahl) {
      const zahl = el("p", null, "kachel-zahl");
      zahl.append(el("strong", p.kennzahl.wert), document.createTextNode(p.kennzahl.name));
      text.append(zahl);
    }
    text.append(el("span", fertig ? "Ergebnisse lesen" : "in Arbeit", "kachel-status"));

    kachel.append(bildRahmen, text);
    ziel.append(kachel);
  });
}

// ---------- Projektseite ----------
function zeigeProjekt(p, ziel) {
  document.title = `${p.titel} – Timothy Larsen`;
  ziel.innerHTML = "";
  ziel.append(el("p", `Projekt ${p.nummer}`, "projekt-nr"), el("h1", p.titel));
  if (p.tags?.length) ziel.append(el("p", p.tags.join(", "), "projekt-fokus"));

  if (p.erkenntnisse?.length) {
    const box = el("div", null, "ueberblick");
    box.append(el("h2", "Auf einen Blick"), liste(p.erkenntnisse));
    ziel.append(box);
  }
  if (p.frage) ziel.append(el("h2", "Fragestellung"), el("p", p.frage));
  if (p.daten?.length) ziel.append(el("h2", "Daten"), liste(p.daten));
  if (p.methode?.length) ziel.append(el("h2", "Methode"), liste(p.methode));

  if (p.kennzahlen) {
    ziel.append(el("h2", "Ergebnisse"));
    const tabelle = el("table");
    const kopf = el("tr");
    ["Kennzahl", ...p.kennzahlen.spalten].forEach((s) => kopf.append(el("th", s)));
    const thead = el("thead");
    thead.append(kopf);
    const tbody = el("tbody");
    p.kennzahlen.zeilen.forEach((zeile) => {
      const tr = el("tr");
      zeile.forEach((wert, i) => tr.append(el(i === 0 ? "th" : "td", wert, i > 0 && istNegativ(wert) ? "neg" : "")));
      tbody.append(tr);
    });
    tabelle.append(thead, tbody);
    ziel.append(tabelle);
  }

  (p.charts || []).forEach((c) => {
    const fig = el("figure");
    const img = el("img");
    img.src = c.bild;
    img.alt = c.titel;
    fig.append(img, el("figcaption", c.titel));
    ziel.append(fig);
  });

  if (p.grenzen?.length) ziel.append(el("h2", "Grenzen"), liste(p.grenzen));

  if (p.code) {
    const absatz = el("p");
    const link = el("a", "Quellcode auf GitHub ansehen");
    link.href = p.code;
    absatz.append(link);
    ziel.append(el("h2", "Code"), absatz);
  }
}

// ---------- Start ----------
(async () => {
  const kacheln = document.getElementById("projekt-liste");
  const projektSeite = document.getElementById("projekt");
  try {
    const projekte = await ladeProjekte();
    if (kacheln) zeigeKacheln(projekte, kacheln, document.getElementById("projekt-stand"));
    if (projektSeite) {
      const id = new URLSearchParams(location.search).get("id");
      const projekt = projekte.find((p) => p.id === id && p.status === "fertig");
      if (projekt) zeigeProjekt(projekt, projektSeite);
      else projektSeite.innerHTML = '<p>Dieses Projekt ist noch nicht veröffentlicht. <a href="index.html#projekte">Zur Projektübersicht</a></p>';
    }
  } catch (fehler) {
    const ziel = kacheln || projektSeite;
    if (ziel) ziel.innerHTML = `<p>Die Projekte konnten nicht geladen werden: ${fehler.message}. Lokal die Seite über "python -m http.server" öffnen.</p>`;
  }
})();
