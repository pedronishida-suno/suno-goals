"""
Snowflake Sidecar — FastAPI
Provides two endpoints:
  POST /sync-indicators  → pulls data from Snowflake and returns rows for Supabase upsert
  POST /query            → executes an arbitrary parameterized SQL (used by AI terminal)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import snowflake.connector
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Suno Snowflake Sidecar", version="1.0.0")
security = HTTPBearer()

# ─── Auth ────────────────────────────────────────────────────────────────────

SIDECAR_SECRET = os.getenv("SIDECAR_SECRET", "change-me-in-production")


def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != SIDECAR_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid sidecar secret",
        )
    return credentials


# ─── Snowflake Connection ─────────────────────────────────────────────────────


def get_snowflake_connection():
    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA", "PUBLIC"),
        role=os.getenv("SNOWFLAKE_ROLE"),
    )


# ─── Mapping ─────────────────────────────────────────────────────────────────

MAPPING_FILE = Path(__file__).parent / "mapping.json"


def load_mappings() -> list[dict]:
    with open(MAPPING_FILE) as f:
        data = json.load(f)
    return [m for m in data.get("mappings", []) if not m.get("_example")]


# ─── Models ──────────────────────────────────────────────────────────────────


class SyncRequest(BaseModel):
    sector: Optional[str] = None   # filter by sector (e.g. "Tecnologia"); None = all
    year: int
    month: int                      # 1–12


class SyncRow(BaseModel):
    indicator_id: str
    year: int
    month: int
    real: float
    meta: Optional[float] = None


class SyncResponse(BaseModel):
    rows: list[SyncRow]
    mapping_count: int
    queried_count: int
    errors: list[str]


class QueryRequest(BaseModel):
    sql: str
    params: Optional[list[Any]] = None
    max_rows: int = 500


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    row_count: int


# ─── Endpoints ───────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sync-indicators", response_model=SyncResponse)
def sync_indicators(
    req: SyncRequest,
    _creds: HTTPAuthorizationCredentials = Security(security),
):
    """
    For each mapping entry (optionally filtered by sector), queries Snowflake
    and returns a list of SyncRow objects ready for Supabase upsert.
    """
    verify_token(_creds)
    mappings = load_mappings()

    if req.sector:
        mappings = [m for m in mappings if m.get("sector") == req.sector]

    rows: list[SyncRow] = []
    errors: list[str] = []
    queried = 0

    try:
        conn = get_snowflake_connection()
        cur = conn.cursor()

        for mapping in mappings:
            try:
                table = mapping["snowflake_table"]
                column = mapping["snowflake_column"]
                indicator_id = mapping["indicator_id"]
                aggregation = mapping.get("aggregation", "sum").upper()

                sql = f"""
                    SELECT {aggregation}({column}) AS value
                    FROM {table}
                    WHERE YEAR(date_column) = %s
                      AND MONTH(date_column) = %s
                """
                # Note: 'date_column' is a placeholder — each mapping can override
                # with a 'date_column' key when the Snowflake table has a different name
                date_col = mapping.get("date_column", "date")
                sql = sql.replace("date_column", date_col)

                cur.execute(sql, (req.year, req.month))
                result = cur.fetchone()
                value = float(result[0]) if result and result[0] is not None else 0.0

                rows.append(
                    SyncRow(
                        indicator_id=indicator_id,
                        year=req.year,
                        month=req.month,
                        real=value,
                    )
                )
                queried += 1

            except Exception as e:
                errors.append(f"[{mapping.get('description', mapping.get('indicator_id'))}] {str(e)}")

        cur.close()
        conn.close()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Snowflake connection failed: {str(e)}")

    return SyncResponse(
        rows=rows,
        mapping_count=len(mappings),
        queried_count=queried,
        errors=errors,
    )


@app.post("/query", response_model=QueryResponse)
def run_query(
    req: QueryRequest,
    _creds: HTTPAuthorizationCredentials = Security(security),
):
    """
    Executes a read-only SQL query on Snowflake.
    Used by the Phase 4 AI Terminal agent for live data retrieval.
    Rejects any DDL or DML statements for safety.
    """
    verify_token(_creds)

    # Safety: only allow SELECT statements
    sql_stripped = req.sql.strip().upper()
    if not sql_stripped.startswith("SELECT") and not sql_stripped.startswith("WITH"):
        raise HTTPException(
            status_code=400,
            detail="Only SELECT / WITH queries are allowed",
        )

    # Reject dangerous keywords
    blocked = ["INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER", "CREATE", "GRANT"]
    for keyword in blocked:
        if f" {keyword} " in f" {sql_stripped} ":
            raise HTTPException(
                status_code=400,
                detail=f"Keyword {keyword} is not allowed in read-only queries",
            )

    try:
        conn = get_snowflake_connection()
        cur = conn.cursor()

        if req.params:
            cur.execute(req.sql, req.params)
        else:
            cur.execute(req.sql)

        columns = [desc[0] for desc in cur.description] if cur.description else []
        raw_rows = cur.fetchmany(req.max_rows)
        rows = [[str(v) if v is not None else None for v in row] for row in raw_rows]

        cur.close()
        conn.close()

        return QueryResponse(columns=columns, rows=rows, row_count=len(rows))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8001)))
