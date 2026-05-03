import redis
import os

r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)
