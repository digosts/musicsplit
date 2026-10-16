"""MoisesPwa backend: baixa áudio do YouTube (yt-dlp) e separa as faixas com Demucs."""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("MOISES_DATA", BASE_DIR / "data"))
TRACKS_DIR = DATA_DIR / "tracks"
# Opcional: se definido, o app precisa enviar o header "X-Api-Token" com este valor
API_TOKEN = os.environ.get("API_TOKEN", "")
# Opcional: arquivo cookies.txt do YouTube (necessário em servidores na nuvem que o YouTube bloqueia)
YTDLP_COOKIES = os.environ.get("YTDLP_COOKIES", "")

# htdemucs_6s: vocals, drums, bass, piano, guitar, other
MODEL = os.environ.get("DEMUCS_MODEL", "htdemucs_6s")
MP3_BITRATE = os.environ.get("MP3_BITRATE", "320")
# Mais shifts = um pouco mais de qualidade, porém mais lento (padrão do Demucs = 1)
SHIFTS = os.environ.get("DEMUCS_SHIFTS", "2")

STEM_ORDER = ["vocals", "drums", "bass", "piano", "guitar", "other"]

TRACKS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="MoisesPwa")


@app.middleware("http")
async def check_token(request: Request, call_next):  # type: ignore[no-untyped-def]
    # arquivos de áudio ficam livres (o <audio> não envia headers); o resto exige o token
    protected = request.url.path.startswith("/api/") and not request.url.path.startswith(("/api/files/", "/api/health"))
    if API_TOKEN and protected and request.method != "OPTIONS" and request.headers.get("x-api-token") != API_TOKEN:
        return JSONResponse({"detail": "Token inválido"}, status_code=401)
    return await call_next(request)


# o CORS precisa envolver o middleware de token, por isso é adicionado depois
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def ydl_base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {"quiet": True, "noplaylist": True, "no_warnings": True}
    if shutil.which("deno") is None and shutil.which("node"):
        # o YouTube exige um runtime JavaScript; usa o Node se o Deno não estiver instalado
        opts["js_runtimes"] = {"node": {}}
    if YTDLP_COOKIES and Path(YTDLP_COOKIES).exists():
        opts["cookiefile"] = YTDLP_COOKIES
    return opts


# ---------------------------------------------------------------- tracks


def read_track(track_dir: Path) -> dict[str, Any] | None:
    meta = track_dir / "meta.json"
    if not meta.exists():
        return None
    return json.loads(meta.read_text(encoding="utf-8"))


def list_tracks() -> list[dict[str, Any]]:
    tracks = [t for d in TRACKS_DIR.iterdir() if d.is_dir() and (t := read_track(d))]
    return sorted(tracks, key=lambda t: t["created_at"], reverse=True)


def safe_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value):
        raise HTTPException(400, "id inválido")
    return value


# ---------------------------------------------------------------- jobs

jobs: dict[str, dict[str, Any]] = {}
job_queue: "queue.Queue[str]" = queue.Queue()
jobs_lock = threading.Lock()


def update_job(job_id: str, **fields: Any) -> None:
    with jobs_lock:
        jobs[job_id].update(fields)


def download_audio(job_id: str, url: str, track_dir: Path, info: dict[str, Any]) -> Path:
    def hook(d: dict[str, Any]) -> None:
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                update_job(job_id, progress=d.get("downloaded_bytes", 0) / total * 100)

    opts = {
        **ydl_base_opts(),
        "format": "bestaudio/best",
        "outtmpl": str(track_dir / "source.%(ext)s"),
        "progress_hooks": [hook],
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([info.get("webpage_url") or url])
    return track_dir / "source.wav"


def separate(job_id: str, source: Path, track_dir: Path) -> list[str]:
    out_dir = track_dir / "_demucs"
    cmd = [
        sys.executable, "-m", "demucs",
        "-n", MODEL,
        "--shifts", SHIFTS,
        "--mp3", "--mp3-bitrate", MP3_BITRATE,
        "-o", str(out_dir),
        "--filename", "{stem}.{ext}",
        str(source),
    ]
    proc = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL)
    assert proc.stderr is not None
    buf = b""
    log: list[str] = []
    while chunk := proc.stderr.read(256):
        buf += chunk
        # tqdm usa \r para redesenhar a barra de progresso
        *lines, buf = re.split(rb"[\r\n]", buf)
        for line in lines:
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            log.append(text)
            if m := re.search(r"(\d{1,3})%\|", text):
                update_job(job_id, progress=float(m.group(1)))
    if proc.wait() != 0:
        raise RuntimeError("Demucs falhou:\n" + "\n".join(log[-15:]))

    stems: list[str] = []
    for f in (out_dir / MODEL).glob("*.mp3"):
        shutil.move(str(f), track_dir / f.name)
        stems.append(f.stem)
    shutil.rmtree(out_dir, ignore_errors=True)
    return sorted(stems, key=lambda s: STEM_ORDER.index(s) if s in STEM_ORDER else 99)


def make_original(source: Path, track_dir: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
         "-b:a", f"{MP3_BITRATE}k", str(track_dir / "original.mp3")],
        check=True,
    )


def process_job(job_id: str) -> None:
    url = jobs[job_id]["url"]
    track_dir: Path | None = None
    try:
        update_job(job_id, status="info", message="Lendo informações do vídeo…")
        with yt_dlp.YoutubeDL(ydl_base_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
        if info.get("_type") == "playlist":
            info = info["entries"][0]
        track_id = re.sub(r"[^A-Za-z0-9_-]", "_", info["id"])
        track_dir = TRACKS_DIR / track_id
        if read_track(track_dir):
            update_job(job_id, status="done", progress=100, track_id=track_id, message="Já estava na biblioteca")
            return
        shutil.rmtree(track_dir, ignore_errors=True)
        track_dir.mkdir(parents=True)

        title = info.get("track") or info.get("title") or track_id
        artist = info.get("artist") or info.get("uploader") or ""
        update_job(job_id, title=title, status="downloading", progress=0, message="Baixando áudio…")
        source = download_audio(job_id, url, track_dir, info)

        update_job(job_id, status="separating", progress=0, message="Separando faixas com IA…")
        stems = separate(job_id, source, track_dir)

        update_job(job_id, status="finishing", progress=100, message="Finalizando…")
        make_original(source, track_dir)
        source.unlink(missing_ok=True)

        meta = {
            "id": track_id,
            "title": title,
            "artist": artist,
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "source_url": info.get("webpage_url") or url,
            "stems": stems,
            "model": MODEL,
            "created_at": time.time(),
        }
        (track_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        update_job(job_id, status="done", progress=100, track_id=track_id, message="Pronto!")
    except Exception as exc:  # noqa: BLE001
        if track_dir and not read_track(track_dir):
            shutil.rmtree(track_dir, ignore_errors=True)
        update_job(job_id, status="error", message=str(exc)[-800:])


def worker() -> None:
    while True:
        job_id = job_queue.get()
        process_job(job_id)


threading.Thread(target=worker, daemon=True).start()


# ---------------------------------------------------------------- API


class JobIn(BaseModel):
    url: str


@app.get("/api/health")
def health() -> dict[str, Any]:
    import torch

    return {
        "ok": True,
        "model": MODEL,
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "token_required": bool(API_TOKEN),
    }


@app.post("/api/jobs")
def create_job(body: JobIn) -> dict[str, Any]:
    url = body.url.strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(400, "Informe um link válido (http/https)")
    job_id = uuid.uuid4().hex[:12]
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id, "url": url, "status": "queued", "progress": 0,
            "message": "Na fila…", "title": None, "track_id": None, "created_at": time.time(),
        }
    job_queue.put(job_id)
    return jobs[job_id]


@app.get("/api/jobs")
def get_jobs() -> list[dict[str, Any]]:
    with jobs_lock:
        return sorted(jobs.values(), key=lambda j: j["created_at"], reverse=True)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    if job_id not in jobs:
        raise HTTPException(404, "Job não encontrado")
    return jobs[job_id]


@app.delete("/api/jobs/{job_id}")
def dismiss_job(job_id: str) -> dict[str, bool]:
    with jobs_lock:
        job = jobs.get(job_id)
        if job and job["status"] in ("done", "error"):
            del jobs[job_id]
    return {"ok": True}


@app.get("/api/tracks")
def get_tracks() -> list[dict[str, Any]]:
    return list_tracks()


@app.get("/api/tracks/{track_id}")
def get_track(track_id: str) -> dict[str, Any]:
    track = read_track(TRACKS_DIR / safe_id(track_id))
    if not track:
        raise HTTPException(404, "Música não encontrada")
    return track


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str) -> dict[str, bool]:
    shutil.rmtree(TRACKS_DIR / safe_id(track_id), ignore_errors=True)
    return {"ok": True}


app.mount("/api/files", StaticFiles(directory=TRACKS_DIR), name="files")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
