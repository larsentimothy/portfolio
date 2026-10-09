"""Building blocks for Project 1: trend following with the 200-day moving average."""
from pathlib import Path

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def load_prices(ticker, path, start="1988-01-01", end=None):
    """Daily adjusted prices from Yahoo Finance, cached locally as CSV.

    ticker:  Yahoo Finance symbol, e.g. "SPY", "^GDAXI", "^IRX"
    path:    CSV file for the cache; the first call downloads, later calls read the file
    start:   first date to download
    end:     last date to keep (inclusive), e.g. "2026-09-30" for reproducible results
    """
    path = Path(path)
    if not path.exists():
        import yfinance as yf                    # only needed for the download
        df = yf.download(ticker, start=start, auto_adjust=True, multi_level_index=False)
        if df.empty:
            raise RuntimeError(f"Download for {ticker} returned no data, try again later")
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path)
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    return df.loc[:end] if end else df


def backtest(price, window=200, costs=0.001, delay=1, cash_rate=None):
    """Daily returns of the trend rule and of buy & hold over the same period.

    price:      adjusted closing prices as pd.Series with a date index
    window:     length of the simple moving average in trading days
    costs:      costs per buy or sell as a fraction (0.001 = 10 basis points)
    delay:      days between signal and position (1 = trade at the close of the signal day)
    cash_rate:  optional daily interest on cash as pd.Series (e.g. T-bill yield / 100 / 252);
                None means cash earns 0 %
    """
    if delay < 1:
        raise ValueError("delay must be at least 1, otherwise the backtest uses information from the future")

    df = pd.DataFrame({"Close": price})
    df["Return"] = df["Close"].pct_change()
    df["SMA"] = df["Close"].rolling(window=window).mean()
    df["Signal"] = np.where(df["Close"] > df["SMA"], 1.0, 0.0)
    df["Signal"] = df["Signal"].where(df["SMA"].notna())    # no signal while the average is missing
    df["Position"] = df["Signal"].shift(delay)               # today's signal applies from tomorrow

    bt = df[["Return", "Position"]].dropna().copy()
    bt["Trade"] = bt["Position"].diff().abs().fillna(bt["Position"].iloc[0])   # entry on day one counts as a buy
    cash = 0.0 if cash_rate is None else cash_rate.reindex(bt.index).ffill().fillna(0)
    bt["Strategy"] = bt["Position"] * bt["Return"] + (1 - bt["Position"]) * cash - bt["Trade"] * costs
    bt["Buy_Hold"] = bt["Return"]
    return bt


def metrics(r) -> pd.Series:
    """CAGR, volatility, Sharpe ratio and maximum drawdown of a series of daily returns."""
    years = (r.index[-1] - r.index[0]).days / 365.25
    wealth = (1 + r).cumprod()

    # average growth per year: final wealth^(1/years) - 1
    cagr = wealth.iloc[-1] ** (1 / years) - 1

    # fluctuation of daily returns, scaled to one year (252 trading days)
    volatility = r.std() * np.sqrt(TRADING_DAYS)

    # return per unit of volatility, without a risk-free rate (simplified)
    sharpe_ratio = r.mean() / r.std() * np.sqrt(TRADING_DAYS)

    # largest loss from the previous peak; the starting capital of 1 counts as the first peak
    peak = wealth.cummax().clip(lower=1)
    max_drawdown = (wealth / peak - 1).min()

    return pd.Series({
        "CAGR": cagr,
        "Volatility": volatility,
        "Sharpe Ratio": sharpe_ratio,
        "Max Drawdown": max_drawdown,
    })


def trades_per_year(bt) -> float:
    """Average number of buys and sells per year in a backtest result."""
    years = (bt.index[-1] - bt.index[0]).days / 365.25
    return bt["Trade"].sum() / years
