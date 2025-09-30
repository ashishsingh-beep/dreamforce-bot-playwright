import asyncio
import time
from typing import List, Optional, Any, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from stage3 import process_leads

app = FastAPI(title="LLM Lead Processing API", version="0.1.0")

# -------------------- CORS --------------------
# Allow frontend (e.g., Vite dev server) to call this API.
# Adjust origins list for production as needed.
# ALLOWED_ORIGINS = [
#     "http://localhost:5173",
#     "http://127.0.0.1:5173",
# ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- Pydantic Schemas --------------------
class LeadIn(BaseModel):
    lead_id: Optional[str] = None
    tag: Optional[str] = None
    name: Optional[str] = None
    title: Optional[str] = None
    location: Optional[str] = None
    company_name: Optional[str] = None
    experience: Optional[Any] = None
    skills: Optional[Any] = None
    bio: Optional[str] = None
    profile_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    company_page_url: Optional[str] = None

class ProcessRequest(BaseModel):
    api_key: str = Field(..., description="Gemini API key for this batch")
    wildnet_data: str = Field(..., description="WildnetEdge contextual/company data")
    scoring_criteria_and_icp: str = Field(..., description="Scoring criteria and ICP definition")
    message_prompt: str = Field(..., description="Prompt/instructions for outreach message generation")
    leads: List[LeadIn] = Field(..., description="List of lead objects to process")

class LeadResult(BaseModel):
    lead_id: Optional[str]
    tag: Optional[str]
    name: Optional[str]
    linkedin_url: Optional[str]
    location: Optional[str]
    score: Optional[int]
    response: Optional[str]
    should_contact: Optional[int]
    message: Optional[str]
    subject: Optional[str]

class ProcessResponse(BaseModel):
    results: List[LeadResult]
    errors: List[Dict[str, Any]] = []
    duration_sec: float

# -------------------- Endpoint --------------------
@app.post("/process-leads", response_model=ProcessResponse)
async def process_leads_endpoint(payload: ProcessRequest):
    if not payload.leads:
        raise HTTPException(status_code=400, detail="No leads provided")

    start = time.monotonic()
    errors: List[Dict[str, Any]] = []

    # Run synchronous function in a thread (to avoid blocking event loop)
    loop = asyncio.get_event_loop()
    try:
        processed = await loop.run_in_executor(
            None,
            lambda: process_leads(
                [l.dict() for l in payload.leads],
                payload.api_key,
                payload.wildnet_data,
                payload.scoring_criteria_and_icp,
                payload.message_prompt
            )
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

    # processed already inserted into supabase inside process_leads; build response
    duration = time.monotonic() - start
    # No per-lead error capture currently beyond exceptions; extend here if needed
    return ProcessResponse(results=processed, errors=errors, duration_sec=round(duration, 3))

@app.get("/health")
async def health():
    return {"ok": True}

# Optional root
@app.get("/")
async def root():
    return {"service": "llm-backend", "status": "online"}

# If run directly (manual dev)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
