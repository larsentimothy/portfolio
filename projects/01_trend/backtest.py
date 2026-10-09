"""Bausteine für Projekt 1: Trendfolge mit der 200-Tage-Linie."""
import numpy as np
import pandas as pd


def backtest(price, window=200, costs=0.001, delay=1):
    """Tägliche Renditen der Trendregel und von Buy & Hold im selben Zeitraum.

    price:   bereinigte Schlusskurse als pd.Series mit Datumsindex
    window:  Länge des gleitenden Durchschnitts in Handelstagen
    costs:   Kosten je Kauf oder Verkauf als Anteil (0.001 = 10 Basispunkte)
    delay:   Tage zwischen Signal und Position (1 = Handel zum Schlusskurs des Signaltags)
    """
    if delay < 1:
        raise ValueError("delay muss mindestens 1 sein, sonst nutzt der Backtest Wissen aus der Zukunft")

    data = pd.DataFrame({"Close": price})

    data["Rendite"] = data["Close"].pct_change()
    data["sma"] = data["Close"].rolling(window=window).mean()
    data["Signal"] = np.where(data["Close"] > data["sma"], 1.0, 0.0)
    data["Signal"] = data["Signal"].where(data["sma"].notna())   # kein Signal, solange der Durchschnitt fehlt
    data["Position"] = data["Signal"].shift(delay)                # Signal von heute gilt erst ab morgen

    bt = data[["Rendite", "Position"]].dropna().copy()
    bt["Wechsel"] = bt["Position"].diff().abs().fillna(bt["Position"].iloc[0])   # Einstieg am ersten Tag zählt als Kauf
    bt["Strategie"] = bt["Position"] * bt["Rendite"] - bt["Wechsel"] * costs
    bt["Buy_Hold"] = bt["Rendite"]
    return bt


def kennzahlen(r) -> pd.Series:
    """Rendite p. a., Volatilität p. a., Sharpe Ratio und maximaler Drawdown einer täglichen Renditereihe."""
    jahre = (r.index[-1] - r.index[0]).days / 365.25
    wert = (1 + r).cumprod()

    # durchschnittliches Wachstum pro Jahr: Endwert^(1/Jahre) - 1
    rendite_p_a = wert.iloc[-1] ** (1 / jahre) - 1

    # Schwankung der Tagesrenditen, auf ein Jahr hochgerechnet (252 Handelstage)
    volatilitaet_p_a = r.std() * np.sqrt(252)

    # Rendite je Einheit Schwankung, ohne risikolosen Zins (vereinfacht)
    sharpe_ratio = r.mean() / r.std() * np.sqrt(252)

    # größter Verlust vom bisherigen Höchststand, das Startkapital 1 zählt mit
    hoch = wert.cummax().clip(lower=1)
    max_drawdown = (wert / hoch - 1).min()

    return pd.Series({
        "Rendite p. a.": rendite_p_a,
        "Volatilität p. a.": volatilitaet_p_a,
        "Sharpe Ratio": sharpe_ratio,
        "Max. Drawdown": max_drawdown,
    })