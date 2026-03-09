from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from app.database import Base


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"
    __table_args__ = (UniqueConstraint("scope", "key", name="uq_rate_limit_scope_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    scope = Column(String(50), nullable=False)
    key = Column(String(255), nullable=False)
    count = Column(Integer, nullable=False, default=0)
    window_started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    blocked_until = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
