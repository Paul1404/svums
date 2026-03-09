from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.rate_limit import RateLimitBucket


@dataclass
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int | None = None


def normalize_client_ip(client_host: str | None) -> str:
    return client_host or "unknown"


def _get_bucket(
    db: Session,
    scope: str,
    key: str,
    window_seconds: int,
    now: datetime,
) -> RateLimitBucket:
    bucket = (
        db.query(RateLimitBucket)
        .filter(
            RateLimitBucket.scope == scope,
            RateLimitBucket.key == key,
        )
        .first()
    )
    if not bucket:
        bucket = RateLimitBucket(
            scope=scope,
            key=key,
            count=0,
            window_started_at=now,
            blocked_until=None,
            updated_at=now,
        )
        db.add(bucket)
        db.flush()
        return bucket

    if bucket.blocked_until:
        if bucket.blocked_until > now:
            bucket.updated_at = now
            db.flush()
            return bucket
        bucket.blocked_until = None

    if bucket.window_started_at + timedelta(seconds=window_seconds) <= now:
        bucket.count = 0
        bucket.window_started_at = now
        bucket.blocked_until = None

    bucket.updated_at = now
    db.flush()
    return bucket


def consume_rate_limit(
    db: Session,
    *,
    scope: str,
    key: str,
    limit: int,
    window_seconds: int,
    block_seconds: int | None = None,
) -> RateLimitDecision:
    now = datetime.utcnow()
    bucket = _get_bucket(db, scope, key, window_seconds, now)

    if bucket.blocked_until and bucket.blocked_until > now:
        retry_after = max(1, int((bucket.blocked_until - now).total_seconds()))
        db.commit()
        return RateLimitDecision(allowed=False, retry_after_seconds=retry_after)

    if bucket.count >= limit:
        window_end = bucket.window_started_at + timedelta(seconds=window_seconds)
        bucket.blocked_until = (
            now + timedelta(seconds=block_seconds)
            if block_seconds is not None
            else window_end
        )
        bucket.updated_at = now
        db.commit()
        retry_after = max(1, int((bucket.blocked_until - now).total_seconds()))
        return RateLimitDecision(allowed=False, retry_after_seconds=retry_after)

    bucket.count += 1
    bucket.updated_at = now
    db.commit()
    return RateLimitDecision(allowed=True)


def record_failed_attempt(
    db: Session,
    *,
    scope: str,
    key: str,
    limit: int,
    window_seconds: int,
    block_seconds: int,
) -> RateLimitDecision:
    now = datetime.utcnow()
    bucket = _get_bucket(db, scope, key, window_seconds, now)

    if bucket.blocked_until and bucket.blocked_until > now:
        retry_after = max(1, int((bucket.blocked_until - now).total_seconds()))
        db.commit()
        return RateLimitDecision(allowed=False, retry_after_seconds=retry_after)

    bucket.count += 1
    bucket.updated_at = now
    if bucket.count >= limit:
        bucket.blocked_until = now + timedelta(seconds=block_seconds)
        db.commit()
        return RateLimitDecision(
            allowed=False,
            retry_after_seconds=max(1, block_seconds),
        )

    db.commit()
    return RateLimitDecision(allowed=True)


def is_rate_limited(
    db: Session,
    *,
    scope: str,
    key: str,
    window_seconds: int,
) -> RateLimitDecision:
    now = datetime.utcnow()
    bucket = _get_bucket(db, scope, key, window_seconds, now)
    if bucket.blocked_until and bucket.blocked_until > now:
        retry_after = max(1, int((bucket.blocked_until - now).total_seconds()))
        db.commit()
        return RateLimitDecision(allowed=False, retry_after_seconds=retry_after)
    db.commit()
    return RateLimitDecision(allowed=True)


def reset_rate_limit(
    db: Session,
    *,
    scope: str,
    key: str,
) -> None:
    (
        db.query(RateLimitBucket)
        .filter(
            RateLimitBucket.scope == scope,
            RateLimitBucket.key == key,
        )
        .delete()
    )
    db.commit()
