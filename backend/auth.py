import os
import secrets
import logging
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = os.getenv("API_SECRET_TOKEN", "")
    if not token:
        logger.error("API_SECRET_TOKEN is not configured")
        raise HTTPException(status_code=500, detail="Server misconfiguration")
    if not secrets.compare_digest(credentials.credentials, token):
        raise HTTPException(status_code=403, detail="Unauthorized")
