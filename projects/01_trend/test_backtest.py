"""Tests with small examples that can be checked by hand. From the repo root: pytest -q projects/01_trendfolge"""
import pandas as pd
import pytest

from backtest import backtest, metrics, trades_per_year


def days(n):
    return pd.bdate_range("2020-01-01", periods=n)


def test_drawdown_counts_from_starting_capital():
    r = pd.Series([-0.10, 0.05, 0.05], index=days(3))
    assert metrics(r)["Max Drawdown"] == pytest.approx(-0.10)


def test_cagr_when_doubling_in_two_years():
    idx = pd.DatetimeIndex(["2020-01-01", "2022-01-01"])
    r = pd.Series([0.0, 1.0], index=idx)               # wealth 1 -> 2 in two years
    assert metrics(r)["CAGR"] == pytest.approx(2 ** 0.5 - 1, rel=1e-3)


def test_no_look_ahead():
    # Example from the signal section: signal on the jump day, position only from the next day
    price = pd.Series([100, 100, 100, 110, 121], index=days(5), dtype=float)
    e = backtest(price, window=3, costs=0)
    assert e.loc[price.index[3], "Position"] == 0      # jump day: not yet invested
    assert e.loc[price.index[3], "Strategy"] == 0      # so no gain from the jump
    assert e.loc[price.index[4], "Position"] == 1
    assert e.loc[price.index[4], "Strategy"] == pytest.approx(0.10)


def test_costs_only_when_trading():
    price = pd.Series(range(100, 120), index=days(20), dtype=float)   # steadily rising: always invested
    without = backtest(price, window=3, costs=0)
    with_costs = backtest(price, window=3, costs=0.01)
    assert with_costs["Trade"].sum() == 1               # only the entry
    assert (without["Strategy"] - with_costs["Strategy"]).sum() == pytest.approx(0.01)


def test_delay_zero_is_rejected():
    price = pd.Series(range(100, 120), index=days(20), dtype=float)
    with pytest.raises(ValueError):
        backtest(price, window=3, delay=0)


def test_cash_earns_interest_when_out_of_the_market():
    price = pd.Series(range(120, 100, -1), index=days(20), dtype=float)   # steadily falling: always in cash
    rate = pd.Series(0.0001, index=price.index)
    e = backtest(price, window=3, costs=0.001, cash_rate=rate)
    assert e["Position"].sum() == 0
    assert e["Strategy"].tolist() == pytest.approx([0.0001] * len(e))   # no trades, only interest


def test_trades_per_year():
    idx = pd.DatetimeIndex(["2020-01-01", "2021-01-01", "2022-01-01"])
    bt = pd.DataFrame({"Trade": [1.0, 1.0, 0.0]}, index=idx)
    assert trades_per_year(bt) == pytest.approx(2 / (731 / 365.25))
