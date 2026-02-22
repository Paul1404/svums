"""
Object storage service backed by Tigris (S3-compatible).

Required environment variables (set automatically by `fly storage create`):
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_ENDPOINT_URL_S3
  AWS_REGION
  BUCKET_NAME
"""

import logging
import os

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

BUCKET = os.environ.get("BUCKET_NAME", "svums-uploads")


def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL_S3"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_REGION", "auto"),
    )


def upload_file(filename: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload bytes to object storage under the given key."""
    _client().put_object(Bucket=BUCKET, Key=filename, Body=data, ContentType=content_type)
    logger.debug(f"Uploaded {filename} ({len(data)} bytes) to storage")


def download_file(filename: str) -> bytes | None:
    """Return file bytes, or None if the key does not exist."""
    try:
        resp = _client().get_object(Bucket=BUCKET, Key=filename)
        return resp["Body"].read()
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise


def delete_file(filename: str) -> None:
    """Delete a file from storage (silently ignores missing keys)."""
    try:
        _client().delete_object(Bucket=BUCKET, Key=filename)
        logger.debug(f"Deleted {filename} from storage")
    except ClientError:
        pass


def file_exists(filename: str) -> bool:
    """Return True if the key exists in the bucket."""
    try:
        _client().head_object(Bucket=BUCKET, Key=filename)
        return True
    except ClientError:
        return False
