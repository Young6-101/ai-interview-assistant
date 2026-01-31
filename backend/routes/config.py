from fastapi import APIRouter
import os

router = APIRouter(prefix='/api/config')

@router.get('/assemblyai')
async def get_assemblyai_config():
    """Return AssemblyAI configuration for front-end usage.
    Prefer returning a short-lived token if available; otherwise return apiKey.
    """
    token = os.environ.get('ASSEMBLYAI_TOKEN')
    api_key = os.environ.get('ASSEMBLYAI_API_KEY')

    result = {}
    if token:
        result['token'] = token
    if api_key:
        result['apiKey'] = api_key

    return result
