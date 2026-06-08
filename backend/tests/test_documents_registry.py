"""Tests for the generated-document registry (unique IDs + admin lookup)."""
import re

from app.services.documents import (
    DOC_TYPE_AUFNAHME,
    DOC_TYPE_KUENDIGUNG,
    generate_document_id,
    record_document,
)

ID_PATTERN = re.compile(r"^DOK-\d{4}-[ACDEFGHJKLMNPQRSTUVWXYZ2345679]{6}$")


def test_generate_document_id_format_and_uniqueness(db_session):
    ids = {generate_document_id(db_session) for _ in range(50)}
    assert len(ids) == 50
    for value in ids:
        assert ID_PATTERN.match(value), value


def test_record_and_list_documents(client, db_session, admin_cookie):
    doc_id = generate_document_id(db_session)
    record_document(
        db_session,
        document_id=doc_id,
        doc_type=DOC_TYPE_AUFNAHME,
        storage_filename="ANT-1_approved.pdf",
        application_id=1,
        recipient_name="Anna Müller",
    )
    cancel_id = generate_document_id(db_session)
    record_document(
        db_session,
        document_id=cancel_id,
        doc_type=DOC_TYPE_KUENDIGUNG,
        storage_filename="kuendigung_x.pdf",
        cancellation_letter_id=7,
        recipient_name="Müller, Anna",
    )
    db_session.commit()

    resp = client.get("/api/admin/documents", cookies=admin_cookie)
    assert resp.status_code == 200
    rows = resp.json()
    by_id = {r["document_id"]: r for r in rows}
    assert doc_id in by_id and cancel_id in by_id
    assert by_id[doc_id]["doc_type_label"] == "Aufnahmebestätigung"
    assert by_id[doc_id]["application_id"] == 1
    assert by_id[cancel_id]["doc_type_label"] == "Austrittsbestätigung"
    assert by_id[cancel_id]["cancellation_letter_id"] == 7


def test_lookup_document_by_id(client, db_session, admin_cookie):
    doc_id = generate_document_id(db_session)
    record_document(
        db_session,
        document_id=doc_id,
        doc_type=DOC_TYPE_AUFNAHME,
        storage_filename="ANT-2_approved.pdf",
        application_id=2,
        recipient_name="Max Mustermann",
    )
    db_session.commit()

    ok = client.get(f"/api/admin/documents/{doc_id}", cookies=admin_cookie)
    assert ok.status_code == 200
    assert ok.json()["recipient_name"] == "Max Mustermann"

    missing = client.get("/api/admin/documents/DOK-2026-ZZZZZZ", cookies=admin_cookie)
    assert missing.status_code == 404


def test_documents_endpoint_requires_admin(client):
    assert client.get("/api/admin/documents").status_code == 401
