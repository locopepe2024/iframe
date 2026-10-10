"""Optional live PostgreSQL contract check."""

import os

import pytest

from scripts.verify_knowledge_postgres import verify


REQUIRED_ENV = (
    "IFRAME_KNOWLEDGE_PG_HOST",
    "IFRAME_KNOWLEDGE_PG_USER",
    "IFRAME_KNOWLEDGE_PG_PASSWORD_FILE",
    "IFRAME_KNOWLEDGE_PG_CA_FILE",
)


@pytest.mark.skipif(
    any(not os.getenv(name) for name in REQUIRED_ENV),
    reason="Live knowledge PostgreSQL is not configured",
)
def test_migration_and_public_plus_owner_visibility():
    verify()
