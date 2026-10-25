import os
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Speakomo ASR Whisper Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None

def get_model():
    global _model
    if _model is None:
        import whisper
        model_name = os.getenv("WHISPER_MODEL", "base")
        _model = whisper.load_model(model_name)
    return _model

@app.get("/health")
def health():
    return {"status": "ok", "service": "speakomo-local-asr"}

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    try:
        model = get_model()
        suffix = os.path.splitext(file.filename or "")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        try:
            result = model.transcribe(tmp_path, fp16=False)
            return {
                "text": result.get("text", "").strip(),
                "duration": result.get("segments", [{}])[-1].get("end") if result.get("segments") else None,
                "language": result.get("language", "en"),
            }
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
