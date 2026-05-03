from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import os

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = os.getenv("API_SECRET_TOKEN")
    if credentials.credentials != token:
        raise HTTPException(status_code=403, detail="Unauthorized")
