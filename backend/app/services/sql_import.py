"""
Parser for MySQL dumps produced by Linear Webverein.

The dump format is the standard ``mysqldump`` output:

    CREATE TABLE `name` (
      `col1` int NOT NULL,
      `col2` varchar(80) DEFAULT NULL,
      ...
      PRIMARY KEY (`col1`)
    ) ENGINE=...;

    INSERT INTO `name` VALUES (1,'foo',NULL,...),(2,'bar',NULL,...);

Single-line ``INSERT INTO ... VALUES (...),(...);`` statements can be very
large (several megabytes per line), so the value tokenizer is kept linear
and avoids any regex backtracking.

This module is intentionally limited to the small set of tables we care
about (members, contracts, fee types, SEPA mandates). Anything else is
skipped without raising.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Iterator

logger = logging.getLogger(__name__)


# Tables we extract from the dump. Anything not in this set is silently
# skipped — clubs may dump dozens of irrelevant lookup tables we don't need.
SUPPORTED_TABLES = {"adresse", "mgart", "mgvert", "adrsepa"}


# ---- Value tokenizer -------------------------------------------------------

# MySQL string escape sequences inside single-quoted literals
_ESCAPES = {
    "n": "\n",
    "t": "\t",
    "r": "\r",
    "0": "\x00",
    "b": "\b",
    "Z": "\x1a",
    "\\": "\\",
    "'": "'",
    '"': '"',
}


def _parse_string(text: str, pos: int) -> tuple[str, int]:
    """Parse a single-quoted MySQL string starting at ``text[pos]``.

    Returns the unescaped value and the index just after the closing quote.
    Handles both ``''`` and ``\\'`` escapes for the quote character.
    """
    assert text[pos] == "'"
    out: list[str] = []
    i = pos + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            esc = text[i + 1]
            out.append(_ESCAPES.get(esc, esc))
            i += 2
            continue
        if ch == "'":
            # Doubled quote inside a string literal -> single quote
            if i + 1 < n and text[i + 1] == "'":
                out.append("'")
                i += 2
                continue
            return "".join(out), i + 1
        out.append(ch)
        i += 1
    raise ValueError("Unterminated string literal in SQL dump")


def _parse_values(payload: str) -> Iterator[list]:
    """Iterate over ``(v1, v2, ...)`` tuples in an ``INSERT ... VALUES`` payload.

    ``payload`` is the part after ``VALUES`` up to (but not including) the
    closing ``;``. The function yields one Python list per tuple, with
    elements typed as ``None``, ``str``, ``int``, ``float``, or ``bool``.
    """
    n = len(payload)
    i = 0
    while i < n:
        ch = payload[i]
        if ch.isspace() or ch == ",":
            i += 1
            continue
        if ch != "(":
            # End of tuples (e.g. trailing semicolon already stripped).
            break
        i += 1  # consume '('
        row: list = []
        # Read values until matching ')'
        while True:
            # Skip whitespace
            while i < n and payload[i].isspace():
                i += 1
            if i >= n:
                raise ValueError("Unterminated tuple in SQL dump")
            ch = payload[i]
            if ch == ")":
                i += 1
                break
            if ch == ",":
                i += 1
                continue
            if ch == "'":
                value, i = _parse_string(payload, i)
                row.append(value)
                continue
            # NULL literal
            if ch in ("N", "n") and payload[i:i + 4].upper() == "NULL":
                row.append(None)
                i += 4
                continue
            # _binary 'x' literal (used for bit() columns: _binary '\0', _binary '\x01')
            if ch == "_" and payload[i:i + 8].lower() == "_binary ":
                j = i + 8
                while j < n and payload[j].isspace():
                    j += 1
                if j < n and payload[j] == "'":
                    raw, j = _parse_string(payload, j)
                    # Treat 0x00 as False, anything else as True
                    row.append(bool(raw) and raw != "\x00")
                    i = j
                    continue
                # Could not parse; fall through to error
            # b'...' bit literal (alternative form)
            if ch == "b" and i + 1 < n and payload[i + 1] == "'":
                raw, j = _parse_string(payload, i + 1)
                row.append(any(c != "0" for c in raw))
                i = j
                continue
            # Numeric / boolean keyword
            j = i
            while j < n and payload[j] not in (",", ")"):
                j += 1
            token = payload[i:j].strip()
            i = j
            if not token:
                row.append(None)
                continue
            upper = token.upper()
            if upper == "TRUE":
                row.append(True)
                continue
            if upper == "FALSE":
                row.append(False)
                continue
            try:
                if "." in token or "e" in token or "E" in token:
                    row.append(float(token))
                else:
                    row.append(int(token))
            except ValueError:
                # Unknown literal — store raw text
                row.append(token)
        yield row


# ---- CREATE TABLE column extraction ---------------------------------------

def _extract_columns(create_sql: str) -> list[str]:
    """Pull the ordered column names out of a ``CREATE TABLE`` body.

    Splits the body at top-level commas (depth-0 parens) and treats each
    fragment as one definition. A fragment whose first token is a backticked
    identifier is a column; anything else (``PRIMARY KEY``, ``KEY``,
    ``CONSTRAINT``, ...) terminates column collection.
    """
    cols: list[str] = []
    start = create_sql.find("(")
    if start == -1:
        return cols
    body = create_sql[start + 1:]
    fragments: list[str] = []
    depth = 0
    buf: list[str] = []
    in_str = False
    in_backtick = False
    for ch in body:
        if not in_str and not in_backtick:
            if ch == "(":
                depth += 1
                buf.append(ch)
                continue
            if ch == ")":
                if depth == 0:
                    fragments.append("".join(buf))
                    buf = []
                    break
                depth -= 1
                buf.append(ch)
                continue
            if ch == "," and depth == 0:
                fragments.append("".join(buf))
                buf = []
                continue
            if ch == "`":
                in_backtick = True
                buf.append(ch)
                continue
            if ch == "'":
                in_str = True
                buf.append(ch)
                continue
            buf.append(ch)
            continue
        if in_backtick:
            buf.append(ch)
            if ch == "`":
                in_backtick = False
            continue
        # in single-quoted string
        buf.append(ch)
        if ch == "'":
            in_str = False
    if buf and not fragments:
        fragments.append("".join(buf))

    for fragment in fragments:
        f = fragment.strip()
        if not f:
            continue
        upper = f.upper()
        if (
            upper.startswith("PRIMARY KEY")
            or upper.startswith("KEY ")
            or upper.startswith("UNIQUE KEY")
            or upper.startswith("CONSTRAINT")
            or upper.startswith("FULLTEXT")
            or upper.startswith("INDEX")
        ):
            break
        if f.startswith("`"):
            end = f.find("`", 1)
            if end > 1:
                cols.append(f[1:end])
    return cols


# ---- Streaming parser ------------------------------------------------------

@dataclass
class ParsedDump:
    """Tables of interest extracted from a MySQL dump."""

    columns: dict[str, list[str]] = field(default_factory=dict)
    rows: dict[str, list[list]] = field(default_factory=dict)
    skipped_tables: set[str] = field(default_factory=set)

    def add_columns(self, table: str, cols: list[str]) -> None:
        self.columns[table] = cols
        self.rows.setdefault(table, [])

    def add_rows(self, table: str, rows: list[list]) -> None:
        self.rows.setdefault(table, []).extend(rows)


def parse_dump(text: str, supported: set[str] = SUPPORTED_TABLES) -> ParsedDump:
    """Parse a full MySQL dump and return tables in ``supported``.

    The parser tolerates DDL/comments/lock statements; only ``CREATE TABLE``
    headers (for column order) and ``INSERT INTO`` payloads for supported
    tables produce output.
    """
    result = ParsedDump()
    lines = text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.lstrip()

        # CREATE TABLE — collect lines until the statement-terminating ';'.
        if stripped.startswith("CREATE TABLE"):
            table = _parse_table_name(stripped)
            buf = [stripped]
            while not _ends_statement(buf[-1]):
                i += 1
                if i >= n:
                    break
                buf.append(lines[i])
            i += 1
            if table in supported:
                cols = _extract_columns("\n".join(buf))
                if cols:
                    result.add_columns(table, cols)
            continue

        # INSERT INTO — payload typically lives on a single (very long) line
        # in mysqldump output, but other tools may wrap. Accumulate lines
        # until we see a terminating ';' that isn't inside a string literal.
        if stripped.startswith("INSERT INTO"):
            table = _parse_table_name(stripped)
            if table not in supported:
                # Still need to consume until end of statement
                while i < n and not _ends_statement(lines[i]):
                    i += 1
                i += 1  # skip the terminating line
                continue
            buf = [stripped]
            i += 1
            while not _ends_statement(buf[-1]):
                if i >= n:
                    break
                buf.append(lines[i])
                i += 1
            joined = "\n".join(buf).strip()
            try:
                values_idx = joined.upper().index(" VALUES")
            except ValueError:
                continue
            payload = joined[values_idx + len(" VALUES"):].rstrip()
            if payload.endswith(";"):
                payload = payload[:-1]
            try:
                rows = list(_parse_values(payload))
            except ValueError as exc:
                logger.warning("Skipping malformed INSERT for %s: %s", table, exc)
                rows = []
            if rows:
                result.add_rows(table, rows)
            continue

        i += 1

    # Track tables that appeared but were skipped
    return result


def _ends_statement(line: str) -> bool:
    """Cheap heuristic: line ends an SQL statement when it terminates in ';'.

    Good enough for mysqldump output because statement-terminating ';' are
    never followed by content on the same line, and string literals never
    contain raw newlines (mysqldump escapes them as ``\\n``).
    """
    return line.rstrip().endswith(";")


def _parse_table_name(stmt: str) -> str:
    start = stmt.find("`")
    if start == -1:
        return ""
    end = stmt.find("`", start + 1)
    if end == -1:
        return ""
    return stmt[start + 1:end]


# ---- Value coercion helpers -----------------------------------------------

def coerce_date(value) -> date | None:
    """Best-effort ``date`` from a MySQL datetime literal or already-date value."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        s = value.strip()
        if not s or s.startswith("0000"):
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def coerce_str(value, max_len: int | None = None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if max_len is not None and len(s) > max_len:
        s = s[:max_len]
    return s


def coerce_bool(value) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ("", "n", "false", "0"):
            return False
        if v in ("y", "j", "true", "1"):
            return True
    return None


def coerce_decimal(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        s = value.strip().replace(",", ".")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def coerce_int(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            try:
                return int(float(s))
            except ValueError:
                return None
    return None


def row_to_dict(columns: list[str], row: list) -> dict:
    """Zip a row to its column dict, tolerating short rows."""
    return {col: row[idx] if idx < len(row) else None for idx, col in enumerate(columns)}
