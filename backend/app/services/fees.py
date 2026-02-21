from datetime import date
from decimal import Decimal


def stichtag() -> date:
    """Return Jan 1st of the current year (Stichtag for fee categories)."""
    return date(date.today().year, 1, 1)


def calculate_age(geburtsdatum: date, reference_date: date | None = None) -> int:
    """Calculate age in years from birth date.

    If no reference_date is given, uses Jan 1st of the current year
    (Stichtag) for membership category purposes.
    """
    if reference_date is None:
        reference_date = stichtag()
    age = reference_date.year - geburtsdatum.year
    if (reference_date.month, reference_date.day) < (geburtsdatum.month, geburtsdatum.day):
        age -= 1
    return age


def calculate_real_age(geburtsdatum: date) -> int:
    """Calculate actual age as of today (for validation, not fee categories)."""
    today = date.today()
    age = today.year - geburtsdatum.year
    if (today.month, today.day) < (geburtsdatum.month, geburtsdatum.day):
        age -= 1
    return age


def determine_mitgliedschaft_typ(geburtsdatum: date, is_familie: bool = False) -> str:
    """Determine membership type from birthdate using Stichtag (Jan 1st)."""
    if is_familie:
        return "familie"
    age = calculate_age(geburtsdatum)  # uses Stichtag
    if age < 14:
        return "kind"
    elif age < 18:
        return "jugendlich"
    elif age < 25:
        return "junger_erwachsener"
    else:
        return "erwachsener"


def calculate_fee(
    mitgliedschaft_typ: str,
    elternteil_mitglied: bool | None = None,
) -> tuple[Decimal, str]:
    """
    Calculate annual membership fee.
    Returns (fee, label).
    """
    if mitgliedschaft_typ == "familie":
        return Decimal("96.00"), "Familie (2 Erwachsene + Kinder bis 18 Jahre)"

    if mitgliedschaft_typ == "kind":
        if elternteil_mitglied:
            return Decimal("12.00"), "Kinder (bis 14 Jahre), 1 Elternteil Mitglied"
        else:
            return Decimal("24.00"), "Kinder (bis 14 Jahre), kein Elternteil Mitglied"

    if mitgliedschaft_typ == "jugendlich":
        if elternteil_mitglied:
            return Decimal("24.00"), "Jugendliche (bis 18 Jahre), 1 Elternteil Mitglied"
        else:
            return Decimal("36.00"), "Jugendliche (bis 18 Jahre), kein Elternteil Mitglied"

    if mitgliedschaft_typ == "junger_erwachsener":
        return Decimal("42.00"), "Junge Leute (bis 25 Jahre)"

    if mitgliedschaft_typ == "erwachsener":
        return Decimal("54.00"), "Erwachsene"

    raise ValueError(f"Ungültiger Mitgliedschaftstyp: {mitgliedschaft_typ}")
