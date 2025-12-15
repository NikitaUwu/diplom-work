from fastapi import APIRouter

from . import auth, charts

router = APIRouter()

# /api/v1/auth/...
router.include_router(auth.router, prefix="/auth", tags=["auth"])

# /api/v1/charts/...
router.include_router(charts.router, prefix="/charts", tags=["charts"])
