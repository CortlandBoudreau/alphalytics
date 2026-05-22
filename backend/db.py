import redis
import os
import logging

logger = logging.getLogger(__name__)

_url = os.getenv("REDIS_URL", "redis://localhost:6379")

# Railway reference variables (e.g. ${{Redis.REDIS_URL}}) are resolved at
# deploy time, but if the service link is broken the literal placeholder is
# injected instead.  Guard against that so the app can at least start — Redis
# operations will fail at request time with a clear error rather than crashing
# the whole process on import.
if not _url.startswith(("redis://", "rediss://", "unix://")):
    logger.warning(
        "REDIS_URL %r has no valid scheme (unresolved reference variable?). "
        "Falling back to redis://localhost:6379 — Redis will not work until "
        "REDIS_URL is set correctly in Railway.",
        _url,
    )
    _url = "redis://localhost:6379"

r = redis.from_url(_url, decode_responses=True)
