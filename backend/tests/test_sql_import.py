"""
Tests for the Linear Webverein SQL dump parser and importer.
"""

from datetime import date

from app.models.imported import LwContract, LwFeeType, LwMember, LwSepaMandate
from app.services.crypto import decrypt_iban
from app.services.imported_writer import write_dump
from app.services.sql_import import (
    _parse_string,
    _parse_values,
    coerce_bool,
    coerce_date,
    parse_dump,
)


def test_parse_string_basic():
    value, end = _parse_string("'hello'", 0)
    assert value == "hello"
    assert end == 7


def test_parse_string_doubled_quote():
    # MySQL dumps '' as escaped quote inside a string
    value, _ = _parse_string("'O''Brien'", 0)
    assert value == "O'Brien"


def test_parse_string_backslash_escape():
    value, _ = _parse_string("'line1\\nline2'", 0)
    assert value == "line1\nline2"


def test_parse_values_mixed_types():
    payload = "(1,'foo',NULL,3.14,_binary '\\0'),(2,'bar',NULL,0,_binary '\\x01')"
    rows = list(_parse_values(payload))
    assert len(rows) == 2
    assert rows[0][:4] == [1, "foo", None, 3.14]
    assert rows[0][4] is False  # _binary '\0' -> False
    assert rows[1][4] is True   # any non-zero byte -> True


def test_parse_values_string_with_comma_and_paren():
    payload = "(1,'foo, bar (baz)',NULL)"
    rows = list(_parse_values(payload))
    assert rows == [[1, "foo, bar (baz)", None]]


def test_parse_dump_minimal():
    sql = """
-- header
DROP TABLE IF EXISTS `adresse`;
CREATE TABLE `adresse` (
  `AdrNr` int NOT NULL,
  `Vorname` varchar(30) DEFAULT NULL,
  `Nachname` varchar(40) DEFAULT NULL,
  `Geburtsdatum` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`AdrNr`)
) ENGINE=InnoDB;
INSERT INTO `adresse` VALUES (5,'Nadine','Bähr','1982-03-28 00:00:00.000000'),(6,'Jürgen','Bähr',NULL);
"""
    dump = parse_dump(sql)
    assert dump.columns["adresse"] == ["AdrNr", "Vorname", "Nachname", "Geburtsdatum"]
    assert len(dump.rows["adresse"]) == 2
    assert dump.rows["adresse"][0] == [5, "Nadine", "Bähr", "1982-03-28 00:00:00.000000"]
    assert dump.rows["adresse"][1][3] is None


def test_parse_dump_ignores_unknown_tables():
    sql = """
CREATE TABLE `something_else` (`X` int NOT NULL, PRIMARY KEY (`X`));
INSERT INTO `something_else` VALUES (1),(2),(3);
"""
    dump = parse_dump(sql)
    assert "something_else" not in dump.rows


def test_coerce_date():
    assert coerce_date("1982-03-28 00:00:00.000000") == date(1982, 3, 28)
    assert coerce_date("1982-03-28") == date(1982, 3, 28)
    assert coerce_date("0000-00-00 00:00:00") is None
    assert coerce_date(None) is None


def test_coerce_bool():
    assert coerce_bool("N") is False
    assert coerce_bool("Y") is True
    assert coerce_bool(0) is False
    assert coerce_bool(1) is True
    assert coerce_bool(True) is True
    assert coerce_bool(None) is None


def test_write_dump_inserts_members_with_encrypted_iban(db_session):
    sql = """
CREATE TABLE `adresse` (
  `AdrNr` int NOT NULL,
  `Vorname` varchar(30) DEFAULT NULL,
  `Nachname` varchar(40) DEFAULT NULL,
  `IBAN1` varchar(40) DEFAULT NULL,
  `BIC1` varchar(40) DEFAULT NULL,
  `Geburtsdatum` datetime(6) DEFAULT NULL,
  `Eintritt` datetime(6) DEFAULT NULL,
  `Geloscht` bit(1) DEFAULT b'0',
  PRIMARY KEY (`AdrNr`)
);
INSERT INTO `adresse` VALUES
  (5,'Nadine','Bähr','DE02120300000000202051','BYLADEM1001','1982-03-28 00:00:00.000000','2014-01-01 00:00:00.000000',_binary '\\0'),
  (6,'Jürgen','Bähr',NULL,NULL,NULL,NULL,_binary '\\x01');
"""
    dump = parse_dump(sql)
    batch, summary = write_dump(db_session, dump, filename="test.sql", file_size_bytes=len(sql))

    assert summary.members == 2
    assert batch.id is not None

    members = db_session.query(LwMember).order_by(LwMember.adr_nr).all()
    assert members[0].vorname == "Nadine"
    assert members[0].nachname == "Bähr"
    assert members[0].geburtsdatum == date(1982, 3, 28)
    assert members[0].eintritt == date(2014, 1, 1)
    assert members[0].geloscht is False
    # IBAN must be stored encrypted at rest
    assert members[0].iban.startswith("enc:")
    assert decrypt_iban(members[0].iban) == "DE02120300000000202051"
    assert members[0].bic == "BYLADEM1001"

    assert members[1].iban is None
    assert members[1].geloscht is True


def test_write_dump_links_contracts_and_sepa(db_session):
    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Nachname` varchar(40), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (7,'Hans','Mueller'),(8,'Else','Schmidt');

CREATE TABLE `mgvert` (
  `AdrNr` int NOT NULL,
  `VertragNr` varchar(10) NOT NULL,
  `Art` smallint NOT NULL,
  `ArtName` varchar(120) DEFAULT NULL,
  `Betrag` decimal(19,8) DEFAULT NULL,
  `VertragBegin` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`AdrNr`,`VertragNr`,`Art`)
);
INSERT INTO `mgvert` VALUES
  (7,'11',100,'Erwachsene',54.00000000,'2018-01-01 00:00:00.000000'),
  (7,'12',101,'Familienbeitrag',96.00000000,'2019-01-01 00:00:00.000000'),
  (999,'1',100,'Orphan',0,NULL);

CREATE TABLE `adrsepa` (
  `AdrNr` int NOT NULL,
  `MandatsNr` varchar(35) NOT NULL,
  `MandKey` varchar(35) NOT NULL,
  `Lastschriftart` varchar(20) NOT NULL,
  `Typ` char(1) NOT NULL,
  `Status` varchar(20) NOT NULL,
  `AngelegtAm` datetime(6) DEFAULT NULL,
  `IsDeleted` bit(1) DEFAULT b'0',
  PRIMARY KEY (`AdrNr`,`MandatsNr`)
);
INSERT INTO `adrsepa` VALUES
  (7,'M1','M1k','Basis','W','Aktiv','2014-01-24 00:00:00.000000',_binary '\\0');

CREATE TABLE `mgart` (
  `Art` smallint NOT NULL,
  `Bezeichnung` varchar(120) DEFAULT NULL,
  `Sollstellung` varchar(10) DEFAULT NULL,
  `Fibukonto` int DEFAULT NULL,
  `Betrag1` decimal(18,8) DEFAULT NULL,
  `NichAktiv` char(1) DEFAULT NULL,
  PRIMARY KEY (`Art`)
);
INSERT INTO `mgart` VALUES (100,'Erwachsene','jährlich',40000,54.00000000,'N');
"""
    dump = parse_dump(sql)
    _, summary = write_dump(db_session, dump, filename="test.sql", file_size_bytes=len(sql))

    assert summary.members == 2
    assert summary.fee_types == 1
    # One contract is orphan (no matching AdrNr) so only 2 land in the DB
    assert summary.contracts == 2
    assert summary.sepa == 1

    contracts = db_session.query(LwContract).filter(LwContract.adr_nr == 7).all()
    assert len(contracts) == 2
    assert any(c.art_name == "Erwachsene" for c in contracts)
    assert any(float(c.betrag) == 96.0 for c in contracts)

    sepa = db_session.query(LwSepaMandate).filter(LwSepaMandate.adr_nr == 7).all()
    assert len(sepa) == 1
    assert sepa[0].status == "Aktiv"
    assert sepa[0].is_deleted is False

    fee = db_session.query(LwFeeType).first()
    assert fee.bezeichnung == "Erwachsene"
    assert float(fee.betrag) == 54.0


def test_write_dump_is_idempotent(db_session):
    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Nachname` varchar(40), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A','B'),(2,'C','D');
"""
    dump = parse_dump(sql)
    write_dump(db_session, dump, filename="t.sql", file_size_bytes=len(sql))
    write_dump(db_session, dump, filename="t.sql", file_size_bytes=len(sql))
    assert db_session.query(LwMember).count() == 2


def test_upload_endpoint_round_trip(client, admin_cookie):
    sql = """
CREATE TABLE `adresse` (
  `AdrNr` int NOT NULL,
  `Vorname` varchar(30) DEFAULT NULL,
  `Nachname` varchar(40) DEFAULT NULL,
  `MITGLNR` varchar(15) DEFAULT NULL,
  `IBAN1` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`AdrNr`)
);
INSERT INTO `adresse` VALUES (10,'Test','Person','M-007','DE02120300000000202051');
"""
    files = {"file": ("dump.sql", sql.encode("utf-8"), "application/sql")}
    res = client.post(
        "/api/admin/imports/sql",
        files=files,
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["inserted_members"] == 1

    res = client.get("/api/admin/imports/members", cookies=admin_cookie)
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["items"][0]["nachname"] == "Person"
    assert data["items"][0]["mitgliedsnummer"] == "M-007"

    res = client.get("/api/admin/imports/members/10", cookies=admin_cookie)
    assert res.status_code == 200
    member = res.json()
    # IBAN is decrypted in the detail response
    assert member["iban"] == "DE02120300000000202051"
    assert member["contracts"] == []
    assert member["sepa_mandates"] == []


def test_upload_endpoint_rejects_non_sql(client, admin_cookie):
    files = {"file": ("dump.txt", b"hello", "text/plain")}
    res = client.post(
        "/api/admin/imports/sql",
        files=files,
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 400


def test_upload_endpoint_requires_admin(client):
    files = {"file": ("dump.sql", b"INSERT INTO `adresse` VALUES (1);", "application/sql")}
    res = client.post(
        "/api/admin/imports/sql",
        files=files,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code in (401, 403)


def test_members_geo_only_returns_geocoded(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump
    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Nachname` varchar(40), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A','One','Berlin'),(2,'B','Two','Hamburg'),(3,'C','Three','München');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))

    # Manually mark two as geocoded
    rows = db_session.query(LwMember).all()
    rows[0].lat = 52.52
    rows[0].lng = 13.405
    rows[0].geocode_status = "found"
    rows[1].lat = 53.55
    rows[1].lng = 9.99
    rows[1].geocode_status = "found"
    rows[2].geocode_status = "failed"
    db_session.commit()

    res = client.get("/api/admin/imports/members/geo", cookies=admin_cookie)
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 2
    assert {m["ort"] for m in items} == {"Berlin", "Hamburg"}
    assert all("lat" in m and "lng" in m for m in items)


def test_geocode_status_endpoint(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump
    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Strasse` varchar(200), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A','Mainstr. 1','Hamburg'),(2,'B',NULL,NULL);
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))

    res = client.get("/api/admin/imports/geocode/status", cookies=admin_cookie)
    assert res.status_code == 200
    body = res.json()
    assert body["running"] is False
    assert body["geocoded"] == 0
    assert body["pending"] == 2
    # Only one has any address fields
    assert body["total_with_address"] == 1


def test_geocode_classify_house_when_housenumber_matches():
    from app.services.geocode import _classify

    item = {
        "resultType": "houseNumber",
        "houseNumberType": "PA",
        "address": {"houseNumber": "12", "street": "Hauptstraße"},
    }
    assert _classify(item, "12") == "house"


def test_geocode_classify_street_when_no_housenumber():
    from app.services.geocode import _classify

    item = {
        "resultType": "street",
        "address": {"street": "Hauptstraße"},
    }
    assert _classify(item, "12") == "street"


def test_geocode_classify_city_when_place_village():
    from app.services.geocode import _classify

    item = {
        "resultType": "locality",
        "address": {"city": "Kleindorf"},
    }
    assert _classify(item, None) == "city"


def test_geocode_classify_handles_alphanumeric_housenumber():
    from app.services.geocode import _classify

    # Members commonly have "12a" -- HERE may return "12a" or "12 a"
    # depending on how the address was recorded. We match digits plus
    # an optional suffix, so both round-trip as "house".
    item = {
        "resultType": "houseNumber",
        "houseNumberType": "PA",
        "address": {"houseNumber": "12 a", "street": "Hauptstraße"},
    }
    assert _classify(item, "12a") == "house"


def test_geocode_classify_demotes_interpolated_housenumber():
    from app.services.geocode import _classify

    # HERE returns ``houseNumberType: interpolated`` when it had to
    # estimate the position along a street segment. That's a mid-block
    # guess, not a real building hit, so it must drop to "street".
    item = {
        "resultType": "houseNumber",
        "houseNumberType": "interpolated",
        "address": {"houseNumber": "12", "street": "Hauptstraße"},
    }
    assert _classify(item, "12") == "street"


def test_geocode_classify_demotes_when_suffix_differs():
    from app.services.geocode import _classify

    # "12a" and "12b" are different buildings on the same plot --
    # accepting one for the other would put the pin on a neighbour.
    item = {
        "resultType": "houseNumber",
        "houseNumberType": "PA",
        "address": {"houseNumber": "12b", "street": "Hauptstraße"},
    }
    assert _classify(item, "12a") == "street"


def test_geocode_address_key_groups_household():
    from app.services.geocode import _address_key
    from app.models.imported import LwMember

    # Family at the same address: same key.
    a = LwMember(adr_nr=1, strasse="Hauptstraße", hausnummer="12", plz="12345", ort="Musterstadt")
    b = LwMember(adr_nr=2, strasse="hauptstraße ", hausnummer="12", plz="12345", ort="MUSTERSTADT")
    # Different Hausnummer: different key.
    c = LwMember(adr_nr=3, strasse="Hauptstraße", hausnummer="14", plz="12345", ort="Musterstadt")
    assert _address_key(a) == _address_key(b)
    assert _address_key(a) != _address_key(c)


def test_geocode_classify_demotes_house_with_wrong_number():
    from app.services.geocode import _classify

    # HERE sometimes returns a nearby house when ours doesn't exist
    # in its index. That's misleading on the map, so we demote it to
    # street precision and let the caller swap to the PLZ centroid.
    item = {
        "resultType": "houseNumber",
        "houseNumberType": "PA",
        "address": {"houseNumber": "9", "street": "Hauptstraße"},
    }
    assert _classify(item, "12") == "street"


def test_geocode_reset_for_scope_approximate_clears_only_non_house(db_session):
    from app.services.imported_writer import write_dump
    from app.services.geocode import _reset_for_scope

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'House','Berlin'),(2,'Street','Berlin'),(3,'Legacy','Berlin');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    rows = {m.adr_nr: m for m in db_session.query(LwMember).all()}
    # House-level: must survive an approximate reset
    rows[1].lat = 52.52
    rows[1].lng = 13.4
    rows[1].geocode_status = "found"
    rows[1].geocode_precision = "house"
    # Street-level: should get cleared
    rows[2].lat = 52.53
    rows[2].lng = 13.41
    rows[2].geocode_status = "found"
    rows[2].geocode_precision = "street"
    # Legacy row (no precision recorded): should get cleared too
    rows[3].lat = 52.54
    rows[3].lng = 13.42
    rows[3].geocode_status = "found"
    rows[3].geocode_precision = None
    db_session.commit()

    cleared = _reset_for_scope(db_session, "approximate")
    assert cleared == 2

    db_session.expire_all()
    fresh = {m.adr_nr: m for m in db_session.query(LwMember).all()}
    assert fresh[1].lat is not None and fresh[1].geocode_precision == "house"
    assert fresh[2].lat is None and fresh[2].geocode_precision is None
    assert fresh[3].lat is None and fresh[3].geocode_precision is None


def test_geocode_reset_for_scope_all_clears_everything(db_session):
    from app.services.imported_writer import write_dump
    from app.services.geocode import _reset_for_scope

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'House','Berlin');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    m = db_session.query(LwMember).first()
    m.lat = 52.52
    m.lng = 13.4
    m.geocode_status = "found"
    m.geocode_precision = "house"
    db_session.commit()

    cleared = _reset_for_scope(db_session, "all")
    assert cleared == 1
    db_session.expire_all()
    fresh = db_session.query(LwMember).first()
    assert fresh.lat is None
    assert fresh.geocode_precision is None


def test_geocode_clear_member_helper(db_session):
    from app.services.imported_writer import write_dump
    from app.services.geocode import clear_member_geocode

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'X');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    m = db_session.query(LwMember).first()
    m.lat = 52.5
    m.lng = 13.4
    m.geocode_status = "found"
    m.geocode_precision = "house"
    db_session.commit()

    assert clear_member_geocode(db_session, m.adr_nr) is True
    db_session.expire_all()
    fresh = db_session.query(LwMember).first()
    assert fresh.lat is None
    assert fresh.geocode_status is None
    assert fresh.geocode_precision is None

    # Unknown adr_nr returns False rather than raising
    assert clear_member_geocode(db_session, 9999) is False


def test_geocode_clear_endpoint_all_scope(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A'),(2,'B');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    rows = db_session.query(LwMember).order_by(LwMember.adr_nr).all()
    for r in rows:
        r.lat = 52.0
        r.lng = 13.0
        r.geocode_status = "found"
        r.geocode_precision = "house"
    db_session.commit()

    res = client.post(
        "/api/admin/imports/geocode/clear?scope=all",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200
    db_session.expire_all()
    for r in db_session.query(LwMember).all():
        assert r.lat is None
        assert r.geocode_precision is None


def test_geocode_clear_member_endpoint(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    m = db_session.query(LwMember).first()
    m.lat = 52.0
    m.lng = 13.0
    m.geocode_status = "found"
    m.geocode_precision = "house"
    db_session.commit()

    res = client.delete(
        f"/api/admin/imports/members/{m.adr_nr}/geocode",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200
    db_session.expire_all()
    fresh = db_session.query(LwMember).first()
    assert fresh.lat is None
    assert fresh.geocode_precision is None

    # Second call: row already cleared, but member exists -> 200
    res = client.delete(
        f"/api/admin/imports/members/{m.adr_nr}/geocode",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200

    # Unknown adr_nr -> 404
    res = client.delete(
        "/api/admin/imports/members/9999/geocode",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 404


def test_geocode_status_excludes_no_address_from_pending(client, admin_cookie, db_session):
    """Members with no address fields used to be stuck in the pending counter
    because the geocoder kept re-marking them as ``no_address`` without
    coords. They should now drop out of the counter and out of the worker
    queue."""
    from app.services.imported_writer import write_dump

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Strasse` varchar(200), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'WithAddr','Mainstr. 1','Hamburg'),(2,'NoAddr',NULL,NULL);
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))

    # Simulate what the worker writes for a "no address" row.
    no_addr = db_session.query(LwMember).filter(LwMember.adr_nr == 2).first()
    no_addr.geocode_status = "no_address"
    no_addr.geocode_precision = "none"
    no_addr.geocode_notes = "Keine Adressfelder vorhanden."
    db_session.commit()

    res = client.get("/api/admin/imports/geocode/status", cookies=admin_cookie)
    body = res.json()
    # Only the row with a real address remains pending.
    assert body["pending"] == 1


def test_geocode_ignore_excludes_from_counters(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Strasse` varchar(200), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'Pending','Foostr. 1','Berlin'),(2,'Approx','Barstr. 2','Berlin');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))

    approx = db_session.query(LwMember).filter(LwMember.adr_nr == 2).first()
    approx.lat = 52.5
    approx.lng = 13.4
    approx.geocode_status = "found"
    approx.geocode_precision = "street"
    db_session.commit()

    before = client.get("/api/admin/imports/geocode/status", cookies=admin_cookie).json()
    assert before["pending"] == 1
    assert before["approximate"] == 1
    assert before["ignored"] == 0

    # Mute both rows.
    for adr in (1, 2):
        res = client.post(
            f"/api/admin/imports/members/{adr}/geocode/ignore?ignore=true",
            cookies=admin_cookie,
            headers={"X-CSRF-Token": "test-csrf-token"},
        )
        assert res.status_code == 200

    after = client.get("/api/admin/imports/geocode/status", cookies=admin_cookie).json()
    assert after["pending"] == 0
    assert after["approximate"] == 0
    assert after["ignored"] == 2

    # Un-mute one row and re-check.
    res = client.post(
        "/api/admin/imports/members/1/geocode/ignore?ignore=false",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200
    after2 = client.get("/api/admin/imports/geocode/status", cookies=admin_cookie).json()
    assert after2["pending"] == 1
    assert after2["ignored"] == 1


def test_geocode_stuck_endpoint_returns_buckets(client, admin_cookie, db_session):
    from app.services.imported_writer import write_dump

    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), `Strasse` varchar(200), `Ort` varchar(80), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'Pend','Foostr','Berlin'),(2,'Approx','Barstr','Berlin'),(3,'Good','Bazstr','Berlin');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    rows = {m.adr_nr: m for m in db_session.query(LwMember).all()}
    # adr_nr=1 stays pending, no coords.
    rows[1].geocode_notes = "Test note"
    # adr_nr=2 has coords but street precision.
    rows[2].lat = 52.5
    rows[2].lng = 13.4
    rows[2].geocode_status = "found"
    rows[2].geocode_precision = "street"
    rows[2].geocode_notes = "HERE kennt die Hausnummer nicht."
    # adr_nr=3 is fully resolved -- must not appear.
    rows[3].lat = 52.6
    rows[3].lng = 13.5
    rows[3].geocode_status = "found"
    rows[3].geocode_precision = "house"
    db_session.commit()

    res = client.get(
        "/api/admin/imports/geocode/stuck?bucket=all",
        cookies=admin_cookie,
    )
    assert res.status_code == 200
    items = res.json()
    assert {it["adr_nr"] for it in items} == {1, 2}
    by_id = {it["adr_nr"]: it for it in items}
    assert by_id[1]["bucket"] == "pending"
    assert by_id[2]["bucket"] == "approximate"
    assert by_id[2]["geocode_notes"] == "HERE kennt die Hausnummer nicht."

    # bucket=pending narrows to just the unresolved row.
    res = client.get(
        "/api/admin/imports/geocode/stuck?bucket=pending",
        cookies=admin_cookie,
    )
    assert {it["adr_nr"] for it in res.json()} == {1}


def test_geocode_describe_here_hit_notes():
    """The German notes should explain the demotion reason clearly."""
    from app.services.geocode import _describe_here_hit

    # Interpolated -> demoted to street
    note = _describe_here_hit(
        {"resultType": "houseNumber", "houseNumberType": "interpolated",
         "address": {"houseNumber": "12"}},
        "street",
        "12",
    )
    assert "interpoliert" in note

    # House number mismatch
    note = _describe_here_hit(
        {"resultType": "houseNumber", "houseNumberType": "PA",
         "address": {"houseNumber": "9"}},
        "street",
        "12",
    )
    assert "9" in note and "12" in note

    # Plain street centroid
    note = _describe_here_hit(
        {"resultType": "street"},
        "street",
        "12",
    )
    assert "Hausnummer" in note


def test_geocode_start_refuses_without_api_key(client, admin_cookie, monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "here_api_key", "")
    res = client.post(
        "/api/admin/imports/geocode/start",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 400
    assert "HERE_API_KEY" in res.json()["detail"]


def test_purge_endpoint(client, admin_cookie, db_session):
    sql = """
CREATE TABLE `adresse` (`AdrNr` int NOT NULL, `Vorname` varchar(30), PRIMARY KEY (`AdrNr`));
INSERT INTO `adresse` VALUES (1,'A'),(2,'B');
"""
    write_dump(db_session, parse_dump(sql), filename="t.sql", file_size_bytes=len(sql))
    assert db_session.query(LwMember).count() == 2

    res = client.delete(
        "/api/admin/imports/data",
        cookies=admin_cookie,
        headers={"X-CSRF-Token": "test-csrf-token"},
    )
    assert res.status_code == 200
    db_session.expire_all()
    assert db_session.query(LwMember).count() == 0
