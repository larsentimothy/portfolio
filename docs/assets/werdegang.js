// Werdegang als interaktiver Kursverlauf auf der Startseite.
// Inhalte (Anker, Stationen, Prognose) stehen in data/werdegang.json, hier wird nur gerechnet und gezeichnet.
// Farben und Schrift kommen aus assets/style.css (Klassen wg-...).
(() => {
  "use strict";
  const box = document.getElementById("werdegang-chart");
  if (!box) return;
  const legende = document.getElementById("werdegang-legende");
  const knoepfe = [...document.querySelectorAll(".zeitraum button")];

  const NS = "http://www.w3.org/2000/svg";
  const TAG = 864e5, WOCHE = 7 * TAG, JAHR = 365.25 * TAG;
  const zahl = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const monat = (t) => new Date(t).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
  const QUARTAL = ["Jan", "Apr", "Jul", "Okt"];
  const datum = (iso) => Date.parse(iso + "T00:00:00Z");
  const grenze = (w, a, b) => Math.min(b, Math.max(a, w));
  const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const z = { jahre: "max", cursor: null, erstesMal: true };

  // ---------- kleine Helfer zum Erzeugen von Elementen ----------
  function svgEl(tag, attrs, eltern, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    if (eltern) eltern.append(e);
    return e;
  }
  function htmlEl(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // =====================================================================
  // Daten: Verlauf, Prognose, Stationen
  // =====================================================================
  // Zufallszahlen mit festem Seed (mulberry32), damit die Kurve bei jedem Besuch gleich aussieht
  function zufall(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  // Wöchentlicher Verlauf vom ersten bis zum letzten Anker ("heute"), trifft jeden Anker exakt
  function verlauf(cfg) {
    const start = datum(cfg.anker[0].datum);
    const woche = (iso) => Math.round((datum(iso) - start) / WOCHE);
    const n = woche(cfg.anker[cfg.anker.length - 1].datum);

    const punkte = [];   // [Wochennummer, log(Indexstand)]; ein Sprung wird ein Punkt eine Woche später
    for (const a of cfg.anker) {
      punkte.push([woche(a.datum), Math.log(a.stand)]);
      if (a.sprung) punkte.push([woche(a.datum) + 1, Math.log(a.stand * (1 + a.sprung / 100))]);
    }
    const faktor = (t) =>
      (cfg.unruhige_phasen || []).reduce((f, p) => (t >= datum(p.von) && t <= datum(p.bis) ? p.faktor : f), 1);

    const rng = zufall(cfg.seed);
    const log = new Array(n + 1);
    for (let j = 0; j + 1 < punkte.length; j++) {
      const [i0, l0] = punkte[j];
      const [i1, l1] = punkte[j + 1];
      const m = i1 - i0;
      if (m <= 0) continue;
      const pfad = [0];
      for (let k = 1; k <= m; k++) {
        pfad.push(pfad[k - 1] + normal(rng) * cfg.volatilitaet_woche * faktor(start + (i0 + k) * WOCHE));
      }
      for (let k = 0; k <= m; k++) {
        const anteil = k / m;
        // Brownsche Brücke: Zufallspfad, der am Anfang und am Ende bei null liegt
        log[i0 + k] = l0 + anteil * (l1 - l0) + pfad[k] - anteil * pfad[m];
      }
    }
    return log.map((l, i) => ({ t: start + i * WOCHE, v: Math.exp(l) }));
  }

  // Lognormaler Prognosekorridor von heute bis prognose.bis: Median, 50-%- und 90-%-Band
  function prognose(cfg, reihe) {
    const { t: t0, v: v0 } = reihe[reihe.length - 1];
    const ende = datum(cfg.prognose.bis);
    const mu = Math.log(cfg.prognose.ziel / v0) / ((ende - t0) / JAHR);
    const sigma = cfg.prognose.volatilitaet_jahr;
    const punkt = (t) => {
      const jahre = (t - t0) / JAHR;
      const w = (q) => v0 * Math.exp(mu * jahre + q * sigma * Math.sqrt(jahre));
      return { t, median: w(0), u50: w(-0.674), o50: w(0.674), u90: w(-1.645), o90: w(1.645) };
    };
    const werte = [];
    for (let t = t0; t < ende; t += WOCHE) werte.push(punkt(t));
    werte.push(punkt(ende));
    return werte;
  }

  // Stationen nach Datum, mit Buchstabe A, B, C ... und Kennzeichen "geplant"
  function stationen(cfg, heute) {
    return [...cfg.ereignisse]
      .sort((a, b) => datum(a.datum) - datum(b.datum))
      .map((e, i) => ({ ...e, t: datum(e.datum), zeichen: String.fromCharCode(65 + i), geplant: datum(e.datum) > heute }));
  }

  function naechster(liste, t) {
    return liste[grenze(Math.round((t - liste[0].t) / WOCHE), 0, liste.length - 1)];
  }
  function wertBei(t) {
    return t <= z.heute ? naechster(z.reihe, t).v : naechster(z.prog, t).median;
  }

  // Stiel so lang wählen, dass sich eine Marke nicht mit der vorherigen überdeckt
  function stiele(pos, r) {
    const stufen = [2.8 * r, 5 * r, 7.2 * r];
    let vorher = null;
    return pos.map(([x, y]) => {
      let stiel = stufen[stufen.length - 1];
      for (const s of stufen) {
        if (!vorher || Math.hypot(x - vorher[0], y - s - vorher[1]) >= 2.3 * r) { stiel = s; break; }
      }
      vorher = [x, y - stiel];
      return stiel;
    });
  }

  // =====================================================================
  // Zeichnen (in der tatsächlichen Breite, damit Schrift überall gleich groß ist)
  // =====================================================================
  function zeichne() {
    const W = Math.max(280, Math.round(box.clientWidth));
    const schmal = W < 640;
    const H = schmal ? 340 : 440;
    const r = schmal ? 10 : 11;
    const rand = { l: r + 4, r: schmal ? 40 : 52, o: 14, u: 30 };
    const oben = rand.o, unten = H - rand.u;

    const ende = z.prog[z.prog.length - 1].t;
    const von = z.jahre === "max" ? z.reihe[0].t : Math.max(z.reihe[0].t, z.heute - z.jahre * JAHR);
    const sicht = z.reihe.filter((p) => p.t >= von);
    const sichtbar = z.stat.map((e, i) => ({ e, i })).filter(({ e }) => e.t >= von - TAG);

    const x = (t) => rand.l + ((t - von) / (ende - von)) * (W - rand.l - rand.r);
    let lo = Math.log(Math.min(...sicht.map((p) => p.v), ...z.prog.map((p) => p.u90)) * 0.96);
    let hi = Math.log(Math.max(...sicht.map((p) => p.v), ...z.prog.map((p) => p.o90)) * 1.02);
    const y = (v) => unten - ((Math.log(v) - lo) / (hi - lo)) * (unten - oben);

    // Platz nach oben schaffen, bis alle Marken hineinpassen
    let pos = [], laengen = [];
    for (let runde = 0; runde < 6; runde++) {
      pos = sichtbar.map(({ e }) => [x(e.t), y(wertBei(e.t))]);
      laengen = stiele(pos, r);
      const oberkante = Math.min(...pos.map(([, yy], k) => yy - laengen[k] - r));
      if (oberkante >= 4) break;
      hi += ((4 - oberkante) / (unten - oben)) * (hi - lo) * 1.15;
    }

    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`, width: W, height: H, tabindex: "0",
      "aria-label": "Werdegang als Kursverlauf seit Oktober 2018 mit Prognose bis 2027. Mit den Pfeiltasten durch die Zeit bewegen.",
      "aria-describedby": "werdegang-hilfe",
    });
    if (z.erstesMal && !ruhig) svg.classList.add("animiert");

    // Gitter und rechte Achse
    let ticks = [50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800].filter((v) => {
      const l = Math.log(v);
      return l >= lo && l <= hi && y(v) > oben + 8;
    });
    while (ticks.length > (schmal ? 4 : 6)) ticks = ticks.filter((_, k) => k % 2 === 0);
    for (const v of ticks) {
      svgEl("line", { class: "wg-gitter", x1: rand.l, x2: W - rand.r, y1: y(v), y2: y(v) }, svg);
      svgEl("text", { class: "wg-text", x: W - rand.r + 8, y: y(v) + 4 }, svg, zahl.format(v));
    }
    svgEl("line", { class: "wg-achse", x1: rand.l, x2: W - rand.r, y1: unten, y2: unten }, svg);

    // Zeitachse: Jahre, bei kurzen Zeiträumen Quartale
    const marken = [];
    const spanne = (ende - von) / JAHR;
    if (spanne > 3) {
      const schritt = schmal && spanne > 5 ? 2 : 1;
      for (let j = new Date(von).getUTCFullYear() + 1; j <= new Date(ende).getUTCFullYear(); j += schritt) {
        marken.push([Date.UTC(j, 0, 1), String(j)]);
      }
    } else {
      const d = new Date(von);
      for (let m = d.getUTCMonth() + 1, j = d.getUTCFullYear(); Date.UTC(j, m, 1) <= ende; m++) {
        if (m === 12) { m = 0; j++; }
        if (m % (schmal ? 6 : 3) === 0) marken.push([Date.UTC(j, m, 1), `${QUARTAL[m / 3]} ${j}`]);
      }
    }
    for (const [t, text] of marken) {
      svgEl("line", { class: "wg-achse", x1: x(t), x2: x(t), y1: unten, y2: unten + 5 }, svg);
      svgEl("text", { class: "wg-text", x: x(t), y: unten + 20, "text-anchor": "middle" }, svg, text);
    }

    // Prognosekorridor
    const punkte = (liste, feld) => liste.map((p) => `${x(p.t).toFixed(1)},${y(p[feld]).toFixed(1)}`).join(" ");
    const zukunft = svgEl("g", { class: "wg-spaeter" }, svg);
    svgEl("polygon", { class: "wg-band90", points: `${punkte(z.prog, "o90")} ${punkte([...z.prog].reverse(), "u90")}` }, zukunft);
    svgEl("polygon", { class: "wg-band50", points: `${punkte(z.prog, "o50")} ${punkte([...z.prog].reverse(), "u50")}` }, zukunft);
    svgEl("polyline", { class: "wg-median", points: punkte(z.prog, "median") }, zukunft);

    // Fläche und Kurs
    svgEl("polygon", { class: "wg-flaeche wg-spaeter", points: `${x(sicht[0].t)},${unten} ${punkte(sicht, "v")} ${x(z.heute)},${unten}` }, svg);
    const kurs = svgEl("polyline", { class: "wg-kurs", points: punkte(sicht, "v") }, svg);

    // heute
    svgEl("line", { class: "wg-heute", x1: x(z.heute), x2: x(z.heute), y1: oben, y2: unten }, svg);
    svgEl("text", { class: "wg-text wg-heute-text", x: x(z.heute) - 6, y: unten - 8, "text-anchor": "end" }, svg, "heute");

    // Fadenkreuz (unsichtbar, bis jemand über den Chart fährt)
    const kreuz = svgEl("g", { class: "wg-kreuz", visibility: "hidden" }, svg);
    const kreuzLinie = svgEl("line", { y1: oben, y2: unten }, kreuz);
    const kreuzPunkt = svgEl("circle", { r: 4.5 }, kreuz);

    // Marken (wie News-Fähnchen in Kursportalen)
    const markenGruppe = svgEl("g", { class: "wg-spaeter" }, svg);
    const fahnen = {};
    sichtbar.forEach(({ e, i }, k) => {
      const [xx, yy] = pos[k];
      const yf = yy - laengen[k];
      fahnen[i] = [xx, yf - r];
      const g = svgEl("g", { class: "marke" + (e.geplant ? " geplant" : "") + (e.hervorheben ? " hervorheben" : ""), "data-i": i }, markenGruppe);
      svgEl("line", { class: "stiel", x1: xx, x2: xx, y1: yy, y2: yf + r }, g);
      if (!e.geplant) svgEl("circle", { class: "punkt", cx: xx, cy: yy, r: 3.5 }, g);
      svgEl("circle", { class: "treffer", cx: xx, cy: yf, r: r + 7 }, g);
      svgEl("circle", { class: "fahne", cx: xx, cy: yf, r }, g);
      svgEl("text", { x: xx, y: yf + r * 0.4, "font-size": (r * 1.1).toFixed(1) }, g, e.zeichen);
    });

    const tip = htmlEl("div", "wg-tooltip");
    tip.hidden = true;
    tip.setAttribute("role", "status");
    box.replaceChildren(svg, tip);

    z.skala = { W, H, von, ende, x, y, rand, svg, tip, kreuz, kreuzLinie, kreuzPunkt, fahnen };
    verbinde(svg);

    // Einblenden: Kurs zeichnet sich von links nach rechts, danach Prognose und Marken
    if (svg.classList.contains("animiert")) {
      const laenge = kurs.getTotalLength();
      kurs.style.strokeDasharray = `${laenge} ${laenge}`;
      kurs.style.strokeDashoffset = laenge;
      kurs.getBoundingClientRect();
      kurs.style.transition = "stroke-dashoffset 1.4s ease-out";
      kurs.style.strokeDashoffset = "0";
    }
  }

  // =====================================================================
  // Interaktion
  // =====================================================================
  function zeigeTooltip(zeilen, px, py) {
    const { tip, W, H } = z.skala;
    tip.replaceChildren(...zeilen);
    tip.hidden = false;
    const b = tip.offsetWidth, h = tip.offsetHeight;
    let links = px + 16;
    if (links + b > W) links = px - 16 - b;
    let oben = py - h - 14;
    if (oben < 0) oben = py + 14;
    tip.style.left = `${grenze(links, 0, Math.max(0, W - b))}px`;
    tip.style.top = `${grenze(oben, 0, Math.max(0, H - h))}px`;
  }

  function markiere(i) {
    for (const el of box.querySelectorAll(".marke")) el.classList.toggle("aktiv", Number(el.dataset.i) === i);
    if (legende) for (const li of legende.children) li.classList.toggle("aktiv", Number(li.dataset.i) === i);
  }

  function zeigeZeitpunkt(t) {
    const s = z.skala;
    t = grenze(t, s.von, s.ende);
    z.cursor = t;
    let px, py, zeilen;
    if (t <= z.heute) {
      const p = naechster(z.reihe, t);
      px = s.x(p.t);
      py = s.y(p.v);
      const station = [...z.stat].reverse().find((e) => !e.geplant && e.t <= p.t + 3 * TAG);
      zeilen = [htmlEl("strong", null, monat(p.t)), htmlEl("span", null, `Index ${zahl.format(p.v)}`)];
      if (station) zeilen.push(htmlEl("span", "neben", `Letzte Station: ${station.text}`));
    } else {
      const q = naechster(z.prog, t);
      px = s.x(q.t);
      py = s.y(q.median);
      zeilen = [
        htmlEl("strong", null, `Prognose für ${monat(q.t)}`),
        htmlEl("span", null, `Median ${zahl.format(q.median)}`),
        htmlEl("span", "neben", `50-%-Band: ${zahl.format(q.u50)} bis ${zahl.format(q.o50)}`),
        htmlEl("span", "neben", `90-%-Band: ${zahl.format(q.u90)} bis ${zahl.format(q.o90)}`),
      ];
    }
    s.kreuzLinie.setAttribute("x1", px);
    s.kreuzLinie.setAttribute("x2", px);
    s.kreuzPunkt.setAttribute("cx", px);
    s.kreuzPunkt.setAttribute("cy", py);
    s.kreuz.setAttribute("visibility", "visible");
    markiere(null);
    zeigeTooltip(zeilen, px, py);
  }

  function zeigeStation(i) {
    const e = z.stat[i];
    const [px, py] = z.skala.fahnen[i];
    z.skala.kreuz.setAttribute("visibility", "hidden");
    markiere(i);
    zeigeTooltip([htmlEl("strong", null, `${e.zeichen}, ${e.anzeige}`), htmlEl("span", null, e.text)], px, py);
  }

  function verstecke() {
    if (!z.skala) return;
    z.skala.tip.hidden = true;
    z.skala.kreuz.setAttribute("visibility", "hidden");
    markiere(null);
  }

  function verbinde(svg) {
    const zeigen = (ev) => {
      const marke = ev.target.closest(".marke");
      if (marke) return zeigeStation(Number(marke.dataset.i));
      const { rand, W, von, ende } = z.skala;
      const px = ev.clientX - svg.getBoundingClientRect().left;
      zeigeZeitpunkt(von + ((px - rand.l) / (W - rand.l - rand.r)) * (ende - von));
    };
    svg.addEventListener("pointermove", zeigen);
    svg.addEventListener("pointerdown", zeigen);
    svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") verstecke(); });
    svg.addEventListener("focus", () => zeigeZeitpunkt(z.cursor ?? z.heute));
    svg.addEventListener("blur", verstecke);
    svg.addEventListener("keydown", (ev) => {
      let t = z.cursor ?? z.heute;
      const schritt = (ev.shiftKey ? 52 : 4) * WOCHE;
      if (ev.key === "ArrowLeft") t -= schritt;
      else if (ev.key === "ArrowRight") t += schritt;
      else if (ev.key === "Home") t = z.skala.von;
      else if (ev.key === "End") t = z.skala.ende;
      else if (ev.key === "Escape") return verstecke();
      else return;
      ev.preventDefault();
      zeigeZeitpunkt(t);
    });
  }

  function baueLegende() {
    if (!legende) return;
    legende.replaceChildren();
    z.stat.forEach((e, i) => {
      const li = htmlEl("li");
      li.dataset.i = i;
      const zeichen = htmlEl("span", "zeichen" + (e.geplant ? " geplant" : "") + (e.hervorheben ? " hervorheben" : ""), e.zeichen);
      const text = htmlEl("span");
      text.append(htmlEl("strong", null, e.anzeige), htmlEl("span", "text", e.text));
      li.append(zeichen, text);
      li.addEventListener("pointerenter", () => markiere(i));
      li.addEventListener("pointerleave", () => markiere(null));
      legende.append(li);
    });
  }

  // Zeitraum-Knöpfe (1J, 3J, 5J, Max)
  knoepfe.forEach((knopf) =>
    knopf.addEventListener("click", () => {
      z.jahre = knopf.dataset.jahre === "max" ? "max" : Number(knopf.dataset.jahre);
      knoepfe.forEach((k) => k.setAttribute("aria-pressed", String(k === knopf)));
      z.cursor = null;
      zeichne();
    })
  );

  // Tippen außerhalb des Charts blendet den Tooltip aus (für Handys)
  document.addEventListener("pointerdown", (ev) => { if (!box.contains(ev.target)) verstecke(); });

  // =====================================================================
  // Start
  // =====================================================================
  fetch("data/werdegang.json")
    .then((antwort) => {
      if (!antwort.ok) throw new Error("data/werdegang.json wurde nicht gefunden");
      return antwort.json();
    })
    .then((cfg) => {
      z.reihe = verlauf(cfg);
      z.heute = z.reihe[z.reihe.length - 1].t;
      z.prog = prognose(cfg, z.reihe);
      z.stat = stationen(cfg, z.heute);
      baueLegende();
      zeichne();
      z.erstesMal = false;

      let breite = box.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(box.clientWidth - breite) < 1) return;
        breite = box.clientWidth;
        zeichne();
      }).observe(box);
    })
    .catch((fehler) => {
      box.closest("figure")?.remove();   // ohne Daten lieber kein halber Chart
      console.warn("Werdegang-Chart:", fehler.message);
    });
})();
