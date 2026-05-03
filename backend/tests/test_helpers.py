"""
Unit tests for pure helper functions in financials.py and screener.py.
No external calls, no mocking required.
"""
import math
import sys
import os
import pandas as pd
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from financials import safe_val, pct_change, fmt_millions, get_row, get_quarters
from screener import _fmt_mc


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def simple_stmt():
    """A minimal DataFrame resembling a yfinance financial statement."""
    cols = pd.to_datetime(["2024-03-31", "2023-12-31", "2023-09-30", "2023-06-30"])
    return pd.DataFrame(
        {
            cols[0]: [100_000_000, 40_000_000, float("nan")],
            cols[1]: [90_000_000,  35_000_000, float("nan")],
            cols[2]: [80_000_000,  30_000_000, None],
            cols[3]: [70_000_000,  25_000_000, None],
        },
        index=["Total Revenue", "Gross Profit", "Empty Row"],
    )


# ── safe_val ───────────────────────────────────────────────────────────────────

class TestSafeVal:
    def test_returns_int_for_valid_cell(self, simple_stmt):
        col = simple_stmt.columns[0]
        assert safe_val(simple_stmt, "Total Revenue", col) == 100_000_000

    def test_returns_none_when_row_name_is_none(self, simple_stmt):
        col = simple_stmt.columns[0]
        assert safe_val(simple_stmt, None, col) is None

    def test_returns_none_for_nan(self, simple_stmt):
        col = simple_stmt.columns[0]
        assert safe_val(simple_stmt, "Empty Row", col) is None

    def test_returns_none_for_missing_row(self, simple_stmt):
        col = simple_stmt.columns[0]
        assert safe_val(simple_stmt, "Nonexistent Row", col) is None

    def test_returns_none_for_missing_col(self, simple_stmt):
        fake_col = pd.Timestamp("2000-01-01")
        assert safe_val(simple_stmt, "Total Revenue", fake_col) is None

    def test_truncates_float_to_int(self, simple_stmt):
        col = simple_stmt.columns[0]
        result = safe_val(simple_stmt, "Total Revenue", col)
        assert isinstance(result, int)


# ── pct_change ─────────────────────────────────────────────────────────────────

class TestPctChange:
    def test_basic_positive_growth(self):
        assert pct_change(110, 100) == 10.0

    def test_basic_negative_growth(self):
        assert pct_change(90, 100) == -10.0

    def test_uses_abs_for_negative_prev(self):
        # Going from -100 to -90 is 10% improvement
        assert pct_change(-90, -100) == pytest.approx(10.0, rel=1e-3)

    def test_returns_none_when_curr_is_none(self):
        assert pct_change(None, 100) is None

    def test_returns_none_when_prev_is_none(self):
        assert pct_change(100, None) is None

    def test_returns_none_when_prev_is_zero(self):
        assert pct_change(100, 0) is None

    def test_rounds_to_one_decimal(self):
        result = pct_change(103, 100)
        assert result == 3.0
        assert isinstance(result, float)

    def test_large_growth(self):
        assert pct_change(200, 100) == 100.0


# ── fmt_millions ───────────────────────────────────────────────────────────────

class TestFmtMillions:
    def test_returns_none_for_none(self):
        assert fmt_millions(None) is None

    def test_one_million(self):
        assert fmt_millions(1_000_000) == 1.0

    def test_fractional(self):
        assert fmt_millions(1_500_000) == pytest.approx(1.5)

    def test_zero(self):
        assert fmt_millions(0) == 0.0

    def test_large_value(self):
        assert fmt_millions(10_000_000_000) == pytest.approx(10_000.0)


# ── get_row ────────────────────────────────────────────────────────────────────

class TestGetRow:
    def test_finds_first_alias(self, simple_stmt):
        result = get_row(simple_stmt, ["Total Revenue", "Revenue"])
        assert result == "Total Revenue"

    def test_falls_through_to_second_alias(self, simple_stmt):
        result = get_row(simple_stmt, ["Revenue", "Total Revenue"])
        assert result == "Total Revenue"

    def test_returns_none_when_no_alias_matches(self, simple_stmt):
        result = get_row(simple_stmt, ["EBITDA", "Operating Income"])
        assert result is None

    def test_empty_aliases(self, simple_stmt):
        assert get_row(simple_stmt, []) is None


# ── get_quarters ───────────────────────────────────────────────────────────────

class TestGetQuarters:
    def test_returns_first_four_columns(self, simple_stmt):
        result = get_quarters(simple_stmt)
        assert len(result) == 4
        assert list(result) == list(simple_stmt.columns[:4])

    def test_fewer_than_four_columns(self):
        cols = pd.to_datetime(["2024-03-31", "2023-12-31"])
        stmt = pd.DataFrame({cols[0]: [1], cols[1]: [2]}, index=["Revenue"])
        result = get_quarters(stmt)
        assert len(result) == 2


# ── _fmt_mc ────────────────────────────────────────────────────────────────────

class TestFmtMc:
    def test_returns_none_for_none(self):
        assert _fmt_mc(None) is None

    def test_returns_none_for_zero(self):
        assert _fmt_mc(0) is None

    def test_trillions(self):
        assert _fmt_mc(3_000_000_000_000) == "$3.00T"

    def test_billions(self):
        assert _fmt_mc(2_500_000_000) == "$2.50B"

    def test_millions(self):
        assert _fmt_mc(500_000_000) == "$500.00M"

    def test_small_value(self):
        result = _fmt_mc(999_999)
        assert result == "$999,999"

    def test_boundary_trillion(self):
        assert _fmt_mc(1_000_000_000_000) == "$1.00T"

    def test_boundary_billion(self):
        assert _fmt_mc(1_000_000_000) == "$1.00B"

    def test_boundary_million(self):
        assert _fmt_mc(1_000_000) == "$1.00M"
