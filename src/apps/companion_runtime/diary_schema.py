"""Additive schema for confirmed diaries."""
DIARY_SCHEMA = """
CREATE TABLE IF NOT EXISTS companion_diaries (
 owner TEXT NOT NULL, actor TEXT NOT NULL, day TEXT NOT NULL,
 text TEXT NOT NULL, source_turn_id TEXT NOT NULL, revision INTEGER NOT NULL,
 updated_at REAL NOT NULL, PRIMARY KEY(owner,actor,day)
);
CREATE TABLE IF NOT EXISTS companion_diary_receipts (
 owner TEXT NOT NULL, actor TEXT NOT NULL, operation_id TEXT NOT NULL,
 payload TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner,actor,operation_id)
);
"""

