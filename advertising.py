"""First-party sponsor campaigns. No ad-network SDK and no playback access."""
from __future__ import annotations

import re
import sqlite3
from typing import Literal
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CampaignInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sponsor: str = Field(min_length=2, max_length=80)
    headline: str = Field(min_length=2, max_length=100)
    body: str = Field(min_length=2, max_length=320)
    cta: str = Field(default="Zobrazit nabídku", min_length=2, max_length=32)
    target_url: str = Field(min_length=8, max_length=500)
    starts_at: int = Field(ge=0, le=4102444800)
    ends_at: int = Field(gt=0, le=4102444800)

    @field_validator("sponsor", "headline", "body", "cta")
    @classmethod
    def plain_text(cls, value):
        value = " ".join(value.split())
        if len(value) < 2 or "<" in value or ">" in value:
            raise ValueError("Vyplň prostý text bez HTML.")
        return value

    @field_validator("target_url")
    @classmethod
    def https_url(cls, value):
        # Never accept scripts, credentials, backslashes or ambiguous browser URLs.
        if re.search(r"[\s\\\x00-\x1f\x7f]", value):
            raise ValueError("Odkaz musí být platná HTTPS adresa.")
        try:
            parsed = urlsplit(value)
            host = parsed.hostname or ""
            port = parsed.port
        except ValueError as exc:
            raise ValueError("Neplatný odkaz.") from exc
        if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
                or not re.fullmatch(r"[A-Za-z0-9.-]+", host)
                or "." not in host or port not in (None, 443)):
            raise ValueError("Použij veřejnou HTTPS adresu bez přihlašovacích údajů.")
        return value

    @model_validator(mode="after")
    def dates(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("Konec kampaně musí být později než začátek.")
        return self


class AdEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=10, max_length=600)
    kind: Literal["impression", "click"]


def init_schema(conn: sqlite3.Connection):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ad_campaigns(
            id TEXT PRIMARY KEY,
            venue_key TEXT NOT NULL,
            sponsor TEXT NOT NULL,
            headline TEXT NOT NULL,
            body TEXT NOT NULL,
            cta TEXT NOT NULL,
            target_url TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            active INTEGER NOT NULL DEFAULT 0,
            impressions INTEGER NOT NULL DEFAULT 0,
            clicks INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ad_one_active_per_venue
            ON ad_campaigns(venue_key) WHERE active=1;
        CREATE TABLE IF NOT EXISTS ad_receipts(
            campaign_id TEXT NOT NULL REFERENCES ad_campaigns(id),
            nonce TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('impression','click')),
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(campaign_id,nonce,kind)
        );
        CREATE INDEX IF NOT EXISTS ad_receipts_expiry ON ad_receipts(expires_at);
    """)


def local_action(connection, venue_key: str, action: str, payload: dict):
    stamp = payload["stamp"]
    with connection() as conn:
        if action == "list":
            return [dict(row) for row in conn.execute(
                "SELECT * FROM ad_campaigns WHERE venue_key=? ORDER BY created_at DESC,id DESC LIMIT 50",
                (venue_key,),
            )]
        if action == "current":
            row = conn.execute(
                "SELECT * FROM ad_campaigns WHERE venue_key=? AND active=1 AND starts_at<=? AND ends_at>?",
                (venue_key, stamp, stamp),
            ).fetchone()
            return dict(row) if row else None
        conn.execute("BEGIN IMMEDIATE")
        if action == "create":
            campaign = payload["campaign"]
            columns = ("sponsor", "headline", "body", "cta", "target_url", "starts_at", "ends_at")
            conn.execute(
                "INSERT INTO ad_campaigns(id,venue_key,sponsor,headline,body,cta,target_url,starts_at,ends_at,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (payload["id"], venue_key, *(campaign[key] for key in columns), stamp),
            )
            return {"ok": True, "id": payload["id"]}
        row = conn.execute("SELECT * FROM ad_campaigns WHERE id=? AND venue_key=?", (payload["id"], venue_key)).fetchone()
        if not row:
            raise HTTPException(404, "Kampaň nebyla nalezena.")
        if action == "activate":
            if row["ends_at"] <= stamp:
                raise HTTPException(409, "Tahle kampaň už skončila.")
            conn.execute("UPDATE ad_campaigns SET active=0 WHERE venue_key=?", (venue_key,))
            conn.execute("UPDATE ad_campaigns SET active=1 WHERE id=?", (row["id"],))
        elif action == "pause":
            conn.execute("UPDATE ad_campaigns SET active=0 WHERE id=?", (row["id"],))
        elif action == "event":
            if not row["active"] or not row["starts_at"] <= stamp < row["ends_at"] or payload["expires_at"] <= stamp:
                return {"ok": True, "counted": False}
            conn.execute("DELETE FROM ad_receipts WHERE expires_at<=?", (stamp,))
            counted = False
            # A click also proves exposure, even when it happens before the view timer.
            for kind in (["impression", "click"] if payload["kind"] == "click" else ["impression"]):
                changed = conn.execute(
                    "INSERT OR IGNORE INTO ad_receipts(campaign_id,nonce,kind,expires_at) VALUES(?,?,?,?)",
                    (row["id"], payload["nonce"], kind, payload["expires_at"]),
                ).rowcount
                if changed:
                    column = "clicks" if kind == "click" else "impressions"
                    conn.execute(f"UPDATE ad_campaigns SET {column}={column}+1 WHERE id=?", (row["id"],))
                    counted = True
            return {"ok": True, "counted": counted}
        else:
            raise HTTPException(400, "Neznámá reklamní operace.")
        return {"ok": True}
